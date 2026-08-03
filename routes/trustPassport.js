const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/auth');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { logger } = require('../logger');
const ctrl = require('../controllers/trustPassportController');

const ROUTE_NAME = 'trustPassport';

router.use((req, res, next) => {
  logger.info(`[ROUTE] ${ROUTE_NAME}`, { path: req.path, method: req.method });
  next();
});

// ── Leitura ──────────────────────────────────────────
router.get('/passport',           verifyToken, readLimit,  ctrl.getMyPassport);
router.get('/passport/:userId',   verifyToken, readLimit,  ctrl.getPublicPassport);
router.get('/levels',                          readLimit,  ctrl.getLevels);          // público

// ── Escrita ──────────────────────────────────────────
router.post('/endorse',           verifyToken, writeLimit, ctrl.createEndorsement);
router.post('/recalculate',       verifyToken, writeLimit, ctrl.recalculate);
router.post('/recalculate-all',   verifyToken, writeLimit, ctrl.recalculateAll);     // admin

module.exports = router;
