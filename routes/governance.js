const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/auth');
const { checkRole } = require('../middlewares/rbac');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { logger } = require('../logger');
const ctrl = require('../controllers/governanceController');

const ROUTE_NAME = 'governance';

router.use((req, res, next) => {
  logger.info(`[ROUTE] ${ROUTE_NAME}`, { path: req.path, method: req.method });
  next();
});

// ── Propostas — Leitura ─────────────────────────────────
router.get('/proposals',          verifyToken, readLimit,  ctrl.listProposals);
router.get('/proposals/:id',      verifyToken, readLimit,  ctrl.getProposal);

// ── Propostas — Escrita ─────────────────────────────────
router.post('/proposals',         verifyToken, writeLimit, ctrl.createProposal);
router.patch('/proposals/:id/open', verifyToken, writeLimit, ctrl.openProposal);

// ── Votação ─────────────────────────────────────────────
router.post('/proposals/:id/vote',  verifyToken, writeLimit, ctrl.castVote);
router.post('/proposals/:id/tally', verifyToken, writeLimit, ctrl.tallyVotes);

// ── Execução (admin-only) ───────────────────────────────
router.post('/proposals/:id/execute', verifyToken, writeLimit, checkRole('admin'), ctrl.executeProposal);

// ── Tesouraria ──────────────────────────────────────────
router.get('/treasury',           verifyToken, readLimit,  ctrl.getTreasuryStats);

module.exports = router;
