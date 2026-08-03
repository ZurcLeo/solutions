/**
 * @fileoverview Controller para webhook de retorno do IconChat → ElosCloud.
 *
 * Invariante §3: Valida HMAC do IconChat (mesma lógica invertida).
 * Dedup por event_id em webhook_return_events.
 * Responde 200 imediato, processa async.
 */

'use strict';

const crypto = require('crypto');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');
const webhookReturnService = require('../services/webhookReturnService');

const SERVICE = 'webhookIconController';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

/**
 * Verifica HMAC do IconChat.
 * Busca secret em webhook_subscriptions pelo seller_id no header.
 */
async function _verifyIconHmac(req) {
  const signature = req.headers['x-icon-signature'];
  const eventId = req.headers['x-icon-event-id'];
  const timestamp = req.headers['x-icon-timestamp'];
  const sellerId = req.headers['x-icon-seller-id'];

  if (!signature || !eventId || !timestamp || !sellerId) {
    return { valid: false, reason: 'missing_headers' };
  }

  // Verificar janela de timestamp (5 minutos)
  const timestampSec = parseInt(timestamp, 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (isNaN(timestampSec) || Math.abs(nowSec - timestampSec) > 300) {
    return { valid: false, reason: 'timestamp_expired' };
  }

  // Buscar secret da subscription
  const { data: sub } = await sb()
    .from('webhook_subscriptions')
    .select('hmac_secret')
    .eq('seller_id', sellerId)
    .eq('is_active', true)
    .maybeSingle();

  if (!sub) {
    return { valid: false, reason: 'subscription_not_found' };
  }

  // Verificar HMAC
  const rawBody = JSON.stringify(req.body);
  const message = `${timestamp}.${eventId}.${rawBody}`;
  const expectedHash = crypto
    .createHmac('sha256', sub.hmac_secret)
    .update(message)
    .digest('hex');

  const receivedHash = signature.replace('sha256=', '');
  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  const receivedBuffer = Buffer.from(receivedHash, 'hex');

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    return { valid: false, reason: 'invalid_signature' };
  }

  return { valid: true, sellerId, eventId };
}

/**
 * POST /api/webhook/icon-events
 * Recebe eventos de retorno do IconChat.
 */
async function handleIconEvent(req, res) {
  // 1. Verificar HMAC
  const hmacResult = await _verifyIconHmac(req);
  if (!hmacResult.valid) {
    logger.warn(`[${SERVICE}] HMAC inválido`, { reason: hmacResult.reason });
    return res.status(401).json({ error: 'Unauthorized', code: hmacResult.reason });
  }

  const { sellerId, eventId } = hmacResult;
  const { event_type: eventType } = req.body;

  if (!eventType) {
    return res.status(400).json({ error: 'event_type é obrigatório' });
  }

  // 2. Dedup por event_id
  const supabase = sb();
  const { error: insertErr } = await supabase
    .from('webhook_return_events')
    .insert({
      event_id: eventId,
      event_type: eventType,
      seller_id: sellerId,
      payload: req.body,
      status: 'pending',
    });

  if (insertErr && insertErr.code === '23505') {
    // Duplicado — retorna 200 sem processar
    logger.info(`[${SERVICE}] Evento duplicado ignorado`, { eventId });
    return res.status(200).json({ status: 'duplicate' });
  }

  if (insertErr) {
    logger.error(`[${SERVICE}] Erro ao registrar return event`, { error: insertErr.message });
    return res.status(500).json({ error: 'Erro interno' });
  }

  // 3. Responder 200 imediato
  res.status(200).json({ status: 'accepted', eventId });

  // 4. Processar async
  setImmediate(async () => {
    try {
      await webhookReturnService.processReturnEvent(eventType, eventId, sellerId, req.body);
    } catch (err) {
      logger.error(`[${SERVICE}] Erro no processamento async`, { eventId, error: err.message });
    }
  });
}

module.exports = {
  handleIconEvent,
};
