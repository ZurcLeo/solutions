// src/controllers/notificationsController.js
const notificationService = require('../services/notificationService');
const { logger } = require('../logger');

const getUserNotifications = async (req, res) => {
  const userId = req.uid;
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
        userId
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
  const { userId, notificationId } = req.params;

  logger.info('Requisicao para marcar notificacao como lida', {
    service: 'notificationsController',
    function: 'markNotificationAsRead',
    userId,
    notificationId,
  });

  try {
    const result = await notificationService.markAsRead(userId, notificationId);
    if (result.success) {
      logger.info('Notificacao marcada como lida com sucesso', {
        service: 'notificationsController',
        function: 'markNotificationAsRead',
        userId,
        notificationId
      });
      
      // Emitir evento de socket para sincronizar outros dispositivos do usuário
      if (req.socketManager) {
        req.socketManager.emitToUser(
          userId, 
          'notification_read', 
          { notificationId, timestamp: Date.now() }
        );
      }
      
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
      
      // Emitir evento de socket para o usuário
      if (req.socketManager && result.data) {
        const socketResult = req.socketManager.emitToUser(
          userId, 
          'new_notification', 
          result.data
        );
        
        logger.info('Notificação emitida via socket', {
          service: 'notificationsController',
          function: 'createNotification',
          userId,
          socketSuccess: socketResult
        });
      }
      
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