'use strict';

/**
 * shippingTrackingPollerJob — Cron job para polling de rastreio Melhor Envio.
 *
 * A cada 30 minutos consulta status de envios ativos via ME API,
 * insere novos eventos de tracking, atualiza status da shipping_order
 * e notifica o comprador quando o status muda.
 *
 * Ativacao: chamado em index.js apos server.listen()
 */

const cron = require('node-cron');
const { logger } = require('../../logger');
const { getSupabaseClient } = require('../supabase');

const JOB_NAME = 'shippingTrackingPollerJob';
const sb = () => getSupabaseClient();
let _started = false;

// ---------------------------------------------------------------------------
// ME status -> our enum mapping
// ---------------------------------------------------------------------------

const ME_STATUS_MAP = {
  posted: 'posted',
  in_transit: 'in_transit',
  transit: 'in_transit',
  out_for_delivery: 'in_transit', // sub-event, logged but no main status change
  delivered: 'delivered',
  returned: 'cancelled',
};

// Statuses that represent "active" shipments worth polling
const ACTIVE_STATUSES = ['paid', 'generated', 'posted', 'in_transit'];

// ---------------------------------------------------------------------------
// Shared helper: processTrackingUpdate
// ---------------------------------------------------------------------------

/**
 * Processes a tracking update for a single shipping order.
 * Used by both the polling job and the webhook handler.
 *
 * @param {object} shippingOrder - Row from shipping_orders
 * @param {object} meTrackingData - Tracking data from ME API for this order
 * @returns {Promise<{updated: boolean, newStatus: string|null, newEventsCount: number}>}
 */
