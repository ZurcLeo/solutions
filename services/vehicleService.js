/**
 * @fileoverview vehicleService — ElosCloud Veículo Centralizado
 *
 * CRUD de veículos do usuário. Fonte de verdade para dados de veículo
 * compartilhados entre Delivery e Carona.
 *
 * Validações:
 *   - Placa obrigatória para motorizados (moto, carro, van, caminhonete)
 *   - Formato placa: antigo (ABC1234) ou Mercosul (ABC1D23)
 *   - RENAVAM: 11 dígitos (opcional, aumenta trust)
 *
 * Integrações:
 *   gamificationService → vehicle_registered (XP + coins)
 *   trustPassportService → recordEvent (trust score)
 */

const { getSupabaseClient } = require('../config/supabase');
const { logger }            = require('../logger');
const gamificationService   = require('./gamificationService');
const trustPassportService  = require('./trustPassportService');

const SERVICE = 'vehicleService';

const VALID_TYPES  = ['bike', 'moto', 'carro', 'van', 'caminhonete'];

// Regex: placa antiga ABC1234 ou Mercosul ABC1D23
const PLATE_REGEX  = /^[A-Z]{3}\d[A-Z0-9]\d{2}$/;

// RENAVAM: exatamente 11 dígitos
const RENAVAM_REGEX = /^\d{11}$/;

// ── Helpers ─────────────────────────────────────────────────────────────────

function sb() {
  return getSupabaseClient();
}

function log(fn, msg, extra = {}) {
  logger.info(`[${SERVICE}.${fn}] ${msg}`, { service: SERVICE, ...extra });
}

function logWarn(fn, msg, extra = {}) {
  logger.warn(`[${SERVICE}.${fn}] ${msg}`, { service: SERVICE, ...extra });
}

function logError(fn, err, extra = {}) {
  logger.error(`[${SERVICE}.${fn}] ${err.message || err}`, { service: SERVICE, error: err.message, ...extra });
}

function generateId() {
  const crypto = require('crypto');
  return 'veh_' + crypto.randomUUID().replace(/-/g, '').substring(0, 12);
}

function normalizePlate(plate) {
  if (!plate) return null;
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function validatePlate(plate) {
  if (!plate) return false;
  return PLATE_REGEX.test(plate);
}

// ── CRUD ────────────────────────────────────────────────────────────────────

/**
 * Lista veículos ativos do usuário
 * @param {string} userId
 * @returns {Promise<Array>}
 */
async function listVehicles(userId) {
  const fn = 'listVehicles';

  const { data, error } = await sb()
    .from('user_vehicles')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    logError(fn, error, { userId });
    throw new Error(`Erro ao listar veículos: ${error.message}`);
  }

  return data || [];
}

/**
 * Retorna um veículo por ID (somente do próprio usuário)
 * @param {string} userId
 * @param {string} vehicleId
 * @returns {Promise<Object|null>}
 */
async function getVehicle(userId, vehicleId) {
  const fn = 'getVehicle';

  const { data, error } = await sb()
    .from('user_vehicles')
    .select('*')
    .eq('id', vehicleId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // not found
    logError(fn, error, { userId, vehicleId });
    throw new Error(`Erro ao buscar veículo: ${error.message}`);
  }

  return data;
}

/**
 * Cadastra um novo veículo
 * @param {string} userId
 * @param {Object} data
 * @returns {Promise<Object>}
 */
