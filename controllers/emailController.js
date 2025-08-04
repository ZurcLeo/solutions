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