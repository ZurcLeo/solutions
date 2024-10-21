// src/controllers/notificationsController.js
const notificationService = require('../services/notificationService');
const { logger } = require('../logger');

const getUserNotifications = async (req, res) => {
  const userId = req.params.userId;
  logger.info('Requisicao para obter notificacoes do usuario', {
    service: 'notificationsController',
    function: 'getUserNotifications',
    userId
  });

  try {
    const result = await notificationService.getUserNotifications(userId);
    if (result.success) {
      logger.info('Notificacoes obtidas com sucesso', {
        service: 'notificationsController',
        function: 'getUserNotifications',
        userId,
        result: result.data
      });
      return res.status(200).json(result.data);
    } else {
      logger.error('Erro ao obter notificacoes do usuario', {
        service: 'notificationsController',
        function: 'getUserNotifications',
        userId,
        error: result.message
      });
      return res.status(500).json({ message: 'Erro ao obter notificacoes', error: result.message });
    }
  } catch (error) {
    logger.error('Erro ao obter notificacoes do usuario', {
      service: 'notificationsController',
      function: 'getUserNotifications',
      userId,
      error: error.message
    });
    return res.status(500).json({ message: 'Erro ao obter notificacoes', error: error.message });
  }
};

const markNotificationAsRead = async (req, res) => {
  const userId = req.params.userId;
  const { notificationId, type } = req.body;
  logger.info('Requisicao para marcar notificacao como lida', {
    service: 'notificationsController',
    function: 'markNotificationAsRead',
    userId,
    notificationId,
    type
  });

  try {
    const result = await notificationService.markAsRead(userId, notificationId, type);
    if (result.success) {
      logger.info('Notificacao marcada como lida com sucesso', {
        service: 'notificationsController',
        function: 'markNotificationAsRead',
        userId,
        notificationId
      });
      return res.status(200).json({ message: 'Notificação marcada como lida' });
    } else {
      logger.error('Erro ao marcar notificacao como lida', {
        service: 'notificationsController',
        function: 'markNotificationAsRead',
        userId,
        notificationId,
        error: result.message
      });
      return res.status(500).json({ message: 'Erro ao marcar notificacao como lida', error: result.message });
    }
  } catch (error) {
    logger.error('Erro ao marcar notificacao como lida', {
      service: 'notificationsController',
      function: 'markNotificationAsRead',
      userId,
      notificationId,
      error: error.message
    });
    return res.status(500).json({ message: 'Erro ao marcar notificacao como lida', error: error.message });
  }
};

const createNotification = async (req, res) => {
  const userId = req.params.userId;
  const notificationData = req.body;
  logger.info('Requisicao para criar notificacao', {
    service: 'notificationsController',
    function: 'createNotification',
    userId,
    notificationData
  });

  try {
    const result = await notificationService.createNotification(userId, notificationData);
    if (result.success) {
      logger.info('Notificacao criada com sucesso', {
        service: 'notificationsController',
        function: 'createNotification',
        userId,
        notificationData
      });
      return res.status(200).json({ message: 'Notificação criada com sucesso' });
    } else {
      logger.error('Erro ao criar notificacao', {
        service: 'notificationsController',
        function: 'createNotification',
        userId,
        error: result.message
      });
      return res.status(500).json({ message: 'Erro ao criar notificacao', error: result.message });
    }
  } catch (error) {
    logger.error('Erro ao criar notificacao', {
      service: 'notificationsController',
      function: 'createNotification',
      userId,
      error: error.message
    });
    return res.status(500).json({ message: 'Erro ao criar notificacao', error: error.message });
  }
};

module.exports = {
  getUserNotifications,
  markNotificationAsRead,
  createNotification
};