'use strict';

const express = require('express');
const router = express.Router();
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { healthCheck } = require('../middlewares/healthMiddleware');
const ctrl = require('../controllers/publicStoreController');
const { logger } = require('../logger');

const ROUTE_NAME = 'publicStore';
router.use(healthCheck(ROUTE_NAME));

router.use((req, res, next) => {
  logger.info(`[ROUTE] ${ROUTE_NAME}`, { method: req.method, path: req.path });
  next();
});

// ──────────────────────────────────────────────────────
// Public Store API — NENHUM verifyToken (todas públicas)
// ──────────────────────────────────────────────────────

// Leitura pública
router.get('/:sellerId',                      readLimit, ctrl.getStore);
router.get('/:sellerId/categories',             readLimit, ctrl.listCategories);
router.get('/:sellerId/products',              readLimit, ctrl.listProducts);
router.get('/:sellerId/products/:productId',   readLimit, ctrl.getProduct);
router.post('/:sellerId/delivery-estimate',    writeLimit, ctrl.estimateDelivery);

// Shipping quote (SHIP-W2 — public, no auth)
router.post('/:sellerId/shipping-quote',       readLimit,  ctrl.getShippingQuote);

// Guest order (Wave 2)
router.post('/:sellerId/orders',               writeLimit, ctrl.createGuestOrder);
router.post('/orders/:orderId/pay',            writeLimit, ctrl.initiateGuestPayment);
router.get('/orders/:orderId/status',          readLimit,  ctrl.getGuestOrderStatus);

module.exports = router;
