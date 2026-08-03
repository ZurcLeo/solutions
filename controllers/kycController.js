/**
 * @fileoverview Controller de KYC — Verificação de Identidade.
 * @module controllers/kycController
 *
 * CPF  → submete para verificação; Receita Federal exige hCaptcha (bloqueado),
 *         resultado cai em manual_review → suporte aprova manualmente.
 * CNPJ → scraper direto Receita Federal (cnpjVerificationService)
 * DOC  → captura de documento + liveness challenge-response (prova de vida)
 */

const KYCService           = require('../services/KYCService');
const { getSupabaseClient } = require('../config/supabase');
const { logger }           = require('../logger');

const VALID_DOC_TYPES  = ['rg', 'cnh', 'passport'];
const VALID_MEDIA_TYPES = ['liveness', 'doc_front', 'doc_back'];
const MEDIA_EXT_MAP    = {
  'video/webm':      'webm',
  'video/mp4':       'mp4',
  'video/quicktime': 'mov',
  'image/jpeg':      'jpg',
  'image/png':       'png',
  'image/webp':      'webp',
};

/**
 * GET /api/kyc/status
 * Retorna o status KYC atual do usuário autenticado.
 */
exports.getStatus = async (req, res) => {
  try {
    const userId = req.uid;
    const status = await KYCService.getKYCStatus(userId);
    return res.status(200).json({ success: true, kyc: status });
  } catch (err) {
    logger.error('kycController.getStatus: erro', { error: err.message, userId: req.uid });
    return res.status(500).json({ success: false, error: 'Erro ao consultar status KYC.' });
  }
};

/**
 * POST /api/kyc/verify-cpf
 * Inicia verificação de CPF.
 *
 * Receita Federal exige hCaptcha que não pode ser resolvido por scraper —
 * o fluxo atual retorna manual_review e o suporte aprova manualmente.
 *
 * Body: { cpf, birthDate, declaredName }
 *   cpf          — string com ou sem máscara
 *   birthDate    — ISO 8601 ou DD/MM/YYYY
 *   declaredName — nome do usuário para conferência
 */
exports.verifyCPF = async (req, res) => {
  const userId = req.uid;
  const { cpf, birthDate, declaredName } = req.body;

  if (!cpf || !birthDate || !declaredName) {
    return res.status(400).json({
      success: false,
      error: 'Campos obrigatórios: cpf, birthDate, declaredName.',
    });
  }

  const ctx = {
    ip:        req.ip || req.headers['x-forwarded-for'] || null,
    userAgent: req.headers['user-agent'] || null,
  };

  logger.info('kycController.verifyCPF: requisição recebida', {
    controller: 'kycController',
    userId,
  });

  try {
    const result = await KYCService.verifyCPF(userId, cpf, birthDate, declaredName, ctx);

    const httpStatus = result.success ? 200
      : result.status === 'manual_review' ? 202
      : 422;

    return res.status(httpStatus).json({ success: result.success, kyc: result });
  } catch (err) {
    logger.error('kycController.verifyCPF: erro não tratado', {
      controller: 'kycController',
      userId,
      error: err.message,
    });
    return res.status(500).json({ success: false, error: 'Erro interno na verificação KYC.' });
  }
};

/**
 * POST /api/kyc/upload-media
 * Faz upload de mídia KYC (vídeo de liveness ou foto de documento) para o bucket kyc-docs.
 * Usa multer (kycMediaUpload) para receber arquivo multipart.
 *
 * Form fields:
 *   file  — arquivo binário (image/jpeg, image/png, image/webp, video/webm, video/mp4)
 *   type  — 'liveness' | 'doc_front' | 'doc_back'
 *
 * Retorna: { success: true, path: string }
 */
exports.uploadMedia = async (req, res) => {
  const userId = req.uid;
  const { type } = req.body;

  if (!type || !VALID_MEDIA_TYPES.includes(type)) {
    return res.status(400).json({
      success: false,
      error: `type deve ser um de: ${VALID_MEDIA_TYPES.join(', ')}.`,
    });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Arquivo não recebido.' });
  }

  // Strip ';codecs=...' antes de mapear (ex: 'video/webm;codecs=vp8' → 'video/webm')
  const baseMime = req.file.mimetype.split(';')[0].trim();
  const ext = MEDIA_EXT_MAP[baseMime] || 'bin';
  const storagePath = `${userId}/${type}_${Date.now()}.${ext}`;

  logger.info('kycController.uploadMedia: iniciando upload', {
    controller: 'kycController', userId, type, mimetype: req.file.mimetype,
  });

  try {
    const supabase = getSupabaseClient();
    const { error: uploadErr } = await supabase.storage
      .from('kyc-docs')
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    if (uploadErr) {
      logger.error('kycController.uploadMedia: erro no Supabase Storage', {
        controller: 'kycController', userId, error: uploadErr.message,
      });
      return res.status(500).json({ success: false, error: 'Falha ao armazenar arquivo.' });
    }

    return res.status(200).json({ success: true, path: storagePath });
  } catch (err) {
    logger.error('kycController.uploadMedia: erro não tratado', {
      controller: 'kycController', userId, error: err.message,
    });
    return res.status(500).json({ success: false, error: 'Erro interno no upload.' });
  }
};

