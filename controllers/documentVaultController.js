/**
 * @fileoverview documentVaultController — Cofre de Documentos por Relacionamento
 *
 * POST   /api/vault/vaults                          — criar vault
 * POST   /api/vault/vaults/:vaultId/upload-url      — gerar URL de upload
 * POST   /api/vault/vaults/:vaultId/confirm-upload  — confirmar após upload direto
 * GET    /api/vault/vaults/:vaultId/documents       — listar documentos
 * GET    /api/vault/documents/:documentId           — ver documento + signed URL
 * DELETE /api/vault/documents/:documentId           — soft delete
 * PATCH  /api/vault/documents/:documentId/consent   — toggle share/AI consent
 * GET    /api/vault/bookings/:bookingId/vault       — vault do booking
 * GET    /api/vault/vaults/quota                    — quota do usuário
 * GET    /api/vault/vaults/:vaultId/access-log      — audit trail
 * GET    /api/vault/documents/:documentId/history   — histórico do documento
 * POST   /api/vault/documents/:documentId/analyze   — solicitar análise IA
 * GET    /api/vault/documents/:documentId/analysis  — ver resultado IA
 */

'use strict';

const Joi = require('joi');
const { logger } = require('../logger');
const documentVaultService    = require('../services/documentVaultService');
const documentAccessLogService = require('../services/documentAccessLogService');

const CTRL = 'documentVaultController';

function uid(req) {
  return req.user?.uid || req.user?.id;
}

// ── Joi Schemas ──────────────────────────────────────────────────────────────

const createVaultSchema = Joi.object({
  bookingId:        Joi.string().allow(null).optional(),
  clientUid:        Joi.string().required(),
  providerUid:      Joi.string().required(),
  relationshipType: Joi.string().valid('booking', 'continuous').default('booking'),
});

const uploadUrlSchema = Joi.object({
  fileName: Joi.string().max(255).required(),
  mimeType: Joi.string().required(),
  fileSize: Joi.number().integer().min(1).max(52428800).required(), // max 50MB
});

const confirmUploadSchema = Joi.object({
  storagePath:  Joi.string().required(),
  fileName:     Joi.string().max(255).required(),
  mimeType:     Joi.string().required(),
  fileSize:     Joi.number().integer().min(1).required(),
  sha256Hash:   Joi.string().hex().length(64).allow(null).optional(),
  documentType: Joi.string().valid(
    'contrato', 'laudo', 'receita', 'exame', 'declaracao',
    'nota_fiscal', 'procuracao', 'alvara', 'certidao', 'outro'
  ).default('outro'),
});

const consentSchema = Joi.object({
  shareConsent: Joi.boolean().optional(),
  aiConsent:    Joi.boolean().optional(),
}).or('shareConsent', 'aiConsent');

// ── POST /api/vault/vaults ───────────────────────────────────────────────────

