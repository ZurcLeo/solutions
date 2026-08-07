'use strict';

/**
 * @fileoverview caronaController — ElosCloud Módulo de Carona Solidária
 * Camada fina: extrai parâmetros da request, delega ao caronaService,
 * retorna resposta padronizada { success, data } ou { success, message }.
 */

const caronaService = require('../services/caronaService');
const { logger }    = require('../logger');

const CTRL = 'caronaController';

// ─── helpers ─────────────────────────────────────────────────────
function mapStatus(msg) {
  if (!msg) return 500;
  if (msg.includes('não encontrad')  || msg.includes('não possui'))    return 404;
  if (msg.includes('já possui')      || msg.includes('já avaliou'))    return 409;
  if (msg.includes('obrigatório')    || msg.includes('inválido')
   || msg.includes('deve ser')       || msg.includes('não pode')
   || msg.includes('Moto não')       || msg.includes('não é permitid')) return 400;
  if (msg.includes('Trust Level')    || msg.includes('não foi verificad')
   || msg.includes('Vizinho de')     || msg.includes('admin'))         return 403;
  return 500;
}

// ──────────────────────────────────────────────────────
// Perfil de motorista
// ──────────────────────────────────────────────────────

exports.registerDriver = async (req, res) => {
  try {
    const data = await caronaService.registerDriver(req.user.uid, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) {
    logger.warn(`[${CTRL}] registerDriver: ${err.message}`, { userId: req.user?.uid });
    res.status(mapStatus(err.message)).json({ success: false, message: err.message });
  }
};

exports.getDriverProfile = async (req, res) => {
  try {
    const data = await caronaService.getDriverProfile(req.user.uid);
    if (!data) return res.status(404).json({ success: false, message: 'Perfil de motorista não encontrado.' });
    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(mapStatus(err.message)).json({ success: false, message: err.message });
  }
};

exports.verifyDriver = async (req, res) => {
  try {
    const { approved, rejection_reason, verification_expires_at, expiresAt } = req.body;
    const expiry = verification_expires_at || expiresAt || null;
    const data = await caronaService.verifyDriver(
      req.user.uid, req.params.id, approved, rejection_reason, expiry
    );
    res.status(200).json({ success: true, data });
  } catch (err) {
    logger.warn(`[${CTRL}] verifyDriver: ${err.message}`, { adminId: req.user?.uid });
    res.status(mapStatus(err.message)).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Estimativa de rota (read-only, sem criar nada)
// ──────────────────────────────────────────────────────

exports.routeEstimate = async (req, res) => {
  try {
    const data = await caronaService.getRouteEstimate(req.body);
    res.status(200).json({ success: true, data });
  } catch (err) {
    logger.warn(`[${CTRL}] routeEstimate: ${err.message}`);
    res.status(mapStatus(err.message)).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Viagens
// ──────────────────────────────────────────────────────

exports.createRide = async (req, res) => {
  try {
    const data = await caronaService.createRide(req.user.uid, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) {
    logger.warn(`[${CTRL}] createRide: ${err.message}`, { userId: req.user?.uid });
    res.status(mapStatus(err.message)).json({ success: false, message: err.message });
  }
};

exports.searchRides = async (req, res) => {
  try {
    const data = await caronaService.searchRides(req.user.uid, req.query);
    res.status(200).json({ success: true, data });
  } catch (err) {
    logger.warn(`[${CTRL}] searchRides: ${err.message}`, { userId: req.user?.uid });
    res.status(mapStatus(err.message)).json({ success: false, message: err.message });
  }
};

exports.listRecentRides = async (req, res) => {
  try {
    const { sort, limit } = req.query;
    const data = await caronaService.listRecentRides({ sort, limit });
    res.status(200).json({ success: true, data });
  } catch (err) {
    logger.warn(`[${CTRL}] listRecentRides: ${err.message}`);
    res.status(mapStatus(err.message)).json({ success: false, message: err.message });
  }
};

exports.getRideDetail = async (req, res) => {
  try {
    const data = await caronaService.getRideDetail(req.user.uid, req.params.id);
    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(mapStatus(err.message)).json({ success: false, message: err.message });
  }
};

exports.updateRide = async (req, res) => {
  try {
    const data = await caronaService.updateRide(req.user.uid, req.params.id, req.body);
    res.status(200).json({ success: true, data });
  } catch (err) {
    logger.warn(`[${CTRL}] updateRide: ${err.message}`, { userId: req.user?.uid });
    res.status(mapStatus(err.message)).json({ success: false, message: err.message });
  }
};

exports.cancelRide = async (req, res) => {
  try {
    const data = await caronaService.cancelRide(req.user.uid, req.params.id, req.body.reason);
    res.status(200).json({ success: true, data });
  } catch (err) {
    logger.warn(`[${CTRL}] cancelRide: ${err.message}`, { userId: req.user?.uid });
    res.status(mapStatus(err.message)).json({ success: false, message: err.message });
  }
};

exports.getMyRidesAsDriver = async (req, res) => {
  try {
    const data = await caronaService.getMyRidesAsDriver(req.user.uid, req.query);
    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getMyRidesAsPassenger = async (req, res) => {
  try {
    const data = await caronaService.getMyRidesAsPassenger(req.user.uid, req.query);
    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Reservas (seats)
// ──────────────────────────────────────────────────────

exports.bookSeat = async (req, res) => {
  try {
    const data = await caronaService.bookSeat(req.user.uid, req.params.id, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) {
    logger.warn(`[${CTRL}] bookSeat: ${err.message}`, { userId: req.user?.uid });
    res.status(mapStatus(err.message)).json({ success: false, message: err.message });
  }
};

exports.cancelSeat = async (req, res) => {
  try {
    const data = await caronaService.cancelSeat(req.user.uid, req.params.seatId);
    res.status(200).json({ success: true, data });
  } catch (err) {
    logger.warn(`[${CTRL}] cancelSeat: ${err.message}`, { userId: req.user?.uid });
    res.status(mapStatus(err.message)).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Fluxo da viagem
// ──────────────────────────────────────────────────────

exports.driverCheckin = async (req, res) => {
  try {
    const data = await caronaService.driverCheckin(req.user.uid, req.params.id);
    res.status(200).json({ success: true, data });
  } catch (err) {
    logger.warn(`[${CTRL}] driverCheckin: ${err.message}`, { userId: req.user?.uid });
    res.status(mapStatus(err.message)).json({ success: false, message: err.message });
  }
};

exports.passengerBoard = async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const coords = (lat && lng) ? { lat: Number(lat), lng: Number(lng) } : null;
    const data = await caronaService.passengerBoard(req.user.uid, req.params.seatId, coords);
    res.status(200).json({ success: true, data });
  } catch (err) {
    logger.warn(`[${CTRL}] passengerBoard: ${err.message}`, { userId: req.user?.uid });
    res.status(mapStatus(err.message)).json({ success: false, message: err.message });
  }
};

exports.passengerAlight = async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const coords = (lat && lng) ? { lat: Number(lat), lng: Number(lng) } : null;
    const data = await caronaService.passengerAlight(req.user.uid, req.params.seatId, coords);
    res.status(200).json({ success: true, data });
  } catch (err) {
    logger.warn(`[${CTRL}] passengerAlight: ${err.message}`, { userId: req.user?.uid });
    res.status(mapStatus(err.message)).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Avaliações
// ──────────────────────────────────────────────────────

exports.submitRating = async (req, res) => {
  try {
    const data = await caronaService.submitRating(req.user.uid, req.params.seatId, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) {
    logger.warn(`[${CTRL}] submitRating: ${err.message}`, { userId: req.user?.uid });
    res.status(mapStatus(err.message)).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Dashboard
// ──────────────────────────────────────────────────────

exports.getDriverDashboard = async (req, res) => {
  try {
    const data = await caronaService.getDriverDashboard(req.user.uid);
    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Recorrência
// ──────────────────────────────────────────────────────

exports.createRecurringRide = async (req, res) => {
  try {
    const data = await caronaService.createRecurringRide(req.user.uid, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) {
    logger.warn(`[${CTRL}] createRecurringRide: ${err.message}`, { userId: req.user?.uid });
    res.status(mapStatus(err.message)).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Waitlist (CARONA-GAP-005)
// ──────────────────────────────────────────────────────

exports.joinWaitlist = async (req, res) => {
  try {
    const result = await caronaService.joinWaitlist(req.params.rideId, req.user.uid);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    logger.warn(`[${CTRL}] joinWaitlist: ${err.message}`, { userId: req.user?.uid });
    res.status(mapStatus(err.message)).json({ success: false, message: err.message });
  }
};

exports.leaveWaitlist = async (req, res) => {
  try {
    const result = await caronaService.leaveWaitlist(req.params.rideId, req.user.uid);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.warn(`[${CTRL}] leaveWaitlist: ${err.message}`, { userId: req.user?.uid });
    res.status(mapStatus(err.message)).json({ success: false, message: err.message });
  }
};

exports.getWaitlistStatus = async (req, res) => {
  try {
    const result = await caronaService.getWaitlistStatus(req.params.rideId, req.user.uid);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// SOS — Botao de panico (CARONA-GAP-006)
// ──────────────────────────────────────────────────────

exports.triggerSOS = async (req, res) => {
  try {
    const { lat, lng } = req.body || {};
    const result = await caronaService.triggerSOS(
      req.params.rideId,
      req.user.uid,
      { lat: lat != null ? Number(lat) : null, lng: lng != null ? Number(lng) : null },
    );
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    logger.warn(`[${CTRL}] triggerSOS: ${err.message}`, { userId: req.user?.uid });
    res.status(mapStatus(err.message)).json({ success: false, message: err.message });
  }
};
