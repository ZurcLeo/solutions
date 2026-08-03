const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/auth');
const { readLimit } = require('../middlewares/rateLimiter');
const { logger } = require('../logger');
const ctrl = require('../controllers/eloCoinController');

const ROUTE_NAME = 'elcoin';

router.use((req, res, next) => {
  logger.info(`[ROUTE] ${ROUTE_NAME}`, { path: req.path, method: req.method });
  next();
});

// Extrato do usuário — auth obrigatória, readLimit
router.get('/statement', verifyToken, readLimit, ctrl.getStatement);

module.exports = router;
