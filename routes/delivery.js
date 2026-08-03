'use strict';

/**
 * Rotas do Módulo de Delivery — ElosCloud
 *
 * Base: /api/delivery
 *
 * Loja de entrega:
 *   POST   /api/delivery/service              — criar loja de entrega
 *   GET    /api/delivery/service/me           — meu perfil de entregador
 *   GET    /api/delivery/service/:id          — perfil público
 *   PATCH  /api/delivery/service              — editar minha loja
 *
 * Sessão ativa (REST fallback — principal via Socket.IO):
 *   POST   /api/delivery/session/online       — ir online (compartilha posição)
 *   POST   /api/delivery/session/offline      — ir offline
 *
 * Matching (vendedor consulta antes de solicitar):
 *   GET    /api/delivery/eligible             — lista entregadores disponíveis
 *   GET    /api/delivery/fee                  — calcula tarifa para um entregador
 *
 * Solicitação (vendedor):
 *   POST   /api/delivery/orders/:orderId/request — solicitar entrega para um pedido
 *
 * Pedidos de entrega:
 *   GET    /api/delivery/requests             — meus pedidos (?role=deliverer|seller, ?status)
 *   GET    /api/delivery/requests/:id         — detalhe de um pedido
 *
 * Ações do vendedor:
 *   PATCH  /api/delivery/requests/:id/cancel  — cancelar busca (somente status 'open')
 *
 * Ações do entregador:
 *   POST   /api/delivery/requests/:id/accept  — aceitar pedido
 *   POST   /api/delivery/requests/:id/decline — recusar pedido
 *   POST   /api/delivery/requests/:id/step    — confirmar etapa (body: { step })
 *
 * Gorjeta [DELIVERY-SOL-001]:
 *   POST   /api/delivery/requests/:id/tip     — gorjeta voluntária pós-entrega (comprador)
 *
 * Avaliação:
 *   POST   /api/delivery/requests/:id/rate    — avaliar entrega (vendedor ou comprador)
 *
 * Painel:
 *   GET    /api/delivery/dashboard            — dados do painel do entregador
 */

const express    = require('express');
const router     = express.Router();
const verifyToken   = require('../middlewares/auth');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { healthCheck } = require('../middlewares/healthMiddleware');
const ctrl       = require('../controllers/deliveryController');
const ratingCtrl = require('../controllers/deliveryRatingController');
const { logger } = require('../logger');

const ROUTE_NAME = 'delivery';
router.use(healthCheck(ROUTE_NAME));

router.use((req, res, next) => {
  logger.info(`[ROUTE] ${ROUTE_NAME}`, {
    method: req.method, path: req.path, sreContext: req.sreContext || 'no-context',
  });
  next();
});

// ── Loja de entrega ──────────────────────────────────
router.post('/service',          verifyToken, writeLimit, ctrl.createDeliveryService);
router.get('/service/me',        verifyToken, readLimit,  ctrl.getMyDeliveryService);
router.get('/service/:id',       verifyToken, readLimit,  ctrl.getDeliveryServiceById);
router.patch('/service',         verifyToken, writeLimit, ctrl.updateDeliveryService);

// ── Sessão ativa (REST fallback) ─────────────────────
router.post('/session/online',   verifyToken, writeLimit, ctrl.goOnline);
router.post('/session/offline',  verifyToken, writeLimit, ctrl.goOffline);

// ── Matching ─────────────────────────────────────────
router.get('/eligible',          verifyToken, readLimit,  ctrl.findEligibleDeliverers);
router.get('/fee',               verifyToken, readLimit,  ctrl.calculateFee);

// ── Simulador de frete [DELIVERY-SIM-001] ────────────
router.get('/simulate',          verifyToken, readLimit,  ctrl.simulateRoute);

// ── Solicitação (vendedor) ───────────────────────────
router.post('/orders/:orderId/request', verifyToken, writeLimit, ctrl.requestDelivery);

// ── Painel ───────────────────────────────────────────
router.get('/dashboard',         verifyToken, readLimit,  ctrl.getDashboard);

// ── Pedidos de entrega ───────────────────────────────
router.get('/requests',          verifyToken, readLimit,  ctrl.listMyDeliveryRequests);
router.get('/requests/:id',      verifyToken, readLimit,  ctrl.getDeliveryRequest);

// ── Ações do vendedor ────────────────────────────────
router.patch('/requests/:id/cancel',   verifyToken, writeLimit, ctrl.cancelDeliveryRequest);
router.patch('/requests/:id/resolve',  verifyToken, writeLimit, ctrl.resolveDeliveryRequest);

// ── Gorjeta voluntária [DELIVERY-SOL-001] ─────────────
router.post('/requests/:id/tip',     verifyToken, writeLimit, ctrl.addTip);

// ── Ações do entregador ──────────────────────────────
router.post('/requests/:id/accept',  verifyToken, writeLimit, ctrl.acceptDeliveryRequest);
router.post('/requests/:id/decline', verifyToken, writeLimit, ctrl.declineDeliveryRequest);
router.post('/requests/:id/step',    verifyToken, writeLimit, ctrl.confirmStep);

// ── Avaliação (legado — entregador via deliveryController) ───────────────────
router.post('/requests/:id/rate',    verifyToken, writeLimit, ctrl.rateDelivery);

// ── Avaliação tripartite (DELIVERY-RATING-001) ────────────────────────────────
// ATENÇÃO: rotas estáticas ANTES de /:requestId para evitar conflito de params
router.get('/ratings/pending',              verifyToken, readLimit,  ratingCtrl.getPendingRatings);
router.get('/ratings/history',              verifyToken, readLimit,  ratingCtrl.getRatingHistory);
router.get('/ratings/summary/:userId',      verifyToken, readLimit,  ratingCtrl.getUserRatingSummary);
router.post('/:requestId/ratings',          verifyToken, writeLimit, ratingCtrl.submitRating);
router.get('/:requestId/ratings',           verifyToken, readLimit,  ratingCtrl.getRatingsForRequest);

module.exports = router;
