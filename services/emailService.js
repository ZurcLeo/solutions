/**
 * @fileoverview Serviço para envio e gerenciamento de e-mails via Resend API com templates.
 * @module services/emailService
 * @requires ../logger
 * @requires ../models/Email
 * @requires ../templates/emails
 * @requires dotenv
 */
const axios = require('axios');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const { logger } = require('../logger');
const Email = require('../models/Email');
const emailTemplates = require('../templates/emails');
require('dotenv').config();

// ─── Rate limiters por destinatário ──────────────────────────────────────────
const recipientLimiter = new RateLimiterMemory({
  points: 5,       // max 5 emails por hora por destinatário
  duration: 3600,
  keyPrefix: 'email_recipient',
});

const otpLimiter = new RateLimiterMemory({
  points: 3,       // max 3 OTPs por 15min por destinatário
  duration: 900,
  keyPrefix: 'email_otp',
});

/**
 * Mapeamento de templateType → setor da plataforma.
 * Cada setor tem seu próprio endereço de remetente para melhor identificação
 * e profissionalismo perante o destinatário.
 */
const TEMPLATE_SECTOR_MAP = {
  // Segurança / Gestão de Acesso
  otp:                       'seguranca',
  kyc_approved:              'seguranca',
  kyc_rejected:              'seguranca',
  // Social / Comunidade
  convite:                   'social',
  convite_lembrete:          'social',
  waitlist_match:            'social',
  welcome:                   'social',
  // Financeiro
  caixinha_invite:           'financeiro',
  loan_approved:             'financeiro',
  loan_rejected:             'financeiro',
  contribuicao_reminder:     'financeiro',
  // Comercial / Mercado
  seller_approved:           'comercial',
  seller_rejected:           'comercial',
  order_confirmed:           'comercial',
  order_shipped:             'comercial',
  guest_order_status:        'comercial',
  booking_new_request:       'comercial',
  booking_confirmed:         'comercial',
  booking_declined:          'comercial',
  booking_created:           'comercial',
  // Jurídico
  contract_created:          'juridico',
  contract_signed:           'juridico',
  contract_expired:          'juridico',
  // Gamificação
  level_up:                  'gamificacao',
  selo_earned:               'gamificacao',
  mission_complete:          'gamificacao',
  // Jogos e Concursos
  game_invite:               'social',
  // Suporte (default para templates de suporte e padrao)
  support_ticket_created:    'suporte',
  support_ticket_update:     'suporte',
  support_ticket_resolved:   'suporte',
  csat_survey:               'suporte',
  padrao:                    'suporte',
};

/**
 * Resolve o endereço "from" baseado no setor do template.
 * Usa variáveis de ambiente por setor com fallback para suporte@eloscloud.com.
 *
 * Secrets Fly.io necessários (flyctl secrets set):
 *   EMAIL_FROM_SEGURANCA   → seguranca@eloscloud.com
 *   EMAIL_FROM_SOCIAL      → comunidade@eloscloud.com
 *   EMAIL_FROM_FINANCEIRO  → financeiro@eloscloud.com
 *   EMAIL_FROM_COMERCIAL   → comercial@eloscloud.com
 *   EMAIL_FROM_JURIDICO    → juridico@eloscloud.com
 *   EMAIL_FROM_GAMIFICACAO → conquistas@eloscloud.com
 *   EMAIL_FROM_SUPORTE     → suporte@eloscloud.com (já existente)
 *
 * @param {string} templateType
 * @returns {{ fromEmail: string, fromName: string, replyTo: string }}
 */