async function createVehicle(userId, data) {
  const fn = 'createVehicle';
  const {
    vehicle_type, plate, model, color, year,
    renavam, nickname, vehicle_doc_url, vehicle_photo_url,
  } = data;

  // Validações
  if (!vehicle_type) throw new Error('vehicle_type é obrigatório');
  if (!VALID_TYPES.includes(vehicle_type)) {
    throw new Error(`vehicle_type inválido. Opções: ${VALID_TYPES.join(', ')}`);
  }

  // Placa obrigatória para motorizados
  const normalizedPlate = normalizePlate(plate);
  if (vehicle_type !== 'bike') {
    if (!normalizedPlate) throw new Error('Placa é obrigatória para veículos motorizados.');
    if (!validatePlate(normalizedPlate)) {
      throw new Error('Formato de placa inválido. Use o formato antigo (ABC1234) ou Mercosul (ABC1D23).');
    }
  }

  // RENAVAM opcional: se informado, valida formato
  if (renavam && !RENAVAM_REGEX.test(renavam)) {
    throw new Error('RENAVAM deve conter exatamente 11 dígitos.');
  }

  // Verifica se é o primeiro veículo do usuário → será primário
  const existing = await listVehicles(userId);
  const isPrimary = existing.length === 0;

  const vehicleId = generateId();

  const { data: vehicle, error } = await sb()
    .from('user_vehicles')
    .insert({
      id:                 vehicleId,
      user_id:            userId,
      vehicle_type,
      plate:              normalizedPlate,
      model:              model?.trim() || null,
      color:              color?.trim() || null,
      year:               year ? Number(year) : null,
      renavam:            renavam || null,
      nickname:           nickname?.trim() || null,
      is_primary:         isPrimary,
      verification_status: 'unverified',
      vehicle_doc_url:    vehicle_doc_url || null,
      vehicle_photo_url:  vehicle_photo_url || null,
      is_active:          true,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') throw new Error('Já existe um veículo com essa placa.');
    logError(fn, error, { userId });
    throw new Error(`Erro ao cadastrar veículo: ${error.message}`);
  }

  log(fn, 'Veículo cadastrado', { userId, vehicleId, vehicleType: vehicle_type });

  // Gamificação: primeiro veículo registrado
  gamificationService.triggerEvent('vehicle_registered', userId, { vehicleId })
    .catch(err => logWarn(fn, `gamification falhou: ${err.message}`, { userId }));

  // Trust: evento positivo
  trustPassportService.recordEvent(userId, 'account', 'vehicle_registered', 2, false, { vehicleId, vehicleType: vehicle_type })
    .catch(err => logWarn(fn, `trust event falhou: ${err.message}`, { userId }));

  return vehicle;
}

/**
 * Atualiza dados de um veículo
 * @param {string} userId
 * @param {string} vehicleId
 * @param {Object} data
 * @returns {Promise<Object>}
 */
async function updateVehicle(userId, vehicleId, data) {
  const fn = 'updateVehicle';

  const ALLOWED = [
    'plate', 'model', 'color', 'year', 'renavam',
    'nickname', 'vehicle_doc_url', 'vehicle_photo_url',
    'price_per_km', 'base_fee', 'minimum_fee',
    'delivery_enabled', 'maintenance_status', 'maintenance_notes',
  ];

  const payload = {};
  for (const key of ALLOWED) {
    if (data[key] !== undefined) payload[key] = data[key];
  }

  if (Object.keys(payload).length === 0) {
    throw new Error('Nenhum campo válido para atualizar.');
  }

  // Normaliza placa se fornecida
  if (payload.plate !== undefined) {
    payload.plate = normalizePlate(payload.plate);
    if (payload.plate && !validatePlate(payload.plate)) {
      throw new Error('Formato de placa inválido. Use o formato antigo (ABC1234) ou Mercosul (ABC1D23).');
    }
  }

  // RENAVAM se fornecido
  if (payload.renavam !== undefined && payload.renavam && !RENAVAM_REGEX.test(payload.renavam)) {
    throw new Error('RENAVAM deve conter exatamente 11 dígitos.');
  }

  // Trim strings
  if (payload.model) payload.model = payload.model.trim();
  if (payload.color) payload.color = payload.color.trim();
  if (payload.nickname) payload.nickname = payload.nickname.trim();
  if (payload.year) payload.year = Number(payload.year);

  const { data: vehicle, error } = await sb()
    .from('user_vehicles')
    .update(payload)
    .eq('id', vehicleId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') throw new Error('Já existe um veículo com essa placa.');
    logError(fn, error, { userId, vehicleId });
    throw new Error(`Erro ao atualizar veículo: ${error.message}`);
  }
  if (!vehicle) throw new Error('Veículo não encontrado.');

  log(fn, 'Veículo atualizado', { userId, vehicleId });
  return vehicle;
}

/**
 * Soft-delete de um veículo
 * @param {string} userId
 * @param {string} vehicleId
 * @returns {Promise<void>}
 */
async function deleteVehicle(userId, vehicleId) {
  const fn = 'deleteVehicle';

  const { data: vehicle, error } = await sb()
    .from('user_vehicles')
    .update({ is_active: false, is_primary: false })
    .eq('id', vehicleId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .select()
    .single();

  if (error) {
    logError(fn, error, { userId, vehicleId });
    throw new Error(`Erro ao remover veículo: ${error.message}`);
  }
  if (!vehicle) throw new Error('Veículo não encontrado.');

  log(fn, 'Veículo removido (soft-delete)', { userId, vehicleId });
}

/**
 * Define um veículo como primário
 * @param {string} userId
 * @param {string} vehicleId
 * @returns {Promise<Object>}
 */
async function setPrimary(userId, vehicleId) {
  const fn = 'setPrimary';

  // O trigger trg_ensure_single_primary_vehicle cuida de desmarcar os outros
  const { data: vehicle, error } = await sb()
    .from('user_vehicles')
    .update({ is_primary: true })
    .eq('id', vehicleId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .select()
    .single();

  if (error) {
    logError(fn, error, { userId, vehicleId });
    throw new Error(`Erro ao definir veículo primário: ${error.message}`);
  }
  if (!vehicle) throw new Error('Veículo não encontrado.');

  log(fn, 'Veículo definido como primário', { userId, vehicleId });
  return vehicle;
}

/**
 * Admin: verifica ou rejeita um veículo
 * @param {string} adminId
 * @param {string} vehicleId
 * @param {boolean} approved
 * @param {string} [rejectionReason]
 * @returns {Promise<Object>}
 */
async function verifyVehicle(adminId, vehicleId, approved, rejectionReason) {
  const fn = 'verifyVehicle';

  const newStatus = approved ? 'verified' : 'rejected';

  const { data: vehicle, error } = await sb()
    .from('user_vehicles')
    .update({ verification_status: newStatus })
    .eq('id', vehicleId)
    .eq('is_active', true)
    .select()
    .single();

  if (error) {
    logError(fn, error, { adminId, vehicleId });
    throw new Error(`Erro ao verificar veículo: ${error.message}`);
  }
  if (!vehicle) throw new Error('Veículo não encontrado.');

  log(fn, `Veículo ${newStatus}`, { adminId, vehicleId, ownerId: vehicle.user_id, rejectionReason });

  // Se aprovado → gamification + trust
  if (approved) {
    gamificationService.triggerEvent('vehicle_verified', vehicle.user_id, { vehicleId })
      .catch(err => logWarn(fn, `gamification falhou: ${err.message}`));

    trustPassportService.recordEvent(vehicle.user_id, 'account', 'vehicle_verified', 3, false, { vehicleId })
      .catch(err => logWarn(fn, `trust event falhou: ${err.message}`));
  }

  return vehicle;
}

/**
 * Atualiza configuração de delivery de um veículo (tarifas, habilitação, manutenção)
 */
async function updateDeliveryConfig(userId, vehicleId, config) {
  const fn = 'updateDeliveryConfig';

  // Verifica ownership
  const vehicle = await getVehicle(userId, vehicleId);
  if (!vehicle) throw new Error('Veículo não encontrado.');

  const payload = {};
  const DELIVERY_FIELDS = ['price_per_km', 'base_fee', 'minimum_fee', 'delivery_enabled', 'maintenance_status', 'maintenance_notes'];
  for (const key of DELIVERY_FIELDS) {
    if (config[key] !== undefined) payload[key] = config[key];
  }

  if (Object.keys(payload).length === 0) {
    throw new Error('Nenhum campo válido para atualizar.');
  }

  // Manutenção: setar/limpar timestamps
  if (payload.maintenance_status === 'maintenance' && vehicle.maintenance_status !== 'maintenance') {
    payload.maintenance_reported_at = new Date().toISOString();
  } else if (payload.maintenance_status === 'operational' && vehicle.maintenance_status !== 'operational') {
    payload.maintenance_reported_at = null;
    payload.maintenance_notes = null;
  }

  const { data: updated, error } = await sb()
    .from('user_vehicles')
    .update(payload)
    .eq('id', vehicleId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .select()
    .single();

  if (error) {
    logError(fn, error, { userId, vehicleId });
    throw new Error(`Erro ao atualizar config de delivery: ${error.message}`);
  }

  log(fn, 'Delivery config atualizada', { userId, vehicleId, fields: Object.keys(payload) });

  // Gamification: report de manutenção
  if (payload.maintenance_status === 'maintenance' && vehicle.maintenance_status !== 'maintenance') {
    gamificationService.triggerEvent('vehicle_maintenance_reported', userId, { vehicleId })
      .catch(err => logWarn(fn, `gamification falhou: ${err.message}`, { userId }));
  }

  return updated;
}

/**
 * Lista veículos elegíveis para delivery (ativos + habilitados + operacionais)
 */
async function getDeliveryEligibleVehicles(userId) {
  const fn = 'getDeliveryEligibleVehicles';

  const { data, error } = await sb()
    .from('user_vehicles')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('delivery_enabled', true)
    .eq('maintenance_status', 'operational')
    .order('is_primary', { ascending: false });

  if (error) {
    logError(fn, error, { userId });
    throw new Error(`Erro ao listar veículos elegíveis: ${error.message}`);
  }

  return data || [];
}

/**
 * Resolve tarifas de um veículo com cascata: veículo → loja (delivery_services) → default
 */
async function resolveVehicleTariffs(userId, vehicleId) {
  const fn = 'resolveVehicleTariffs';

  const DEFAULTS = { price_per_km: 2.50, base_fee: 5.00, minimum_fee: 8.00 };

  // 1. Busca tarifas do veículo
  const vehicle = await getVehicle(userId, vehicleId);
  if (!vehicle) throw new Error('Veículo não encontrado.');

  if (vehicle.price_per_km != null && vehicle.base_fee != null && vehicle.minimum_fee != null) {
    return {
      price_per_km: Number(vehicle.price_per_km),
      base_fee:     Number(vehicle.base_fee),
      minimum_fee:  Number(vehicle.minimum_fee),
      source:       'vehicle',
    };
  }

  // 2. Fallback: busca tarifas da loja (delivery_services)
  const { data: svc } = await sb()
    .from('delivery_services')
    .select('price_per_km, base_fee, minimum_fee')
    .eq('user_id', userId)
    .maybeSingle();

  if (svc) {
    return {
      price_per_km: vehicle.price_per_km != null ? Number(vehicle.price_per_km) : Number(svc.price_per_km),
      base_fee:     vehicle.base_fee     != null ? Number(vehicle.base_fee)     : Number(svc.base_fee),
      minimum_fee:  vehicle.minimum_fee  != null ? Number(vehicle.minimum_fee)  : Number(svc.minimum_fee),
      source:       'service',
    };
  }

  // 3. Fallback: defaults
  return {
    price_per_km: vehicle.price_per_km != null ? Number(vehicle.price_per_km) : DEFAULTS.price_per_km,
    base_fee:     vehicle.base_fee     != null ? Number(vehicle.base_fee)     : DEFAULTS.base_fee,
    minimum_fee:  vehicle.minimum_fee  != null ? Number(vehicle.minimum_fee)  : DEFAULTS.minimum_fee,
    source:       'default',
  };
}

module.exports = {
  listVehicles,
  getVehicle,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  setPrimary,
  verifyVehicle,
  updateDeliveryConfig,
  getDeliveryEligibleVehicles,
  resolveVehicleTariffs,
};
