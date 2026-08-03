// utils/unsubscribeToken.js
// HMAC-SHA256 tokens para links de unsubscribe (LGPD compliance)

const crypto = require('crypto');

const SECRET_ENV = 'EMAIL_UNSUBSCRIBE_SECRET';

function _getSecret() {
  const secret = process.env[SECRET_ENV];
  if (!secret) throw new Error(`${SECRET_ENV} não configurado`);
  return secret;
}

/**
 * Gera um token HMAC-SHA256 para unsubscribe.
 * @param {string} userId
 * @param {string} category — categoria de notificação (ex: 'payments', 'invites')
 * @returns {string} token base64url
 */
function generate(userId, category) {
  const secret = _getSecret();
  const payload = `${userId}:${category}`;
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
}

/**
 * Verifica um token de unsubscribe usando timingSafeEqual.
 * @param {string} token — token recebido do link
 * @param {string} userId
 * @param {string} category
 * @returns {boolean}
 */
function verify(token, userId, category) {
  try {
    const expected = generate(userId, category);
    const tokenBuf = Buffer.from(token, 'base64url');
    const expectedBuf = Buffer.from(expected, 'base64url');

    if (tokenBuf.length !== expectedBuf.length) return false;

    return crypto.timingSafeEqual(tokenBuf, expectedBuf);
  } catch {
    return false;
  }
}

module.exports = { generate, verify };
