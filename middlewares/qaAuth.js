const crypto = require('crypto');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const { logger } = require('../logger');

// Rate limiter dedicado APENAS para POST /api/qa/run (disparo de runs).
// GET /api/qa/runs e /api/qa/runs/:runId não são limitados (leitura).
// - IP externo: 15 runs/hora (default)
// - IP interno do Fly.io: 30 runs/hora (default)
const externalPoints = parseInt(process.env.QA_RATE_LIMIT_POINTS_EXTERNAL) || 15;
const internalPoints = parseInt(process.env.QA_RATE_LIMIT_POINTS_INTERNAL) || 30;
const duration       = parseInt(process.env.QA_RATE_LIMIT_DURATION)        || 3600;

const externalLimiter = new RateLimiterMemory({ points: externalPoints, duration });
const internalLimiter = new RateLimiterMemory({ points: internalPoints, duration });

function isInternalFlyRequest(req) {
  // Requests da rede privada do Fly.io não chegam com x-forwarded-for
  // ou chegam com IPs do range interno 10.x / fd::/8
  const ip = req.ip || '';
  return ip.startsWith('10.') || ip.startsWith('::ffff:10.') || ip === '::1' || ip === '127.0.0.1';
}

module.exports = async function qaAuth(req, res, next) {
  // EventSource (SSE) não suporta custom headers — aceita token via query param para GET /api/qa/stream
  const token = req.headers['x-qa-token'] || req.query.token;

  if (!token) {
    return res.status(401).json({ error: 'x-qa-token header ou query param ?token obrigatório' });
  }

  // Timing-safe comparison — nunca compare tokens em plaintext
  const expectedHash = process.env.QA_INTERNAL_TOKEN_HASH;
  if (!expectedHash) {
    logger.error('QA_INTERNAL_TOKEN_HASH não configurado', { service: 'qaAuth' });
    return res.status(503).json({ error: 'QA não configurado neste ambiente' });
  }

  const receivedHash = crypto.createHash('sha256').update(token).digest('hex');
  const expectedBuf  = Buffer.from(expectedHash, 'hex');
  const receivedBuf  = Buffer.from(receivedHash, 'hex');

  // Os buffers devem ter o mesmo tamanho para timingSafeEqual
  if (expectedBuf.length !== receivedBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
    logger.warn('QA token inválido', { service: 'qaAuth', ip: req.ip });
    return res.status(403).json({ error: 'QA token inválido' });
  }

  // Rate limiting apenas em POST (disparar runs) — leituras não são limitadas
  if (req.method === 'POST') {
    const limiter = isInternalFlyRequest(req) ? internalLimiter : externalLimiter;
    const key     = req.ip || 'unknown';
    try {
      await limiter.consume(key);
    } catch {
      return res.status(429).json({ error: 'Rate limit do QA excedido. Tente novamente mais tarde.' });
    }
  }

  req.isQARequest = true;
  next();
};
