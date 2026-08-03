/**
 * @fileoverview Controller de KYC Social Comunitário (Círculo de Confiança).
 * @module controllers/kycSocialController
 *
 * Endpoints:
 *  POST /api/kyc-social/request                     — solicitar verificação social
 *  GET  /api/kyc-social/my-request                  — consultar própria solicitação
 *  GET  /api/kyc-social/requests/:requestId         — ver solicitação para validar (Interface Cega)
 *  POST /api/kyc-social/requests/:requestId/validate — validar identidade de vizinho
 *  POST /api/kyc-social/bonds/:protegeId/break      — romper vínculo de padrinho (SOCIAL-KYC-003)
 */

const KYCSocialService    = require('../services/KYCSocialService');
const gamificationService = require('../services/gamificationService');
const { getSupabaseClient } = require('../config/supabase');
const { logger }          = require('../logger');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _handleError(res, fn, err) {
  const status  = err.status || 500;
  const code    = err.code   || 'INTERNAL_ERROR';
  const message = err.message || 'Erro interno';

  logger.error(`kycSocialController.${fn}`, { error: message, code });
  return res.status(status).json({ success: false, code, message });
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

/**
 * POST /api/kyc-social/request
 * Solicita verificação social comunitária.
 * Requer: Nível 3+ e nenhuma solicitação ativa.
 */
exports.requestVerification = async (req, res) => {
  const userId = req.uid;
  try {
    const request = await KYCSocialService.requestVerification(userId);
    return res.status(201).json({ success: true, request });
  } catch (err) {
    return _handleError(res, 'requestVerification', err);
  }
};

/**
 * GET /api/kyc-social/my-request
 * Retorna a própria solicitação de verificação social com progresso de validações.
 */
exports.getMyRequest = async (req, res) => {
  const userId = req.uid;
  try {
    const request = await KYCSocialService.getMyRequest(userId);
    return res.status(200).json({ success: true, request });
  } catch (err) {
    return _handleError(res, 'getMyRequest', err);
  }
};

/**
 * GET /api/kyc-social/requests/:requestId
 * Retorna dados de uma solicitação para validação — Interface Cega (LGPD).
 * NUNCA retorna document_photo_url, CPF ou número do RG.
 * Apenas nome, foto e bairro do solicitante são expostos.
 */
exports.getRequestForValidation = async (req, res) => {
  const validatorId = req.uid;
  const { requestId } = req.params;
  try {
    const data = await KYCSocialService.getRequestForValidation(requestId, validatorId);
    return res.status(200).json({ success: true, ...data });
  } catch (err) {
    return _handleError(res, 'getRequestForValidation', err);
  }
};

/**
 * POST /api/kyc-social/requests/:requestId/validate
 * Valida a identidade de um solicitante (Círculo de Confiança).
 * Requer: Nível 5+, não ser o padrinho do solicitante, não ter validado antes.
 */
exports.validateIdentity = async (req, res) => {
  const validatorId = req.uid;
  const { requestId } = req.params;
  try {
    const result = await KYCSocialService.validateIdentity(requestId, validatorId);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return _handleError(res, 'validateIdentity', err);
  }
};

/**
 * POST /api/kyc-social/bonds/:protegeId/break
 * Padrinho rompe proativamente o vínculo com um afilhado suspeito.
 * Ao romper ANTES do banimento do afilhado, o padrinho fica isento
 * da penalidade de reputação (-10% social_score).
 *
 * Requer: ser o padrinho registrado do protegeId.
 * Gamificação: dispara 'godfather_responsible' (+200 XP, +50 EloCoins).
 */
/**
 * POST /api/kyc-social/admin/cleanup-expired-photos
 * Protegido: apenas admin (isAdmin middleware).
 * Deleta fisicamente arquivos expirados do bucket 'kyc-docs' e nulifica
 * as URLs correspondentes no banco. Chamado manualmente ou via cron externo
 * como fallback do pg_cron (se não disponível no plano Supabase).
 *
 * LGPD: fotos de documento não podem permanecer armazenadas após 90 dias.
 */
exports.cleanupExpiredPhotos = async (req, res) => {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return res.status(503).json({ success: false, code: 'DB_ERROR', message: 'Supabase indisponível' });
  }

  try {
    const { data: expired, error: fetchError } = await supabase
      .from('kyc_social_requests')
      .select('id, document_photo_url')
      .lt('document_expires_at', new Date().toISOString())
      .not('document_photo_url', 'is', null);

    if (fetchError) throw fetchError;

    if (!expired?.length) {
      return res.json({ success: true, cleaned: 0 });
    }

    let cleaned = 0;
    for (const row of expired) {
      try {
        // Extrair path relativo após '/kyc-docs/'
        const path = row.document_photo_url.split('/kyc-docs/').pop();
        if (path) {
          await supabase.storage.from('kyc-docs').remove([path]);
        }
        await supabase
          .from('kyc_social_requests')
          .update({ document_photo_url: null })
          .eq('id', row.id);
        cleaned++;
      } catch (fileErr) {
        // Falha individual não interrompe a limpeza dos demais
        logger.warn('cleanupExpiredPhotos: falha ao deletar arquivo', {
          id: row.id,
          error: fileErr.message,
        });
      }
    }

    logger.info('cleanupExpiredPhotos: limpeza concluída', { cleaned, total: expired.length });
    return res.json({ success: true, cleaned });
  } catch (err) {
    logger.error('cleanupExpiredPhotos: erro geral', { error: err.message });
    return res.status(500).json({ code: 'CLEANUP_ERROR', message: err.message });
  }
};

