'use strict';

const crypto = require('crypto');
const { logger } = require('../logger');

const MW = 'verifyIconExchangeKey';

/**
 * Middleware que valida X-Icon-Exchange-Key contra ICON_EXCHANGE_API_KEY (D5).
 * Usa timing-safe comparison para evitar timing attacks.
 */
function verifyIconExchangeKey(req, res, next) {
  const exchangeKey = req.headers['x-icon-exchange-key'];

  if (!exchangeKey) {
    return res.status(401).json({ error: 'missing_exchange_key' });
  }

  const expectedKey = process.env.ICON_EXCHANGE_API_KEY;
  if (!expectedKey) {
    logger.error(`[${MW}] ICON_EXCHANGE_API_KEY not configured`);
    return res.status(500).json({ error: 'internal_error' });
  }

  try {
    const keyBuffer = Buffer.from(exchangeKey);
    const expectedBuffer = Buffer.from(expectedKey);

    if (keyBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(keyBuffer, expectedBuffer)) {
      logger.warn(`[${MW}] Invalid exchange key`, { ip: req.ip });
      return res.status(401).json({ error: 'invalid_exchange_key' });
    }
  } catch {
    return res.status(401).json({ error: 'invalid_exchange_key' });
  }

  next();
}

module.exports = verifyIconExchangeKey;
