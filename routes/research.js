'use strict';

const express = require('express');
const router = express.Router();
const { RateLimiterMemory } = require('rate-limiter-flexible');
const verifyToken = require('../middlewares/auth');
const { checkRole } = require('../middlewares/rbac');
const optionalAuth = require('../middlewares/optionalAuth');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { healthCheck } = require('../middlewares/healthMiddleware');
const ctrl = require('../controllers/researchSurveyController');
const { logger } = require('../logger');

const ROUTE_NAME = 'research';
router.use(healthCheck(ROUTE_NAME));

router.use((req, res, next) => {
  logger.info(`[ROUTE] ${ROUTE_NAME}`, { method: req.method, path: req.path });
  next();
});

const requireAdmin = checkRole('admin');

// ── Rate limiter: 10 submissions per IP per hour per survey (D8) ──

const surveySubmitLimiter = new RateLimiterMemory({
  points: 10,
  duration: 3600,
});

const surveySubmitLimit = async (req, res, next) => {
  const key = `${req.ip}:${req.params.slug}`;
  try {
    await surveySubmitLimiter.consume(key);
    next();
  } catch (err) {
    res.status(429).json({
      success: false,
      message: 'Muitas respostas enviadas. Tente novamente mais tarde.',
      retryAfter: Math.round((err.msBeforeNext || 60000) / 1000),
    });
  }
};

// ── Admin endpoints (verifyToken + requireAdmin) ────────────

router.get('/surveys',                    verifyToken, requireAdmin, readLimit,  ctrl.listSurveys);
router.get('/surveys/:id',               verifyToken, requireAdmin, readLimit,  ctrl.getSurvey);
router.post('/surveys',                   verifyToken, requireAdmin, writeLimit, ctrl.createSurvey);
router.patch('/surveys/:id',             verifyToken, requireAdmin, writeLimit, ctrl.updateSurvey);
router.post('/surveys/:id/publish',      verifyToken, requireAdmin, writeLimit, ctrl.publishSurvey);
router.post('/surveys/:id/pause',        verifyToken, requireAdmin, writeLimit, ctrl.pauseSurvey);
router.post('/surveys/:id/close',        verifyToken, requireAdmin, writeLimit, ctrl.closeSurvey);
router.delete('/surveys/:id',            verifyToken, requireAdmin, writeLimit, ctrl.deleteSurvey);
router.get('/surveys/:id/responses',     verifyToken, requireAdmin, readLimit,  ctrl.listResponses);
router.get('/surveys/:id/stats',         verifyToken, requireAdmin, readLimit,  ctrl.getResponseStats);
router.get('/surveys/:id/export',        verifyToken, requireAdmin, readLimit,  ctrl.exportResponsesCsv);

// ── Public endpoints (sem auth, rate limit) ─────────────────

router.get('/public/:slug',              readLimit,                             ctrl.getPublicSurvey);
router.post('/public/:slug/respond',     optionalAuth, surveySubmitLimit,       ctrl.submitResponse);

module.exports = router;
