/**
 * @fileoverview Webhook Outbound Service — ElosCloud → IconChat
 *
 * Responsabilidades:
 *   - Assinar payloads com HMAC-SHA256 per-seller
 *   - Enviar webhooks com headers padronizados
 *   - Gerenciar delivery log com idempotência (UNIQUE event_id + subscription_id)
 *   - Retry exponencial (30s, 2min, 10min)
 *
 * Invariante §3: HMAC per-seller, event_id UUID dedup
 */

'use strict';

const crypto = require('crypto');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const SERVICE = 'webhookOutboundService';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

// Retry delays em ms: 30s, 2min, 10min
const RETRY_DELAYS = [30_000, 120_000, 600_000];

// ---------------------------------------------------------------------------
// HMAC Signing
// ---------------------------------------------------------------------------

/**
 * Gera assinatura HMAC-SHA256 para um payload de webhook.
 * Formato: sha256=hex(HMAC(timestamp.eventId.JSON(payload), secret))
 */
function signPayload(payload, secret, eventId, timestamp) {
  const message = `${timestamp}.${eventId}.${JSON.stringify(payload)}`;
  const hmac = crypto.createHmac('sha256', secret).update(message).digest('hex');
  return `sha256=${hmac}`;
}

// ---------------------------------------------------------------------------
// Subscription Lookup
// ---------------------------------------------------------------------------

/**
 * Busca subscription ativa para um seller.
 * @returns {Object|null} subscription ou null
 */
async function getActiveSubscription(sellerId) {
  if (!sellerId) return null;

  const { data, error } = await sb()
    .from('webhook_subscriptions')
    .select('*')
    .eq('seller_id', sellerId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    logger.warn(`[${SERVICE}] getActiveSubscription error`, { sellerId, error: error.message });
    return null;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Webhook Dispatch
// ---------------------------------------------------------------------------

/**
 * Envia webhook para uma subscription específica.
 * Cria entry no delivery_log para idempotência e tracking.
 *
 * @param {string} subscriptionId
 * @param {string} eventType - e.g. 'pendencia.deadline_approaching'
 * @param {string} eventId - UUID único do evento
 * @param {Object} payload - Dados do evento
 * @returns {{ success: boolean, eventId: string, deliveryLogId?: string }}
 */
async function sendWebhook(subscriptionId, eventType, eventId, payload) {
  const supabase = sb();

  // 1. Buscar subscription
  const { data: sub, error: subErr } = await supabase
    .from('webhook_subscriptions')
    .select('*')
    .eq('id', subscriptionId)
    .eq('is_active', true)
    .single();

  if (subErr || !sub) {
    logger.warn(`[${SERVICE}] Subscription não encontrada ou inativa`, { subscriptionId });
    return { success: false, eventId, error: 'subscription_not_found' };
  }

  // 2. Criar delivery log entry (idempotência via UNIQUE constraint)
  const { data: logEntry, error: logErr } = await supabase
    .from('webhook_delivery_log')
    .insert({
      event_id: eventId,
      subscription_id: subscriptionId,
      event_type: eventType,
      payload,
      status: 'pending',
      attempts: 0,
    })
    .select('id')
    .single();

  if (logErr) {
    // Se o erro é de constraint UNIQUE, o evento já foi registrado — idempotência
    if (logErr.code === '23505') {
      logger.info(`[${SERVICE}] Evento duplicado ignorado`, { eventId, subscriptionId });
      return { success: true, eventId, status: 'duplicate' };
    }
    throw new Error(`Erro ao criar delivery log: ${logErr.message}`);
  }

  // 3. Enviar HTTP POST
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signPayload(payload, sub.hmac_secret, eventId, timestamp);

  try {
    const response = await fetch(sub.endpoint_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Elos-Signature': signature,
        'X-Elos-Event-Id': eventId,
        'X-Elos-Event-Type': eventType,
        'X-Elos-Timestamp': timestamp,
        'X-Elos-Seller-Id': sub.seller_id,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000), // 10s timeout
    });

    const httpStatus = response.status;

    if (httpStatus >= 200 && httpStatus < 300) {
      // Sucesso
      await supabase
        .from('webhook_delivery_log')
        .update({
          status: 'delivered',
          http_status: httpStatus,
          attempts: 1,
          delivered_at: new Date().toISOString(),
        })
        .eq('id', logEntry.id);

      logger.info(`[${SERVICE}] Webhook entregue`, { eventId, eventType, httpStatus });
      return { success: true, eventId, deliveryLogId: logEntry.id };
    }

    // Falha — agendar retry
    const nextRetryAt = new Date(Date.now() + RETRY_DELAYS[0]).toISOString();
    await supabase
      .from('webhook_delivery_log')
      .update({
        status: 'failed',
        http_status: httpStatus,
        attempts: 1,
        last_error: `HTTP ${httpStatus}`,
        next_retry_at: nextRetryAt,
      })
      .eq('id', logEntry.id);

    logger.warn(`[${SERVICE}] Webhook falhou`, { eventId, eventType, httpStatus });
    return { success: false, eventId, deliveryLogId: logEntry.id, httpStatus };

  } catch (err) {
    const nextRetryAt = new Date(Date.now() + RETRY_DELAYS[0]).toISOString();
    await supabase
      .from('webhook_delivery_log')
      .update({
        status: 'failed',
        attempts: 1,
        last_error: err.message,
        next_retry_at: nextRetryAt,
      })
      .eq('id', logEntry.id);

    logger.error(`[${SERVICE}] Erro ao enviar webhook`, { eventId, error: err.message });
    return { success: false, eventId, deliveryLogId: logEntry.id, error: err.message };
  }
}

