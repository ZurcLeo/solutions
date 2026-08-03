/**
 * @fileoverview HMAC Middleware para IconChat REST API
 *
 * Valida assinatura HMAC-SHA256 em requests da IconChat para a API de consulta.
 * Reutiliza hmac_secret de webhook_subscriptions.
 *
 * Headers esperados:
 *   X-Icon-Signature: sha256=<hex>
 *   X-Icon-Timestamp: <unix seconds>
 *   X-Icon-Seller-Id: <seller_id>
 *
 * Diferença do webhook inbound: o HMAC usa path+querystring (sem body).
 * Message format (unificado GET/POST): "{timestamp}.{sellerId}.{originalUrl}"
 */

'use strict';

const crypto = require('crypto');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const MW = 'verifyIconApiHmac';
const TIMESTAMP_WINDOW_SECONDS = 300; // 5 min

async function verifyIconApiHmac(req, res, next) {
  const signature = req.headers['x-icon-signature'];
  const timestamp = req.headers['x-icon-timestamp'];
  const sellerId = req.headers['x-icon-seller-id'];

  if (!signature || !timestamp || !sellerId) {
    return res.status(401).json({ error: 'missing_auth_headers' });
  }

  // Verificar timestamp window
  const tsSeconds = parseInt(timestamp, 10);
  if (isNaN(tsSeconds) || Math.abs(Date.now() / 1000 - tsSeconds) > TIMESTAMP_WINDOW_SECONDS) {
    return res.status(401).json({ error: 'timestamp_expired' });
  }

  // Buscar subscription
  const supabase = getSupabaseClient();
  if (!supabase) {
    logger.error(`[${MW}] Supabase client indisponível`);
    return res.status(500).json({ error: 'internal_error' });
  }

  const { data: sub, error } = await supabase
    .from('webhook_subscriptions')
    .select('id, hmac_secret, is_active')
    .eq('seller_id', sellerId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    logger.error(`[${MW}] Erro ao buscar subscription`, { sellerId, error: error.message });
    return res.status(500).json({ error: 'internal_error' });
  }

  if (!sub) {
    return res.status(401).json({ error: 'subscription_not_found' });
  }

  // Computar HMAC: message = "{timestamp}.{sellerId}.{originalUrl}"
  // Formato unificado GET/POST — integridade do body protegida por TLS (D5a)
  const message = `${timestamp}.${sellerId}.${req.originalUrl}`;

  const expected = 'sha256=' + crypto
    .createHmac('sha256', sub.hmac_secret)
    .update(message)
    .digest('hex');

  // Timing-safe comparison
  try {
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      logger.warn(`[${MW}] Assinatura inválida`, { sellerId });
      return res.status(401).json({ error: 'invalid_signature' });
    }
  } catch {
    return res.status(401).json({ error: 'invalid_signature' });
  }

  // Autenticado — expor sellerId no request
  req.iconSellerId = sellerId;
  req.iconSubscriptionId = sub.id;
  next();
}

module.exports = verifyIconApiHmac;
