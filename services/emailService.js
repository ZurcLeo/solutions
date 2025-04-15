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



// //services/emailService.js
// const nodemailer = require('nodemailer');
// const { logger } = require('../logger');
// require('dotenv').config();

// const smtpUser = process.env.SMTP_USER;
// const smtpPass = process.env.SMTP_PASS;

// const templateFunctions = {
//   convite: (subject, content) => {
//         return(
//           `<!DOCTYPE html>
// <html lang="en">
// <head>
//   <meta charset="UTF-8">
//   <meta name="viewport" content="width=device-width, initial-scale=1.0">
//   <title>Email Marketing</title>
//   <style>
//     body {
//       font-family: 'Poppins', Arial, sans-serif;
//       background-color: #f4f4f4;
//       margin: 0;
//       padding: 0;
//       -webkit-font-smoothing: antialiased;
//       -moz-osx-font-smoothing: grayscale;
//     }
//     .email-container {
//       max-width: 600px;
//       margin: auto;
//       background-color: rgba(255, 255, 255, 0.95);
//       border: 1px solid #dddddd;
//       border-radius: 8px;
//       overflow: hidden;
//       padding: 20px;
//     }
//     .email-header {
//       background-color: #345C72;
//       color: white;
//       text-align: center;
//       padding: 15px;
//       font-size: 26px;
//       font-weight: bold;
//     }
//     .email-content {
//       padding: 20px;
//       color: #333333;
//     }
//     .email-footer {
//       background-color: #333333;
//       color: white;
//       text-align: center;
//       padding: 15px;
//       font-size: 14px;
//     }
//     .highlight {
//       background-color: #ffcc00;
//       padding: 10px;
//       border-radius: 8px;
//       margin: 20px 0;
//       text-align: center;
//       font-size: 20px;
//       font-weight: bold;
//       color: #333333;
//     }
//     .button {
//       display: block;
//       width: 200px;
//       margin: 20px auto;
//       padding: 10px;
//       background-color: #fd8c5e;
//       color: white;
//       text-align: center;
//       text-decoration: none;
//       border-radius: 5px;
//       font-size: 16px;
//     }
//     @media screen and (max-width: 600px) {
//       .email-container {
//         width: 100% !important;
//         margin: auto;
//         border-radius: 0;
//       }
//       .email-header, .email-content, .email-footer {
//         padding: 10px !important;
//       }
//     }
//   </style>
//   <link rel="preconnect" href="https://fonts.googleapis.com">
//   <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
// <link href="https://fonts.googleapis.com/css2?family=Cabin:ital,wght@0,400..700;1,400..700&display=swap" rel="stylesheet"></head>
// <body>
//   <table width="100%" border="0" cellspacing="0" cellpadding="0">
//     <tr>
//       <td align="center" valign="top" style="padding: 10px;">
//         <table class="email-container" border="0" cellspacing="0" cellpadding="0" style=" background: url('https://storage.googleapis.com/elossolucoescloud-1804e.appspot.com/emailPictures/background_convite_eloscloud.png?GoogleAccessId=firebase-adminsdk-xr3qw%40elossolucoescloud-1804e.iam.gserviceaccount.com&Expires=16447014000&Signature=URAP17re0vhIg8sObSblsd%2FVzk0OQ3lNB67LT6fPqWgZeMFjMcrqfQCs6tAO%2BPaxOB8Iu7DHjLcrDVHc%2Fw0cU%2F6Nw1zC5ay5d%2B993OwhjDLgWW6LIX086xaIHMXFxF8%2FBBUKSiTpFcSHMKfkSc6VY6XH%2FQcBhLzbQElxNO8RvHNugWFZxpXKtYSI1srP0daUOEr2diENDqrfup%2FcqhOC7C%2FtYPoz9qClmAHqHYjJ9ZeFqorh179S32FmuM7tBROQ2cANgNbX%2Fu08%2FgjNEX8SB1eCcCFRDPZ%2B1%2FQqGPu1kJ33Gf1sA5ZUHS5lWzgyxRkOBmcJ2504x7iRUCHZT9OE%2BA%3D%3D'); background-size: cover; opacity: 0.9; background-position: center; color: white;">
//           <tr>
//             <td align="center" valign="top" class="email-header">
//               BILHETE DE EMBARQUE
//             </td>
//           </tr>
//           <tr>
//             <td class="email-content">
//               ${content}
//             </td>
//           </tr>
//           <tr>
//             <td class="email-footer">
//               Copyright &copy; 2024 | ElosCloud
//               <br>
//               <a href="https://eloscloud.com/view-invite" style="color: #ffffff; text-decoration: underline;">Visualizar Convite no Site</a> |
//               <a href="https://eloscloud.com/terms" style="color: #ffffff; text-decoration: underline;">Termos de Uso</a> |
//               <a href="https://eloscloud.com/privacy" style="color: #ffffff; text-decoration: underline;">Política de Privacidade</a>
//               <p style="margin: 10px 0 0 0; font-size: 12px;">
//                 Ao se registrar, alguns de seus dados serão compartilhados com o amigo que o convidou. Mais detalhes nos termos.
//               </p>
//             </td>
//           </tr>
//         </table>
//       </td>
//     </tr>
//   </table>
// </body>
// </html>
//   `);
//   },
//   convite_lembrete: (subject, content) => {
//     return (
//       `<!DOCTYPE html>
//       <html lang="pt-BR">
//       <head>
//         <meta charset="UTF-8">
//         <meta name="viewport" content="width=device-width, initial-scale=1.0">
//         <title>${subject}</title>
//         <style>
//           body {
//             font-family: 'Poppins', Arial, sans-serif;
//             background-color: #f4f4f4;
//             margin: 0;
//             padding: 0;
//             color: #333333;
//           }
//           .email-container {
//             max-width: 600px;
//             margin: auto;
//             background-color: #ffffff;
//             border-radius: 8px;
//             box-shadow: 0px 0px 10px rgba(0, 0, 0, 0.1);
//             overflow: hidden;
//           }
//           .email-header {
//             background-color: #345C72;
//             color: white;
//             text-align: center;
//             padding: 20px;
//             font-size: 24px;
//             font-weight: bold;
//           }
//           .email-body {
//             padding: 20px;
//             font-size: 16px;
//             color: #333333;
//           }
//           .email-body p {
//             margin: 10px 0;
//           }
//           .cta-button {
//             display: block;
//             width: 80%;
//             margin: 20px auto;
//             padding: 12px;
//             background-color: #fd8c5e;
//             color: white;
//             text-align: center;
//             text-decoration: none;
//             border-radius: 6px;
//             font-size: 18px;
//           }
//           .cta-button:hover {
//             background-color: #e57b50;
//           }
//           .highlight {
//             background-color: #ffcc00;
//             padding: 10px;
//             border-radius: 5px;
//             text-align: center;
//             font-weight: bold;
//           }
//           .email-footer {
//             background-color: #333333;
//             color: white;
//             text-align: center;
//             padding: 15px;
//             font-size: 14px;
//           }
//           .email-footer a {
//             color: #ffffff;
//             text-decoration: underline;
//             margin: 0 5px;
//           }
//           @media screen and (max-width: 600px) {
//             .email-container {
//               width: 100% !important;
//             }
//             .email-body {
//               padding: 10px !important;
//             }
//           }
//         </style>
//       </head>
//       <body>
//         <table width="100%" border="0" cellspacing="0" cellpadding="0">
//           <tr>
//             <td align="center" valign="top">
//               <table class="email-container" border="0" cellspacing="0" cellpadding="0">
//                 <tr>
//                   <td class="email-header">
//                     Lembrete de Convite - ElosCloud
//                   </td>
//                 </tr>
//                 <tr>
//                   <td class="email-body">
//                     <p>Olá ${content.friendName},</p>
//                     <p>Você recebeu um convite de <strong>${content.senderName}</strong> para se juntar ao ElosCloud!</p>
//                     <p>Não perca a oportunidade de fazer parte da nossa rede. Clique no botão abaixo para aceitar o convite:</p>
//                     <a href="https://eloscloud.com/invite?inviteId=${content.inviteId}" class="cta-button">Aceitar Convite</a>
//                     <p class="highlight">Este convite é válido por tempo limitado. Não perca!</p>
//                     <p>Atenciosamente,</p>
//                     <p>Equipe ElosCloud</p>
//                   </td>
//                 </tr>
//                 <tr>
//                   <td class="email-footer">
//                     Copyright &copy; 2024 | ElosCloud
//                     <br>
//                     <a href="https://eloscloud.com">Visitar ElosCloud</a> |
//                     <a href="https://eloscloud.com/terms">Termos de Uso</a> |
//                     <a href="https://eloscloud.com/privacy">Política de Privacidade</a>
//                     <p style="font-size: 12px; margin: 10px 0 0 0;">
//                       Ao aceitar o convite, alguns dados serão compartilhados com o remetente. Consulte os termos.
//                     </p>
//                   </td>
//                 </tr>
//               </table>
//             </td>
//           </tr>
//         </table>
//       </body>
//       </html>`
//     );
//   },  
//   padrao: (subject, content) => {
//   return (`
//   <!DOCTYPE html>
//   <html lang="en">
//       <html lang="en">
//       <head>
//         <meta charset="UTF-8">
//         <meta name="viewport" content="width=device-width, initial-scale=1.0">
//         <title>${subject}</title>
//         <style>
//           body {
//             font-family: 'Poppins', Arial, sans-serif;
//             background-color: #f4f4f4;
//             margin: 0;
//             padding: 0;
//             -webkit-font-smoothing: antialiased;
//             -moz-osx-font-smoothing: grayscale;
//           }
//           .email-container {
//             max-width: 600px;
//             margin: auto;
//             background-color: #ffffff;
//             border: 1px solid #dddddd;
//             border-radius: 8px;
//             overflow: hidden;
//             padding: 20px;
//             position: relative;
//           }
//           .email-header {
//             background-color: #345C72;
//             color: white;
//             text-align: center;
//             padding: 15px;
//             font-size: 26px;
//             font-weight: bold;
//           }
//           .email-body {
//             padding: 20px;
//             font-size: 16px;
//             color: #333333;
//             line-height: 1.6;
//             position: relative;
//             z-index: 1;
//           }
//           .email-body a {
//             color: #fff;
//             text-decoration: none;
//           }
//           .email-highlight {
//             background-color: #ffcc00;
//             padding: 10px;
//             border-radius: 8px;
//             margin: 20px 0;
//             text-align: center;
//             font-size: 20px;
//             font-weight: bold;
//             color: #333333;
//           }
//           .email-footer {
//             background-color: #333333;
//             color: white;
//             text-align: center;
//             padding: 15px;
//             font-size: 14px;
//           }
//           .email-background {
//             position: absolute;
//             top: 0;
//             left: 0;
//             width: 100%;
//             height: 100%;
//             background-image: url('https://imgur.com/4kHNVXA.png');
//             background-size: cover;
//             background-position: center;
//             opacity: 0.3;
//             z-index: 0;
//           }
//           .email-button {
//             display: block;
//             width: 200px;
//             margin: 20px auto;
//             padding: 10px;
//             background-color: #345C72;
//             color: white;
//             text-align: center;
//             text-decoration: none;
//             border-radius: 5px;
//             font-size: 16px;
//           }
//           @media screen and (max-width: 600px) {
//             .email-container {
//               width: 100% !important;
//               margin: auto;
//               border-radius: 0;
//             }
//             .email-header, .email-body, .email-footer {
//               padding: 10px !important;
//             }
//           }
//         </style>
//         <link rel="preconnect" href="https://fonts.googleapis.com">
//         <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
//         <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&display=swap" rel="stylesheet">
//       </head>
//       <body>
//         <div class="email-container">
//           <div class="email-background"></div>
//           <div class="email-header">
//             ${subject}
//           </div>
//           <div class="email-body">
//             ${content}
//           </div>
//           <div class="email-footer">
//             Copyright &copy; 2024 | ElosCloud
//             <br>
//             <a href="https://eloscloud.com" style="color: #ffffff; text-decoration: underline;">Visitar ElosCloud</a> |
//             <a href="https://eloscloud.com/terms" style="color: #ffffff; text-decoration: underline;">Termos de Uso</a> |
//             <a href="https://eloscloud.com/privacy" style="color: #ffffff; text-decoration: underline;">Política de Privacidade</a>
//             <p style="margin: 10px 0 0 0; font-size: 12px;">
//               Ao se registrar, alguns de seus dados serão compartilhados com o amigo que o convidou. Mais detalhes nos termos.
//             </p>
//           </div>
//         </div>
//       </body>
//       </html>
//       `);
//   }
// };

