'use strict';

/**
 * Rotas de Vision Extraction — ElosCloud Vision API
 *
 * Base: /api/vision
 *
 *   POST   /api/vision/extract    — extrair dados de imagem (upload ou URL)
 *   GET    /api/vision/templates  — listar templates disponíveis
 */

const router = require('express').Router();
const verifyToken = require('../middlewares/auth');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { upload } = require('../middlewares/upload.cjs');
const ctrl = require('../controllers/visionController');

// ── Endpoints ────────────────────────────────────────────────────────────────

// Extract: accepts multipart/form-data (image file) or JSON body (imageUrl)
router.post('/extract', verifyToken, writeLimit, upload.single('image'), ctrl.extract);

// List available templates
router.get('/templates', verifyToken, readLimit, ctrl.getTemplates);

module.exports = router;
