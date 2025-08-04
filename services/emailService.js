/**
 * @fileoverview Serviço para envio e gerenciamento de e-mails, utilizando Nodemailer e templates.
 * @module services/emailService
 * @requires nodemailer
 * @requires ../logger
 * @requires ../models/Email
 * @requires ../templates/emails
 * @requires dotenv
 */
const nodemailer = require('nodemailer');
const { logger } = require('../logger');
const Email = require('../models/Email');
const emailTemplates = require('../templates/emails');
require('dotenv').config();

// SMTP configuration
const smtpConfig = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_PORT == 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  tls: {
    rejectUnauthorized: false
  },
  debug: process.env.NODE_ENV !== 'production',
  logger: process.env.NODE_ENV !== 'production'
};

/**
 * Cria e retorna um transportador Nodemailer reutilizável.
 * @private
 * @function createTransporter
 * @returns {Object} Um objeto transportador Nodemailer.
 * @description Configura e inicializa o transportador SMTP para envio de e-mails.
 */
const createTransporter = () => {
  return nodemailer.createTransport(smtpConfig);
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
   * @returns {Promise<Object>} Um objeto com o status de sucesso (`success`), o ID do registro de e-mail no Firestore (`emailId`) e o ID da mensagem SMTP (`messageId`). Em caso de erro, contém `success: false` e uma mensagem de `error`.
   * @throws {Error} Se o template não for encontrado ou ocorrer um erro no envio.
   * @description Registra o e-mail no Firestore, renderiza o conteúdo HTML e de texto simples a partir de um template, e envia o e-mail via SMTP, atualizando o status do registro no banco.
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
    
    try {
      // 2. Create email record in Firestore first
      const emailRecord = await Email.create({
        to,
        subject,
        templateType,
        templateData: data,
        status: 'pending',
        userId,
        reference,
        referenceType
      });
      
      // 3. Render email content from template
      const htmlContent = emailTemplates[templateType](data);
      
      // 4. Create plain text version by stripping HTML
      const textContent = htmlContent.replace(/<[^>]*>?/gm, '');
      
      // 5. Prepare email data
      const mailOptions = {
        from: `"${process.env.EMAIL_FROM_NAME || 'ElosCloud'}" <${process.env.EMAIL_FROM_ADDRESS || 'suporte@eloscloud.com.br'}>`,
        to,
        subject,
        html: htmlContent,
        text: textContent,
        attachDataUrls: true
      };
      
      // 6. Send email
      const transporter = createTransporter();
      const info = await transporter.sendMail(mailOptions);
      
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
      if (params.emailId) {
        await Email.updateStatus(params.emailId, 'error', {
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