// const getEmailTemplate = (subject, content, type) => {
//   logger.info(`:::::::::::::DEBBUG - gettemplate:::::::::::`, {
//     service: 'emailService',
//     function: 'sendEmail',
//   subject,
//   content,
//   type
//   });
//   const templateFunction = templateFunctions[type];
//   if (!templateFunction) {
//     throw new Error(`Unknown email template type: ${type}`);
//   }
//   return templateFunction(subject, content);
// };

//  // Função de envio de e-mail
// const emailService = {
//   sendEmail: async (to, subject, content, userId, inviteId, type) => {
//       // const { to, subject, content, userId, inviteId, type } = req;
//       logger.info(`:::::::::::::DEBBUG:::::::::::`, {
//           service: 'emailService',
//           function: 'sendEmail',
//           to,
//           subject,
//           userId,
//           inviteId,
//           type
//       });

//  // Configuração do transport SMTP usando o Hostinger
//  const transporter = nodemailer.createTransport({
//   host: 'smtp.hostinger.com',
//   port: 465,
//   secure: true,
//   auth: {
//     user: smtpUser,
//     pass: smtpPass
//   },
//   tls: {
//     rejectUnauthorized: true // Permite conexões TLS não autorizadas (caso seja necessário)
//   }
// });

//       logger.info('Configuração do transporte:', transporter); // Verifique a configuração do transporte

