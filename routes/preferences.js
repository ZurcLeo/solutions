// backend/eloscloudapp/routes/preferences.js
// PREFS-001 — Rotas de preferências do usuário

const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/auth');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { getPreferences, updatePreferences, updateLocation, updateAddress, updateRegistroProfissional, updateVehicle } = require('../controllers/userPreferencesController');

// GET /api/preferences — retorna preferências do usuário autenticado
router.get('/', verifyToken, readLimit, getPreferences);

// PATCH /api/preferences/location — atualiza localização (deve vir ANTES de /:category)
router.patch('/location', verifyToken, writeLimit, updateLocation);

// PATCH /api/preferences/address — salva endereço residencial ou comercial (deve vir ANTES de /:category)
router.patch('/address', verifyToken, writeLimit, updateAddress);

// PATCH /api/preferences/registro-profissional — salva registro profissional (deve vir ANTES de /:category)
router.patch('/registro-profissional', verifyToken, writeLimit, updateRegistroProfissional);

// PATCH /api/preferences/vehicle — salva tipo e placa do veículo (deve vir ANTES de /:category)
router.patch('/vehicle', verifyToken, writeLimit, updateVehicle);

// PATCH /api/preferences/:category — atualiza uma categoria
router.patch('/:category', verifyToken, writeLimit, updatePreferences);

module.exports = router;
