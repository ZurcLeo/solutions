/**
 * @fileoverview Webhook Admin Controller — DLQ + Subscription management
 *
 * Endpoints admin para gerenciar webhooks ElosCloud ↔ IconChat:
 *   - Stats de delivery (por status)
 *   - DLQ: listar abandonados + replay
 *   - Subscriptions: criar, listar, toggle
 *
 * Todas as rotas protegidas por verifyToken + requireAdmin em admin.js
 */

'use strict';

const crypto = require('crypto');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const CTRL = 'webhookAdminController';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

// ---------------------------------------------------------------------------
// GET /api/admin/webhooks/stats
// ---------------------------------------------------------------------------

exports.getWebhookStats = async (req, res) => {
  try {
    const supabase = sb();

    const { data, error } = await supabase.rpc('get_webhook_delivery_stats');

    if (error) {
      // Fallback: query manual se RPC não existir
      const counts = {};
      for (const status of ['delivered', 'failed', 'abandoned', 'pending']) {
        const { count } = await supabase
          .from('webhook_delivery_log')
          .select('*', { count: 'exact', head: true })
          .eq('status', status);
        counts[status] = count || 0;
      }

      return res.json({ success: true, data: counts });
    }

    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] getWebhookStats error`, { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ---------------------------------------------------------------------------
// GET /api/admin/webhooks/abandoned
// ---------------------------------------------------------------------------

exports.listAbandoned = async (req, res) => {
  try {
    const { sellerId, page = 1, limit = 20 } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const pageLimit = Math.min(100, Math.max(1, parseInt(limit)));

    let query = sb()
      .from('webhook_delivery_log')
      .select(`
        id, event_id, event_type, status, attempts, max_attempts,
        last_error, http_status, created_at,
        subscription:subscription_id (seller_id, endpoint_url, provider)
      `, { count: 'exact' })
      .eq('status', 'abandoned')
      .order('created_at', { ascending: false })
      .range(offset, offset + pageLimit - 1);

    if (sellerId) {
      // Filtrar por seller via subscription
      const { data: subs } = await sb()
        .from('webhook_subscriptions')
        .select('id')
        .eq('seller_id', sellerId);
      const subIds = (subs || []).map(s => s.id);
      if (subIds.length === 0) {
        return res.json({ success: true, data: [], total: 0 });
      }
      query = query.in('subscription_id', subIds);
    }

    const { data, count, error } = await query;

    if (error) throw error;

    return res.json({
      success: true,
      data: data || [],
      total: count || 0,
      page: parseInt(page),
      limit: pageLimit,
    });
  } catch (err) {
    logger.error(`[${CTRL}] listAbandoned error`, { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ---------------------------------------------------------------------------
// POST /api/admin/webhooks/:deliveryLogId/replay
// ---------------------------------------------------------------------------

exports.replayEvent = async (req, res) => {
  try {
    const { deliveryLogId } = req.params;

    const { data: entry, error: fetchErr } = await sb()
      .from('webhook_delivery_log')
      .select('id, status, event_id, event_type')
      .eq('id', deliveryLogId)
      .single();

    if (fetchErr || !entry) {
      return res.status(404).json({ success: false, error: 'delivery_log_not_found' });
    }

    if (entry.status === 'delivered') {
      return res.status(400).json({ success: false, error: 'already_delivered' });
    }

    const { error: updateErr } = await sb()
      .from('webhook_delivery_log')
      .update({
        status: 'pending',
        attempts: 0,
        next_retry_at: new Date().toISOString(),
        last_error: `replayed by admin ${req.user.uid} at ${new Date().toISOString()}`,
      })
      .eq('id', deliveryLogId);

    if (updateErr) throw updateErr;

    logger.info(`[${CTRL}] Webhook replayed`, {
      deliveryLogId,
      eventId: entry.event_id,
      eventType: entry.event_type,
      adminId: req.user.uid,
    });

    return res.json({ success: true, message: 'Event queued for retry' });
  } catch (err) {
    logger.error(`[${CTRL}] replayEvent error`, { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ---------------------------------------------------------------------------
// POST /api/admin/webhooks/subscriptions
// ---------------------------------------------------------------------------

exports.createSubscription = async (req, res) => {
  try {
    const { sellerId, endpointUrl, provider = 'icon_chat', eventsEnabled = [], iconTenantId } = req.body;

    if (!sellerId || !endpointUrl) {
      return res.status(400).json({ success: false, error: 'sellerId and endpointUrl are required' });
    }

    const hmacSecret = crypto.randomBytes(32).toString('hex');

    const { data, error } = await sb()
      .from('webhook_subscriptions')
      .insert({
        seller_id: sellerId,
        endpoint_url: endpointUrl,
        provider,
        hmac_secret: hmacSecret,
        is_active: true,
        events_enabled: eventsEnabled,
        icon_tenant_id: iconTenantId || null,
      })
      .select('id, seller_id, endpoint_url, provider, is_active, events_enabled, icon_tenant_id, created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ success: false, error: 'subscription_already_exists' });
      }
      throw error;
    }

    logger.info(`[${CTRL}] Subscription created`, {
      subscriptionId: data.id,
      sellerId,
      adminId: req.user.uid,
    });

    // Retornar hmac_secret apenas na criação (único momento em que é visível)
    return res.status(201).json({
      success: true,
      data: { ...data, hmac_secret: hmacSecret },
    });
  } catch (err) {
    logger.error(`[${CTRL}] createSubscription error`, { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ---------------------------------------------------------------------------
// GET /api/admin/webhooks/subscriptions
// ---------------------------------------------------------------------------

exports.listSubscriptions = async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('webhook_subscriptions')
      .select('id, seller_id, endpoint_url, provider, is_active, admin_confirmed_at, events_enabled, icon_tenant_id, franchise_pending, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.json({ success: true, data: data || [] });
  } catch (err) {
    logger.error(`[${CTRL}] listSubscriptions error`, { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/admin/webhooks/subscriptions/:id/confirm — Admin confirma config no IconChat
// ---------------------------------------------------------------------------

exports.confirmSubscription = async (req, res) => {
  try {
    const { id } = req.params;
    const iconChatService = require('../services/iconChatProvisioningService');
    const data = await iconChatService.adminConfirm(id);

    logger.info(`[${CTRL}] Subscription confirmed by admin`, {
      subscriptionId: id,
      adminId: req.user.uid,
    });

    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] confirmSubscription error`, { error: err.message });
    return res.status(err.message === 'Subscription não encontrada.' ? 404 : 500)
      .json({ success: false, error: err.message });
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/admin/webhooks/subscriptions/:id/toggle
// ---------------------------------------------------------------------------

