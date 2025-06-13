// src/middlewares/rateLimiter.js
const { RateLimiterMemory } = require('rate-limiter-flexible');
const { logger } = require('../logger');

// Configuration - Move these to a configuration file/environment variables
const RATE_LIMIT_CONFIG = {
  standard: { points: 100, duration: 60, blockDuration: 300 },
  auth: { points: 5, duration: 3600, blockDuration: 3600 },
  read: { points: 100, duration: 60, blockDuration: 300 }, // Reduzido para dados sensíveis
  write: { points: 20, duration: 60, blockDuration: 900 }, // Mais restritivo para operações bancárias
  connection: { points: 10, duration: 3600, blockDuration: 3600 },
  banking: { points: 10, duration: 60, blockDuration: 600 }, // Específico para operações bancárias
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


module.exports = {
  rateLimiter,
  authRateLimiter,
  readLimit,
  writeLimit,
  connectionLimit,
  bankingLimit,
};