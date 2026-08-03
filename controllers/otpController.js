/**
 * @fileoverview Controller para geração e validação de OTP via security_tickets.
 * @module controllers/otpController
 */

const SecurityTicketService = require('../services/SecurityTicketService');
const AuditService           = require('../services/AuditService');
const emailService           = require('../services/emailService');
const { logger }             = require('../logger');

const VALID_TYPES = ['login', 'saque', 'kyc', 'email_verify', 'pagamento_pix'];

// Tempo de expiração em segundos por tipo (espelhado do Service)
const EXPIRES_IN_LABEL = {
  email_verify: 3600,
  login:         600,
  kyc:          1800,
  saque:         300,
  pagamento_pix: 300,
};

class OtpController {
  /**
   * POST /api/security/otp/generate
   * Gera um ticket OTP e envia por e-mail.
   * Body: { type, metadata? }
   */
  static async generate(req, res) {
    const userId = req.user?.uid;
    const userEmail = req.user?.email;
    const userName  = req.user?.name || req.user?.displayName || 'usuário';
    const { type, metadata } = req.body;

    if (!type || !VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Tipo de verificação inválido.' });
    }

    if (!userEmail) {
      logger.warn('OtpController.generate: usuário sem e-mail no token', { userId });
      return res.status(400).json({ error: 'E-mail do usuário não encontrado.' });
    }

    try {
      const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;

      const { code, expiresIn, expiresAt } = await SecurityTicketService.generateTicket(
        userId,
        type,
        { ipAddress, metadata: metadata || {} }
      );

      // Envia por e-mail (código nunca vai para o response)
      const otpResult = await emailService.sendOTP({
        to:       userEmail,
        userName,
        code,
        type,
        expiresIn,
      });

      if (!otpResult.success) {
        logger.error('OtpController: falha ao enviar OTP', {
          controller: 'OtpController', method: 'generate', userId, error: otpResult.error,
        });

        if (otpResult.error === 'otp_rate_limit_exceeded') {
          return res.status(429).json({
            error: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.',
            retryAfterSeconds: otpResult.retryAfterSeconds || 900,
          });
        }

        if (otpResult.error === 'recipient_suppressed') {
          return res.status(422).json({
            error: 'Não conseguimos enviar para este email. Entre em contato com o suporte.',
          });
        }

        return res.status(500).json({ error: 'Erro ao enviar código de verificação.' });
      }

      logger.info('OtpController: OTP gerado e enviado', {
        controller: 'OtpController',
        method: 'generate',
        userId,
        type,
        expiresAt: expiresAt.toISOString(),
      });

      return res.status(200).json({
        message:   'Código enviado para o seu e-mail.',
        expiresIn,
      });

    } catch (err) {
      logger.error('OtpController.generate: erro', {
        controller: 'OtpController',
        method: 'generate',
        userId,
        type,
        error: err.message,
      });
      return res.status(500).json({ error: 'Não foi possível enviar o código. Tente novamente.' });
    }
  }

  /**
   * POST /api/security/otp/validate
   * Valida o código OTP informado pelo usuário.
   * Body: { type, code }
   */
  static async validate(req, res) {
    const userId = req.user?.uid;
    const { type, code } = req.body;

    if (!type || !VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Tipo de verificação inválido.' });
    }

    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
      return res.status(400).json({ error: 'Código inválido.' });
    }

    try {
      const ticket = await SecurityTicketService.validateTicket(userId, type, code.trim());

      logger.info('OtpController: OTP validado com sucesso', {
        controller: 'OtpController',
        method: 'validate',
        userId,
        type,
        ticketId: ticket.id,
      });

      // Auditoria: fire-and-forget
      setImmediate(() => {
        AuditService.log({
          userId,
          action:     'otp_validated',
          entityType: 'security_ticket',
          entityId:   ticket.id,
          ticketId:   ticket.id,
          ipAddress:  req.ip || req.headers['x-forwarded-for'] || null,
          userAgent:  req.headers['user-agent'] || null,
          metadata:   { type },
        });
      });

      return res.status(200).json({
        valid:  true,
        ticket: {
          id:       ticket.id,
          type:     ticket.type,
          metadata: ticket.metadata,
        },
      });

    } catch (err) {
      // Erros de negócio (código inválido, expirado, bloqueado) são 400/429
      const isBruteForce = err.message.includes('Muitas tentativas');

      logger.warn('OtpController.validate: falha na validação', {
        controller: 'OtpController',
        method: 'validate',
        userId,
        type,
        reason: err.message,
      });

      return res.status(isBruteForce ? 429 : 400).json({ error: err.message });
    }
  }
}

module.exports = OtpController;