async function processTrackingUpdate(shippingOrder, meTrackingData) {
  const TAG = `[${JOB_NAME}.processTrackingUpdate]`;
  const supabase = sb();
  if (!supabase) {
    logger.warn(`${TAG} Supabase indisponivel`, { action: 'TRACKING_NO_SUPABASE' });
    return { updated: false, newStatus: null, newEventsCount: 0 };
  }

  const shippingOrderId = shippingOrder.id;
  const meOrderId = shippingOrder.me_order_id;

  // 1. Parse tracking events from ME response
  const rawEvents = _parseTrackingEvents(meTrackingData);
  if (rawEvents.length === 0) {
    return { updated: false, newStatus: null, newEventsCount: 0 };
  }

  // 2. Get latest existing event for this shipping order
  const { data: existingEvents } = await supabase
    .from('shipping_tracking_events')
    .select('occurred_at')
    .eq('shipping_order_id', shippingOrderId)
    .order('occurred_at', { ascending: false })
    .limit(1);

  const latestExistingAt = existingEvents?.[0]?.occurred_at
    ? new Date(existingEvents[0].occurred_at).getTime()
    : 0;

  // 3. Filter to only new events
  const newEvents = rawEvents.filter(
    evt => new Date(evt.occurred_at).getTime() > latestExistingAt
  );

  if (newEvents.length === 0) {
    return { updated: false, newStatus: null, newEventsCount: 0 };
  }

  // 4. Insert new events
  const eventsToInsert = newEvents.map(evt => ({
    shipping_order_id: shippingOrderId,
    status: evt.status,
    description: evt.description || '',
    location: evt.location || '',
    occurred_at: evt.occurred_at,
    raw_data: evt.raw || {},
  }));

  const { error: insertErr } = await supabase
    .from('shipping_tracking_events')
    .insert(eventsToInsert);

  if (insertErr) {
    logger.error(`${TAG} Erro ao inserir tracking events`, {
      action: 'TRACKING_INSERT_ERROR',
      shippingOrderId,
      error: insertErr.message,
    });
  }

  // 5. Determine latest status from all new events (last one wins)
  const latestEvent = newEvents[newEvents.length - 1];
  const mappedStatus = ME_STATUS_MAP[latestEvent.status] || null;

  // 6. Update shipping_orders if status changed
  let statusChanged = false;
  let newStatus = null;

  if (mappedStatus && mappedStatus !== shippingOrder.status) {
    // out_for_delivery maps to in_transit — only update if not already in_transit
    if (latestEvent.status === 'out_for_delivery' && shippingOrder.status === 'in_transit') {
      // Already in_transit — no status change needed, just log
      logger.info(`${TAG} Sub-evento out_for_delivery registrado (status nao muda)`, {
        action: 'TRACKING_SUBEVENT_LOGGED',
        shippingOrderId,
        meOrderId,
      });
    } else {
      const updatePayload = { status: mappedStatus };

      // Also update tracking_code if present
      const trackingCode = _extractTrackingCode(meTrackingData);
      if (trackingCode && trackingCode !== shippingOrder.tracking_code) {
        updatePayload.tracking_code = trackingCode;
      }

      if (mappedStatus === 'delivered') {
        updatePayload.delivered_at = new Date().toISOString();
      }

      const { error: updateErr } = await supabase
        .from('shipping_orders')
        .update(updatePayload)
        .eq('id', shippingOrderId);

      if (updateErr) {
        logger.error(`${TAG} Erro ao atualizar shipping_order`, {
          action: 'TRACKING_UPDATE_ERROR',
          shippingOrderId,
          error: updateErr.message,
        });
      } else {
        statusChanged = true;
        newStatus = mappedStatus;

        logger.info(`${TAG} Status atualizado`, {
          action: 'TRACKING_STATUS_UPDATED',
          shippingOrderId,
          meOrderId,
          oldStatus: shippingOrder.status,
          newStatus: mappedStatus,
        });
      }
    }
  } else {
    // Status didn't change, but still update tracking_code if new
    const trackingCode = _extractTrackingCode(meTrackingData);
    if (trackingCode && trackingCode !== shippingOrder.tracking_code) {
      await supabase
        .from('shipping_orders')
        .update({ tracking_code: trackingCode })
        .eq('id', shippingOrderId);
    }
  }

  // 7. If status changed, notify buyer + update marketplace_order if delivered
  if (statusChanged && newStatus) {
    await _notifyBuyerAndUpdateOrder(shippingOrder, newStatus, latestEvent);
  }

  return { updated: statusChanged, newStatus, newEventsCount: newEvents.length };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parses ME tracking response into a normalized array of events.
 */
function _parseTrackingEvents(meTrackingData) {
  if (!meTrackingData) return [];

  // ME tracking response can be:
  // - An object keyed by order UUID: { "uuid": { tracking: {...}, ... } }
  // - Or direct tracking data: { tracking: "CODE", events: [...], status: "..." }
  let trackingObj = meTrackingData;

  // If keyed by UUID, extract first value
  if (typeof trackingObj === 'object' && !trackingObj.status && !trackingObj.tracking) {
    const keys = Object.keys(trackingObj);
    if (keys.length > 0) {
      trackingObj = trackingObj[keys[0]];
    }
  }

  // If no events array, try to infer from status field
  if (!trackingObj) return [];

  // ME may return status directly without events array in some cases
  if (trackingObj.melhor_rastreio_events && Array.isArray(trackingObj.melhor_rastreio_events)) {
    return trackingObj.melhor_rastreio_events.map(evt => ({
      status: evt.status || '',
      description: evt.description || evt.message || '',
      location: evt.location || evt.city || '',
      occurred_at: evt.date || evt.created_at || new Date().toISOString(),
      raw: evt,
    }));
  }

  // Standard events array
  if (Array.isArray(trackingObj.events)) {
    return trackingObj.events.map(evt => ({
      status: evt.status || '',
      description: evt.description || evt.message || '',
      location: evt.location || evt.city || '',
      occurred_at: evt.date || evt.datetime || evt.created_at || new Date().toISOString(),
      raw: evt,
    }));
  }

  // Fallback: if just a status field is present, create a single synthetic event
  if (trackingObj.status) {
    return [{
      status: trackingObj.status,
      description: trackingObj.description || '',
      location: trackingObj.location || '',
      occurred_at: trackingObj.updated_at || trackingObj.created_at || new Date().toISOString(),
      raw: trackingObj,
    }];
  }

  return [];
}

/**
 * Extracts tracking code from ME tracking data.
 */
function _extractTrackingCode(meTrackingData) {
  if (!meTrackingData) return null;

  // Direct field
  if (meTrackingData.tracking) return meTrackingData.tracking;

  // Keyed by UUID
  const keys = Object.keys(meTrackingData);
  if (keys.length > 0 && meTrackingData[keys[0]]?.tracking) {
    return meTrackingData[keys[0]].tracking;
  }

  return null;
}

/**
 * Notifies the buyer about a shipping status change and updates marketplace_order if delivered.
 */
async function _notifyBuyerAndUpdateOrder(shippingOrder, newStatus, event) {
  const TAG = `[${JOB_NAME}._notifyBuyerAndUpdateOrder]`;
  const supabase = sb();
  if (!supabase) return;

  const orderId = shippingOrder.order_id;
  if (!orderId) return;

  // Get buyer_id from marketplace_orders
  const { data: order } = await supabase
    .from('marketplace_orders')
    .select('id, buyer_id, status')
    .eq('id', orderId)
    .maybeSingle();

  if (!order) {
    logger.warn(`${TAG} marketplace_order nao encontrada`, {
      action: 'TRACKING_ORDER_NOT_FOUND',
      orderId,
    });
    return;
  }

  // Dispatch notification to buyer (if buyer_id exists — skip for guest orders)
  if (order.buyer_id) {
    const NotificationDispatcher = require('../../services/NotificationDispatcher');
    const trackingCode = shippingOrder.tracking_code || '';

    NotificationDispatcher.dispatch({
      userId: order.buyer_id,
      type: 'shipping_status_changed',
      importance: 'high',
      data: {
        orderId,
        status: newStatus,
        location: event.location || '',
        trackingCode,
      },
      dedupKey: `shipping_track_${shippingOrder.id}_${newStatus}`,
      metadata: { triggeredBy: 'system' },
    }).catch(() => {});
  }

  // When status reaches 'delivered', update marketplace_order if still in progress/shipped
  if (newStatus === 'delivered') {
    const updatableStatuses = ['shipped', 'in_progress'];
    if (updatableStatuses.includes(order.status)) {
      const { error: mktErr } = await supabase
        .from('marketplace_orders')
        .update({ status: 'delivered' })
        .eq('id', orderId)
        .in('status', updatableStatuses);

      if (mktErr) {
        logger.error(`${TAG} Erro ao atualizar marketplace_order para delivered`, {
          action: 'TRACKING_MKT_ORDER_UPDATE_ERROR',
          orderId,
          error: mktErr.message,
        });
      } else {
        logger.info(`${TAG} marketplace_order atualizado para delivered`, {
          action: 'TRACKING_MKT_ORDER_DELIVERED',
          orderId,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Polling job
// ---------------------------------------------------------------------------

async function _runOnce() {
  const TAG = `[${JOB_NAME}._runOnce]`;
  logger.info(`${TAG} Iniciando polling de rastreio`, {
    service: JOB_NAME, action: 'SHIPPING_TRACKING_POLL_START',
  });

  const supabase = sb();
  if (!supabase) {
    logger.warn(`${TAG} Supabase indisponivel — abortando`, {
      service: JOB_NAME, action: 'SHIPPING_TRACKING_NO_SUPABASE',
    });
    return { polled: 0, updated: 0, errors: 0 };
  }

  // 1. Query active shipping orders
  const { data: activeOrders, error: queryErr } = await supabase
    .from('shipping_orders')
    .select('id, order_id, me_order_id, status, tracking_code')
    .in('status', ACTIVE_STATUSES)
    .not('me_order_id', 'is', null)
    .limit(50);

  if (queryErr) {
    logger.error(`${TAG} Erro ao buscar shipping_orders ativas`, {
      service: JOB_NAME, action: 'SHIPPING_TRACKING_QUERY_ERROR',
      error: queryErr.message,
    });
    return { polled: 0, updated: 0, errors: 1 };
  }

  if (!activeOrders || activeOrders.length === 0) {
    logger.info(`${TAG} Nenhum envio ativo para polling`, {
      service: JOB_NAME, action: 'SHIPPING_TRACKING_NO_ACTIVE',
    });
    return { polled: 0, updated: 0, errors: 0 };
  }

  // 2. Poll tracking for each order
  const melhorEnvioService = require('../../services/melhorEnvioService');
  let polled = 0;
  let updated = 0;
  let errors = 0;

  for (const order of activeOrders) {
    try {
      const trackingData = await melhorEnvioService.getTracking(order.me_order_id);
      polled++;

      const result = await processTrackingUpdate(order, trackingData);
      if (result.updated) updated++;
    } catch (err) {
      errors++;
      logger.warn(`${TAG} Erro ao processar tracking`, {
        service: JOB_NAME, action: 'SHIPPING_TRACKING_SINGLE_ERROR',
        shippingOrderId: order.id,
        meOrderId: order.me_order_id,
        error: err.message,
      });
    }
  }

  logger.info(`${TAG} Polling concluido`, {
    service: JOB_NAME, action: 'SHIPPING_TRACKING_POLL_DONE',
    polled, updated, errors,
  });

  return { polled, updated, errors };
}

// ---------------------------------------------------------------------------
// Cron schedule
// ---------------------------------------------------------------------------

function startShippingTrackingPollerJob() {
  if (_started) return;
  _started = true;

  // Every 30 minutes
  cron.schedule('*/30 * * * *', () => {
    _runOnce().catch(() => { /* errors already logged in _runOnce */ });
  }, { timezone: 'America/Sao_Paulo' });

  logger.info(`[${JOB_NAME}] Job registrado (a cada 30min)`, {
    service: JOB_NAME, action: 'SHIPPING_TRACKING_JOB_REGISTERED',
  });
}

function stopShippingTrackingPollerJob() {
  _started = false;
  logger.info(`[${JOB_NAME}] Job marcado como parado`, {
    service: JOB_NAME, action: 'SHIPPING_TRACKING_JOB_STOPPED',
  });
}

module.exports = {
  startShippingTrackingPollerJob,
  stopShippingTrackingPollerJob,
  processTrackingUpdate,
  _runOnce,
};
