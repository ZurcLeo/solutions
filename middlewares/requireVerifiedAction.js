/**
 * @fileoverview Middleware de Step-Up Authentication (SCA).
 * Verifica se o usuário completou um desafio OTP (ou futuramente Passkey) recentemente
 * antes de permitir acesso a rotas sensíveis.
 *
 * IMPORTANTE: Este middleware NÃO valida o código OTP. Ele apenas verifica se o usuário
 * JÁ passou pelo desafio (security_tickets.status='used') dentro da janela de tempo.
 * A validação do OTP ocorre em POST /api/security/otp/validate.
 *
 * @module middlewares/requireVerifiedAction
 *
 * @example
 * // Uso em rotas sensíveis:
 * const requireVerifiedAction = require('../middlewares/requireVerifiedAction');
 *
 * // Saque — janela de 5 minutos (padrão do tipo)
 * router.post('/sacar',
 *   verifyToken,
 *   requireVerifiedAction('saque'),
 *   CaixinhaController.sacar
 * );
 *
 * // KYC — janela estendida de 45 minutos
 * router.post('/kyc/submit',
 *   verifyToken,
 *   requireVerifiedAction('kyc', { windowMinutes: 45 }),
 *   KycController.submit
 * );
 *
 * // Com extração de contexto para auditoria
 * router.post('/caixinha/:caixinhaId/sacar',
 *   verifyToken,
 *   requireVerifiedAction('saque', {
 *     getEntityType: () => 'caixinha',
 *     getEntityId:   (req) => req.params.caixinhaId,
 *   }),
 *   CaixinhaController.sacar
 * );
 */

const { getSupabaseClient } = require('../config/supabase');
const AuditService           = require('../services/AuditService');
const { logger }             = require('../logger');

// Janelas padrão por tipo (em minutos)
const DEFAULT_WINDOWS = {
  saque:        5,
  kyc:         30,
  login:       10,
  email_verify: 60,
  pagamento_pix: 5,
};

const VALID_TYPES = Object.keys(DEFAULT_WINDOWS);
const TABLE = 'security_tickets';

/**
 * Factory do middleware de verificação de ação autenticada.
 *
 * @param {string} type - Tipo da operação: 'login' | 'saque' | 'kyc' | 'email_verify'
 * @param {Object} [opts]
 * @param {number}   [opts.windowMinutes]  - Sobrescreve a janela padrão do tipo
 * @param {Function} [opts.getEntityType]  - (req) => string — tipo da entidade auditada
 * @param {Function} [opts.getEntityId]    - (req) => string — ID da entidade auditada
 * @returns {Function} Middleware Express assíncrono
 */
const requireVerifiedAction = (type, opts = {}) => {
  if (!VALID_TYPES.includes(type)) {
    throw new Error(`requireVerifiedAction: tipo inválido "${type}". Use: ${VALID_TYPES.join(', ')}`);
  }

  const windowMinutes  = opts.windowMinutes  ?? DEFAULT_WINDOWS[type];
  const getEntityType  = opts.getEntityType  ?? (() => null);
  const getEntityId    = opts.getEntityId    ?? (() => null);

  return async (req, res, next) => {
    const userId    = req.uid;
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;
    const userAgent = req.headers['user-agent'] || null;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Autenticação necessária.',
      });
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      logger.error('requireVerifiedAction: Supabase indisponível', {
        middleware: 'requireVerifiedAction',
        userId,
        type,
      });
      return res.status(503).json({
        success:  false,
        message: 'Serviço de verificação temporariamente indisponível.',
      });
    }

    try {
      // Janela: used_at deve estar dentro de [now() - window, now()]
      const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

      const { data: tickets, error } = await supabase
        .from(TABLE)
        .select('id, type, metadata, used_at')
        .eq('user_id', userId)
        .eq('type', type)
        .eq('status', 'used')
        .gte('used_at', windowStart)
        .order('used_at', { ascending: false })
        .limit(1);

      if (error) {
        logger.error('requireVerifiedAction: erro ao consultar security_tickets', {
          middleware: 'requireVerifiedAction',
          userId,
          type,
          error: error.message,
        });
        return res.status(503).json({
          success:  false,
          message: 'Serviço de verificação temporariamente indisponível.',
        });
      }

      if (!tickets || tickets.length === 0) {
        logger.info('requireVerifiedAction: nenhum ticket válido na janela', {
          middleware: 'requireVerifiedAction',
          userId,
          type,
          windowMinutes,
        });
        return res.status(403).json({
          success:      false,
          code:         'OTP_REQUIRED',
          error:        'Verificação adicional necessária.',
          requiredType: type,
          action:       type,
          windowMinutes,
        });
      }

      const ticket = tickets[0];

      // Disponibiliza o contexto do ticket para o controller seguinte
      req.verifiedTicket = {
        id:       ticket.id,
        type:     ticket.type,
        metadata: ticket.metadata || {},
      };

      logger.info('requireVerifiedAction: ticket verificado — acesso liberado', {
        middleware: 'requireVerifiedAction',
        userId,
        type,
        ticketId: ticket.id,
        usedAt:   ticket.used_at,
      });

      // Passa ao próximo middleware/controller
      next();

      // Fire-and-forget: grava audit APÓS a resposta ter sido enviada
      // Não bloqueia o pipeline nem o tempo de resposta
      setImmediate(() => {
        AuditService.log({
          userId,
          action:     `${type}_autorizado`,
          entityType: getEntityType(req) || null,
          entityId:   getEntityId(req)   || null,
          ticketId:   ticket.id,
          ipAddress,
          userAgent,
          metadata: {
            path:   req.originalUrl,
            method: req.method,
          },
        });
      });

    } catch (err) {
      logger.error('requireVerifiedAction: exceção não tratada', {
        middleware: 'requireVerifiedAction',
        userId,
        type,
        error: err.message,
      });
      return res.status(500).json({
        success:  false,
        message: 'Erro interno ao verificar autorização.',
      });
    }
  };
};

module.exports = requireVerifiedAction;
