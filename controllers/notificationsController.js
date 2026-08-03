/**
 * @fileoverview Controller de notificações - gerencia notificações em tempo real dos usuários
 * @module controllers/notificationsController
 */

const notificationService = require('../services/notificationService');
const pushService = require('../services/pushService');
const { logger } = require('../logger');

/**
 * Busca todas as notificações de um usuário
 * @async
 * @function getUserNotifications
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.uid - ID do usuário
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Lista de notificações do usuário
 */
const getUserNotifications = async (req, res) => {
  const userId = req.uid;
  const limit  = Math.min(parseInt(req.query.limit)  || 50, 200);
  const offset = Math.max(parseInt(req.query.offset)  || 0, 0);

  try {
    const result = await notificationService.getUserNotifications(userId, { limit, offset });
    if (result.success) {
      return res.status(200).json(result.data);
    }
    return res.status(500).json({ message: 'Erro ao obter notificacoes', error: result.message });
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

const getUnreadCount = async (req, res) => {
  const userId = req.uid;
  try {
    const result = await notificationService.getUnreadCount(userId);
    if (result.success) {
      return res.status(200).json({ unreadCount: result.count });
    }
    return res.status(500).json({ message: 'Erro ao contar notificações', error: result.message });
  } catch (error) {
    logger.error('Erro ao contar notificações não lidas', {
      service: 'notificationsController',
      function: 'getUnreadCount',
      userId,
      error: error.message
    });
    return res.status(500).json({ message: 'Erro ao contar notificações', error: error.message });
  }
};

/**
 * Marca uma notificação como lida
 * @async
 * @function markNotificationAsRead
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.userId - ID do usuário
 * @param {string} req.params.notificationId - ID da notificação
 * @param {Object} req.socketManager - Gerenciador de socket (opcional)
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Confirmação da atualização
 */
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

/**
 * Marca todas as notificações de um usuário como lidas
 * @async
 * @function clearAllNotifications
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.userId - ID do usuário
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Confirmação da operação
 */
const clearAllNotifications = async (req, res) => {
  const { userId } = req.params;

  logger.info('Requisicao para limpar todas as notificacoes', {
    service: 'notificationsController',
    function: 'clearAllNotifications',
    userId,
  });

  try {
    const result = await notificationService.clearAllNotifications(userId);
    if (result.success) {
      // Emitir evento de socket para sincronizar outros dispositivos
      if (req.socketManager) {
        req.socketManager.emitToUser(
          userId,
          'clear_notifications',
          { timestamp: Date.now() }
        );
      }

      return res.status(200).json({ message: 'Todas as notificações marcadas como lidas' });
    } else {
      logger.error('Erro ao limpar notificacoes', {
        service: 'notificationsController',
        function: 'clearAllNotifications',
        userId,
        error: result.message,
      });
      return res.status(500).json({ message: 'Erro ao limpar notificações', error: result.message });
    }
  } catch (error) {
    logger.error('Erro ao limpar notificacoes', {
      service: 'notificationsController',
      function: 'clearAllNotifications',
      userId,
      error: error.message,
    });
    return res.status(500).json({ message: 'Erro ao limpar notificações', error: error.message });
  }
};

/**
 * Cria uma nova notificação para um usuário
 * @async
 * @function createNotification
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.userId - ID do usuário destinatário
 * @param {Object} req.body - Dados da notificação
 * @param {Object} req.socketManager - Gerenciador de socket (opcional)
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Confirmação da criação
 */
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

/**
 * Retorna a chave pública VAPID para o frontend (necessária para PushManager.subscribe).
 */
const getVapidPublicKey = async (req, res) => {
  const key = pushService.getVapidPublicKey();
  if (!key) {
    return res.status(503).json({ message: 'VAPID key não configurada' });
  }
  return res.status(200).json({ vapidPublicKey: key });
};

/**
 * Salva uma subscription Web Push (W3C VAPID) para o usuário autenticado.
 */
const savePushToken = async (req, res) => {
  const userId = req.uid;
  const { subscription, deviceName, deviceType } = req.body;

  if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return res.status(400).json({ message: 'Subscription inválida — endpoint e keys (p256dh, auth) obrigatórios' });
  }

  try {
    const result = await pushService.saveSubscription(userId, subscription, {
      deviceName: deviceName || null,
      deviceType: deviceType || 'web',
    });

    if (result.success) {
      return res.status(200).json({ message: 'Subscription salva', subscriptionId: result.subscriptionId });
    }
    return res.status(500).json({ message: 'Erro ao salvar subscription', error: result.error });
  } catch (error) {
    logger.error('Erro ao salvar push subscription', {
      service: 'notificationsController',
      function: 'savePushToken',
      userId,
      error: error.message
    });
    return res.status(500).json({ message: 'Erro ao salvar subscription', error: error.message });
  }
};

/**
 * Remove (desativa) uma subscription Web Push do usuário autenticado.
 */
const removePushToken = async (req, res) => {
  const userId = req.uid;
  const { endpoint } = req.body;

  if (!endpoint || typeof endpoint !== 'string') {
    return res.status(400).json({ message: 'Endpoint inválido' });
  }

  try {
    const result = await pushService.removeSubscription(userId, endpoint);

    if (result.success) {
      return res.status(200).json({ message: 'Subscription removida' });
    }
    return res.status(500).json({ message: 'Erro ao remover subscription', error: result.error });
  } catch (error) {
    logger.error('Erro ao remover push subscription', {
      service: 'notificationsController',
      function: 'removePushToken',
      userId,
      error: error.message
    });
    return res.status(500).json({ message: 'Erro ao remover subscription', error: error.message });
  }
};

module.exports = {
  getUserNotifications,
  getUnreadCount,
  markNotificationAsRead,
  clearAllNotifications,
  createNotification,
  getVapidPublicKey,
  savePushToken,
  removePushToken
};