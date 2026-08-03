/**
 * @fileoverview Controller de email - gerencia envio, reenvio e consulta de emails do sistema
 * @module controllers/emailController
 */

const { logger } = require('../logger');
const emailService = require('../services/emailService');
const Email = require('../models/Email');
const { isAdmin } = require('../middlewares/admin');

/**
 * Envia um email usando template específico
 * @async
 * @function sendEmail
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} req.body - Dados do email
 * @param {string} req.body.to - Destinatário
 * @param {string} req.body.subject - Assunto
 * @param {string} req.body.templateType - Tipo de template
 * @param {Object} req.body.data - Dados para o template
 * @param {string} req.body.reference - Referência (opcional)
 * @param {string} req.body.referenceType - Tipo de referência (opcional)
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Resultado do envio
 */
exports.sendEmail = async (req, res) => {
  const { to, subject, templateType, data, reference, referenceType } = req.body;
  const userId = req.user?.uid;
  
  logger.info('Email send request received', {
    service: 'emailController',
    function: 'sendEmail',
    to,
    subject,
    templateType,
    reference
  });
  
  if (!to || !subject || !templateType || !data) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields: to, subject, templateType, or data'
    });
  }
  
  try {
    const result = await emailService.sendEmail({
      to,
      subject,
      templateType,
      data,
      userId,
      reference,
      referenceType
    });
    
    if (result.success) {
      return res.status(200).json({
        success: true,
        messageId: result.messageId,
        emailId: result.emailId
      });
    } else {
      return res.status(500).json({
        success: false,
        message: result.error || 'Failed to send email'
      });
    }
  } catch (error) {
    logger.error('Error in send email controller', {
      service: 'emailController',
      function: 'sendEmail',
      error: error.message
    });
    
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Reenvia um email existente
 * @async
 * @function resendEmail
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.emailId - ID do email a ser reenviado
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Resultado do reenvio
 */
exports.resendEmail = async (req, res) => {
  const { emailId } = req.params;
  const userId = req.user?.uid;
  
  logger.info('Email resend request received', {
    service: 'emailController',
    function: 'resendEmail',
    emailId,
    userId
  });
  
  try {
    // Verify permission - only admin or email owner
    if (!req.user.isAdmin) {
      const email = await Email.getById(emailId);
      if (!email || email.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to resend this email'
        });
      }
    }
    
    const result = await emailService.resendEmail(emailId);
    
    if (result.success) {
      return res.status(200).json({
        success: true,
        messageId: result.messageId,
        emailId: result.emailId
      });
    } else {
      return res.status(500).json({
        success: false,
        message: result.error || 'Failed to resend email'
      });
    }
  } catch (error) {
    logger.error('Error in resend email controller', {
      service: 'emailController',
      function: 'resendEmail',
      emailId,
      error: error.message
    });
    
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Busca emails enviados pelo usuário atual
 * @async
 * @function getUserEmails
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} req.user - Usuário autenticado
 * @param {string} req.user.uid - ID do usuário
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Lista de emails do usuário
 */
exports.getUserEmails = async (req, res) => {
  const userId = req.user.uid;
  
  try {
    const emails = await Email.getByUser(userId);
    
    return res.status(200).json({
      success: true,
      emails
    });
  } catch (error) {
    logger.error('Error getting user emails', {
      service: 'emailController',
      function: 'getUserEmails',
      userId,
      error: error.message
    });
    
    return res.status(500).json({
      success: false,
      message: 'Failed to get user emails',
      error: error.message
    });
  }
};

/**
 * Busca emails relacionados a uma referência específica (convite, etc.)
 * @async
 * @function getEmailsByReference
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.referenceType - Tipo de referência
 * @param {string} req.params.referenceId - ID da referência
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Lista de emails filtrada
 */
exports.getEmailsByReference = async (req, res) => {
  const { referenceType, referenceId } = req.params;
  const userId = req.user.uid;
  
  try {
    const emails = await Email.getByReference(referenceType, referenceId);
    
    // Filter emails for non-admin users
    const filteredEmails = req.user.isAdmin 
      ? emails 
      : emails.filter(email => email.userId === userId);
    
    return res.status(200).json({
      success: true,
      emails: filteredEmails
    });
  } catch (error) {
    logger.error('Error getting emails by reference', {
      service: 'emailController',
      function: 'getEmailsByReference',
      referenceType,
      referenceId,
      error: error.message
    });
    
    return res.status(500).json({
      success: false,
      message: 'Failed to get emails',
      error: error.message
    });
  }
};

/**
 * Endpoint administrativo - busca emails por status
 * @async
 * @function getEmailsByStatus
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.status - Status dos emails
 * @param {Object} req.user - Usuário autenticado
 * @param {boolean} req.user.isAdmin - Indica se é administrador
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Lista de emails por status
 */
exports.getEmailsByStatus = async (req, res) => {
  const { status } = req.params;
  
  // Check if admin
  if (!req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }
  
  try {
    const emails = await Email.getByStatus(status);
    
    return res.status(200).json({
      success: true,
      emails
    });
  } catch (error) {
    logger.error('Error getting emails by status', {
      service: 'emailController',
      function: 'getEmailsByStatus',
      status,
      error: error.message
    });
    
    return res.status(500).json({
      success: false,
      message: 'Failed to get emails',
      error: error.message
    });
  }
};

// ─── Unsubscribe (LGPD) ──────────────────────────────────────────────────────

