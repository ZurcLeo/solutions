// controllers/emailController.js
const { logger } = require('../logger');
const emailService = require('../services/emailService');
const Email = require('../models/Email');
const { isAdmin } = require('../middlewares/admin');

/**
 * Send an email using a specific template
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
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
 * Resend an existing email
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
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
 * Get emails sent by the current user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
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
 * Get emails related to a specific reference (inviteId, etc.)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
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
 * Admin endpoint - Get emails by status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object 
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
 * Legacy compatibility method for the old email functionality
 * @param {Object} emailData - Email parameters in the old format
 * @returns {Promise<Object>} Response in the format of the old email service
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