'use strict';

/**
 * Rotas do Cofre de Documentos — ElosCloud Document Vault
 *
 * Base: /api/vault
 *
 * Vaults:
 *   POST   /vaults                          — criar vault (geralmente lazy)
 *   GET    /vaults/quota                    — quota do usuário
 *   POST   /vaults/:vaultId/upload-url      — gerar URL de upload
 *   POST   /vaults/:vaultId/confirm-upload  — confirmar após upload direto
 *   GET    /vaults/:vaultId/documents       — listar documentos
 *   GET    /vaults/:vaultId/access-log      — audit trail
 *   GET    /vaults/:vaultId/export          — export LGPD (ZIP)
 *
 * Documents:
 *   GET    /documents/:documentId           — ver documento + signed URL
 *   DELETE /documents/:documentId           — soft delete
 *   PATCH  /documents/:documentId/consent   — toggle share/AI consent
 *   GET    /documents/:documentId/history   — histórico de acessos
 *   POST   /documents/:documentId/analyze   — solicitar análise IA
 *   GET    /documents/:documentId/analysis  — ver resultado IA
 *
 * Bookings:
 *   GET    /bookings/:bookingId/vault       — vault do booking
 */

const router = require('express').Router();
const verifyToken = require('../middlewares/auth');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const ctrl = require('../controllers/documentVaultController');

// Todas as rotas requerem autenticação
router.use(verifyToken);

// ── Vaults ───────────────────────────────────────────────────────────────────
router.post('/vaults',                           writeLimit, ctrl.createVault);
router.get('/vaults/quota',                      readLimit,  ctrl.getQuota);
router.post('/vaults/:vaultId/upload-url',       writeLimit, ctrl.generateUploadUrl);
router.post('/vaults/:vaultId/confirm-upload',   writeLimit, ctrl.confirmUpload);
router.get('/vaults/:vaultId/documents',         readLimit,  ctrl.listDocuments);
router.get('/vaults/:vaultId/access-log',        readLimit,  ctrl.getAccessLog);
router.get('/vaults/:vaultId/export',            readLimit,  ctrl.exportVault);

// ── Documents ────────────────────────────────────────────────────────────────
router.get('/documents/:documentId',             readLimit,  ctrl.getDocument);
router.delete('/documents/:documentId',          writeLimit, ctrl.deleteDocument);
router.patch('/documents/:documentId/consent',   writeLimit, ctrl.updateConsent);
router.get('/documents/:documentId/history',     readLimit,  ctrl.getDocumentHistory);
router.post('/documents/:documentId/analyze',    writeLimit, ctrl.requestAnalysis);
router.get('/documents/:documentId/analysis',    readLimit,  ctrl.getAnalysis);

// ── Bookings ─────────────────────────────────────────────────────────────────
router.get('/bookings/:bookingId/vault',         readLimit,  ctrl.getVaultForBooking);

module.exports = router;
