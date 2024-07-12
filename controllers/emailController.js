// controllers/emailController.js
const { logger } = require('../logger');
const { sendEmail } = require('../services/emailService');

exports.sendInviteEmail = async (emailData) => {
  const { to, subject, content, userId, inviteId, type } = emailData;
  console.log('emailData em emailcontroller: ', emailData)

  logger.info('Requisição em send invite email no controlador de emails', {
    service: 'emailController',
    function: 'sendInviteEmail',
    emailData
  });

  try {
    const result = await sendEmail(to, subject, content, userId, inviteId, type);
    if (result === true) {
      logger.info('Email enviado com sucesso', {
        service: 'emailController',
        function: 'sendInviteEmail',
        result
      });
      return { status: 201, json: { success: true, message: 'E-mail de convite enviado com sucesso:', result } };
    }
  } catch (error) {
    logger.error('Erro ao enviar convite', {
      service: 'emailController',
      function: 'sendInviteEmail',
      error: error.message
    });
    return { status: 500, json: { message: 'Internal server error', error: error.message } };
  }
};
