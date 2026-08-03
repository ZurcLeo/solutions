'use strict';

const express = require('express');
const router = express.Router();
const { readLimit } = require('../middlewares/rateLimiter');
const { healthCheck } = require('../middlewares/healthMiddleware');
const handleController = require('../controllers/handleController');
const { logger } = require('../logger');

const ROUTE_NAME = 'handleRoutes';
router.use(healthCheck(ROUTE_NAME));

router.use((req, res, next) => {
  logger.info(`[ROUTE] ${ROUTE_NAME}`, { method: req.method, path: req.path });
  next();
});

// ──────────────────────────────────────────────────────
// Public Handle Resolution — no auth required
// [HANDLE-006] Resolve handles to owner IDs + 301 redirect for old handles
// ──────────────────────────────────────────────────────

// User profile by handle (must be BEFORE /:handle to avoid conflict)
router.get('/user/:handle/profile', readLimit, handleController.getPublicUserProfile);

// Generic handle resolver
router.get('/:handle', readLimit, handleController.resolveHandle);

module.exports = router;