exports.createVault = async (req, res) => {
  try {
    const { error, value } = createVaultSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const vault = await documentVaultService.getOrCreateVault(
      value.bookingId, value.clientUid, value.providerUid, value.relationshipType
    );
    return res.status(201).json({ success: true, data: vault });
  } catch (err) {
    logger.warn(`[${CTRL}] createVault: ${err.message}`, { userId: uid(req) });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/vault/vaults/:vaultId/upload-url ───────────────────────────────

exports.generateUploadUrl = async (req, res) => {
  try {
    const { error, value } = uploadUrlSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await documentVaultService.generateUploadUrl(
      req.params.vaultId, uid(req), value.fileName, value.mimeType, value.fileSize
    );
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.warn(`[${CTRL}] generateUploadUrl: ${err.message}`, { userId: uid(req) });
    const status = err.message.includes('limite') || err.message.includes('excede') ? 413 : 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

// ── POST /api/vault/vaults/:vaultId/confirm-upload ───────────────────────────

exports.confirmUpload = async (req, res) => {
  try {
    const { error, value } = confirmUploadSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const doc = await documentVaultService.confirmUpload(
      req.params.vaultId, uid(req), value, req
    );
    return res.status(201).json({ success: true, data: doc });
  } catch (err) {
    logger.warn(`[${CTRL}] confirmUpload: ${err.message}`, { userId: uid(req) });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/vault/vaults/:vaultId/documents ─────────────────────────────────

exports.listDocuments = async (req, res) => {
  try {
    const docs = await documentVaultService.listDocuments(req.params.vaultId, uid(req));
    return res.status(200).json({ success: true, data: docs });
  } catch (err) {
    logger.warn(`[${CTRL}] listDocuments: ${err.message}`, { userId: uid(req) });
    const status = err.message.includes('permissão') ? 403 : 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

// ── GET /api/vault/documents/:documentId ─────────────────────────────────────

exports.getDocument = async (req, res) => {
  try {
    const doc = await documentVaultService.getDocument(req.params.documentId, uid(req), req);
    return res.status(200).json({ success: true, data: doc });
  } catch (err) {
    logger.warn(`[${CTRL}] getDocument: ${err.message}`, { userId: uid(req) });
    const status = err.message.includes('não encontrado') ? 404
      : err.message.includes('permissão') ? 403 : 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

// ── DELETE /api/vault/documents/:documentId ──────────────────────────────────

exports.deleteDocument = async (req, res) => {
  try {
    await documentVaultService.softDeleteDocument(req.params.documentId, uid(req), req);
    return res.status(200).json({ success: true, message: 'Documento removido' });
  } catch (err) {
    logger.warn(`[${CTRL}] deleteDocument: ${err.message}`, { userId: uid(req) });
    const status = err.message.includes('não encontrado') ? 404
      : err.message.includes('Apenas quem') ? 403 : 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/vault/documents/:documentId/consent ───────────────────────────

exports.updateConsent = async (req, res) => {
  try {
    const { error, value } = consentSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const doc = await documentVaultService.updateConsent(
      req.params.documentId, uid(req), value, req
    );
    return res.status(200).json({ success: true, data: doc });
  } catch (err) {
    logger.warn(`[${CTRL}] updateConsent: ${err.message}`, { userId: uid(req) });
    const status = err.message.includes('Apenas quem') ? 403 : 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

// ── GET /api/vault/bookings/:bookingId/vault ─────────────────────────────────

exports.getVaultForBooking = async (req, res) => {
  try {
    const vault = await documentVaultService.getVaultForBooking(
      req.params.bookingId, uid(req)
    );
    if (!vault) return res.status(404).json({ success: false, message: 'Vault não encontrado para este booking' });
    return res.status(200).json({ success: true, data: vault });
  } catch (err) {
    logger.warn(`[${CTRL}] getVaultForBooking: ${err.message}`, { userId: uid(req) });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/vault/vaults/quota ──────────────────────────────────────────────

exports.getQuota = async (req, res) => {
  try {
    const quota = await documentVaultService.getStorageQuota(uid(req));
    return res.status(200).json({ success: true, data: quota });
  } catch (err) {
    logger.warn(`[${CTRL}] getQuota: ${err.message}`, { userId: uid(req) });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/vault/vaults/:vaultId/access-log ────────────────────────────────

exports.getAccessLog = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const result = await documentAccessLogService.getAccessLog(
      req.params.vaultId, uid(req), { limit, offset }
    );
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.warn(`[${CTRL}] getAccessLog: ${err.message}`, { userId: uid(req) });
    const status = err.message.includes('permissão') ? 403 : 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

// ── GET /api/vault/documents/:documentId/history ─────────────────────────────

exports.getDocumentHistory = async (req, res) => {
  try {
    const entries = await documentAccessLogService.getDocumentHistory(
      req.params.documentId, uid(req)
    );
    return res.status(200).json({ success: true, data: entries });
  } catch (err) {
    logger.warn(`[${CTRL}] getDocumentHistory: ${err.message}`, { userId: uid(req) });
    const status = err.message.includes('permissão') ? 403 : 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

// ── POST /api/vault/documents/:documentId/analyze ────────────────────────────

exports.requestAnalysis = async (req, res) => {
  try {
    const documentAiService = require('../services/documentAiService');
    const result = await documentAiService.analyzeDocument(
      req.params.documentId, uid(req), req
    );
    return res.status(202).json({ success: true, data: result });
  } catch (err) {
    logger.warn(`[${CTRL}] requestAnalysis: ${err.message}`, { userId: uid(req) });
    const status = err.message.includes('consentimento') ? 403
      : err.message.includes('não encontrado') ? 404 : 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

// ── GET /api/vault/documents/:documentId/analysis ────────────────────────────

exports.getAnalysis = async (req, res) => {
  try {
    const documentAiService = require('../services/documentAiService');
    const analysis = await documentAiService.getAnalysis(
      req.params.documentId, uid(req)
    );
    if (!analysis) return res.status(404).json({ success: false, message: 'Análise não encontrada' });
    return res.status(200).json({ success: true, data: analysis });
  } catch (err) {
    logger.warn(`[${CTRL}] getAnalysis: ${err.message}`, { userId: uid(req) });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/vault/vaults/:vaultId/export ────────────────────────────────────

exports.exportVault = async (req, res) => {
  try {
    const vaultExportService = require('../services/vaultExportService');
    const result = await vaultExportService.exportVault(req.params.vaultId, uid(req));
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.warn(`[${CTRL}] exportVault: ${err.message}`, { userId: uid(req) });
    const status = err.message.includes('permissão') ? 403 : 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};
