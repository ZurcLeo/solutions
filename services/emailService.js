//services/emailService.js
const nodemailer = require('nodemailer');
const { logger } = require('../logger');
require('dotenv').config();

const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;

const transporter = nodemailer.createTransport({
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    auth: {
        user: smtpUser,
        pass: smtpPass
    },
    tls: {
        ciphers: 'SSLv3'
    }
});

const templateFunctions = {
  convite: (subject, content) => {
        return(
          `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Marketing</title>
  <style>
    body {
      font-family: 'Poppins', Arial, sans-serif;
      background-color: #f4f4f4;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    .email-container {
      max-width: 600px;
      margin: auto;
      background-color: rgba(255, 255, 255, 0.95);
      border: 1px solid #dddddd;
      border-radius: 8px;
      overflow: hidden;
      padding: 20px;
    }
    .email-header {
      background-color: #345C72;
      color: white;
      text-align: center;
      padding: 15px;
      font-size: 26px;
      font-weight: bold;
    }
    .email-content {
      padding: 20px;
      color: #333333;
    }
    .email-footer {
      background-color: #333333;
      color: white;
      text-align: center;
      padding: 15px;
      font-size: 14px;
    }
    .highlight {
      background-color: #ffcc00;
      padding: 10px;
      border-radius: 8px;
      margin: 20px 0;
      text-align: center;
      font-size: 20px;
      font-weight: bold;
      color: #333333;
    }
    .button {
      display: block;
      width: 200px;
      margin: 20px auto;
      padding: 10px;
      background-color: #fd8c5e;
      color: white;
      text-align: center;
      text-decoration: none;
      border-radius: 5px;
      font-size: 16px;
    }
    @media screen and (max-width: 600px) {
      .email-container {
        width: 100% !important;
        margin: auto;
        border-radius: 0;
      }
      .email-header, .email-content, .email-footer {
        padding: 10px !important;
      }
    }
  </style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cabin:ital,wght@0,400..700;1,400..700&display=swap" rel="stylesheet"></head>
<body>
  <table width="100%" border="0" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" valign="top" style="padding: 10px;">
        <table class="email-container" border="0" cellspacing="0" cellpadding="0" style=" background: url('https://storage.googleapis.com/elossolucoescloud-1804e.appspot.com/emailPictures/background_passport_eloscloud.png?GoogleAccessId=firebase-adminsdk-xr3qw%40elossolucoescloud-1804e.iam.gserviceaccount.com&Expires=16447014000&Signature=mpnEi9BiyObz8hV49hynk4TDpys9NP%2BO9LQIRBWHQbBVtbztYYln2sN2Id9P0qyW6sfBaWrcgWuBTtRkxmqJBgJMxBPoCJbK3q1r35guGIB72J7YMsxIlU30XXc%2F7Iz45XdLkiDWwK9xbmBq%2F6dTViiGV%2By3Zm%2FS0%2Brw%2FiOG12XP3uMeFD3%2BrL%2FRAX9vM2bDwNxCoJIZIXEt9uuqGGDIKgBZPoPNyIXygupchW63hSis%2BdiRHlK3M0uHej3XLqV5nOFZmRDiKjMBLKs3dpnctqzUw0CjIX%2BTy66YkhC6nIQFviI9U4Tz5ZzJ4HrTMh33JSxgUB0YNJjQwnzja8mk%2Bg%3D%3D'); background-size: cover; background-position: center; color: white;">
          <tr>
            <td align="center" valign="top" class="email-header">
              BILHETE DE EMBARQUE
            </td>
          </tr>
          <tr>
            <td class="email-content">
              ${content}
            </td>
          </tr>
          <tr>
            <td class="email-footer">
              Copyright &copy; 2024 | ElosCloud
              <br>
              <a href="https://eloscloud.com/view-invite" style="color: #ffffff; text-decoration: underline;">Visualizar Convite no Site</a> |
              <a href="https://eloscloud.com/terms" style="color: #ffffff; text-decoration: underline;">Termos de Uso</a> |
              <a href="https://eloscloud.com/privacy" style="color: #ffffff; text-decoration: underline;">Política de Privacidade</a>
              <p style="margin: 10px 0 0 0; font-size: 12px;">
                Ao se registrar, alguns de seus dados serão compartilhados com o amigo que o convidou. Mais detalhes nos termos.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `);
  },
  padrao: (subject, content) => {
  return (`
  <!DOCTYPE html>
  <html lang="en">
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
        <style>
          body {
            font-family: 'Poppins', Arial, sans-serif;
            background-color: #f4f4f4;
            margin: 0;
            padding: 0;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }
          .email-container {
            max-width: 600px;
            margin: auto;
            background-color: #ffffff;
            border: 1px solid #dddddd;
            border-radius: 8px;
            overflow: hidden;
            padding: 20px;
            position: relative;
          }
          .email-header {
            background-color: #345C72;
            color: white;
            text-align: center;
            padding: 15px;
            font-size: 26px;
            font-weight: bold;
          }
          .email-body {
            padding: 20px;
            font-size: 16px;
            color: #333333;
            line-height: 1.6;
            position: relative;
            z-index: 1;
          }
          .email-body a {
            color: #fff;
            text-decoration: none;
          }
          .email-highlight {
            background-color: #ffcc00;
            padding: 10px;
            border-radius: 8px;
            margin: 20px 0;
            text-align: center;
            font-size: 20px;
            font-weight: bold;
            color: #333333;
          }
          .email-footer {
            background-color: #333333;
            color: white;
            text-align: center;
            padding: 15px;
            font-size: 14px;
          }
          .email-background {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: url('https://imgur.com/4kHNVXA.png');
            background-size: cover;
            background-position: center;
            opacity: 0.3;
            z-index: 0;
          }
          .email-button {
            display: block;
            width: 200px;
            margin: 20px auto;
            padding: 10px;
            background-color: #345C72;
            color: white;
            text-align: center;
            text-decoration: none;
            border-radius: 5px;
            font-size: 16px;
          }
          @media screen and (max-width: 600px) {
            .email-container {
              width: 100% !important;
              margin: auto;
              border-radius: 0;
            }
            .email-header, .email-body, .email-footer {
              padding: 10px !important;
            }
          }
        </style>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&display=swap" rel="stylesheet">
      </head>
      <body>
        <div class="email-container">
          <div class="email-background"></div>
          <div class="email-header">
            ${subject}
          </div>
          <div class="email-body">
            ${content}
          </div>
          <div class="email-footer">
            Copyright &copy; 2024 | ElosCloud
            <br>
            <a href="https://eloscloud.com" style="color: #ffffff; text-decoration: underline;">Visitar ElosCloud</a> |
            <a href="https://eloscloud.com/terms" style="color: #ffffff; text-decoration: underline;">Termos de Uso</a> |
            <a href="https://eloscloud.com/privacy" style="color: #ffffff; text-decoration: underline;">Política de Privacidade</a>
            <p style="margin: 10px 0 0 0; font-size: 12px;">
              Ao se registrar, alguns de seus dados serão compartilhados com o amigo que o convidou. Mais detalhes nos termos.
            </p>
          </div>
        </div>
      </body>
      </html>
      `);
  }
};

