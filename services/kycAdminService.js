/**
 * @fileoverview Serviço de aprovação manual de KYC pelo suporte/admin.
 * @module services/kycAdminService
 *
 * Gerencia a fila de verificações KYC com status 'manual_review'.
 * CPF nunca retornado em plaintext — apenas cpf_last4.
 */

const { getSupabaseClient } = require('../config/supabase');
const emailService          = require('./emailService');
const AuditService          = require('./AuditService');
const { logger }            = require('../logger');

const kycAdminService = {

  /**
   * Lista verificações KYC aguardando aprovação manual.
   * Junta com users para expor email e nome do titular.
   *
   * @param {{ page?: number, limit?: number, level?: 'cpf'|'document'|null }} opts
   * @returns {Promise<{ verifications: Array, total: number, page: number, totalPages: number }>}
   */
  async getPendingVerifications({ page = 1, limit = 20, level = null } = {}) {
    const supabase = getSupabaseClient();
    const offset   = (page - 1) * limit;

    let query = supabase
      .from('user_kyc_verifications')
      .select(`
        id,
        user_id,
        cpf_last4,
        level,
        attempts,
        created_at,
        liveness_challenge,
        liveness_passed,
        name_match_score,
        document_type,
        document_expiry,
        doc_front_path,
        doc_back_path,
        liveness_video_path,
        support_ticket_id,
        users!inner (
          email,
          full_name,
          kyc_status,
          kyc_level
        )
      `, { count: 'exact' })
      .eq('status', 'manual_review')
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (level) query = query.eq('level', level);

    const { data, error, count } = await query;
    if (error) throw error;

    const verifications = (data || []).map(v => ({
      id:               v.id,
      userId:           v.user_id,
      cpfLast4:         v.cpf_last4 || '****',
      level:            v.level,
      attempts:         v.attempts,
      createdAt:        v.created_at,
      // Campos de documento (disponíveis após migration 20260616000001)
      livenessChallenge: v.liveness_challenge || null,
      livenessPassed:    v.liveness_passed    || false,
      nameMatchScore:    v.name_match_score   ?? null,
      documentType:      v.document_type      || null,
      documentExpiry:    v.document_expiry    || null,
      hasMedia:          !!(v.doc_front_path || v.liveness_video_path),
      supportTicketId:   v.support_ticket_id  || null,
      // User
      userEmail:        v.users?.email     || null,
      userName:         v.users?.full_name || null,
      kycStatus:        v.users?.kyc_status  || null,
      kycLevel:         v.users?.kyc_level   || null,
    }));

    return {
      verifications,
      total:      count || 0,
      page,
      totalPages: Math.ceil((count || 0) / limit),
    };
  },

  /**
   * Retorna signed URLs (1h TTL) para os arquivos de mídia de uma verificação de documento.
   * Apenas admin/suporte pode chamar este método.
   *
   * @param {string} verificationId
   * @param {string} adminId
   * @returns {Promise<{ livenessUrl, docFrontUrl, docBackUrl, nameMatchScore, livenessChallenge, documentType, documentExpiry }>}
   */
  async getVerificationMedia(verificationId, adminId) {
    const supabase = getSupabaseClient();
    const TTL_SECONDS = 3600; // 1 hora

    const { data: verif, error } = await supabase
      .from('user_kyc_verifications')
      .select('id, user_id, level, liveness_video_path, doc_front_path, doc_back_path, liveness_challenge, liveness_passed, name_match_score, document_type, document_expiry, receita_name')
      .eq('id', verificationId)
      .single();

    if (error || !verif) throw new Error(`Verificação não encontrada: ${verificationId}`);
    if (verif.level !== 'document') throw new Error('getVerificationMedia é exclusivo para verificações de nível document.');

    const _signedUrl = async (path) => {
      if (!path) return null;
      const { data, error: urlErr } = await supabase.storage
        .from('kyc-docs')
        .createSignedUrl(path, TTL_SECONDS);
      if (urlErr) {
        logger.warn('kycAdminService.getVerificationMedia: falha ao gerar signed URL', {
          service: 'kycAdminService', path, error: urlErr.message,
        });
        return null;
      }
      return data?.signedUrl || null;
    };

    const [livenessUrl, docFrontUrl, docBackUrl] = await Promise.all([
      _signedUrl(verif.liveness_video_path),
      _signedUrl(verif.doc_front_path),
      _signedUrl(verif.doc_back_path),
    ]);

    setImmediate(() => {
      AuditService.log({
        userId:     adminId,
        action:     'kyc_media_accessed',
        entityType: 'kyc_verification',
        entityId:   verificationId,
        metadata:   { targetUserId: verif.user_id },
      }).catch(() => {});
    });

    return {
      livenessUrl,
      docFrontUrl,
      docBackUrl,
      livenessChallenge: verif.liveness_challenge || null,
      livenessPassed:    verif.liveness_passed    || false,
      nameMatchScore:    verif.name_match_score   ?? null,
      receitaName:       verif.receita_name       || null,
      documentType:      verif.document_type      || null,
      documentExpiry:    verif.document_expiry    || null,
    };
  },

  /**
   * Aprova uma verificação KYC manualmente.
   * Eleva kyc_level → 'cpf' e kyc_status → 'verified' em users.
   * Envia email de notificação ao titular.
   *
   * @param {string} verificationId  — UUID de user_kyc_verifications
   * @param {string} adminId         — uid do admin que aprovou
   * @param {{ ip?: string, userAgent?: string }} ctx
   */
  async approveVerification(verificationId, adminId, ctx = {}) {
    const supabase = getSupabaseClient();

    // Busca verificação + dados do usuário
    const { data: verification, error: fetchErr } = await supabase
      .from('user_kyc_verifications')
      .select('id, user_id, cpf_last4, cpf_encrypted, level, status, document_number_encrypted, document_type, document_expiry, users!inner(email, full_name)')
      .eq('id', verificationId)
      .single();

    if (fetchErr || !verification) {
      throw new Error(`Verificação não encontrada: ${verificationId}`);
    }

    if (verification.status !== 'manual_review') {
      throw new Error(`Verificação não está em manual_review (status atual: ${verification.status})`);
    }

    const { user_id: userId, users: user } = verification;

    // Atualiza a verificação
    const { error: updErr } = await supabase
      .from('user_kyc_verifications')
      .update({ status: 'verified', updated_at: new Date().toISOString() })
      .eq('id', verificationId);

    if (updErr) throw updErr;

    // Eleva nível KYC do usuário.
    // Para CPF: copia cpf_encrypted (necessário para validação PIX).
    // Para Document: copia document_number_encrypted + document_type + document_expiry.
    const isDocumentLevel = verification.level === 'document';
    const userUpdate = {
      kyc_status:      'verified',
      kyc_level:       isDocumentLevel ? 'document' : 'cpf',
      kyc_verified_at: new Date().toISOString(),
    };

    if (!isDocumentLevel) {
      if (verification.cpf_encrypted) {
        userUpdate.cpf_encrypted = verification.cpf_encrypted;
        if (verification.cpf_last4) userUpdate.cpf_last4 = verification.cpf_last4;
      }
    } else {
      if (verification.document_number_encrypted) {
        userUpdate.document_number_encrypted = verification.document_number_encrypted;
      }
      if (verification.document_type)   userUpdate.document_type   = verification.document_type;
      if (verification.document_expiry) userUpdate.document_expiry = verification.document_expiry;
    }

    const { error: userErr } = await supabase
      .from('users')
      .update(userUpdate)
      .eq('id', userId);

    if (userErr) throw userErr;

    logger.info('kycAdminService.approve: KYC aprovado', {
      service: 'kycAdminService', verificationId, userId, adminId,
    });

    // Email assíncrono
    setImmediate(() => {
      emailService.sendEmail({
        to:           user.email,
        subject:      'Sua identidade foi verificada — ElosCloud',
        templateType: 'kyc_approved',
        data: {
          userName: _firstName(user.full_name),
        },
        userId,
        reference:     verificationId,
        referenceType: 'kyc_verification',
      }).catch(e => logger.error('kycAdminService: falha ao enviar email de aprovação', { error: e.message }));

      AuditService.log({
        userId:    adminId,
        action:    'kyc_manual_approve',
        entityType:'kyc_verification',
        entityId:  verificationId,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        metadata:  { targetUserId: userId },
      }).catch(() => {});
    });

    return { success: true, userId, verificationId };
  },

  /**
   * Rejeita uma verificação KYC manualmente.
   * Atualiza kyc_status → 'failed' em users.
   * Envia email com motivo ao titular.
   *
   * @param {string} verificationId
   * @param {string} adminId
   * @param {string} reason — motivo visível ao usuário (não técnico)
   * @param {{ ip?: string, userAgent?: string }} ctx
   */
  async rejectVerification(verificationId, adminId, reason, ctx = {}) {
    const supabase = getSupabaseClient();

    const { data: verification, error: fetchErr } = await supabase
      .from('user_kyc_verifications')
      .select('id, user_id, cpf_last4, cpf_encrypted, level, status, users!inner(email, full_name)')
      .eq('id', verificationId)
      .single();

    if (fetchErr || !verification) {
      throw new Error(`Verificação não encontrada: ${verificationId}`);
    }

    if (verification.status !== 'manual_review') {
      throw new Error(`Verificação não está em manual_review (status atual: ${verification.status})`);
    }

    const { user_id: userId, users: user } = verification;

    const { error: updErr } = await supabase
      .from('user_kyc_verifications')
      .update({
        status:        'failed',
        failed_reason: reason || 'Rejeitado pela equipe de suporte.',
        updated_at:    new Date().toISOString(),
      })
      .eq('id', verificationId);

    if (updErr) throw updErr;

    const { error: userErr } = await supabase
      .from('users')
      .update({ kyc_status: 'failed' })
      .eq('id', userId);

    if (userErr) throw userErr;

    logger.info('kycAdminService.reject: KYC rejeitado', {
      service: 'kycAdminService', verificationId, userId, adminId,
    });

    setImmediate(() => {
      emailService.sendEmail({
        to:           user.email,
        subject:      'Atualização sobre sua verificação de identidade — ElosCloud',
        templateType: 'kyc_rejected',
        data: {
          userName: _firstName(user.full_name),
          reason:   reason || 'Não foi possível concluir a verificação com as informações fornecidas.',
        },
        userId,
        reference:     verificationId,
        referenceType: 'kyc_verification',
      }).catch(e => logger.error('kycAdminService: falha ao enviar email de rejeição', { error: e.message }));

      AuditService.log({
        userId:    adminId,
        action:    'kyc_manual_reject',
        entityType:'kyc_verification',
        entityId:  verificationId,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        metadata:  { targetUserId: userId, reason },
      }).catch(() => {});
    });

    return { success: true, userId, verificationId };
  },
};

function _firstName(displayName) {
  if (!displayName) return 'Usuário';
  return displayName.trim().split(/\s+/)[0];
}

module.exports = kycAdminService;
