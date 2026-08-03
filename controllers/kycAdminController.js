/**
 * @fileoverview Controller para aprovação manual de KYC pelo suporte/admin.
 * @module controllers/kycAdminController
 */

const kycAdminService = require('../services/kycAdminService');
const { logger }      = require('../logger');

/**
 * GET /api/admin/kyc/pending
 * Lista verificações KYC com status manual_review, paginadas.
 * Query: ?page=1&limit=20&level=cpf|document
 */
exports.getPending = async (req, res) => {
  const adminId = req.uid;
  try {
    const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const level = ['cpf', 'document'].includes(req.query.level) ? req.query.level : null;

    const result = await kycAdminService.getPendingVerifications({ page, limit, level });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    logger.error('kycAdminController.getPending: erro', { adminId, error: err.message });
    return res.status(500).json({ success: false, error: 'Erro ao listar verificações pendentes.' });
  }
};

/**
 * GET /api/admin/kyc/:verificationId/media
 * Retorna signed URLs (1h TTL) para vídeo de liveness e fotos de documento.
 * Exclusivo para verificações de nível 'document'.
 */
exports.getMedia = async (req, res) => {
  const adminId            = req.uid;
  const { verificationId } = req.params;

  try {
    const result = await kycAdminService.getVerificationMedia(verificationId, adminId);
    return res.status(200).json({ success: true, media: result });
  } catch (err) {
    logger.error('kycAdminController.getMedia: erro', { adminId, verificationId, error: err.message });
    const status = err.message.includes('não encontrada') ? 404
      : err.message.includes('exclusivo para') ? 422
      : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/admin/kyc/:verificationId/approve
 * Aprova uma verificação e eleva kyc_level do usuário.
 */
exports.approve = async (req, res) => {
  const adminId        = req.uid;
  const { verificationId } = req.params;
  const ctx = {
    ip:        req.ip || req.headers['x-forwarded-for'] || null,
    userAgent: req.headers['user-agent'] || null,
  };

  try {
    const result = await kycAdminService.approveVerification(verificationId, adminId, ctx);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    logger.error('kycAdminController.approve: erro', { adminId, verificationId, error: err.message });
    const status = err.message.includes('não encontrada') ? 404
      : err.message.includes('não está em manual_review') ? 422
      : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/admin/kyc/:verificationId/reject
 * Rejeita uma verificação com motivo.
 * Body: { reason: string }
 */
exports.reject = async (req, res) => {
  const adminId        = req.uid;
  const { verificationId } = req.params;
  const { reason }     = req.body;
  const ctx = {
    ip:        req.ip || req.headers['x-forwarded-for'] || null,
    userAgent: req.headers['user-agent'] || null,
  };

  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ success: false, error: 'reason é obrigatório para rejeição.' });
  }

  try {
    const result = await kycAdminService.rejectVerification(verificationId, adminId, String(reason).trim(), ctx);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    logger.error('kycAdminController.reject: erro', { adminId, verificationId, error: err.message });
    const status = err.message.includes('não encontrada') ? 404
      : err.message.includes('não está em manual_review') ? 422
      : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
};