/**
 * Dispatch webhook para um seller por sellerId.
 * Resolve subscription e gera eventId automaticamente.
 */
async function dispatchForSeller(sellerId, eventType, payload) {
  const sub = await getActiveSubscription(sellerId);
  if (!sub) {
    logger.debug(`[${SERVICE}] Nenhuma subscription ativa para seller`, { sellerId, eventType });
    return { success: false, reason: 'no_subscription' };
  }

  // Verificar se o evento está habilitado
  if (sub.events_enabled.length > 0 && !sub.events_enabled.includes(eventType)) {
    logger.debug(`[${SERVICE}] Evento não habilitado`, { sellerId, eventType });
    return { success: false, reason: 'event_not_enabled' };
  }

  const eventId = crypto.randomUUID();
  return sendWebhook(sub.id, eventType, eventId, payload);
}

/**
 * Dispatch webhook resolvendo seller a partir de um userId.
 * Busca seller_profiles onde user_id = userId.
 */
async function dispatchForUser(userId, eventType, payload, correlationId) {
  const { data: sellers } = await sb()
    .from('seller_profiles')
    .select('id')
    .eq('user_id', userId);

  if (!sellers || sellers.length === 0) return { success: false, reason: 'no_seller' };

  const results = [];
  for (const seller of sellers) {
    const result = await dispatchForSeller(seller.id, eventType, {
      ...payload,
      correlationId,
    });
    results.push(result);
  }

  return { success: results.some(r => r.success), results };
}

// ---------------------------------------------------------------------------
// Retry Logic
// ---------------------------------------------------------------------------

/**
 * Processa webhooks falhados que estão prontos para re-tentativa.
 * Chamado periodicamente pelo webhookRetryJob.
 */
