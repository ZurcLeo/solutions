'use strict';

const express    = require('express');
const router     = express.Router();
const verifyToken = require('../middlewares/auth');
const ctrl       = require('../controllers/contractController');

// ─── Rotas públicas (webhook) — ANTES do verifyToken ──────────────────────────
// O webhook do Clicksign não carrega JWT. Autenticado por HMAC-SHA256.
router.post('/webhook/clicksign', ctrl.clicksignWebhook);

// ─── Rotas autenticadas ────────────────────────────────────────────────────────
router.use(verifyToken);

// Listar contratos do usuário autenticado
router.get('/', ctrl.listContracts);

// Gerar novo contrato (retorna 202 — processamento em background)
router.post('/generate', ctrl.generateContract);

// Status e metadados de um contrato específico
router.get('/:id', ctrl.getContract);

// Signed URL para download do PDF (TTL 1h)
router.get('/:id/download-url', ctrl.getDownloadUrl);

// Link Clicksign para o usuário autenticado assinar
router.get('/:id/signing-link', ctrl.getSigningLink);

// Cancelar contrato
router.post('/:id/cancel', ctrl.cancelContract);

module.exports = router;
