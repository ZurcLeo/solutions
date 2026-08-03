// backend/eloscloudapp/controllers/userPreferencesController.js
// PREFS-001

const userPreferencesService = require('../services/userPreferencesService');
const { logger } = require('../logger');

const CTRL = 'userPreferencesController';

/**
 * GET /api/preferences
 * Retorna todas as preferências do usuário autenticado.
 */
const getPreferences = async (req, res) => {
  try {
    const userId = req.user.uid;
    const prefs = await userPreferencesService.get(userId);
    logger.info('Enviando preferências para o frontend', { userId, hasResAddress: !!prefs.addr_res_logradouro });
    res.json({ success: true, data: prefs });
  } catch (error) {
    logger.error('Erro em getPreferences', { service: CTRL, error: error.message });
    res.status(500).json({ success: false, error: 'Erro ao buscar preferências' });
  }
};

/**
 * PATCH /api/preferences/:category
 * Atualiza uma categoria de preferências (cookie_prefs | privacy_prefs | notification_prefs).
 * Body: objeto parcial com os campos a atualizar.
 */
const updatePreferences = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { category } = req.params;
    const data = req.body;

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return res.status(400).json({ success: false, error: 'Body deve ser um objeto' });
    }

    // PREFS-005: Capturar IP para audit log
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;
    const updated = await userPreferencesService.update(userId, category, data, ipAddress);
    res.json({ success: true, data: updated });
  } catch (error) {
    const status = error.statusCode || 500;
    logger.error('Erro em updatePreferences', { service: CTRL, error: error.message });
    res.status(status).json({ success: false, error: error.message });
  }
};

/**
 * PATCH /api/preferences/location
 * Atualiza a localização do usuário (location_mode + home_bairro/cidade/estado).
 */
const updateLocation = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { location_mode, home_bairro, home_cidade, home_estado } = req.body;

    if (!location_mode) {
      return res.status(400).json({ success: false, error: 'location_mode é obrigatório' });
    }

    const updated = await userPreferencesService.updateLocation(userId, {
      location_mode,
      home_bairro,
      home_cidade,
      home_estado,
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    const status = error.statusCode || 500;
    logger.error('Erro em updateLocation', { service: CTRL, error: error.message });
    res.status(status).json({ success: false, error: error.message });
  }
};

/**
 * PATCH /api/preferences/address
 * Salva endereço residencial ou comercial do usuário.
 * Body: { type: 'residential'|'commercial', cep, logradouro, numero, complemento, bairro, cidade, estado }
 */
const updateAddress = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { type, cep, logradouro, numero, complemento, bairro, cidade, estado } = req.body;

    if (!type) {
      return res.status(400).json({ success: false, error: 'type é obrigatório ("residential" ou "commercial")' });
    }

    const updated = await userPreferencesService.updateAddress(userId, type, {
      cep, logradouro, numero, complemento, bairro, cidade, estado,
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    const status = error.statusCode || 500;
    logger.error('Erro em updateAddress', { service: CTRL, error: error.message });
    res.status(status).json({ success: false, error: error.message });
  }
};

/**
 * PATCH /api/preferences/registro-profissional
 * Salva registro profissional do usuário (fonte de verdade central).
 * Body: { tipo?: string, numero?: string, uf?: string }
 */
const updateRegistroProfissional = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { tipo, numero, uf } = req.body;

    const updated = await userPreferencesService.updateRegistroProfissional(userId, { tipo, numero, uf });
    res.json({ success: true, data: updated });
  } catch (error) {
    const status = error.statusCode || 500;
    logger.error('Erro em updateRegistroProfissional', { service: CTRL, error: error.message });
    res.status(status).json({ success: false, error: error.message });
  }
};

/**
 * PATCH /api/preferences/vehicle
 * Salva tipo e placa do veículo do usuário.
 * Body: { vehicle_type?: 'bike'|'moto'|'car'|'van', vehicle_plate?: string }
 */
const updateVehicle = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { vehicle_type, vehicle_plate } = req.body;

    const updated = await userPreferencesService.updateVehicle(userId, { vehicle_type, vehicle_plate });
    res.json({ success: true, data: updated });
  } catch (error) {
    const status = error.statusCode || 500;
    logger.error('Erro em updateVehicle', { service: CTRL, error: error.message });
    res.status(status).json({ success: false, error: error.message });
  }
};

module.exports = { getPreferences, updatePreferences, updateLocation, updateAddress, updateRegistroProfissional, updateVehicle };
