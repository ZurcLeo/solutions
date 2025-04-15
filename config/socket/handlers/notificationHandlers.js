/**
 * notificationHandlers.js
 * Manipuladores de eventos relacionados a notificações no sistema de socket.
 * Estes handlers processam eventos de socket relacionados a notificações e interagem 
 * com o serviço de notificações para executar a lógica de negócios.
 */

const { logger } = require('../../../logger');
const socketManager = require('../socketManager');
const { NOTIFICATION_EVENTS } = require('../socketEvents');
const notificationService = require('../../../services/notificationService'); // Adapte ao caminho real

/**
 * Registra todos os handlers de notificações para um socket
 * @param {SocketIO.Socket} socket - Socket do cliente
 * @param {string} userId - ID do usuário autenticado
 */
function registerNotificationHandlers(socket, userId) {
  if (!socket || !userId) {
    logger.error('Tentativa de registrar handlers de notificação sem socket ou userId válidos', {
      service: 'socket',
      function: 'registerNotificationHandlers',
      socketId: socket?.id,
      userId
    });
    return;
  }

  // Quando o cliente solicita marcar uma notificação como lida
  socket.on(NOTIFICATION_EVENTS.NOTIFICATION_READ, async (notificationData) => {
    try {
      // Validar dados recebidos
      if (!notificationData || !notificationData.notificationId) {
        logger.warn('Dados de notificação inválidos recebidos', {
          service: 'socket',
          function: 'markNotificationRead',
          userId,
          data: notificationData
        });
        return;
      }

      logger.info('Solicitação para marcar notificação como lida', {
        service: 'socket',
        function: 'markNotificationRead',
        userId,
        notificationId: notificationData.notificationId
      });

      // Chamar o serviço para marcar notificação como lida
      try {
        await notificationService.markAsRead(notificationData.notificationId, userId);
        
        // Responder com confirmação ao mesmo cliente (mesmo socket)
        socket.emit(NOTIFICATION_EVENTS.NOTIFICATION_READ, {
          success: true,
          notificationId: notificationData.notificationId,
          timestamp: Date.now()
        });
        
        // Sincronizar com outros dispositivos do mesmo usuário
        socketManager.emitToUser(userId, NOTIFICATION_EVENTS.NOTIFICATION_READ, {
          notificationId: notificationData.notificationId,
          timestamp: Date.now()
        });
        
      } catch (error) {
        logger.error('Erro ao marcar notificação como lida', {
          service: 'socket',
          function: 'markNotificationRead',
          userId,
          notificationId: notificationData.notificationId,
          error: error.message
        });
        
        // Informar erro ao cliente
        socket.emit(NOTIFICATION_EVENTS.NOTIFICATION_READ, {
          success: false,
          notificationId: notificationData.notificationId,
          error: 'Erro ao marcar notificação como lida'
        });
      }
    } catch (error) {
      logger.error('Erro ao processar notification_read', {
        service: 'socket',
        function: 'markNotificationRead',
        userId,
        error: error.message
      });
    }
  });

  // Quando o cliente solicita limpar todas as notificações
  socket.on(NOTIFICATION_EVENTS.CLEAR_NOTIFICATIONS, async () => {
    try {
      logger.info('Solicitação para limpar todas as notificações', {
        service: 'socket',
        function: 'clearNotifications',
        userId
      });

      // Chamar o serviço para limpar todas as notificações
      try {
        await notificationService.clearAll(userId);
        
        // Responder com confirmação ao mesmo cliente
        socket.emit(NOTIFICATION_EVENTS.CLEAR_NOTIFICATIONS, {
          success: true,
          timestamp: Date.now()
        });
        
        // Sincronizar com outros dispositivos do mesmo usuário
        socketManager.emitToUser(userId, NOTIFICATION_EVENTS.CLEAR_NOTIFICATIONS, {
          timestamp: Date.now()
        });
        
      } catch (error) {
        logger.error('Erro ao limpar notificações', {
          service: 'socket',
          function: 'clearNotifications',
          userId,
          error: error.message
        });
        
        // Informar erro ao cliente
        socket.emit(NOTIFICATION_EVENTS.CLEAR_NOTIFICATIONS, {
          success: false,
          error: 'Erro ao limpar notificações'
        });
      }
    } catch (error) {
      logger.error('Erro ao processar clear_notifications', {
        service: 'socket',
        function: 'clearNotifications',
        userId,
        error: error.message
      });
    }
  });

  /**
   * Método auxiliar para enviar nova notificação para um usuário específico
   * Usado internamente pelo sistema, não um handler de evento
   */
  function sendNotificationToUser(targetUserId, notificationData) {
    if (!targetUserId || !notificationData) return false;
    
    try {
      // Verificar se o usuário alvo está online
      if (socketManager.isUserOnline(targetUserId)) {
        // Enviar notificação em tempo real
        socketManager.emitToUser(
          targetUserId,
          NOTIFICATION_EVENTS.NEW_NOTIFICATION,
          notificationData
        );
        
        logger.info('Notificação enviada em tempo real', {
          service: 'socket',
          function: 'sendNotificationToUser',
          targetUserId,
          notificationId: notificationData.id || 'unknown'
        });
        
        return true;
      } else {
        logger.info('Usuário offline, notificação armazenada para entrega posterior', {
          service: 'socket',
          function: 'sendNotificationToUser',
          targetUserId,
          notificationId: notificationData.id || 'unknown'
        });
        
        return false;
      }
    } catch (error) {
      logger.error('Erro ao enviar notificação para usuário', {
        service: 'socket',
        function: 'sendNotificationToUser',
        targetUserId,
        error: error.message
      });
      
      return false;
    }
  }

  // Expor método para outros componentes do sistema
  socket.notificationUtils = {
    sendNotificationToUser
  };
}

/**
 * Envia uma notificação em tempo real para um usuário específico
 * @param {string} userId - ID do usuário alvo
 * @param {Object} notification - Dados da notificação
 * @returns {boolean} Sucesso do envio
 */
function sendRealTimeNotification(userId, notification) {
  if (!userId || !notification) return false;
  
  return socketManager.emitToUser(
    userId,
    NOTIFICATION_EVENTS.NEW_NOTIFICATION,
    notification
  );
}

// Exportar o registro de handlers e também funções utilitárias
module.exports = {
  registerNotificationHandlers,
  sendRealTimeNotification
};