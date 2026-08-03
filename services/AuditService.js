/**
 * @fileoverview Serviço de auditoria para registro de ações sensíveis verificadas por OTP/Passkey.
 * Nunca lança — resiliente a falhas do Supabase (fire-and-forget seguro).
 * @module services/AuditService
 */

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const TABLE = 'audit_log';

class AuditService {
  /**
   * Registra uma ação auditável no audit_log.
   * Nunca lança erro — falhas são apenas logadas como warning.
   *
   * @param {Object} params
   * @param {string}  params.userId      - Firebase UID do usuário
   * @param {string}  params.action      - Descrição da ação (ex: 'otp_validated', 'saque_autorizado')
   * @param {string}  [params.entityType] - Tipo da entidade alvo (ex: 'caixinha', 'transaction')
   * @param {string}  [params.entityId]   - ID da entidade alvo
   * @param {string}  [params.ticketId]   - UUID do security_ticket que autorizou a operação
   * @param {string}  [params.ipAddress]  - IP do cliente
   * @param {string}  [params.userAgent]  - User-Agent do cliente
   * @param {Object}  [params.metadata]   - Dados de contexto adicionais (sem PII sensível)
   * @returns {Promise<void>}
   */
  async log({ userId, action, entityType, entityId, ticketId, ipAddress, userAgent, metadata } = {}) {
    if (!userId || !action) {
      logger.warn('AuditService.log: chamada sem userId ou action — ignorada', {
        service: 'AuditService',
        userId,
        action,
      });
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      logger.warn('AuditService.log: Supabase indisponível — entrada não registrada', {
        service: 'AuditService',
        userId,
        action,
      });
      return;
    }

    try {
      const { error } = await supabase.from(TABLE).insert({
        user_id:     userId,
        action,
        entity_type: entityType  || null,
        entity_id:   entityId    || null,
        ticket_id:   ticketId    || null,
        ip_address:  ipAddress   || null,
        user_agent:  userAgent   || null,
        metadata:    metadata    || {},
      });

      if (error) {
        logger.warn('AuditService.log: falha ao inserir no audit_log', {
          service: 'AuditService',
          userId,
          action,
          error: error.message,
        });
        return;
      }

      logger.info('AuditService: ação registrada', {
        service: 'AuditService',
        userId,
        action,
        entityType,
        entityId,
      });
    } catch (err) {
      // Nunca propaga — auditoria não pode bloquear operações de negócio
      logger.warn('AuditService.log: exceção não tratada', {
        service: 'AuditService',
        userId,
        action,
        error: err.message,
      });
    }
  }
}

module.exports = new AuditService();
