// health.js - Improved router with tiered access levels
const express = require('express');
const router = express.Router();
const { 
  publicHealthCheck,
  serviceHealthCheck,
  dependenciesHealthCheck,
  fullSystemHealthCheck 
} = require('../controllers/healthController');
const verifyToken = require('../middlewares/auth');
const optionalAuth = require('../middlewares/optionalAuth');
const { logger } = require('../logger')

const ROUTE_NAME = 'health'

// Middleware de log para todas as requisições
router.use((req, res, next) => {
  logger.info(`[ROUTE] Requisição recebida em ${ROUTE_NAME}`, {
    path: req.path,
    method: req.method,
    userId: req.user?.uid,
    params: req.params,
    body: req.body,
    query: req.query,
  });
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
router.get('/', optionalAuth, publicHealthCheck);

module.exports = router;