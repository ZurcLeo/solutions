/**
 * @fileoverview deliveryController — ElosCloud Módulo de Delivery
 * Camada fina: extrai parâmetros da request, delega ao deliveryService,
 * retorna resposta padronizada { success, data } ou { success, message }.
 */

'use strict';

const deliveryService = require('../services/deliveryService');
const { logger }      = require('../logger');
const Joi             = require('joi');

const CTRL = 'deliveryController';

// ──────────────────────────────────────────────────────
// Loja de entrega
// ──────────────────────────────────────────────────────

exports.createDeliveryService = async (req, res) => {
  try {
    const svc = await deliveryService.createDeliveryService(req.user.uid, req.body);
    res.status(201).json({ success: true, data: svc });
  } catch (err) {
    logger.warn(`[${CTRL}] createDeliveryService: ${err.message}`, { userId: req.user?.uid });
    const status = err.message.includes('já possui') ? 409
                 : err.message.includes('obrigatório') || err.message.includes('inválido') || err.message.includes('deve ser') ? 400
                 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.updateDeliveryService = async (req, res) => {
  try {
    const svc = await deliveryService.updateDeliveryService(req.user.uid, req.body);
    res.status(200).json({ success: true, data: svc });
  } catch (err) {
    logger.warn(`[${CTRL}] updateDeliveryService: ${err.message}`, { userId: req.user?.uid });
    const status = err.message.includes('não encontrada') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.getMyDeliveryService = async (req, res) => {
  try {
    const svc = await deliveryService.getMyDeliveryService(req.user.uid);
    res.status(200).json({ success: true, data: svc });
  } catch (err) {
    res.status(404).json({ success: false, message: err.message });
  }
};

exports.getDeliveryServiceById = async (req, res) => {
  try {
    const svc = await deliveryService.getDeliveryServiceById(req.params.id);
    res.status(200).json({ success: true, data: svc });
  } catch (err) {
    res.status(404).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Sessão ativa (online/offline) — chamados internamente pelo Socket.IO
// mas também expostos como REST para fallback HTTP
// ──────────────────────────────────────────────────────

exports.goOnline = async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const result = await deliveryService.goOnline(req.user.uid, {
      lat: lat ? Number(lat) : null,
      lng: lng ? Number(lng) : null,
    });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.warn(`[${CTRL}] goOnline: ${err.message}`, { userId: req.user?.uid });
    res.status(400).json({ success: false, message: err.message });
  }
};

exports.goOffline = async (req, res) => {
  try {
    await deliveryService.goOffline(req.user.uid);
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Matching — vendedor consulta entregadores disponíveis
// ──────────────────────────────────────────────────────

exports.findEligibleDeliverers = async (req, res) => {
  try {
    const {
      pickup_lat, pickup_lng, dest_lat, dest_lng,
      weight_kg, is_fragile,
      pickup_city, dest_city, dest_state,
      limit,
    } = req.query;

    const candidates = await deliveryService.findEligibleDeliverers(
      pickup_lat ? Number(pickup_lat) : null,
      pickup_lng ? Number(pickup_lng) : null,
      dest_lat   ? Number(dest_lat)   : null,
      dest_lng   ? Number(dest_lng)   : null,
      {
        weightKg:   weight_kg  ? Number(weight_kg) : 0,
        isFragile:  is_fragile === 'true',
        limit:      limit ? Number(limit) : 5,
        pickupCity: pickup_city ?? null,
        destCity:   dest_city   ?? null,
        destState:  dest_state  ?? null,
      }
    );

    res.status(200).json({ success: true, data: candidates });
  } catch (err) {
    logger.warn(`[${CTRL}] findEligibleDeliverers: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.calculateFee = async (req, res) => {
  try {
    const {
      service_id,
      pickup_lat, pickup_lng, dest_lat, dest_lng,
      current_lat, current_lng, vehicle_id, is_solidarity,
    } = req.query;

    if (!service_id) return res.status(400).json({ success: false, message: 'service_id é obrigatório' });

    const result = await deliveryService.calculateFee(service_id, {
      pickupLat:    pickup_lat    ? Number(pickup_lat)  : null,
      pickupLng:    pickup_lng    ? Number(pickup_lng)  : null,
      destLat:      dest_lat      ? Number(dest_lat)    : null,
      destLng:      dest_lng      ? Number(dest_lng)    : null,
      currentLat:   current_lat   ? Number(current_lat) : null,
      currentLng:   current_lng   ? Number(current_lng) : null,
      vehicleId:    vehicle_id    || null,
      isSolidarity: is_solidarity === 'true',
    });

    res.status(200).json({ success: true, data: result });
  } catch (err) {
    const status = err.message.includes('indisponível') || err.message.includes('cobertura') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Solicitação de entrega (vendedor)
// ──────────────────────────────────────────────────────

const requestDeliverySchema = Joi.object({
  pickup_address:       Joi.string().optional(),
  pickup_neighborhood:  Joi.string().optional().allow(null, ''),
  pickup_city:          Joi.string().optional(),
  pickup_state:         Joi.string().optional(),
  pickup_lat:           Joi.number().min(-90).max(90).optional().allow(null),
  pickup_lng:           Joi.number().min(-180).max(180).optional().allow(null),
  dest_address:         Joi.string().optional(),
  dest_neighborhood:    Joi.string().optional().allow(null, ''),
  dest_city:            Joi.string().optional(),
  dest_state:           Joi.string().optional().allow(null, ''),
  dest_lat:             Joi.number().min(-90).max(90).optional().allow(null),
  dest_lng:             Joi.number().min(-180).max(180).optional().allow(null),
  weight_kg:            Joi.number().min(0).optional(),
  is_fragile:           Joi.boolean().optional(),
  is_solidarity:        Joi.boolean().optional(),
  notes:                Joi.string().max(500).optional().allow(null, ''),
  service_id:           Joi.string().optional(),
}).unknown(true);

exports.requestDelivery = async (req, res) => {
  try {
    const { error: valErr, value } = requestDeliverySchema.validate(req.body);
    if (valErr) return res.status(400).json({ success: false, message: valErr.details[0].message });

    const { orderId } = req.params;
    const result = await deliveryService.requestDelivery(req.user.uid, orderId, value);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    logger.warn(`[${CTRL}] requestDelivery: ${err.message}`, { userId: req.user?.uid });
    const status = err.message.includes('não encontrado') ? 404
                 : err.message.includes('não é') || err.message.includes('obrigatório') ? 400
                 : err.message.includes('Já existe') ? 409
                 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Aceite / Recusa (entregador)
// ──────────────────────────────────────────────────────

exports.acceptDeliveryRequest = async (req, res) => {
  try {
    const result = await deliveryService.acceptDeliveryRequest(req.user.uid, req.params.id);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.warn(`[${CTRL}] acceptDeliveryRequest: ${err.message}`, { userId: req.user?.uid });
    const status = err.message.includes('já foi aceito') ? 409
                 : err.message.includes('expirou') || err.message.includes('notificado') ? 400
                 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.declineDeliveryRequest = async (req, res) => {
  try {
    const result = await deliveryService.declineDeliveryRequest(req.user.uid, req.params.id);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Etapas (entregador confirma cada passo)
// ──────────────────────────────────────────────────────

exports.confirmStep = async (req, res) => {
  try {
    const { step } = req.body;
    if (!step) return res.status(400).json({ success: false, message: 'step é obrigatório' });

    const result = await deliveryService.confirmStep(req.user.uid, req.params.id, step);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.warn(`[${CTRL}] confirmStep: ${err.message}`, { userId: req.user?.uid });
    const status = err.message.includes('inválida') || err.message.includes('inválido') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Avaliação pós-entrega
// ──────────────────────────────────────────────────────

exports.rateDelivery = async (req, res) => {
  try {
    const { rating, note } = req.body;
    const result = await deliveryService.rateDelivery(req.user.uid, req.params.id, { rating, note });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.warn(`[${CTRL}] rateDelivery: ${err.message}`, { userId: req.user?.uid });
    const status = err.message.includes('não encontrado') ? 404
                 : err.message.includes('entre 1') || err.message.includes('Só é') || err.message.includes('já avaliou') ? 400
                 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Consultas
// ──────────────────────────────────────────────────────

exports.getDeliveryRequest = async (req, res) => {
  try {
    const req_ = await deliveryService.getDeliveryRequest(req.user.uid, req.params.id);
    res.status(200).json({ success: true, data: req_ });
  } catch (err) {
    const status = err.message.includes('Acesso') ? 403 : 404;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.listMyDeliveryRequests = async (req, res) => {
  try {
    const { role, status, limit, page } = req.query;
    const result = await deliveryService.listMyDeliveryRequests(req.user.uid, { role, status, limit, page });
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getDashboard = async (req, res) => {
  try {
    const data = await deliveryService.getDashboard(req.user.uid);
    res.status(200).json({ success: true, data });
  } catch (err) {
    logger.warn(`[${CTRL}] getDashboard: ${err.message}`, { userId: req.user?.uid });
    res.status(404).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Cancelamento de solicitação (vendedor, status open)
// ──────────────────────────────────────────────────────

exports.cancelDeliveryRequest = async (req, res) => {
  try {
    const result = await deliveryService.cancelDeliveryRequest(req.user.uid, req.params.id);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.warn(`[${CTRL}] cancelDeliveryRequest: ${err.message}`, { userId: req.user?.uid });
    const status = err.message.includes('não encontrada') ? 404
                 : err.message.includes('Somente o vendedor') ? 403
                 : err.message.includes("status 'open'") ? 409
                 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Simulador de frete inteligente [DELIVERY-SIM-001]
// ──────────────────────────────────────────────────────

const simulateRouteSchema = Joi.object({
  originLat:   Joi.number().min(-90).max(90).required(),
  originLng:   Joi.number().min(-180).max(180).required(),
  destLat:     Joi.number().min(-90).max(90).required(),
  vehicleId:   Joi.string().optional(),
  destLng:     Joi.number().min(-180).max(180).required(),
  vehicleType: Joi.string().valid('bike', 'moto', 'carro', 'van', 'caminhonete').optional(),
  weightKg:    Joi.number().min(0).optional(),
  returnLeg:   Joi.boolean().optional(),
});

exports.simulateRoute = async (req, res) => {
  try {
    const { error: valErr, value } = simulateRouteSchema.validate({
      originLat:   req.query.originLat   ? Number(req.query.originLat)   : undefined,
      originLng:   req.query.originLng   ? Number(req.query.originLng)   : undefined,
      destLat:     req.query.destLat     ? Number(req.query.destLat)     : undefined,
      destLng:     req.query.destLng     ? Number(req.query.destLng)     : undefined,
      vehicleId:   req.query.vehicleId   || undefined,
      vehicleType: req.query.vehicleType || undefined,
      weightKg:    req.query.weightKg    ? Number(req.query.weightKg)    : undefined,
      returnLeg:   req.query.returnLeg   === 'true' ? true : req.query.returnLeg === 'false' ? false : undefined,
    });

    if (valErr) {
      return res.status(400).json({ success: false, message: valErr.details[0].message });
    }

    const result = await deliveryService.simulateRoutes(req.user.uid, value);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.warn(`[${CTRL}] simulateRoute: ${err.message}`, { userId: req.user?.uid });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Gorjeta voluntária [DELIVERY-SOL-001]
// ──────────────────────────────────────────────────────

const addTipSchema = Joi.object({
  amount: Joi.number().greater(0).max(500).required()
    .messages({
      'number.greater': 'Valor da gorjeta deve ser maior que zero.',
      'number.max': 'Valor máximo de gorjeta é R$ 500,00.',
      'any.required': 'Campo amount é obrigatório.',
    }),
});

exports.addTip = async (req, res) => {
  try {
    const { error: valErr, value } = addTipSchema.validate(req.body);
    if (valErr) return res.status(400).json({ success: false, message: valErr.details[0].message });

    const result = await deliveryService.addTip(req.params.id, value.amount, req.user.uid);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.warn(`[${CTRL}] addTip: ${err.message}`, { userId: req.user?.uid });
    const status = err.message.includes('não encontrado') ? 404
                 : err.message.includes('Somente o comprador') ? 403
                 : err.message.includes('só pode') || err.message.includes('Valor') ? 400
                 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.resolveDeliveryRequest = async (req, res) => {
  try {
    const { action } = req.body;
    if (!action) return res.status(400).json({ success: false, message: "Campo 'action' é obrigatório (cancel | retry)" });
    const result = await deliveryService.resolveDeliveryRequest(req.user.uid, req.params.id, action);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.warn(`[${CTRL}] resolveDeliveryRequest: ${err.message}`, { userId: req.user?.uid });
    const status = err.message.includes('não encontrada') ? 404
                 : err.message.includes('Apenas o vendedor') ? 403
                 : err.message.includes('Ação inválida') || err.message.includes('não pode ser resolvida') ? 400
                 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};
