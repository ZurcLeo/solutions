// services/notificationService.js
const { FieldValue } = require('firebase-admin/firestore');
const { logger } = require('../logger');
const Notification = require('../models/Notification');
const User = require('../models/User');

const getUserNotifications = async (userId) => {
  logger.info('Obtendo notificações do usuário', {
    service: 'notificationService',
    function: 'getUserNotifications',
    userId
  });
  
  try {
    const data = await Notification.getUserNotifications(userId);
    logger.info('Notificações obtidas com sucesso', {
      service: 'notificationService',
      function: 'getUserNotifications',
      userId,
      data
    });
    return { success: true, data };
  } catch (error) {
    logger.error(`Error getting user notifications: ${error.message}`, {
      service: 'notificationService',
      function: 'getUserNotifications',
      userId
    });
    return { success: false, message: `Error getting user notifications: ${error.message}` };
  }
};

const markAsRead = async (userId, notificationId, type) => {
  logger.info('Marcando notificação como lida', {
    service: 'notificationService',
    function: 'markAsRead',
    userId,
    notificationId,
    type
  });

  try {
    const data = type === 'global' ? { [`lida.${userId}`]: FieldValue.serverTimestamp() } : { lidaEm: FieldValue.serverTimestamp() };
    const notification = await Notification.update(notificationId, data, userId, type);
    logger.info('Notificação marcada como lida com sucesso', {
      service: 'notificationService',
      function: 'markAsRead',
      userId,
      notificationId,
      type,
      data: notification
    });
    return { success: true, message: 'Notification marked as read successfully', data: notification };
  } catch (error) {
    logger.error('Error updating notification', {
      service: 'notificationService',
      function: 'markAsRead',
      userId,
      notificationId,
      type,
      error: error.message
    });
    return { success: false, message: `Error updating notification: ${error.message}` };
  }
};

const createNotification = async (data) => {
  logger.info('Criando notificação', {
    service: 'notificationService',
    function: 'createNotification',
    data
  });
  const { userId, type, conteudo, url } = data;
  logger.info('imprimindo data.userId no create notification', userId)

  try {
    let fotoDoPerfil;
    if (type === 'global') {
      fotoDoPerfil = process.env.CLAUD_PROFILE_IMG;
    } else {
      try {
        const user = await User.getById(userId);
        if (!user) {
          throw new Error('User not found');
        }
        fotoDoPerfil = user.fotoDoPerfil;
      } catch (userError) {
        logger.error('Erro ao buscar usuário', {
          service: 'notificationService',
          function: 'createNotification',
          error: userError.message
        });
        throw userError;
      }
    }

    logger.info('Foto de perfil obtida', {
      service: 'notificationService',
      function: 'createNotification',
      fotoDoPerfil
    });

    const notificationData = { ...data, fotoDoPerfil };
    logger.info('Dados completos da notificação', {
      service: 'notificationService',
      function: 'createNotification',
      notificationData
    });

    const notification = await Notification.create(notificationData);
    logger.info('Notificação criada com sucesso', {
      service: 'notificationService',
      function: 'createNotification',
      notification
    });
    return { success: true };
  } catch (error) {
    logger.error('Erro ao criar notificação', {
      service: 'notificationService',
      function: 'createNotification',
      error: error.message
    });
    return { success: false };
  }
};

module.exports = {
  getUserNotifications,
  markAsRead,
  createNotification
};