const resolveSectorFrom = (templateType) => {
  const sector = TEMPLATE_SECTOR_MAP[templateType] || 'suporte';

  const SECTOR_CONFIG = {
    seguranca:   {
      envKey:  'EMAIL_FROM_SEGURANCA',
      default: 'seguranca@eloscloud.com',
      name:    'ElosCloud Segurança',
      replyTo: 'noreply@eloscloud.com',
    },
    social:      {
      envKey:  'EMAIL_FROM_SOCIAL',
      default: 'comunidade@eloscloud.com',
      name:    'ElosCloud Comunidade',
      replyTo: 'suporte@eloscloud.com',
    },
    financeiro:  {
      envKey:  'EMAIL_FROM_FINANCEIRO',
      default: 'financeiro@eloscloud.com',
      name:    'ElosCloud Financeiro',
      replyTo: 'suporte@eloscloud.com',
    },
    comercial:   {
      envKey:  'EMAIL_FROM_COMERCIAL',
      default: 'comercial@eloscloud.com',
      name:    'ElosCloud Mercado',
      replyTo: 'suporte@eloscloud.com',
    },
    juridico:    {
      envKey:  'EMAIL_FROM_JURIDICO',
      default: 'juridico@eloscloud.com',
      name:    'ElosCloud Jurídico',
      replyTo: 'juridico@eloscloud.com',
    },
    gamificacao: {
      envKey:  'EMAIL_FROM_GAMIFICACAO',
      default: 'conquistas@eloscloud.com',
      name:    'ElosCloud Conquistas',
      replyTo: 'noreply@eloscloud.com',
    },
    suporte:     {
      envKey:  'EMAIL_FROM_SUPORTE',
      default: 'suporte@eloscloud.com',
      name:    'ElosCloud Suporte',
      replyTo: 'suporte@eloscloud.com',
    },
  };

  const cfg = SECTOR_CONFIG[sector];
  return {
    fromEmail: process.env[cfg.envKey] || cfg.default,
    fromName:  process.env.EMAIL_FROM_NAME || cfg.name,
    replyTo:   cfg.replyTo,
    sector,
  };
};

// ─── Unsubscribe (LGPD) ─────────────────────────────────────────────────────

// Templates que NUNCA podem ter unsubscribe (segurança/compliance)
const NON_UNSUBSCRIBABLE = new Set(['otp', 'kyc_approved', 'kyc_rejected']);

// Mapeamento setor → event category em notification_prefs
const SECTOR_TO_PREF_EVENT = {
  social:      'invites',
  financeiro:  'payments',
  comercial:   'pedidos',
  gamificacao: 'invites',
  suporte:     'messages',
  juridico:    'payments',
};

/**
 * Envia email via Resend API.
 * @private
 * @async
 * @function sendViaResend
 */
const sendViaResend = async (mailOptions) => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY not configured');
  }

  try {
    // replyTo pode vir no mailOptions (setor-específico) ou cair no fallback global
    const replyTo = mailOptions.replyTo || process.env.EMAIL_REPLY_TO || 'suporte@eloscloud.com';
    const payload = {
      from: mailOptions.from,
      to: mailOptions.to,
      reply_to: replyTo,
      subject: mailOptions.subject,
      html: mailOptions.html,
      text: mailOptions.text,
    };
    // Incluir headers customizados (List-Unsubscribe, etc.)
    if (mailOptions.headers && Object.keys(mailOptions.headers).length > 0) {
      payload.headers = mailOptions.headers;
    }
    const response = await axios.post('https://api.resend.com/emails', payload, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    return {
      messageId: response.data.id
    };
  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;
    logger.error('Resend API Error', { error: errorMsg });
    throw new Error(`Resend API Error: ${errorMsg}`);
  }
};

/**
 * Serviço de e-mail para lidar com todas as operações relacionadas a e-mail.
 * @namespace emailService
 */
