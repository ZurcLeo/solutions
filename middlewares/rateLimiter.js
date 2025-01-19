// src/middlewares/rateLimiter.js
const { RateLimiterMemory } = require('rate-limiter-flexible');
const { logger } = require('../logger');

// Inicialização dos limitadores com logging
const standardLimiter = new RateLimiterMemory({
  points: 100,         // Requisições permitidas
  duration: 60,        // Período em segundos
  blockDuration: 300   // Tempo de bloqueio em segundos
});

logger.info('Standard rate limiter configurado', {
  service: 'rateLimiter',
  function: 'initialization',
  config: {
    points: 100,
    duration: '60 segundos',
    blockDuration: '300 segundos'
  }
});

const authLimiter = new RateLimiterMemory({
  points: 5,           // Tentativas permitidas
  duration: 3600,      // Por hora
  blockDuration: 3600  // Tempo de bloqueio
});

logger.info('Authentication rate limiter configurado', {
  service: 'rateLimiter',
  function: 'initialization',
  config: {
    points: 5,
    duration: '3600 segundos',
    blockDuration: '3600 segundos'
  }
});

// Middleware para rotas padrão da API
const rateLimiter = async (req, res, next) => {
  const key = req.user ? `${req.ip}-${req.user.uid}` : req.ip;
  
  logger.info('Verificando rate limit para requisição', {
    service: 'rateLimiter',
    function: 'rateLimiter',
    data: {
      ip: req.ip,
      userId: req.user?.uid,
      path: req.path,
      method: req.method
    }
  });

  try {
    const rateLimitInfo = await standardLimiter.consume(key);
    
    logger.info('Rate limit verificado com sucesso', {
      service: 'rateLimiter',
      function: 'rateLimiter',
      data: {
        remainingPoints: rateLimitInfo.remainingPoints,
        msBeforeNext: rateLimitInfo.msBeforeNext,
        key
      }
    });

    next();
  } catch (error) {
    logger.warn('Rate limit excedido', {
      service: 'rateLimiter',
      function: 'rateLimiter',
      error: {
        message: error.message,
        remainingMs: error.msBeforeNext
      },
      data: {
        ip: req.ip,
        userId: req.user?.uid,
        path: req.path,
        key
      }
    });

    res.status(429).json({
      error: 'Muitas requisições. Por favor, tente novamente mais tarde.',
      retryAfter: Math.round(error.msBeforeNext / 1000)
    });
  }
};

// Middleware específico para rotas de autenticação
const authRateLimiter = async (req, res, next) => {
  const key = `auth-${req.ip}`;

  logger.info('Verificando rate limit de autenticação', {
    service: 'rateLimiter',
    function: 'authRateLimiter',
    data: {
      ip: req.ip,
      path: req.path,
      method: req.method
    }
  });

  try {
    const rateLimitInfo = await authLimiter.consume(key);
    
    logger.info('Rate limit de autenticação verificado com sucesso', {
      service: 'rateLimiter',
      function: 'authRateLimiter',
      data: {
        remainingPoints: rateLimitInfo.remainingPoints,
        msBeforeNext: rateLimitInfo.msBeforeNext,
        key
      }
    });

    next();
  } catch (error) {
    logger.warn('Rate limit de autenticação excedido', {
      service: 'rateLimiter',
      function: 'authRateLimiter',
      error: {
        message: error.message,
        remainingMs: error.msBeforeNext
      },
      data: {
        ip: req.ip,
        path: req.path,
        key
      }
    });

    res.status(429).json({
      error: 'Muitas tentativas de autenticação. Por favor, tente novamente mais tarde.',
      retryAfter: Math.round(error.msBeforeNext / 1000)
    });
  }
};

module.exports = {
  rateLimiter,
  authRateLimiter
};