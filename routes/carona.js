'use strict';

/**
 * Rotas do Módulo de Carona Solidária — ElosCloud
 *
 * Base: /api/carona
 *
 * Perfil de motorista:
 *   POST   /api/carona/drivers                 — cadastrar perfil de motorista
 *   GET    /api/carona/drivers/me              — meu perfil de motorista
 *   PATCH  /api/carona/drivers/:id/verify      — admin: verificar veículo
 *
 * Viagens:
 *   POST   /api/carona/rides                   — criar viagem
 *   GET    /api/carona/rides/search            — buscar caronas
 *   GET    /api/carona/rides/me/driver         — minhas viagens (motorista)
 *   GET    /api/carona/rides/me/passenger      — minhas reservas
 *   GET    /api/carona/rides/:id               — detalhe da viagem
 *   PATCH  /api/carona/rides/:id               — editar (pré-partida)
 *   DELETE /api/carona/rides/:id/cancel        — cancelar viagem
 *   POST   /api/carona/rides/:id/seats         — reservar vaga
 *   POST   /api/carona/rides/:id/checkin       — motorista: partiu
 *
 * Recorrência:
 *   POST   /api/carona/rides/recurring         — criar viagem recorrente
 *
 * Assentos (seats):
 *   POST   /api/carona/seats/:seatId/board     — passageiro: embarcou
 *   POST   /api/carona/seats/:seatId/alight    — passageiro: desembarcou
 *   POST   /api/carona/seats/:seatId/cancel    — cancelar reserva
 *   POST   /api/carona/seats/:seatId/rate      — avaliar
 *
 * Dashboard:
 *   GET    /api/carona/dashboard               — dashboard motorista
 *
 * SOS (CARONA-GAP-006):
 *   POST   /api/carona/rides/:rideId/sos       — acionar botao de panico
 */

const express    = require('express');
const router     = express.Router();
const verifyToken   = require('../middlewares/auth');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { healthCheck } = require('../middlewares/healthMiddleware');
const ctrl       = require('../controllers/caronaController');
const { logger } = require('../logger');

const ROUTE_NAME = 'carona';
router.use(healthCheck(ROUTE_NAME));

router.use((req, res, next) => {
  logger.info(`[ROUTE] ${ROUTE_NAME}`, {
    method: req.method, path: req.path, sreContext: req.sreContext || 'no-context',
  });
  next();
});

// ── Perfil de motorista ────────────────────────────────
router.post('/drivers',              verifyToken, writeLimit, ctrl.registerDriver);
router.get('/drivers/me',            verifyToken, readLimit,  ctrl.getDriverProfile);
router.patch('/drivers/:id/verify',  verifyToken, writeLimit, ctrl.verifyDriver);

// ── Dashboard ──────────────────────────────────────────
router.get('/dashboard',             verifyToken, readLimit,  ctrl.getDriverDashboard);

// ── Estimativa de rota (read-only) ─────────────────────
router.post('/route-estimate',       verifyToken, readLimit,  ctrl.routeEstimate);

// ── Viagens (rotas estáticas ANTES de :id) ─────────────
router.post('/rides',                verifyToken, writeLimit, ctrl.createRide);
router.get('/rides/search',          verifyToken, readLimit,  ctrl.searchRides);
router.get('/rides/recent',          verifyToken, readLimit,  ctrl.listRecentRides);
router.get('/rides/me/driver',       verifyToken, readLimit,  ctrl.getMyRidesAsDriver);
router.get('/rides/me/passenger',    verifyToken, readLimit,  ctrl.getMyRidesAsPassenger);
router.post('/rides/recurring',      verifyToken, writeLimit, ctrl.createRecurringRide);

// ── Waitlist (CARONA-GAP-005) ─────────────────────────────
router.post('/rides/:rideId/waitlist',        verifyToken, writeLimit, ctrl.joinWaitlist);
router.delete('/rides/:rideId/waitlist',      verifyToken, writeLimit, ctrl.leaveWaitlist);
router.get('/rides/:rideId/waitlist/status',  verifyToken, readLimit,  ctrl.getWaitlistStatus);

// ── SOS — Botao de panico (CARONA-GAP-006) ───────────────
router.post('/rides/:rideId/sos',             verifyToken, writeLimit, ctrl.triggerSOS);

// ── Viagens (rotas com :id) ────────────────────────────
router.get('/rides/:id',             verifyToken, readLimit,  ctrl.getRideDetail);
router.patch('/rides/:id',           verifyToken, writeLimit, ctrl.updateRide);
router.delete('/rides/:id/cancel',   verifyToken, writeLimit, ctrl.cancelRide);
router.post('/rides/:id/seats',      verifyToken, writeLimit, ctrl.bookSeat);
router.post('/rides/:id/checkin',    verifyToken, writeLimit, ctrl.driverCheckin);

// ── Assentos (seats) ───────────────────────────────────
router.post('/seats/:seatId/board',  verifyToken, writeLimit, ctrl.passengerBoard);
router.post('/seats/:seatId/alight', verifyToken, writeLimit, ctrl.passengerAlight);
router.post('/seats/:seatId/cancel', verifyToken, writeLimit, ctrl.cancelSeat);
router.post('/seats/:seatId/rate',   verifyToken, writeLimit, ctrl.submitRating);

module.exports = router;
