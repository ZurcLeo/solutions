'use strict';

/**
 * Rotas do Sistema de Agendamentos — ElosCloud
 * [SCHED-001]
 *
 * Base: /api/bookings
 *
 * Disponibilidade (prestador):
 *   PUT  /api/bookings/availability          — define grade semanal (substitui tudo)
 *   GET  /api/bookings/availability/:serviceId — lê grade semanal (público)
 *
 * Slots:
 *   GET  /api/bookings/slots?service_id=...&date=YYYY-MM-DD — slots livres
 *
 * Agendamentos:
 *   POST /api/bookings                       — cliente cria agendamento
 *   GET  /api/bookings?role=client|provider  — lista meus agendamentos
 *   GET  /api/bookings/:id                   — detalhe de um agendamento
 *
 * Ações do prestador:
 *   PATCH /api/bookings/:id/confirm          — confirmar agendamento
 *   PATCH /api/bookings/:id/decline          — recusar agendamento
 *   PATCH /api/bookings/:id/complete         — marcar como concluído (→ Stripe capture)
 *   PATCH /api/bookings/:id/no-show          — marcar cliente como no-show (não compareceu)
 *
 * Cancelamento (cliente ou prestador):
 *   PATCH /api/bookings/:id/cancel           — cancelar (body: { role, reason? })
 *
 * Check-in QR Code [SCHED-CAP-011]:
 *   POST  /api/bookings/:id/checkin-code     — prestador gera QR token para slot
 *   POST  /api/bookings/checkin              — cliente faz check-in via QR
 *   GET   /api/bookings/checkins             — prestador consulta check-ins do slot
 *
 * Waitlist / Fila de Espera [SCHED-CAP-013]:
 *   POST   /api/bookings/waitlist            — cliente entra na fila de espera
 *   DELETE /api/bookings/waitlist/:id        — cliente sai da fila de espera
 *   GET    /api/bookings/waitlist            — lista entries do cliente
 *   GET    /api/bookings/waitlist/slot       — provider consulta fila do slot
 */

const express     = require('express');
const router      = express.Router();
const verifyToken = require('../middlewares/auth');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { healthCheck } = require('../middlewares/healthMiddleware');
const ctrl        = require('../controllers/bookingController');
const { validateSellerCapability } = require('../middlewares/validateSellerCapability');
const { logger }  = require('../logger');

const ROUTE_NAME = 'bookings';
router.use(healthCheck(ROUTE_NAME));

router.use((req, res, next) => {
  logger.info(`[ROUTE] ${ROUTE_NAME}`, {
    method: req.method, path: req.path, sreContext: req.sreContext || 'no-context',
  });
  next();
});

// ── Scheduling Intelligence — Team Member Assignment ─
router.get('/conflicts',               verifyToken, readLimit,  ctrl.checkConflicts);
router.get('/service-team/:sellerId',  verifyToken, readLimit,  ctrl.getServiceTeam);

// ── Disponibilidade ──────────────────────────────────
router.put('/availability',             verifyToken, validateSellerCapability('has_scheduling'), writeLimit, ctrl.setAvailability);
router.get('/availability/:serviceId',  readLimit,  ctrl.getAvailability); // público — leitura apenas

// ── Dias ativos (prefetch calendário) ────────────────
router.get('/available-days',           verifyToken, readLimit,  ctrl.getActiveDays);

// ── Slots disponíveis ────────────────────────────────
router.get('/slots',                    verifyToken, readLimit,  ctrl.getAvailableSlots);

// ── Waitlist / Fila de Espera [SCHED-CAP-013] ─────────
// IMPORTANTE: /waitlist* ANTES de /:id para evitar conflito de rota
router.post('/waitlist',               verifyToken, writeLimit, ctrl.joinWaitlist);
router.delete('/waitlist/:id',         verifyToken, writeLimit, ctrl.leaveWaitlist);
router.get('/waitlist',                verifyToken, readLimit,  ctrl.getMyWaitlistEntries);
router.get('/waitlist/slot',           verifyToken, readLimit,  ctrl.getSlotWaitlist);

// ── Check-in QR + Fallbacks [SCHED-CAP-011] ──────────
// IMPORTANTE: /checkin* ANTES de /:id para evitar que Express os interprete como :id
router.post('/checkin',                 verifyToken, writeLimit, ctrl.performCheckin);
router.post('/checkin-pin',             verifyToken, writeLimit, ctrl.performCheckinByPin);
router.get('/checkins',                 verifyToken, readLimit,  ctrl.getCheckins);

// ── Agendamentos ─────────────────────────────────────
router.post('/',                        verifyToken, writeLimit, ctrl.createBooking);
router.get('/',                         verifyToken, readLimit,  ctrl.getMyBookings);
router.get('/:id',                      verifyToken, readLimit,  ctrl.getBookingById);

// ── Ações do prestador ───────────────────────────────
router.post('/:id/checkin-code',        verifyToken, writeLimit, ctrl.generateCheckin);
router.post('/:id/manual-checkin',      verifyToken, writeLimit, ctrl.manualCheckin);
router.patch('/:id/confirm',            verifyToken, writeLimit, ctrl.confirmBooking);
router.patch('/:id/decline',            verifyToken, writeLimit, ctrl.declineBooking);
router.patch('/:id/complete',           verifyToken, writeLimit, ctrl.completeBooking);
router.patch('/:id/no-show',            verifyToken, writeLimit, ctrl.markNoShow);

// ── Cancelamento ─────────────────────────────────────
router.patch('/:id/cancel',             verifyToken, writeLimit, ctrl.cancelBooking);

module.exports = router;
