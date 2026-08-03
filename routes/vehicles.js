'use strict';

/**
 * Rotas de Veículos — ElosCloud Veículo Centralizado
 *
 * Base: /api/vehicles
 *
 * CRUD:
 *   GET    /api/vehicles              — listar veículos do usuário
 *   GET    /api/vehicles/:id          — detalhe de um veículo
 *   POST   /api/vehicles              — cadastrar veículo
 *   PATCH  /api/vehicles/:id          — atualizar veículo
 *   DELETE /api/vehicles/:id          — remover veículo (soft-delete)
 *
 * Ações:
 *   PATCH  /api/vehicles/:id/primary  — definir como primário
 *   PATCH  /api/vehicles/:id/verify   — admin: verificar veículo
 */

const router = require('express').Router();
const verifyToken = require('../middlewares/auth');
const { isAdmin } = require('../middlewares/admin');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const ctrl = require('../controllers/vehicleController');

// ── CRUD ────────────────────────────────────────────────────────────────────
router.get('/',          verifyToken, readLimit,  ctrl.list);
router.get('/:id',       verifyToken, readLimit,  ctrl.getById);
router.post('/',         verifyToken, writeLimit, ctrl.create);
router.patch('/:id',     verifyToken, writeLimit, ctrl.update);
router.delete('/:id',    verifyToken, writeLimit, ctrl.remove);

// ── Ações ───────────────────────────────────────────────────────────────────
router.patch('/:id/primary',         verifyToken, writeLimit, ctrl.setPrimary);
router.patch('/:id/delivery-config', verifyToken, writeLimit, ctrl.updateDeliveryConfig);
router.patch('/:id/verify',          verifyToken, isAdmin, writeLimit, ctrl.verify);

module.exports = router;
