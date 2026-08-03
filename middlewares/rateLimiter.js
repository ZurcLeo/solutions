// src/middlewares/rateLimiter.js
const { RateLimiterMemory } = require('rate-limiter-flexible');
const { logger } = require('../logger');
const { addToLocalBlacklist, AUTO_BLACKLIST_TTL_SECONDS } = require('../utils/securityUtils');

// Configuration - Move these to a configuration file/environment variables
const RATE_LIMIT_CONFIG = {
  standard: { points: 100, duration: 60, blockDuration: 300 },
  auth: { points: 5, duration: 3600, blockDuration: 3600 },
  read: { points: 100, duration: 60, blockDuration: 300 }, // Reduzido para dados sensíveis
  write: { points: 20, duration: 60, blockDuration: 900 }, // Mais restritivo para operações bancárias
  connection: { points: 10, duration: 3600, blockDuration: 3600 },
  banking: { points: 10, duration: 60, blockDuration: 600 }, // Específico para operações bancárias
  icon_api: { points: 60, duration: 60, blockDuration: 300 }, // IconChat REST API (consultas)
  icon_api_write: { points: 20, duration: 60, blockDuration: 600 }, // IconChat REST API (ações)
  pin_redeem: { points: 3, duration: 3600, blockDuration: 7200 }, // PIN exchange: 3 req/h por IP (D6)
  ml_oauth: { points: 5, duration: 3600, blockDuration: 3600 }, // ML OAuth: 5 tentativas/h por user
  ml_webhook: { points: 120, duration: 60, blockDuration: 300 }, // ML webhook: 120 notif/min por IP
  channel_link_init: { points: 5, duration: 300, blockDuration: 600 },       // 5/5min por phone
  channel_link_ip_breaker: { points: 100, duration: 60, blockDuration: 300 }, // circuit breaker por IP
};

// Initialize limiters with configuration
const limiters = {};
for (const key in RATE_LIMIT_CONFIG) {
  limiters[key] = new RateLimiterMemory({
    ...RATE_LIMIT_CONFIG[key],
    // Add keyPrefix for better organization if needed
    // keyPrefix: `rl:${key}`,
  });

  logger.info(`${key} rate limiter configurado`, {
    service: 'rateLimiter',
    function: 'initialization',
    config: RATE_LIMIT_CONFIG[key],
  });
}


const createRateLimitMiddleware = (limiter, name) => async (req, res, next) => {
  const key = req.user ? `${req.ip}-${req.user.uid}` : req.ip;

  try {
    await limiter.consume(key);
    next();
  } catch (error) {
    logger.warn(`Rate limit exceeded for ${name}`, {
      service: 'rateLimiter',
      endpoint: req.path,
      userId: req.user?.uid,
      ip: req.ip,
      retryAfter: Math.round(error.msBeforeNext / 1000), // Include retryAfter in logs
    });

    // AUTO-BLACKLIST: Se for uma rota sensível e exceder 4x o limite, banir IP por 24h
    if (['auth', 'banking'].includes(name) && error.consumedPoints > limiter.points * 4) {
      addToLocalBlacklist(req.ip, 'ip', `Brute force attempt on ${name}`, AUTO_BLACKLIST_TTL_SECONDS)
        .catch(() => {}); // fire-and-forget, errors logged internally
    }

    res.status(429).json({
      error: 'Too many requests. Please try again later.',
      retryAfter: Math.round(error.msBeforeNext / 1000),
    });
  }
};

const readLimit = createRateLimitMiddleware(limiters.read, 'read');
const writeLimit = createRateLimitMiddleware(limiters.write, 'write');
const connectionLimit = createRateLimitMiddleware(limiters.connection, 'connection');
const authRateLimiter = createRateLimitMiddleware(limiters.auth, 'auth');
const rateLimiter = createRateLimitMiddleware(limiters.standard, 'standard');
const bankingLimit = createRateLimitMiddleware(limiters.banking, 'banking');
const iconApiLimit = createRateLimitMiddleware(limiters.icon_api, 'icon_api');
const iconApiWriteLimit = createRateLimitMiddleware(limiters.icon_api_write, 'icon_api_write');
const pinRedeemLimit = createRateLimitMiddleware(limiters.pin_redeem, 'pin_redeem');
const mlOAuthLimit = createRateLimitMiddleware(limiters.ml_oauth, 'ml_oauth');
const mlWebhookLimit = createRateLimitMiddleware(limiters.ml_webhook, 'ml_webhook');

// Custom middleware: rate limit D2 (init) por phone + circuit breaker por IP
const channelLinkInitLimit = async (req, res, next) => {
  const phone = req.body?.phone;
  if (!phone) return next(); // Joi pegará a ausência depois

  // 1. Circuit breaker por IP (proteção contra IconChat em loop)
  try {
    await limiters.channel_link_ip_breaker.consume(req.ip);
  } catch (err) {
    logger.warn('Channel link IP circuit breaker triggered', {
      service: 'rateLimiter', ip: req.ip,
      retryAfter: Math.round(err.msBeforeNext / 1000),
    });
    return res.status(429).json({
      error: 'Too many requests',
      retryAfter: Math.round(err.msBeforeNext / 1000),
    });
  }

  // 2. Rate limit por phone (proteção real)
  try {
    await limiters.channel_link_init.consume(phone);
    next();
  } catch (err) {
    logger.warn('Channel link init rate limit exceeded', {
      service: 'rateLimiter', phone,
      retryAfter: Math.round(err.msBeforeNext / 1000),
    });
    return res.status(429).json({
      error: 'Too many link requests for this phone',
      retryAfter: Math.round(err.msBeforeNext / 1000),
    });
  }
};

module.exports = {
  rateLimiter,
  authRateLimiter,
  readLimit,
  writeLimit,
  connectionLimit,
  bankingLimit,
  iconApiLimit,
  iconApiWriteLimit,
  pinRedeemLimit,
  mlOAuthLimit,
  mlWebhookLimit,
  channelLinkInitLimit,
};