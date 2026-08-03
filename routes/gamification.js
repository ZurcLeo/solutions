const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/auth');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { logger } = require('../logger');
const ctrl = require('../controllers/gamificationController');

const ROUTE_NAME = 'gamification';

router.use((req, res, next) => {
  logger.info(`[ROUTE] ${ROUTE_NAME}`, { path: req.path, method: req.method });
  next();
});

// ── Leitura ──────────────────────────────────────────
router.get('/me',                  verifyToken, readLimit,  ctrl.getMe);
router.get('/tasks',               verifyToken, readLimit,  ctrl.getTasks);
router.get('/leaderboard',         verifyToken, readLimit,  ctrl.getLeaderboard);
router.get('/catalog/levels',                   readLimit,  ctrl.getLevels);   // público
router.get('/catalog/selos',                    readLimit,  ctrl.getSelos);    // público

// ── Escrita ──────────────────────────────────────────
router.post('/task/complete',      verifyToken, writeLimit, ctrl.completeTask);
router.post('/task/progress',      verifyToken, writeLimit, ctrl.incrementProgress);
router.post('/streak',             verifyToken, writeLimit, ctrl.updateStreak);
router.post('/selo/pin',           verifyToken, writeLimit, ctrl.togglePin);
router.post('/selo/celebrate',     verifyToken, writeLimit, ctrl.celebrateSelos);

// ── Eventos internos (chamados por outros controllers) ─
router.post('/event',              verifyToken, writeLimit, ctrl.triggerEvent);

// ── [ELOC-001] Economia EloCoin ───────────────────────
router.post('/spend',              verifyToken, writeLimit, ctrl.spendCoins);       // gasto genérico
router.post('/boost-content',      verifyToken, writeLimit, ctrl.boostContent);     // boost comprado com coins
router.post('/tip',                verifyToken, writeLimit, ctrl.tipUser);          // gorjeta usuário→usuário

// ── Recálculo retroativo ──────────────────────────────
router.post('/recalculate',        verifyToken, writeLimit, ctrl.recalculate);      // reconcilia user_tasks com dados reais

// ── Admin / Platform ─────────────────────────────────
router.post('/boost',              verifyToken, writeLimit, ctrl.grantBoost);       // boost algorítmico (admin)

module.exports = router;