//       const htmlContent = getEmailTemplate(subject, content, type);

//       const mailOptions = {
//           from: "'ElosCloud' <suporte@eloscloud.com.br>",
//           to: to,
//           subject: subject,
//           html: htmlContent,
//           attachDataUrls: true,
//           text: content.replace(/<[^>]*>?/gm, '')
//       };

//       try {
//           logger.info(`Enviando email para ${to}`, {
//               service: 'emailService',
//               function: 'sendEmail',
//               to,
//               subject,
//               userId,
//               inviteId,
//               type
//           });

//           const isEmailOK = await transporter.sendMail(mailOptions);

//           if (isEmailOK === true) {
//               logger.info(`Email enviado com sucesso para ${to}`, {
//                   service: 'emailService',
//                   function: 'sendEmail',
//                   to,
//                   subject,
//                   userId,
//                   inviteId,
//                   type
//               });

//               const notificationData = {
//                   userId,
//                   type,
//                   inviteId,
//                   conteudo: `Email enviado para ${to} com sucesso.`,
//                   url: 'https://eloscloud.com'
//               };

//               await Notification.create(notificationData, type, userId);

//               logger.info(`Notificação criada para o usuário ${userId}`, {
//                   service: 'emailService',
//                   function: 'sendEmail',
//                   notificationData
//               });
//           }

//           return { status: true };
//       } catch (error) {
//           logger.error('Erro ao enviar email', {
//               service: 'emailService',
//               function: 'sendEmail',
//               error: error.message,
//               to,
//               subject,
//               userId,
//               inviteId,
//               type
//           });

//           return { status: false, message: `Erro ao criar convite: ${error.message}` };
//       }
//   }
// };
  
//   module.exports = emailService;