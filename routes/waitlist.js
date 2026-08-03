'use strict';

/**
 * Rotas da Waitlist — ElosCloud
 *
 * Base: /api/waitlist
 *
 * PÚBLICO (sem auth):
 *   POST   /                     — cadastro na lista de espera
 *   POST   /check                — envio de contatos para matching
 *   GET    /status               — status por email
 *
 * AUTENTICADO (membros):
 *   GET    /matches              — notificações de matching
 *   POST   /matches/:id/accept   — aceitar convidar A
 *   POST   /matches/:id/dismiss  — rejeitar notificação
 *   GET    /matching             — status atual de matching
 *   PATCH  /matching             — opt-in/out de matching
 */

const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/auth');
const { readLimit, writeLimit, authRateLimiter } = require('../middlewares/rateLimiter');
const { healthCheck } = require('../middlewares/healthMiddleware');
const ctrl = require('../controllers/waitlistController');
const { logger } = require('../logger');

const ROUTE_NAME = 'waitlist';
router.use(healthCheck(ROUTE_NAME));

router.use((req, res, next) => {
  logger.info(`[ROUTE] ${ROUTE_NAME}`, {
    method: req.method, path: req.path, sreContext: req.sreContext || 'no-context',
  });
  next();
});

// ── Público ──────────────────────────────────────────
// writeLimit: 20 req/min — suficiente para endpoint público
// authRateLimiter: 5 req/hora — restritivo para check de contatos
router.post('/',       writeLimit,        ctrl.addToWaitlist);
router.post('/check',  authRateLimiter,   ctrl.checkContacts);
router.get('/status',  readLimit,         ctrl.getStatus);

// ── Autenticado ──────────────────────────────────────
router.get('/matches',               verifyToken, readLimit,  ctrl.getMatches);
router.post('/matches/:id/accept',   verifyToken, writeLimit, ctrl.acceptMatch);
router.post('/matches/:id/dismiss',  verifyToken, writeLimit, ctrl.dismissMatch);
router.get('/matching',              verifyToken, readLimit,  ctrl.getMatchingPreference);
router.patch('/matching',            verifyToken, writeLimit, ctrl.updateMatchingPreference);

module.exports = router;
