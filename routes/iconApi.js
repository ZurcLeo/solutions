/**
 * @fileoverview IconChat REST API Routes
 *
 * Endpoints para o IconChat acessar dados e executar ações no ElosCloud.
 * Autenticação via HMAC per-seller (não usa Firebase Auth/JWT).
 *
 * Direção A (webhooks proativos): implementada separadamente
 * Direção B (consultas GET): 60 req/min — B1-B11
 * Direção B-OPS (ops panel): 60 req/min — B-OPS-1~4 (metrics, tasks, activity)
 * Direção C (ações POST):   20 req/min — C1-C5, C6-C9, C11, C14
 * Marketplace Discovery:    60 req/min — E1-MKT (search), E2-MKT (categories)
 */

'use strict';

const express = require('express');
const router = express.Router();
const verifyIconApiHmac = require('../middlewares/verifyIconApiHmac');
const verifyIconExchangeKey = require('../middlewares/verifyIconExchangeKey');
const { iconApiLimit, iconApiWriteLimit, pinRedeemLimit, channelLinkInitLimit } = require('../middlewares/rateLimiter');
const iconApiController = require('../controllers/iconApiController');
const consultCtrl = require('../controllers/iconApiConsultController');
const actionCtrl = require('../controllers/iconApiActionController');
const iconPinExchangeService = require('../services/iconPinExchangeService');

