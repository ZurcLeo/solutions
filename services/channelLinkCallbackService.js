/**
 * @fileoverview Channel Link Callback — notifica IconChat sobre channel_link.verified
 *
 * Fire-and-forget: nunca bloqueia a resposta do confirm.
 * Retry via setTimeout (perde-se em restart — aceitável: D1 é fonte de verdade).
 *
 * HMAC format: "{timestamp}.elos.{path}" com ICON_CHANNEL_HMAC_SECRET
 */

'use strict';

const crypto = require('crypto');
const { logger } = require('../logger');

const TAG = 'ChannelLinkCallback';
const CALLBACK_PATH = '/elos-events';
const RETRY_DELAYS = [0, 30000, 120000]; // 0s, 30s, 2min

function _getConfig() {
  const secret = process.env.ICON_CHANNEL_HMAC_SECRET;
  const baseUrl = process.env.ICONCHAT_CALLBACK_URL;
  if (!secret || !baseUrl) return null;
  return { secret, url: `${baseUrl}${CALLBACK_PATH}` };
}

function _sign(secret, path) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `${timestamp}.elos.${path}`;
  const signature = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');
  return { timestamp, signature };
}

async function _send(config, payload) {
  const { timestamp, signature } = _sign(config.secret, CALLBACK_PATH);

  const res = await fetch(config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Elos-Timestamp': timestamp,
      'X-Elos-Signature': signature,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
}

async function _sendWithRetry(config, payload, attempt = 0) {
  try {
    await _send(config, payload);
    logger.info(`[${TAG}] Callback enviado`, {
      event: payload.event,
      conversationId: payload.conversationId,
      attempt,
    });
  } catch (err) {
    logger.warn(`[${TAG}] Callback falhou (attempt ${attempt})`, {
      error: err.message,
      conversationId: payload.conversationId,
    });

    const nextAttempt = attempt + 1;
    if (nextAttempt < RETRY_DELAYS.length) {
      setTimeout(() => _sendWithRetry(config, payload, nextAttempt), RETRY_DELAYS[nextAttempt]);
    } else {
      logger.error(`[${TAG}] Callback esgotou retries`, {
        conversationId: payload.conversationId,
      });
    }
  }
}

/**
 * Notifica o IconChat que um channel link foi verificado.
 * Fire-and-forget — nunca bloqueia, nunca lança.
 */
function notifyVerified({ conversationId, phone, userId, displayName }) {
  const config = _getConfig();
  if (!config) {
    logger.warn(`[${TAG}] ICON_CHANNEL_HMAC_SECRET ou ICONCHAT_CALLBACK_URL não configurado — callback ignorado`);
    return;
  }

  const payload = {
    event: 'channel_link.verified',
    conversationId,
    phone,
    userId,
    displayName,
    occurredAt: new Date().toISOString(),
  };

  // Fire-and-forget
  _sendWithRetry(config, payload, 0).catch(() => {});
}

/**
 * Notifica o IconChat que um channel link foi revogado via D3.
 * Fire-and-forget — nunca bloqueia, nunca lança.
 */
function notifyRevoked({ conversationId, phone, userId }) {
  const config = _getConfig();
  if (!config) {
    logger.warn(`[${TAG}] ICON_CHANNEL_HMAC_SECRET ou ICONCHAT_CALLBACK_URL não configurado — callback ignorado`);
    return;
  }

  const payload = {
    event: 'channel_link.revoked',
    conversationId,
    phone,
    userId,
    occurredAt: new Date().toISOString(),
  };

  // Fire-and-forget
  _sendWithRetry(config, payload, 0).catch(() => {});
}

module.exports = { notifyVerified, notifyRevoked };
