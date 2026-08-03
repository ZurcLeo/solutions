// backend/eloscloudapp/routes/userReadiness.js
// GATE-A — Progressive Feature Unlocking

const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/auth');
const { readLimit } = require('../middlewares/rateLimiter');
const { getReadiness, getPendingActions } = require('../controllers/userReadinessController');

// GET /api/user/readiness — retorna os 5 gates de prontidão do usuário autenticado
router.get('/readiness', verifyToken, readLimit, getReadiness);

// GET /api/user/pending-actions — retorna ações pendentes cruzadas com gates faltantes
router.get('/pending-actions', verifyToken, readLimit, getPendingActions);

module.exports = router;