/**
 * Renderiza página de confirmação de unsubscribe (GET público).
 * Valida HMAC antes de exibir.
 */
exports.renderUnsubscribePage = async (req, res) => {
  const { token, uid, cat } = req.query;

  if (!token || !uid || !cat) {
    return res.status(400).send(_unsubscribePage('Link inválido', 'Os parâmetros necessários estão ausentes.', false));
  }

  const unsubscribeToken = require('../utils/unsubscribeToken');
  if (!unsubscribeToken.verify(token, uid, cat)) {
    return res.status(403).send(_unsubscribePage('Link inválido', 'Este link de cancelamento é inválido ou expirou.', false));
  }

  const CATEGORY_LABELS = {
    payments: 'Financeiro',
    invites: 'Social e Convites',
    pedidos: 'Pedidos e Marketplace',
    messages: 'Mensagens e Suporte',
    caixinhas: 'Caixinhas',
    entregas: 'Entregas',
    mobilidade: 'Mobilidade',
  };

  const label = CATEGORY_LABELS[cat] || cat;
  return res.status(200).send(_unsubscribePage(
    'Cancelar recebimento de emails',
    `Você está prestes a cancelar o recebimento de emails da categoria <strong>${label}</strong>. Emails de segurança (OTP, KYC) continuarão sendo enviados normalmente.`,
    true,
    { token, uid, cat }
  ));
};

/**
 * Processa unsubscribe (POST público).
 * Valida HMAC e atualiza notification_prefs do usuário.
 */
exports.processUnsubscribe = async (req, res) => {
  const { token, uid, cat } = req.body.token ? req.body : req.query;

  if (!token || !uid || !cat) {
    return res.status(400).json({ success: false, error: 'Parâmetros ausentes' });
  }

  const unsubscribeToken = require('../utils/unsubscribeToken');
  if (!unsubscribeToken.verify(token, uid, cat)) {
    return res.status(403).json({ success: false, error: 'Token inválido' });
  }

  try {
    const userPreferencesService = require('../services/userPreferencesService');
    await userPreferencesService.update(uid, 'notification_prefs', {
      events: { [cat]: { email: false } }
    });

    logger.info('Unsubscribe processado com sucesso', {
      service: 'emailController', function: 'processUnsubscribe', uid, cat,
    });

    return res.status(200).send(_unsubscribePage(
      'Email cancelado',
      'Você não receberá mais emails desta categoria. Você pode reativar nas configurações do app.',
      false
    ));
  } catch (error) {
    logger.error('Erro ao processar unsubscribe', {
      service: 'emailController', function: 'processUnsubscribe', uid, cat, error: error.message,
    });
    return res.status(500).json({ success: false, error: 'Erro interno' });
  }
};

/**
 * Gera página HTML mínima para unsubscribe.
 * @private
 */
function _unsubscribePage(title, message, showForm, formData = {}) {
  const formHtml = showForm ? `
    <form method="POST" action="/api/email/unsubscribe" style="margin-top:20px;">
      <input type="hidden" name="token" value="${formData.token || ''}" />
      <input type="hidden" name="uid" value="${formData.uid || ''}" />
      <input type="hidden" name="cat" value="${formData.cat || ''}" />
      <button type="submit" style="background:#d32f2f;color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:16px;cursor:pointer;">
        Confirmar cancelamento
      </button>
    </form>
  ` : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${title} — ElosCloud</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:40px auto;padding:20px;text-align:center;">
  <h2 style="color:#333;">${title}</h2>
  <p style="color:#666;line-height:1.6;">${message}</p>
  ${formHtml}
  <p style="margin-top:32px;font-size:12px;color:#aaa;">ElosCloud — Plataforma Comunitária</p>
</body>
</html>`;
}

/**
 * Método de compatibilidade para funcionalidade legacy de email
 * @async
 * @function sendInviteEmail
 * @param {Object} emailData - Parâmetros do email no formato antigo
 * @param {string} emailData.to - Destinatário
 * @param {string} emailData.subject - Assunto
 * @param {string} emailData.content - Conteúdo
 * @param {string} emailData.userId - ID do usuário
 * @param {string} emailData.inviteId - ID do convite
 * @param {string} emailData.type - Tipo do email
 * @returns {Promise<Object>} Resposta no formato do serviço antigo
 */
exports.sendInviteEmail = async (emailData) => {
  const { to, subject, content, userId, inviteId, type } = emailData;
  
  logger.info('Legacy email send request received', {
    service: 'emailController',
    function: 'sendInviteEmail',
    emailData
  });

  try {
    const result = await emailService.sendEmail_legacy(to, subject, content, userId, inviteId, type);
    
    if (result.success) {
      logger.info('Legacy email sent successfully', {
        service: 'emailController',
        function: 'sendInviteEmail',
        result
      });
      
      return { 
        status: 201, 
        json: { 
          success: true, 
          message: 'E-mail de convite enviado com sucesso:', 
          result 
        } 
      };
    } else {
      logger.error('Error in legacy email sending', {
        service: 'emailController',
        function: 'sendInviteEmail',
        error: result.error
      });
      
      return { 
        status: 500, 
        json: { 
          message: 'Internal server error', 
          error: result.error 
        } 
      };
    }
  } catch (error) {
    logger.error('Error in legacy email controller', {
      service: 'emailController',
      function: 'sendInviteEmail',
      error: error.message
    });
    
    return { 
      status: 500, 
      json: { 
        message: 'Internal server error', 
        error: error.message 
      } 
    };
  }
};