/**
 * POST /api/kyc-social/bonds/:protegeId/break
 * Padrinho rompe proativamente o vínculo com um afilhado suspeito.
 * Ao romper ANTES do banimento do afilhado, o padrinho fica isento
 * da penalidade de reputação (-10% social_score).
 *
 * Requer: ser o padrinho registrado do protegeId.
 * Gamificação: dispara 'godfather_responsible' (+200 XP, +50 EloCoins).
 */
exports.breakGodfatherBond = async (req, res) => {
  const godfatherId = req.uid;
  const { protegeId } = req.params;

  try {
    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({ success: false, code: 'DB_ERROR', message: 'Supabase indisponível' });
    }

    // 1. Buscar vínculo ativo do padrinho com este afilhado
    const { data: bond, error: errBond } = await supabase
      .from('kyc_godfather_bonds')
      .select('id, bond_status')
      .eq('godfather_id', godfatherId)
      .eq('protege_id', protegeId)
      .single();

    if (errBond || !bond) {
      return res.status(404).json({ success: false, code: 'BOND_NOT_FOUND', message: 'Vínculo de padrinho não encontrado' });
    }

    if (bond.bond_status === 'broken') {
      return res.status(400).json({ success: false, code: 'BOND_ALREADY_BROKEN', message: 'Vínculo já foi rompido anteriormente' });
    }

    // 2. Romper o vínculo — bond_status = 'broken'
    const { error: errUpdate } = await supabase
      .from('kyc_godfather_bonds')
      .update({ bond_status: 'broken', broken_at: new Date().toISOString() })
      .eq('id', bond.id);

    if (errUpdate) {
      logger.error('kycSocialController.breakGodfatherBond — falha ao romper vínculo', { error: errUpdate.message, godfatherId, protegeId });
      return res.status(500).json({ success: false, code: 'DB_ERROR', message: 'Falha ao romper vínculo' });
    }

    logger.warn('Vínculo de padrinho rompido', {
      service: 'kycSocialController',
      godfatherId,
      protegeId,
      bondId: bond.id,
    });

    // 3. Gamificação: padrinho responsável ganha XP (Lei do Time) — apenas em sucesso
    try {
      await gamificationService.triggerEvent('godfather_responsible', godfatherId);
    } catch (gamErr) {
      logger.warn('kycSocialController.breakGodfatherBond — falha ao disparar evento gamificação', { error: gamErr.message });
    }

    return res.status(200).json({ success: true, bond_status: 'broken' });
  } catch (err) {
    return _handleError(res, 'breakGodfatherBond', err);
  }
};
