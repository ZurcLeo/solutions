// services/emailService.js
const nodemailer = require('nodemailer');
const { logger } = require('../logger');
const Email = require('../models/Email');
const emailTemplates = require('../templates/emails');
require('dotenv').config();

// SMTP configuration
const smtpConfig = {
  host: process.env.SMTP_HOST || 'smtp.hostinger.com',
  port: process.env.SMTP_PORT || 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  tls: {
    rejectUnauthorized: true
  }
};

// Create reusable transporter
const createTransporter = () => {
  return nodemailer.createTransport(smtpConfig);
};

/**
 * Email service to handle all email operations
 */
const emailService = {
  /**
   * Send an email using a template
   * @param {Object} params - Email parameters
   * @param {string} params.to - Recipient email
   * @param {string} params.subject - Email subject
   * @param {string} params.templateType - Template to use (e.g., 'convite', 'welcome')
   * @param {Object} params.data - Data to pass to the template
   * @param {string} [params.userId] - ID of the user sending the email
   * @param {string} [params.reference] - ID of related entity (e.g., inviteId)
   * @param {string} [params.referenceType] - Type of reference (e.g., 'invite')
   * @returns {Promise<Object>} Result with success status and email ID
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
   * Resend an existing email
   * @param {string} emailId - ID of the email to resend
   * @returns {Promise<Object>} Result with success status and new email ID
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
   * Backwards compatibility method for the old interface
   * @deprecated Use the new sendEmail method instead
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