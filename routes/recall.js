'use strict';

/**
 * Rotas do Motor de Recall — ElosCloud
 * [RECALL-003 / RECALL-004]
 *
 * Base: /api/recall
 *
 * Regras (seller team, min: employee):
 *   GET    /api/recall/rules          — listar regras ativas
 *   POST   /api/recall/rules          — criar regra
 *   PATCH  /api/recall/rules/:id      — atualizar regra
 *   DELETE /api/recall/rules/:id      — desativar regra (soft-delete)
 *
 * Defaults:
 *   GET    /api/recall/defaults       — templates default por subtipo
 *
 * Analytics (seller team):
 *   GET    /api/recall/stats/detailed — estatisticas detalhadas (RECALL-009)
 *   GET    /api/recall/stats          — estatisticas de recall
 *   GET    /api/recall/log            — log de recalls paginado
 *
 * Opt-out (cliente autenticado):
 *   POST   /api/recall/optout         — cliente faz opt-out
 */

const express = require('express');
const router  = express.Router();
const verifyToken = require('../middlewares/auth');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { healthCheck } = require('../middlewares/healthMiddleware');
const { requireSellerTeamAccess } = require('../middlewares/requireSellerTeamAccess');
const ctrl = require('../controllers/recallController');
const { logger } = require('../logger');

const ROUTE_NAME = 'recall';
router.use(healthCheck(ROUTE_NAME));

router.use((req, res, next) => {
  logger.info(`[ROUTE] ${ROUTE_NAME}`, { method: req.method, path: req.path });
  next();
});

// ── Opt-out publico via token LGPD [RECALL-007] ─────
router.get('/optout', readLimit, ctrl.publicOptout);

// ── Regras de recall (seller team) ──────────────────
router.get('/rules',       verifyToken, requireSellerTeamAccess('employee'), readLimit,  ctrl.listRules);
router.post('/rules',      verifyToken, requireSellerTeamAccess('manager'),  writeLimit, ctrl.createRule);
router.patch('/rules/:id', verifyToken, requireSellerTeamAccess('manager'),  writeLimit, ctrl.updateRule);
router.delete('/rules/:id', verifyToken, requireSellerTeamAccess('manager'), writeLimit, ctrl.deleteRule);

// ── Templates default ───────────────────────────────
router.get('/defaults',    verifyToken, requireSellerTeamAccess('employee'), readLimit,  ctrl.getDefaults);

// ── Analytics ───────────────────────────────────────
router.get('/stats/detailed', verifyToken, requireSellerTeamAccess('employee'), readLimit, ctrl.getDetailedStats);
router.get('/stats',       verifyToken, requireSellerTeamAccess('employee'), readLimit,  ctrl.getStats);
router.get('/log',         verifyToken, requireSellerTeamAccess('employee'), readLimit,  ctrl.getLog);

// ── Opt-out (cliente autenticado, sem seller context) ─
router.post('/optout',     verifyToken, writeLimit, ctrl.optout);

module.exports = router;