const emailService = {
  /**
   * Envia um e-mail utilizando um template predefinido.
   * @async
   * @function sendEmail
   * @param {Object} params - Parâmetros para o envio do e-mail.
   * @param {string} params.to - O endereço de e-mail do destinatário.
   * @param {string} params.subject - O assunto do e-mail.
   * @param {string} params.templateType - O tipo de template a ser utilizado (ex: 'convite', 'welcome'). Deve corresponder a uma chave em `emailTemplates`.
   * @param {Object} params.data - Os dados a serem injetados no template do e-mail.
   * @param {string} [params.userId] - O ID do usuário associado ao envio (opcional).
   * @param {string} [params.reference] - O ID de uma entidade relacionada (ex: inviteId) (opcional).
   * @param {string} [params.referenceType] - O tipo da entidade referenciada (ex: 'invite') (opcional).
   * @returns {Promise<Object>} Um objeto com o status de sucesso (`success`), o ID do registro de e-mail no Firestore (`emailId`) e o ID da mensagem SMTP/Resend (`messageId`). Em caso de erro, contém `success: false` e uma mensagem de `error`.
   * @throws {Error} Se o template não for encontrado ou ocorrer um erro no envio.
   * @description Registra o e-mail no Firestore, renderiza o conteúdo HTML e de texto simples a partir de um template, e envia o e-mail via Resend (se configurado) ou SMTP, atualizando o status do registro no banco.
   */
  sendEmail: async (params) => {
    const { 
      to, 
      subject, 
      templateType, 
      data,
      userId = null, 
      reference = null,
      referenceType = null
    } = params;
    
    logger.info('Preparing to send email', {
      service: 'emailService',
      function: 'sendEmail',
      to,
      subject,
      templateType,
      reference
    });
    
    // 1. Validate template exists
    if (!emailTemplates[templateType]) {
      logger.error('Email template not found', {
        service: 'emailService',
        function: 'sendEmail',
        templateType
      });
      return { 
        success: false, 
        error: `Email template '${templateType}' not found` 
      };
    }
    
    // 2. Rate limit por destinatário
    try {
      await recipientLimiter.consume(to);
    } catch (_rlErr) {
      logger.warn('Rate limit excedido para destinatário', { service: 'emailService', to, templateType });
      return { success: false, error: 'recipient_rate_limit_exceeded' };
    }

    // 3. Check if recipient is suppressed (bounced/complained)
    const emailDeliveryService = require('./emailDeliveryService');
    const suppressed = await emailDeliveryService.isRecipientSuppressed(to);
    if (suppressed) {
      logger.warn('Email cancelado: destinatário suprimido', { service: 'emailService', to, templateType });
      return { success: false, error: 'recipient_suppressed' };
    }

    let emailRecord = null;
    try {
      // 3. Create email record
      emailRecord = await Email.create({
        to,
        subject,
        templateType,
        templateData: data,
        status: 'pending',
        userId,
        reference,
        referenceType
      });
      
      // 4. Render email content from template
      let htmlContent = emailTemplates[templateType](data);

      // 5. Prepare email data — remetente baseado no setor do template
      const { fromEmail, fromName, replyTo, sector } = resolveSectorFrom(templateType);
      const mailHeaders = {};

      // 6. Unsubscribe headers + footer (LGPD) — apenas para templates não-segurança
      if (!NON_UNSUBSCRIBABLE.has(templateType) && userId && process.env.EMAIL_UNSUBSCRIBE_SECRET) {
        const unsubscribeToken = require('../utils/unsubscribeToken');
        const eventCategory = SECTOR_TO_PREF_EVENT[sector] || 'invites';
        const token = unsubscribeToken.generate(userId, eventCategory);
        const apiUrl = process.env.BACKEND_URL || process.env.REACT_APP_BACKEND_URL || 'https://eloscloud-api.fly.dev';
        const unsubUrl = `${apiUrl}/api/email/unsubscribe?token=${encodeURIComponent(token)}&uid=${encodeURIComponent(userId)}&cat=${encodeURIComponent(eventCategory)}`;

        // RFC 8058: List-Unsubscribe + List-Unsubscribe-Post
        mailHeaders['List-Unsubscribe'] = `<${unsubUrl}>`;
        mailHeaders['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';

        // Injetar link no footer do HTML
        const unsubFooter = `<div style="text-align:center;margin-top:24px;padding-top:16px;border-top:1px solid #e0e0e0;font-size:12px;color:#888;"><a href="${unsubUrl}" style="color:#888;text-decoration:underline;">Cancelar recebimento deste tipo de email</a></div>`;
        // Inserir antes do último </div> do template (footer container)
        const lastDivIdx = htmlContent.lastIndexOf('</div>');
        if (lastDivIdx !== -1) {
          htmlContent = htmlContent.slice(0, lastDivIdx) + unsubFooter + htmlContent.slice(lastDivIdx);
        } else {
          htmlContent += unsubFooter;
        }
      }

      // 7. Create plain text version by stripping HTML
      const textContent = htmlContent.replace(/<[^>]*>?/gm, '');

      const mailOptions = {
        from: `"${fromName}" <${fromEmail}>`,
        to,
        subject,
        html: htmlContent,
        text: textContent,
        replyTo,
        headers: mailHeaders,
      };
      logger.info('Email sector resolved', { service: 'emailService', templateType, sector, fromEmail });
      
      // 6. Send email via Resend API
      logger.info('Using Resend API to send email', { service: 'emailService' });
      const info = await sendViaResend(mailOptions);
      
      // 7. Update email record with success status
      await Email.updateStatus(emailRecord.id, 'sent', {
        messageId: info.messageId
      });
      
      logger.info('Email sent successfully', {
        service: 'emailService',
        function: 'sendEmail',
        emailId: emailRecord.id,
        to,
        messageId: info.messageId
      });
      
      return { 
        success: true, 
        emailId: emailRecord.id,
        messageId: info.messageId 
      };
    } catch (error) {
      // If we have an email record, update its status to error
      if (emailRecord && emailRecord.id) {
        await Email.updateStatus(emailRecord.id, 'error', {
          error: error.message
        });
      }
      
      logger.error('Error sending email', {
        service: 'emailService',
        function: 'sendEmail',
        to,
        error: error.message
      });
      
      return { 
        success: false, 
        error: error.message 
      };
    }
  },
  
  /**
   * Reenvia um e-mail existente, criando um novo registro no Firestore.
   * @async
   * @function resendEmail
   * @param {string} emailId - O ID do registro de e-mail original a ser reenviado.
   * @returns {Promise<Object>} O mesmo formato de retorno de `sendEmail`.
   * @throws {Error} Se o e-mail original não for encontrado ou ocorrer um erro no reenvio.
   * @description Recupera os detalhes de um e-mail enviado anteriormente e tenta reenviá-lo, criando um novo registro e atualizando o status do e-mail original.
   */
  resendEmail: async (emailId) => {
    logger.info('Attempting to resend email', {
      service: 'emailService',
      function: 'resendEmail',
      emailId
    });
    
    try {
      // 1. Get original email
      const originalEmail = await Email.getById(emailId);
      
      // 2. Check if email exists and was not already sent successfully
      if (originalEmail.status === 'sent') {
        logger.warn('Attempting to resend already sent email', {
          service: 'emailService',
          function: 'resendEmail',
          emailId
        });
      }
      
      // 3. Send with same parameters but create a new record
      const result = await emailService.sendEmail({
        to: originalEmail.to,
        subject: originalEmail.subject,
        templateType: originalEmail.templateType,
        data: originalEmail.templateData,
        userId: originalEmail.userId,
        reference: originalEmail.reference,
        referenceType: originalEmail.referenceType
      });
      
      // 4. Link original email to the new one if successful
      if (result.success) {
        await Email.updateStatus(emailId, 'resent', {
          resendEmailId: result.emailId
        });
      }
      
      return result;
    } catch (error) {
      logger.error('Error resending email', {
        service: 'emailService',
        function: 'resendEmail',
        emailId,
        error: error.message
      });
      
      return { 
        success: false, 
        error: error.message 
      };
    }
  },
  
  /**
   * Método de compatibilidade reversa para a antiga interface de envio de e-mails.
   * @async
   * @function sendEmail_legacy
   * @param {string} to - O endereço de e-mail do destinatário.
   * @param {string} subject - O assunto do e-mail.
   * @param {string} content - O conteúdo do e-mail (usado como `data.content` no novo método).
   * @param {string} userId - O ID do usuário associado.
   * @param {string} inviteId - O ID do convite relacionado (usado como `reference`).
   * @param {string} type - O tipo do e-mail (usado como `templateType`).
   * @returns {Promise<Object>} O mesmo formato de retorno de `sendEmail`.
   * @deprecated Use o método `sendEmail` para novas implementações.
   * @description Adapta os parâmetros da interface antiga para o novo método `sendEmail`.
   */
  /**
   * Envia e-mail com código OTP de forma direta (sem registro Firestore).
   * Adequado para OTPs time-critical onde latência mínima é necessária.
   *
   * @param {Object} params
   * @param {string} params.to         - E-mail do destinatário
   * @param {string} params.userName   - Nome do usuário
   * @param {string} params.code       - Código OTP em plaintext (6 dígitos)
   * @param {string} params.type       - Tipo da operação ('login' | 'saque' | 'kyc' | 'email_verify')
   * @param {number} params.expiresIn  - Validade em segundos
   * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
   */
  sendOTP: async ({ to, userName, code, type, expiresIn }) => {
    // ── Suppression check: destinatário bloqueado por bounces ────────────────
    try {
      const emailDeliveryService = require('./emailDeliveryService');
      if (emailDeliveryService && typeof emailDeliveryService.isRecipientSuppressed === 'function') {
        const suppressed = await emailDeliveryService.isRecipientSuppressed(to);
        if (suppressed) {
          logger.warn('OTP bloqueado: destinatário na suppression list', {
            service: 'emailService', function: 'sendOTP', to, type,
          });
          return { success: false, error: 'recipient_suppressed' };
        }
      }
    } catch (suppressionErr) {
      logger.warn('Falha ao verificar suppression list (prosseguindo)', {
        service: 'emailService', function: 'sendOTP', error: suppressionErr.message,
      });
    }

    // ── Rate limit OTP: max 3 por 15min ─────────────────────────────────────
    try {
      await otpLimiter.consume(to);
    } catch (rlErr) {
      const retryAfterSeconds = rlErr.msBeforeNext ? Math.ceil(rlErr.msBeforeNext / 1000) : 900;
      logger.warn('Rate limit OTP excedido', {
        service: 'emailService', function: 'sendOTP', to, type, retryAfterSeconds,
      });
      return { success: false, error: 'otp_rate_limit_exceeded', retryAfterSeconds };
    }

    const emailTemplates = require('../templates/emails');
    const TYPE_SUBJECTS = {
      login:                 'Seu código de acesso — ElosCloud',
      saque:                 'Confirmação de saque — ElosCloud',
      kyc:                   'Verificação de identidade — ElosCloud',
      email_verify:          'Confirme seu e-mail — ElosCloud',
      recovery_email_verify: 'Confirme seu e-mail de recuperação — ElosCloud',
    };

    const subject = TYPE_SUBJECTS[type] || 'Código de verificação — ElosCloud';
    const html    = emailTemplates.otp({ userName, code, type, expiresIn });
    const text    = `Seu código de verificação ElosCloud: ${code}. Válido por ${Math.round(expiresIn / 60)} minuto(s). Não compartilhe com ninguém.`;

    // OTP é sempre do setor de segurança
    const { fromEmail, fromName, replyTo } = resolveSectorFrom('otp');

    try {
      const info = await sendViaResend({
        from:    `"${fromName}" <${fromEmail}>`,
        to,
        subject,
        html,
        text,
        replyTo,
      });

      logger.info('OTP email enviado', {
        service:  'emailService',
        function: 'sendOTP',
        to,
        type,
        messageId: info.messageId,
      });

      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error('Falha ao enviar OTP email', {
        service:  'emailService',
        function: 'sendOTP',
        to,
        type,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  },

  /**
   * Envia magic link de login por email.
   * @param {Object} params
   * @param {string} params.to - Email do destinatário
   * @param {string} params.userName - Nome do usuário
   * @param {string} params.magicLinkUrl - URL completa do magic link
   * @param {number} params.expiresInMinutes - Validade em minutos
   * @returns {{ success: boolean, messageId?: string, error?: string }}
   */
  sendMagicLink: async ({ to, userName, magicLinkUrl, expiresInMinutes }) => {
    // Suppression check
    try {
      const emailDeliveryService = require('./emailDeliveryService');
      if (emailDeliveryService && typeof emailDeliveryService.isRecipientSuppressed === 'function') {
        const suppressed = await emailDeliveryService.isRecipientSuppressed(to);
        if (suppressed) {
          logger.warn('Magic link bloqueado: destinatário na suppression list', {
            service: 'emailService', function: 'sendMagicLink', to,
          });
          return { success: false, error: 'recipient_suppressed' };
        }
      }
    } catch (suppressionErr) {
      logger.warn('Falha ao verificar suppression list (prosseguindo)', {
        service: 'emailService', function: 'sendMagicLink', error: suppressionErr.message,
      });
    }

    // Rate limit: same as OTP (3 per 15min)
    try {
      await otpLimiter.consume(to);
    } catch (rlErr) {
      const retryAfterSeconds = rlErr.msBeforeNext ? Math.ceil(rlErr.msBeforeNext / 1000) : 900;
      logger.warn('Rate limit magic link excedido', {
        service: 'emailService', function: 'sendMagicLink', to, retryAfterSeconds,
      });
      return { success: false, error: 'otp_rate_limit_exceeded', retryAfterSeconds };
    }

    const emailTemplates = require('../templates/emails');
    const subject = 'Acesse sua conta — ElosCloud';
    const html = emailTemplates.magic_link({ userName, magicLinkUrl, expiresInMinutes });
    const text = `Olá ${userName}! Clique neste link para acessar sua conta ElosCloud: ${magicLinkUrl} — Válido por ${expiresInMinutes} minutos. Não compartilhe com ninguém.`;

    const { fromEmail, fromName, replyTo } = resolveSectorFrom('otp');

    try {
      const info = await sendViaResend({
        from: `"${fromName}" <${fromEmail}>`,
        to,
        subject,
        html,
        text,
        replyTo,
      });

      logger.info('Magic link email enviado', {
        service: 'emailService', function: 'sendMagicLink', to, messageId: info.messageId,
      });

      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error('Falha ao enviar magic link email', {
        service: 'emailService', function: 'sendMagicLink', to, error: error.message,
      });
      return { success: false, error: error.message };
    }
  },

  /**
   * Envia email de transição passwordless (AUTH-PL-006).
   * Sem rate limit agressivo — é batch administrativo, max 1 por user.
   */
  sendPasswordTransition: async ({ to, userName, magicLinkUrl, cutoffDate }) => {
    try {
      const html = emailTemplates.password_transition({ userName, magicLinkUrl, cutoffDate });

      const info = await resend.emails.send({
        from: SENDER,
        to,
        subject: 'Sua conta ficou mais segura — ElosCloud',
        html,
      });

      logger.info('Password transition email enviado', {
        service: 'emailService', function: 'sendPasswordTransition', to, messageId: info?.data?.id,
      });

      return { success: true, messageId: info?.data?.id };
    } catch (error) {
      logger.error('Falha ao enviar password transition email', {
        service: 'emailService', function: 'sendPasswordTransition', to, error: error.message,
      });
      return { success: false, error: error.message };
    }
  },

  sendEmail_legacy: async (to, subject, content, userId, inviteId, type) => {
    logger.warn('Using deprecated email interface', {
      service: 'emailService',
      function: 'sendEmail_legacy',
    });
    
    // Map old parameters to the new format
    return emailService.sendEmail({
      to,
      subject,
      templateType: type || 'padrao',
      data: { content },
      userId,
      reference: inviteId,
      referenceType: 'invite'
    });
  }
};

module.exports = emailService;