exports.toggleSubscription = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: current, error: fetchErr } = await sb()
      .from('webhook_subscriptions')
      .select('id, is_active')
      .eq('id', id)
      .single();

    if (fetchErr || !current) {
      return res.status(404).json({ success: false, error: 'subscription_not_found' });
    }

    const newState = !current.is_active;

    const { error: updateErr } = await sb()
      .from('webhook_subscriptions')
      .update({ is_active: newState, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (updateErr) throw updateErr;

    logger.info(`[${CTRL}] Subscription toggled`, {
      subscriptionId: id,
      is_active: newState,
      adminId: req.user.uid,
    });

    return res.json({ success: true, data: { id, is_active: newState } });
  } catch (err) {
    logger.error(`[${CTRL}] toggleSubscription error`, { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ---------------------------------------------------------------------------
// POST /api/admin/webhooks/subscriptions/:id/retry-franchise — Retry franchise setup
// ---------------------------------------------------------------------------

exports.retryFranchise = async (req, res) => {
  try {
    const { id } = req.params;

    // Get seller_id from subscription
    const { data: sub, error: fetchErr } = await sb()
      .from('webhook_subscriptions')
      .select('id, seller_id, franchise_pending')
      .eq('id', id)
      .eq('provider', 'icon_chat')
      .single();

    if (fetchErr || !sub) {
      return res.status(404).json({ success: false, error: 'subscription_not_found' });
    }

    const iconChatService = require('../services/iconChatProvisioningService');
    const result = await iconChatService.retryFranchiseSetup(sub.seller_id);

    logger.info(`[${CTRL}] Franchise retry succeeded`, {
      subscriptionId: id,
      sellerId: sub.seller_id,
      adminId: req.user.uid,
    });

    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error(`[${CTRL}] retryFranchise error`, { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
};
