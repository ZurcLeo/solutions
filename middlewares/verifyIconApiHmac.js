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
    logger.warn(`[${MW}] Headers ausentes`, {
      service: MW, hasSignature: !!signature, hasTimestamp: !!timestamp, hasSellerId: !!sellerId,
      method: req.method, originalUrl: req.originalUrl,
    });
    return res.status(401).json({ error: 'missing_auth_headers' });
  }

  // Verificar timestamp window
  const tsSeconds = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  const skew = now - tsSeconds;
  if (isNaN(tsSeconds) || Math.abs(skew) > TIMESTAMP_WINDOW_SECONDS) {
    logger.warn(`[${MW}] Timestamp rejeitado`, {
      service: MW, sellerId, clientTs: timestamp, serverTs: now, skewSeconds: skew,
      method: req.method, originalUrl: req.originalUrl,
    });
    return res.status(401).json({ error: 'timestamp_expired', skew });
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
    logger.warn(`[${MW}] Subscription não encontrada`, {
      service: MW, sellerId, method: req.method, originalUrl: req.originalUrl,
    });
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
      logger.warn(`[${MW}] Assinatura inválida`, {
        service: MW, sellerId,
        method: req.method, originalUrl: req.originalUrl, path: req.path,
        clientTs: timestamp, serverTs: now, skewSeconds: skew,
        message,
        receivedSig: signature.substring(0, 20) + '...',
        expectedSig: expected.substring(0, 20) + '...',
        secretDigest: crypto.createHash('sha256').update(sub.hmac_secret).digest('hex').substring(0, 12),
      });
      return res.status(401).json({ error: 'invalid_signature' });
    }
  } catch (err) {
    logger.warn(`[${MW}] Erro na comparação`, {
      service: MW, sellerId, error: err.message, method: req.method, originalUrl: req.originalUrl,
    });
    return res.status(401).json({ error: 'invalid_signature' });
  }

  // Autenticado
  logger.info(`[${MW}] OK`, { service: MW, sellerId, method: req.method, originalUrl: req.originalUrl, skewSeconds: skew });
  req.iconSellerId = sellerId;
  req.iconSubscriptionId = sub.id;
  next();
}

module.exports = verifyIconApiHmac;
