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
      logger.warn(`[${MW}] Headers ausentes`, {
        service: MW, hasSignature: !!signature, hasTimestamp: !!timestamp,
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
        service: MW, clientTs: timestamp, serverTs: now, skewSeconds: skew,
        method: req.method, originalUrl: req.originalUrl,
      });
      return res.status(401).json({ error: 'timestamp_expired', skew });
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
        logger.warn(`[${MW}] Assinatura inválida`, {
          service: MW, envVar: envVarName,
          method: req.method, originalUrl: req.originalUrl, path: req.path,
          clientTs: timestamp, serverTs: now, skewSeconds: skew,
          message, // a string que o servidor assinou
          receivedSig: signature.substring(0, 20) + '...', // primeiros 20 chars (safe — é hash)
          expectedSig: expected.substring(0, 20) + '...', // primeiros 20 chars
          secretDigest: crypto.createHash('sha256').update(secret).digest('hex').substring(0, 12),
        });
        return res.status(401).json({ error: 'invalid_signature' });
      }
    } catch (err) {
      logger.warn(`[${MW}] Erro na comparação`, {
        service: MW, error: err.message, method: req.method, originalUrl: req.originalUrl,
      });
      return res.status(401).json({ error: 'invalid_signature' });
    }

    // Autenticado
    logger.info(`[${MW}] OK`, { service: MW, method: req.method, originalUrl: req.originalUrl, skewSeconds: skew });
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
