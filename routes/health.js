// health.js - Improved router with tiered access levels
const express = require('express');
const router = express.Router();
const { 
  publicHealthCheck,
  serviceHealthCheck,
  dependenciesHealthCheck,
  fullSystemHealthCheck,
  fastHealthCheck 
} = require('../controllers/healthController');
const verifyToken = require('../middlewares/auth');
const optionalAuth = require('../middlewares/optionalAuth');
const { logger } = require('../logger')

const ROUTE_NAME = 'health'

// Middleware de log para todas as requisições
router.use((req, res, next) => {
  logger.info(`[ROUTE] Requisição recebida em ${ROUTE_NAME}`, { sreContext: req.sreContext || 'no-context' });
  next();
});

// Public endpoint - no authentication required, just basic connectivity check
router.get('/public', publicHealthCheck);

// Basic service checks with optional authentication
router.get('/service/:serviceName', optionalAuth, serviceHealthCheck);

// Dependencies checks with optional authentication
router.get('/dependencies', optionalAuth, dependenciesHealthCheck);

// Full system check - requires authentication
router.get('/full', verifyToken, fullSystemHealthCheck);

// Legacy route for backward compatibility
router.get('/', fastHealthCheck);

module.exports = router;