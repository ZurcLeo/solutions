/**
 * @fileoverview HMAC Middleware para endpoints channel-scoped (sem seller-scope)
 *
 * Variante sem seller-scope de verifyIconApiHmac.js.
 * Usa secret fixo (env var) em vez de lookup em webhook_subscriptions.
 *
 * Uso:
 *   verifyIconChannelHmac              → usa ICON_CHANNEL_HMAC_SECRET (default)
 *   verifyIconChannelHmac('OPS_LIVE_HMAC_SECRET') → usa secret separado
 *
 * Headers esperados:
 *   X-Icon-Signature: sha256=<hex>
 *   X-Icon-Timestamp: <unix seconds>
 *
 * Message format: "{timestamp}.icon.{originalUrl}"
 */

'use strict';

const crypto = require('crypto');
const { logger } = require('../logger');

const MW = 'verifyIconChannelHmac';
const TIMESTAMP_WINDOW_SECONDS = 300; // 5 min

function createChannelHmacMiddleware(envVarName) {
  return async function verifyIconChannelHmac(req, res, next) {
    const signature = req.headers['x-icon-signature'];
    const timestamp = req.headers['x-icon-timestamp'];

    if (!signature || !timestamp) {
      return res.status(401).json({ error: 'missing_auth_headers' });
    }

    // Verificar timestamp window
    const tsSeconds = parseInt(timestamp, 10);
    if (isNaN(tsSeconds) || Math.abs(Date.now() / 1000 - tsSeconds) > TIMESTAMP_WINDOW_SECONDS) {
      return res.status(401).json({ error: 'timestamp_expired' });
    }

    // Secret da env var
    const secret = process.env[envVarName];
    if (!secret) {
      logger.error(`[${MW}] ${envVarName} não configurado`);
      return res.status(500).json({ error: 'internal_error' });
    }

    // Computar HMAC: message = "{timestamp}.icon.{originalUrl}"
    const message = `${timestamp}.icon.${req.originalUrl}`;

    const expected = 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(message)
      .digest('hex');

    // Timing-safe comparison
    try {
      const sigBuffer = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expected);
      if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
        logger.warn(`[${MW}] Assinatura inválida (${envVarName})`);
        return res.status(401).json({ error: 'invalid_signature' });
      }
    } catch {
      return res.status(401).json({ error: 'invalid_signature' });
    }

    // Autenticado — marcar no request
    req.iconChannelAuth = true;
    next();
  };
}

// Default middleware (retrocompatível — usa ICON_CHANNEL_HMAC_SECRET)
const defaultMiddleware = createChannelHmacMiddleware('ICON_CHANNEL_HMAC_SECRET');

// Factory: verifyIconChannelHmac('OPS_LIVE_HMAC_SECRET') → middleware com secret customizado
// Chamada sem argumento → middleware default
function verifyIconChannelHmac(reqOrEnvVar, res, next) {
  // Se chamado como factory: verifyIconChannelHmac('ENV_VAR_NAME')
  if (typeof reqOrEnvVar === 'string' && !res) {
    return createChannelHmacMiddleware(reqOrEnvVar);
  }
  // Se chamado como middleware direto: verifyIconChannelHmac(req, res, next)
  return defaultMiddleware(reqOrEnvVar, res, next);
}

module.exports = verifyIconChannelHmac;