/**
 * POST /api/kyc/verify-document
 * Submete verificação de documento com liveness.
 *
 * Pré-requisito: usuário deve ter kyc_level >= 'cpf'.
 * Os arquivos de mídia devem ter sido enviados previamente via POST /api/kyc/upload-media.
 *
 * Body: {
 *   documentType: 'rg'|'cnh'|'passport',
 *   documentNumber: string,
 *   documentExpiry: string|null (YYYY-MM-DD),
 *   declaredName: string,
 *   livenessVideoPath: string,
 *   docFrontPath: string,
 *   docBackPath: string|null,
 *   livenessChallenge: string,
 *   livenessPassedClient: boolean,
 * }
 */
exports.verifyDocument = async (req, res) => {
  const userId = req.uid;
  const {
    documentType, documentNumber, documentExpiry, declaredName,
    livenessVideoPath, docFrontPath, docBackPath,
    livenessChallenge, livenessPassedClient,
  } = req.body;

  if (!documentType || !VALID_DOC_TYPES.includes(documentType)) {
    return res.status(400).json({
      success: false,
      error: `documentType deve ser um de: ${VALID_DOC_TYPES.join(', ')}.`,
    });
  }
  if (!documentNumber || !declaredName || !livenessVideoPath || !docFrontPath) {
    return res.status(400).json({
      success: false,
      error: 'Campos obrigatórios: documentNumber, declaredName, livenessVideoPath, docFrontPath.',
    });
  }

  const ctx = {
    ip:        req.ip || req.headers['x-forwarded-for'] || null,
    userAgent: req.headers['user-agent'] || null,
  };

  logger.info('kycController.verifyDocument: requisição recebida', {
    controller: 'kycController', userId, documentType,
  });

  try {
    const result = await KYCService.verifyDocument(userId, {
      documentType,
      documentNumber,
      documentExpiry:       documentExpiry || null,
      declaredName,
      livenessVideoPath,
      docFrontPath,
      docBackPath:          docBackPath || null,
      livenessChallenge:    livenessChallenge || null,
      livenessPassedClient: livenessPassedClient === true || livenessPassedClient === 'true',
    }, ctx);

    const httpStatus = result.success
      ? (result.status === 'manual_review' ? 202 : 200)
      : 422;
    return res.status(httpStatus).json({ success: result.success, kyc: result });
  } catch (err) {
    logger.error('kycController.verifyDocument: erro não tratado', {
      controller: 'kycController', userId, error: err.message,
    });
    return res.status(500).json({ success: false, error: 'Erro interno na verificação de documento.' });
  }
};

/**
 * POST /api/kyc/verify-cnpj
 * Verifica CNPJ na Receita Federal.
 * Exclusivo para tipo_de_conta = 'Organização'.
 *
 * Body: { cnpj: string }
 */
exports.verifyCNPJ = async (req, res) => {
  const userId = req.uid;
  const { cnpj } = req.body;

  if (!cnpj) {
    return res.status(400).json({ success: false, error: 'cnpj é obrigatório.' });
  }

  const cnpjDigits = String(cnpj).replace(/\D/g, '');
  if (cnpjDigits.length !== 14) {
    return res.status(400).json({ success: false, error: 'CNPJ deve conter 14 dígitos.' });
  }

  const ctx = {
    ip:        req.ip || req.headers['x-forwarded-for'] || null,
    userAgent: req.headers['user-agent'] || null,
  };

  logger.info('kycController.verifyCNPJ: requisição recebida', {
    controller: 'kycController', userId,
  });

  try {
    const result = await KYCService.verifyCNPJ(userId, cnpj, ctx);
    const httpStatus = result.success ? 200 : result.status === 'manual_review' ? 202 : 422;
    return res.status(httpStatus).json({ success: result.success, kyc: result });
  } catch (err) {
    logger.error('kycController.verifyCNPJ: erro não tratado', {
      controller: 'kycController', userId, error: err.message,
    });
    return res.status(500).json({ success: false, error: 'Erro interno na verificação de CNPJ.' });
  }
};
