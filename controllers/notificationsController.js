// controllers/notificationController.js
const notificationService = require('../services/notificationService');
const { logger } = require('../logger');

const getUserNotifications = async (req, res) => {
  const userId = req.validatedBody;
  logger.info('Requisicao para obter notificacoes do usuario', {
    service: 'notificationController',
    function: 'getUserNotifications',
    userId
  });

  try {
    const result = await notificationService.getUserNotifications(userId);
    logger.info('Notificacoes obtidas com sucesso', {
      service: 'notificationController',
      function: 'getUserNotifications',
      userId,
      result
    });
    res.status(200).json(result);
  } catch (error) {
    logger.error('Erro ao obter notificacoes do usuario', {
      service: 'notificationController',
      function: 'getUserNotifications',
      userId,
      error: error.message
    });
    res.status(500).json({ message: 'Erro ao obter notificacoes', error: error.message });
  }
};

const markAsRead = async (req, res) => {
  const { userId, notificationId, type } = req.body;
  logger.info('Requisicao para marcar notificacao como lida', {
    service: 'notificationController',
    function: 'markAsRead',
    userId,
    notificationId,
    type
  });

  try {
    const result = await notificationService.markAsRead(userId, notificationId, type);
    logger.info('Notificacao marcada como lida com sucesso', {
      service: 'notificationController',
      function: 'markAsRead',
      userId,
      notificationId,
      type,
      result
    });
    res.status(200).json(result);
  } catch (error) {
    logger.error('Erro ao marcar notificacao como lida', {
      service: 'notificationController',
      function: 'markAsRead',
      userId,
      notificationId,
      type,
      error: error.message
    });
    res.status(500).json({ message: 'Erro ao marcar notificacao como lida', error: error.message });
  }
};

const createNotification = async (req, res) => {
  const { userId, conteudo, type, url } = req;
  logger.info('Requisicao para criar notificacao', {
    service: 'notificationController',
    function: 'createNotification',
    userId,
    conteudo,
    type,
    url
  });

  try {
    const result = await notificationService.createNotification(req);
    logger.info('Notificacao criada com sucesso', {
      service: 'notificationController',
      function: 'createNotification',
      userId,
      conteudo,
      type,
      url,
      result
    });
    res.status(201).json(result);
  } catch (error) {
    logger.error('Erro ao criar notificacao', {
      service: 'notificationController',
      function: 'createNotification',
      userId,
      conteudo,
      type,
      url,
      error: error.message
    });
    res.status(500).json({ message: 'Erro ao criar notificacao', error: error.message });
  }
};

module.exports = {
  getUserNotifications,
  markAsRead,
  createNotification
};