// ── PIN Exchange: ANTES do HMAC middleware (chicken-and-egg: D5) ────────────
router.post('/redeem-pin', verifyIconExchangeKey, pinRedeemLimit, async (req, res) => {
  try {
    const { pin } = req.body || {};

    if (!pin) {
      return res.status(400).json({ error: 'missing_pin' });
    }

    // Validar formato: 8 chars alfanumericos, opcionalmente com dash
    const normalized = pin.replace(/-/g, '').toUpperCase();
    if (!/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(normalized)) {
      return res.status(400).json({ error: 'invalid_pin_format' });
    }

    const credentials = await iconPinExchangeService.redeemPin(pin, req.ip);
    return res.json({ success: true, data: credentials });
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: 'pin_not_found' });
    if (err.statusCode === 410) return res.status(410).json({ error: 'pin_expired' });
    if (err.statusCode === 429) return res.status(429).json({ error: 'pin_max_attempts_exceeded' });

    const { logger } = require('../logger');
    logger.error('[iconApi] redeem-pin error', { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── Channel Links + User Context: HMAC de canal (sem seller-scope) ──────────
const verifyIconChannelHmac = require('../middlewares/verifyIconChannelHmac');
const channelLinkCtrl = require('../controllers/channelLinkController');
const iconUserContextCtrl = require('../controllers/iconUserContextController');

router.get('/channel-links/by-phone/:phone', verifyIconChannelHmac, iconApiLimit, channelLinkCtrl.lookup);
router.post('/channel-links/init', verifyIconChannelHmac, channelLinkInitLimit, channelLinkCtrl.init);
router.post('/channel-links/revoke', verifyIconChannelHmac, iconApiLimit, channelLinkCtrl.revokeByPhone);

// ── Agent Presence: HMAC de canal (sem seller-scope) ────────────────────────
const agentPresenceController = require('../controllers/agentPresenceController');
router.post('/agent-presence', verifyIconChannelHmac, iconApiLimit, agentPresenceController.handlePresenceEvent);

// ── OPS Metrics (channel-scoped): métricas plataforma para CS agent ─────────
const iconOpsCtrl = require('../controllers/iconOpsController');
router.get('/ops/metrics/live', verifyIconChannelHmac('OPS_LIVE_HMAC_SECRET'), iconApiLimit, iconOpsCtrl.getLiveMetrics);  // B-OPS-4

// E1: Contexto global do usuário (trust passport + gamificação + selos + buyer/seller)
router.get('/users/:userId/context', verifyIconChannelHmac, iconApiLimit, iconUserContextCtrl.getUserContext);

// E2: Contexto de comprador (pedidos, agendamentos, pendências — sem seller)
router.get('/users/:userId/buyer-context', verifyIconChannelHmac, iconApiLimit, iconUserContextCtrl.getBuyerContext);

// ── Marketplace Discovery: HMAC de canal (sem seller-scope) ─────────────
const iconMarketplaceCtrl = require('../controllers/iconMarketplaceController');
router.get('/marketplace/search', verifyIconChannelHmac, iconApiLimit, iconMarketplaceCtrl.search);        // E1-MKT
router.get('/marketplace/categories', verifyIconChannelHmac, iconApiLimit, iconMarketplaceCtrl.categories); // E2-MKT

// Middleware: HMAC auth em todas as rotas subsequentes
router.use(verifyIconApiHmac);

// ── Direção A (existente): Consultas básicas ────────────────────────────────

router.get('/orders/:orderId', iconApiLimit, iconApiController.getOrder);
router.get('/deliveries/:deliveryId', iconApiLimit, iconApiController.getDelivery);
router.get('/sellers/:sellerId/catalog', iconApiLimit, iconApiController.getCatalog);

// ── Direção B: Consultas expandidas (60 req/min) ────────────────────────────

router.get('/sellers/:sellerId/profile', iconApiLimit, consultCtrl.getSellerProfile);
router.get('/sellers/:sellerId/team', iconApiLimit, consultCtrl.getSellerTeam);
router.get('/sellers/:sellerId/customer-context', iconApiLimit, consultCtrl.getCustomerContext);
router.get('/sellers/:sellerId/services', iconApiLimit, consultCtrl.getSellerServices);                              // B7
router.get('/sellers/:sellerId/services/:serviceId/slots', iconApiLimit, consultCtrl.getServiceSlots);               // B8
router.get('/sellers/:sellerId/properties/:propertyId/availability', iconApiLimit, consultCtrl.getPropertyAvailability); // B10
router.get('/sellers/:sellerId/properties/:propertyId/detail', iconApiLimit, consultCtrl.getPropertyDetail);             // B11
router.get('/customers/by-phone/:phone', iconApiLimit, consultCtrl.getCustomerByPhone);
router.get('/bookings/:bookingId', iconApiLimit, consultCtrl.getBooking);
router.get('/pendencias/:pendenciaId', iconApiLimit, consultCtrl.getPendencia);
router.get('/sellers/:sellerId/agenda', iconApiLimit, consultCtrl.getSellerAgenda);                                      // B9

// ── Direção B-OPS: Dados do painel de operações (60 req/min) ────────────────

router.get('/sellers/:sellerId/ops/metrics', iconApiLimit, iconOpsCtrl.getSellerMetrics);                    // B-OPS-1
router.get('/sellers/:sellerId/ops/tasks', iconApiLimit, iconOpsCtrl.getSellerTasks);                        // B-OPS-2
router.get('/sellers/:sellerId/ops/tasks/:taskId/activity', iconApiLimit, iconOpsCtrl.getTaskActivity);      // B-OPS-3

// ── Direção C: Ações (20 req/min) ───────────────────────────────────────────

router.post('/actions/cancel-order', iconApiWriteLimit, actionCtrl.cancelOrder);
router.post('/actions/cancel-booking', iconApiWriteLimit, actionCtrl.cancelBooking);
router.post('/actions/request-refund', iconApiWriteLimit, actionCtrl.requestRefund);
router.post('/actions/open-dispute', iconApiWriteLimit, actionCtrl.openDispute);
router.post('/actions/reschedule-booking', iconApiWriteLimit, actionCtrl.rescheduleBooking);
router.post('/actions/create-booking', iconApiWriteLimit, actionCtrl.createBooking);         // C6
router.post('/actions/confirm-booking', iconApiWriteLimit, actionCtrl.confirmBooking);       // C9
router.post('/actions/complete-booking', iconApiWriteLimit, actionCtrl.completeBooking);     // C11
router.post('/actions/request-stay', iconApiWriteLimit, actionCtrl.requestStay);             // C7
router.post('/actions/cancel-stay', iconApiWriteLimit, actionCtrl.cancelStay);               // C8
router.post('/actions/block-dates', iconApiWriteLimit, actionCtrl.blockDates);               // C10
router.post('/actions/create-agenda-task', iconApiWriteLimit, actionCtrl.createAgendaTask); // C13
router.post('/actions/create-product', iconApiWriteLimit, actionCtrl.createProduct);       // C14

// ── ML Integration: Import + Sync (20 req/min) ─────────────────────────────

router.post('/sellers/:sellerId/products/import', iconApiWriteLimit, actionCtrl.importProducts);
router.patch('/sellers/:sellerId/products/by-external-id/:externalId', iconApiWriteLimit, actionCtrl.syncProduct);

// ── ML Replies: IconChat → ElosCloud → ML (20 req/min) ─────────────────────

const mlReplyCtrl = require('../controllers/mlReplyController');
router.post('/sellers/:sellerId/ml/reply-question', iconApiWriteLimit, mlReplyCtrl.replyQuestion);   // F1
router.post('/sellers/:sellerId/ml/reply-message', iconApiWriteLimit, mlReplyCtrl.replyMessage);      // F2

module.exports = router;