async function retryPendingWebhooks() {
  const supabase = sb();
  const now = new Date().toISOString();

  // Buscar webhooks prontos para retry
  const { data: pending, error } = await supabase
    .from('webhook_delivery_log')
    .select(`
      id, event_id, subscription_id, event_type, payload,
      attempts, max_attempts, last_error,
      subscription:subscription_id (endpoint_url, hmac_secret, seller_id, is_active)
    `)
    .in('status', ['pending', 'failed'])
    .lte('next_retry_at', now)
    .lt('attempts', 3) // max_attempts default
    .order('next_retry_at', { ascending: true })
    .limit(50);

  if (error) {
    logger.error(`[${SERVICE}] Erro ao buscar webhooks pendentes`, { error: error.message });
    return;
  }

  if (!pending || pending.length === 0) return;

  logger.info(`[${SERVICE}] Processando ${pending.length} webhooks para retry`);

  for (const entry of pending) {
    const sub = entry.subscription;
    if (!sub || !sub.is_active) {
      // Subscription desativada — abandonar
      await supabase
        .from('webhook_delivery_log')
        .update({ status: 'abandoned', last_error: 'subscription_inactive' })
        .eq('id', entry.id);

      logger.error(`[${SERVICE}] [DLQ] Webhook abandonado — subscription inativa`, {
        eventId: entry.event_id,
        eventType: entry.event_type,
        deliveryLogId: entry.id,
      });
      continue;
    }

    const attempt = entry.attempts + 1;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signPayload(entry.payload, sub.hmac_secret, entry.event_id, timestamp);

    try {
      const response = await fetch(sub.endpoint_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Elos-Signature': signature,
          'X-Elos-Event-Id': entry.event_id,
          'X-Elos-Event-Type': entry.event_type,
          'X-Elos-Timestamp': timestamp,
          'X-Elos-Seller-Id': sub.seller_id,
        },
        body: JSON.stringify(entry.payload),
        signal: AbortSignal.timeout(10_000),
      });

      if (response.status >= 200 && response.status < 300) {
        await supabase
          .from('webhook_delivery_log')
          .update({
            status: 'delivered',
            http_status: response.status,
            attempts: attempt,
            delivered_at: new Date().toISOString(),
          })
          .eq('id', entry.id);

        logger.info(`[${SERVICE}] Retry bem-sucedido`, { eventId: entry.event_id, attempt });
      } else {
        await _handleRetryFailure(supabase, entry, attempt, `HTTP ${response.status}`, response.status);
      }
    } catch (err) {
      await _handleRetryFailure(supabase, entry, attempt, err.message, null);
    }
  }
}

async function _handleRetryFailure(supabase, entry, attempt, errorMsg, httpStatus) {
  if (attempt >= entry.max_attempts) {
    // Esgotar tentativas — abandonar
    await supabase
      .from('webhook_delivery_log')
      .update({
        status: 'abandoned',
        attempts: attempt,
        http_status: httpStatus,
        last_error: errorMsg,
      })
      .eq('id', entry.id);

    logger.error(`[${SERVICE}] [DLQ] Webhook abandonado após ${attempt} tentativas`, {
      eventId: entry.event_id,
      eventType: entry.event_type,
      sellerId: entry.subscription?.seller_id,
      error: errorMsg,
      deliveryLogId: entry.id,
    });
  } else {
    // Agendar próxima tentativa
    const delayIndex = Math.min(attempt - 1, RETRY_DELAYS.length - 1);
    const nextRetryAt = new Date(Date.now() + RETRY_DELAYS[delayIndex]).toISOString();

    await supabase
      .from('webhook_delivery_log')
      .update({
        status: 'failed',
        attempts: attempt,
        http_status: httpStatus,
        last_error: errorMsg,
        next_retry_at: nextRetryAt,
      })
      .eq('id', entry.id);

    logger.warn(`[${SERVICE}] Retry ${attempt} falhou, próximo em ${RETRY_DELAYS[delayIndex] / 1000}s`, {
      eventId: entry.event_id,
    });
  }
}

// ---------------------------------------------------------------------------
// Franchise Renew — emitido na virada de ciclo (pagamento Asaas confirmado)
// ---------------------------------------------------------------------------

/**
 * Emite franchise.renew para o IconChat quando o ciclo de billing renova.
 * Gatilho primário: webhook Asaas de pagamento confirmado.
 * Seller inadimplente não recebe renovação (feature: IA fica com período antigo).
 *
 * @param {string} sellerId
 * @param {{ quota, hardCapPct, periodStart, periodEnd, reason }} franchiseData
 */
async function emitFranchiseRenew(sellerId, { quota, hardCapPct, periodStart, periodEnd, reason = 'cycle_renewal' }) {
  if (!sellerId || !quota) {
    logger.warn(`[${SERVICE}] emitFranchiseRenew: dados insuficientes`, { sellerId, quota });
    return { success: false, reason: 'missing_data' };
  }

  return dispatchForSeller(sellerId, 'franchise.renew', {
    sellerId,
    quota,
    hardCapPct: hardCapPct || 150,
    periodStart,
    periodEnd,
    reason,
  });
}

module.exports = {
  signPayload,
  getActiveSubscription,
  sendWebhook,
  dispatchForSeller,
  dispatchForUser,
  retryPendingWebhooks,
  emitFranchiseRenew,
};
