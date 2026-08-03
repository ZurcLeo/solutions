// MOD-CORE Sprint 1 — Rotas de módulos da plataforma
const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/auth');
const { isAdmin } = require('../middlewares/admin');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const {
  getModules,
  updatePreference,
  adminGetModules,
  adminUpdateModule
} = require('../controllers/modulesController');

// GET /api/modules — catálogo + preferências do usuário autenticado
router.get('/', verifyToken, readLimit, getModules);

// PATCH /api/modules/:moduleId/preference — toggle do usuário
router.patch('/:moduleId/preference', verifyToken, writeLimit, updatePreference);

// Admin — listagem completa e controle de status
router.get('/admin/all', verifyToken, isAdmin, readLimit, adminGetModules);
router.patch('/admin/:moduleId', verifyToken, isAdmin, writeLimit, adminUpdateModule);

module.exports = router;