const getEmailTemplate = (subject, content, type) => {
  logger.info(`:::::::::::::DEBBUG - gettemplate:::::::::::`, {
    service: 'emailService',
    function: 'sendEmail',
  subject,
  content,
  type
  });
  const templateFunction = templateFunctions[type];
  if (!templateFunction) {
    throw new Error(`Unknown email template type: ${type}`);
  }
  return templateFunction(subject, content);
};

  const emailService = {
    sendEmail: async (req) => {
      const { to, subject, content, userId, inviteId, type } = req;
      logger.info(`:::::::::::::DEBBUG:::::::::::`, {
        service: 'emailService',
        function: 'sendEmail',
        to,
        subject,
        userId,
        inviteId,
        type
      });
      const htmlContent = getEmailTemplate(subject, content, type);
  
      const mailOptions = {
        from: "'ElosCloud' <suporte@eloscloud.com.br>",
        to: to,
        subject: subject,
        html: htmlContent,
        attachDataUrls: true,
        text: content.replace(/<[^>]*>?/gm, '')
      };
  
      try {
        logger.info(`Enviando email para ${to}`, {
          service: 'emailService',
          function: 'sendEmail',
          to,
          subject,
          userId,
          inviteId,
          type
        });
  
        const isEmailOK = await transporter.sendMail(mailOptions);
  
        if (isEmailOK === true) {
          logger.info(`Email enviado com sucesso para ${to}`, {
            service: 'emailService',
            function: 'sendEmail',
            to,
            subject,
            userId,
            inviteId,
            type
          });
  
          const notificationData = {
            userId,
            type,
            inviteId,
            conteudo: `Email enviado para ${to} com sucesso.`,
            url: 'https://eloscloud.com'
          };

          logger.info(`Criando notifição com:
             >>>>userId<<<<: ${userId},
             >>>>type<<<< ${type},
             >>>>inviteId<<<< ${inviteId},
             >>>>conteudo<<<< ${conteudo},
             >>>>url<<<< ${url}`, {
            service: 'emailService',
            function: 'sendEmail',
            notificationData
          });
  
          await Notification.create(notificationData, type, userId);
  
          logger.info(`Notificação criada para o usuário ${userId}`, {
            service: 'emailService',
            function: 'sendEmail',
            notificationData
          });
        }
  
        return { status: true };
      } catch (error) {
        logger.error('Erro ao enviar email', {
          service: 'emailService',
          function: 'sendEmail',
          error: error.message,
          to,
          subject,
          userId,
          inviteId,
          type
        });
  
        return { status: false, message: `Erro ao criar convite: ${error.message}` };
      }
    }
  };
  
  module.exports = emailService;