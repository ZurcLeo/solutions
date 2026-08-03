/**
 * @fileoverview Rotas de KYC — Verificação de Identidade.
 * @module routes/kyc
 *
 * Todas as rotas requerem autenticação (verifyToken).
 * POST verify-* requerem também OTP do tipo 'kyc' (requireVerifiedAction, janela 30 min).
 */

const express               = require('express');
const router                = express.Router();
const kycController         = require('../controllers/kycController');
const verifyToken           = require('../middlewares/auth');
const requireVerifiedAction = require('../middlewares/requireVerifiedAction');
const { writeLimit, readLimit } = require('../middlewares/rateLimiter');
const { kycMediaUpload, errorHandler } = require('../middlewares/upload.cjs');
const { logger }            = require('../logger');

router.use((req, res, next) => {
  logger.info('[ROUTE] Request received in kyc', {
    sreContext: req.sreContext || 'no-context',
  });
  next();
});

// ─── Todas as rotas requerem autenticação ──────────────────────────────────────
router.use(verifyToken);

/**
 * GET /api/kyc/status
 * Retorna kyc_status, kyc_level e kyc_verified_at do usuário.
 */
router.get('/status', readLimit, kycController.getStatus);

/**
 * POST /api/kyc/verify-cpf
 * Submete CPF para verificação. Resultado pode ser 'verified' ou 'manual_review'.
 *
 * Fluxo:
 *   1. POST /api/security/otp/generate { type: "kyc" }
 *   2. POST /api/security/otp/validate { type: "kyc", code: "123456" }
 *   3. POST /api/kyc/verify-cpf { cpf, birthDate, declaredName }  (janela 30 min)
 */
router.post(
  '/verify-cpf',
  writeLimit,
  requireVerifiedAction('kyc', { windowMinutes: 30 }),
  kycController.verifyCPF
);

/**
 * POST /api/kyc/upload-media
 * Faz upload de mídia KYC (vídeo de liveness ou foto de documento) para Supabase Storage.
 * Requer OTP de kyc (janela 30 min).
 *
 * Form fields:
 *   file — binário (image/jpeg, image/png, image/webp, video/webm, video/mp4)
 *   type — 'liveness' | 'doc_front' | 'doc_back'
 */
router.post(
  '/upload-media',
  writeLimit,
  requireVerifiedAction('kyc', { windowMinutes: 30 }),
  kycMediaUpload.single('file'),
  errorHandler,
  kycController.uploadMedia
);

/**
 * POST /api/kyc/verify-document
 * Submete verificação de documento com liveness.
 * Os arquivos devem ter sido enviados previamente via POST /api/kyc/upload-media.
 *
 * Body: { documentType, documentNumber, documentExpiry, declaredName,
 *         livenessVideoPath, docFrontPath, docBackPath, livenessChallenge, livenessPassedClient }
 */
router.post(
  '/verify-document',
  writeLimit,
  requireVerifiedAction('kyc', { windowMinutes: 30 }),
  kycController.verifyDocument
);

/**
 * POST /api/kyc/verify-cnpj
 * Verifica CNPJ da organização na Receita Federal.
 * Exclusivo para tipo_de_conta = 'Organização'.
 * Body: { cnpj: string }
 */
router.post(
  '/verify-cnpj',
  writeLimit,
  requireVerifiedAction('kyc', { windowMinutes: 30 }),
  kycController.verifyCNPJ
);

module.exports = router;
