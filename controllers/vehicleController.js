/**
 * @fileoverview vehicleController — ElosCloud Veículo Centralizado
 *
 * GET    /api/vehicles          — listar veículos do usuário
 * GET    /api/vehicles/:id      — detalhe de um veículo
 * POST   /api/vehicles          — cadastrar veículo
 * PATCH  /api/vehicles/:id      — atualizar veículo
 * DELETE /api/vehicles/:id      — remover veículo (soft-delete)
 * PATCH  /api/vehicles/:id/primary — definir como primário
 * PATCH  /api/vehicles/:id/verify  — admin: verificar veículo
 */

const Joi = require('joi');
const { logger } = require('../logger');
const vehicleService = require('../services/vehicleService');

const CTRL = 'vehicleController';

function uid(req) {
  return req.user?.uid || req.user?.id;
}

// ── Schemas ─────────────────────────────────────────────────────────────────

const createSchema = Joi.object({
  vehicle_type:      Joi.string().valid('bike', 'moto', 'carro', 'van', 'caminhonete').required(),
  plate:             Joi.string().max(8).allow(null, '').optional(),
  model:             Joi.string().max(100).allow(null, '').optional(),
  color:             Joi.string().max(50).allow(null, '').optional(),
  year:              Joi.number().integer().min(1950).max(2035).allow(null).optional(),
  renavam:           Joi.string().length(11).pattern(/^\d+$/).allow(null, '').optional(),
  nickname:          Joi.string().max(60).allow(null, '').optional(),
  vehicle_doc_url:   Joi.string().uri().allow(null, '').optional(),
  vehicle_photo_url: Joi.string().uri().allow(null, '').optional(),
});

const updateSchema = Joi.object({
  plate:             Joi.string().max(8).allow(null, '').optional(),
  model:             Joi.string().max(100).allow(null, '').optional(),
  color:             Joi.string().max(50).allow(null, '').optional(),
  year:              Joi.number().integer().min(1950).max(2035).allow(null).optional(),
  renavam:           Joi.string().length(11).pattern(/^\d+$/).allow(null, '').optional(),
  nickname:          Joi.string().max(60).allow(null, '').optional(),
  vehicle_doc_url:   Joi.string().uri().allow(null, '').optional(),
  vehicle_photo_url: Joi.string().uri().allow(null, '').optional(),
}).min(1);

const verifySchema = Joi.object({
  approved:         Joi.boolean().required(),
  rejection_reason: Joi.string().max(500).allow(null, '').optional(),
});

// ── GET /api/vehicles ───────────────────────────────────────────────────────

exports.list = async (req, res) => {
  try {
    const data = await vehicleService.listVehicles(uid(req));
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('list vehicles failed', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/vehicles/:id ───────────────────────────────────────────────────

exports.getById = async (req, res) => {
  try {
    const data = await vehicleService.getVehicle(uid(req), req.params.id);
    if (!data) return res.status(404).json({ success: false, message: 'Veículo não encontrado.' });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('get vehicle failed', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/vehicles ──────────────────────────────────────────────────────

exports.create = async (req, res) => {
  const { error, value } = createSchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });

  try {
    const data = await vehicleService.createVehicle(uid(req), value);
    return res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error('create vehicle failed', { service: CTRL, error: err.message, userId: uid(req) });
    if (err.message.includes('Já existe')) return res.status(409).json({ success: false, message: err.message });
    if (err.message.includes('obrigatóri') || err.message.includes('inválido') || err.message.includes('formato')) {
      return res.status(400).json({ success: false, message: err.message });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/vehicles/:id ─────────────────────────────────────────────────

exports.update = async (req, res) => {
  const { error, value } = updateSchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });

  try {
    const data = await vehicleService.updateVehicle(uid(req), req.params.id, value);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('update vehicle failed', { service: CTRL, error: err.message, userId: uid(req) });
    if (err.message.includes('não encontrado')) return res.status(404).json({ success: false, message: err.message });
    if (err.message.includes('Já existe')) return res.status(409).json({ success: false, message: err.message });
    if (err.message.includes('inválido') || err.message.includes('formato') || err.message.includes('Nenhum campo')) {
      return res.status(400).json({ success: false, message: err.message });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /api/vehicles/:id ────────────────────────────────────────────────

exports.remove = async (req, res) => {
  try {
    await vehicleService.deleteVehicle(uid(req), req.params.id);
    return res.status(200).json({ success: true, message: 'Veículo removido.' });
  } catch (err) {
    logger.error('delete vehicle failed', { service: CTRL, error: err.message, userId: uid(req) });
    if (err.message.includes('não encontrado')) return res.status(404).json({ success: false, message: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/vehicles/:id/primary ─────────────────────────────────────────

exports.setPrimary = async (req, res) => {
  try {
    const data = await vehicleService.setPrimary(uid(req), req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('set primary vehicle failed', { service: CTRL, error: err.message, userId: uid(req) });
    if (err.message.includes('não encontrado')) return res.status(404).json({ success: false, message: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/vehicles/:id/delivery-config ──────────────────────────────────

const deliveryConfigSchema = Joi.object({
  price_per_km:       Joi.number().min(0.50).allow(null).optional(),
  base_fee:           Joi.number().min(0).allow(null).optional(),
  minimum_fee:        Joi.number().min(0).allow(null).optional(),
  delivery_enabled:   Joi.boolean().optional(),
  maintenance_status: Joi.string().valid('operational', 'maintenance', 'retired').optional(),
  maintenance_notes:  Joi.string().max(500).allow('', null).optional(),
}).min(1);

exports.updateDeliveryConfig = async (req, res) => {
  const { error, value } = deliveryConfigSchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });

  try {
    const data = await vehicleService.updateDeliveryConfig(uid(req), req.params.id, value);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('update delivery config failed', { service: CTRL, error: err.message, userId: uid(req) });
    if (err.message.includes('não encontrado')) return res.status(404).json({ success: false, message: err.message });
    if (err.message.includes('Nenhum campo')) return res.status(400).json({ success: false, message: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/vehicles/:id/verify — admin only ─────────────────────────────

exports.verify = async (req, res) => {
  const { error, value } = verifySchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });

  try {
    const data = await vehicleService.verifyVehicle(uid(req), req.params.id, value.approved, value.rejection_reason);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('verify vehicle failed', { service: CTRL, error: err.message, adminId: uid(req) });
    if (err.message.includes('não encontrado')) return res.status(404).json({ success: false, message: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};
