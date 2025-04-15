/**
 * messageHandlers.js
 * Manipuladores de eventos relacionados a mensagens no sistema de socket.
 * Estes handlers processam eventos de socket relacionados a mensagens e interagem 
 * com o serviço de mensagens para executar a lógica de negócios.
 */

const { logger } = require('../../../logger');
const socketManager = require('../socketManager');
const { MESSAGE_EVENTS, CHAT_ROOM_EVENTS, TYPING_EVENTS } = require('../socketEvents');
const messageService = require('../../../services/messageService'); // Adapte ao caminho real do serviço

/**
 * Registra todos os handlers de mensagens para um socket
 * @param {SocketIO.Socket} socket - Socket do cliente
 * @param {string} userId - ID do usuário autenticado
 */
function registerMessageHandlers(socket, userId) {
  if (!socket || !userId) {
    logger.error('Tentativa de registrar handlers de mensagem sem socket ou userId válidos', {
      service: 'socket',
      function: 'registerMessageHandlers',
      socketId: socket?.id,
      userId
    });
    return;
  }

  // Handler para entrar em uma sala de chat (conversação)
  socket.on(CHAT_ROOM_EVENTS.JOIN_CHAT, async (conversationId) => {
    try {
      if (!conversationId) {
        socket.emit(CHAT_ROOM_EVENTS.JOIN_ERROR, { 
          error: 'ID de conversação inválido',
          conversationId 
        });
        return;
      }

      logger.info('Usuário entrando em sala de chat', {
        service: 'socket',
        function: 'joinChat',
        userId,
        conversationId
      });

      // Adicionar socket à sala do Socket.IO
      socket.join(conversationId);
      
      // Registrar usuário na sala via socketManager
      socketManager.addUserToRoom(userId, conversationId);
      
      // Marcar mensagens como lidas ao entrar na sala (opcional)
      try {
        await messageService.markMessagesAsRead(conversationId, userId);
        logger.info('Mensagens marcadas como lidas ao entrar na sala', {
            service: 'socket',
            function: 'joinChat',
            userId,
            conversationId
          });
      } catch (error) {
        logger.warn('Erro ao marcar mensagens como lidas', {
          service: 'socket',
          function: 'joinChat',
          userId,
          conversationId,
          error: error.message
        });
      }

      // Notificar sucesso ao cliente
      socket.emit(CHAT_ROOM_EVENTS.JOIN_SUCCESS, { conversationId });
      
      // Notificar outros na sala que o usuário entrou (opcional)
      socket.to(conversationId).emit(CHAT_ROOM_EVENTS.USER_JOINED, {
        userId,
        conversationId,
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error('Erro ao processar join_chat', {
        service: 'socket',
        function: 'joinChat',
        userId,
        conversationId,
        error: error.message
      });
      
      socket.emit(CHAT_ROOM_EVENTS.JOIN_ERROR, {
        error: 'Erro ao entrar na sala',
        conversationId
      });
    }
  });

  // Handler para sair de uma sala de chat
  socket.on(CHAT_ROOM_EVENTS.LEAVE_CHAT, (conversationId) => {
    try {
      if (!conversationId) return;

      logger.info('Usuário saindo de sala de chat', {
        service: 'socket',
        function: 'leaveChat',
        userId,
        conversationId
      });

      // Remover socket da sala
      socket.leave(conversationId);
      
      // Remover usuário da sala via socketManager
      socketManager.removeUserFromRoom(userId, conversationId);
      
      // Notificar outros na sala que o usuário saiu (opcional)
      socket.to(conversationId).emit(CHAT_ROOM_EVENTS.USER_LEFT, {
        userId,
        conversationId,
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error('Erro ao processar leave_chat', {
        service: 'socket',
        function: 'leaveChat',
        userId,
        conversationId,
        error: error.message
      });
    }
  });

  // Handler para receber e processar novas mensagens
  socket.on(MESSAGE_EVENTS.SEND_MESSAGE, async (messageData) => {
    try {
      // Validar dados da mensagem
      if (!messageData || !messageData.content || !messageData.recipient) {
        socket.emit(MESSAGE_EVENTS.MESSAGE_SEND_FAILED, {
          error: 'Dados da mensagem inválidos',
          temporaryId: messageData?.temporaryId
        });
        return;
      }

      logger.info('Nova mensagem recebida via socket', {
        service: 'socket',
        function: 'sendMessage',
        sender: userId,
        recipient: messageData.recipient,
        temporaryId: messageData.temporaryId
      });

      // Adicionar campos necessários à mensagem
      const enhancedMessage = {
        ...messageData,
        sender: userId,
        timestamp: messageData.timestamp || new Date().toISOString()
      };

      // Persistir a mensagem usando o serviço
      try {
        const savedMessage = await messageService.createMessage({
          uidDestinatario: messageData.recipient,
          conteudo: messageData.content,
          tipo: messageData.type || 'text'
        });

        // Determinar o ID da conversação (consistente com o frontend)
        const conversationId = [userId, messageData.recipient].sort().join('_');

        // Adaptar mensagem salva para o formato esperado pelo cliente
        const formattedMessage = {
          id: savedMessage.id,
          conversationId,
          sender: userId,
          recipient: messageData.recipient,
          content: savedMessage.conteudo,
          type: savedMessage.tipo,
          timestamp: savedMessage.timestamp,
          status: {
            delivered: true,
            read: false
          }
        };

        // Se houver um ID temporário, enviar evento de reconciliação
        if (messageData.temporaryId) {
          socket.emit(MESSAGE_EVENTS.RECONCILE_MESSAGE, {
            temporaryId: messageData.temporaryId,
            permanentMessage: formattedMessage
          });
        }

        // Emitir para todos os sockets na sala (incluindo o remetente para multi-dispositivos)
        socketManager.emitToRoom(conversationId, MESSAGE_EVENTS.NEW_MESSAGE, formattedMessage);

        // Registrar sucesso
        logger.info('Mensagem processada e distribuída com sucesso', {
          service: 'socket',
          function: 'sendMessage',
          messageId: savedMessage.id,
          conversationId
        });
      } catch (error) {
        logger.error('Erro ao salvar mensagem', {
          service: 'socket',
          function: 'sendMessage',
          error: error.message,
          messageData: enhancedMessage
        });

        // Notificar falha ao cliente
        socket.emit(MESSAGE_EVENTS.MESSAGE_SEND_FAILED, {
          error: 'Erro ao processar mensagem',
          temporaryId: messageData.temporaryId
        });
      }
    } catch (error) {
      logger.error('Erro ao processar evento send_message', {
        service: 'socket',
        function: 'sendMessage',
        userId,
        error: error.message
      });

      socket.emit(MESSAGE_EVENTS.MESSAGE_SEND_FAILED, {
        error: 'Erro interno ao processar mensagem',
        temporaryId: messageData?.temporaryId
      });
    }
  });

  // Handler para atualização de status de mensagem (lida, entregue)
  socket.on(MESSAGE_EVENTS.MESSAGE_STATUS_UPDATE, async (statusData) => {
    try {
      // Validar dados
      if (!statusData || !statusData.conversationId || !statusData.messageId || !statusData.status) {
        return;
      }

      logger.info('Atualização de status de mensagem recebida', {
        service: 'socket',
        function: 'updateMessageStatus',
        userId,
        messageId: statusData.messageId,
        status: statusData.status
      });

      // Atualizar status via serviço
      try {
        await messageService.updateMessageStatus(
          statusData.conversationId,
          statusData.messageId,
          { [statusData.status]: true }
        );

        // Transmitir atualização para todos na sala
        socketManager.emitToRoom(statusData.conversationId, MESSAGE_EVENTS.MESSAGE_STATUS_UPDATE, {
          conversationId: statusData.conversationId,
          messageId: statusData.messageId,
          status: statusData.status,
          updatedBy: userId,
          timestamp: Date.now()
        });
      } catch (error) {
        logger.error('Erro ao atualizar status da mensagem', {
          service: 'socket',
          function: 'updateMessageStatus',
          statusData,
          error: error.message
        });
      }
    } catch (error) {
      logger.error('Erro ao processar message_status_update', {
        service: 'socket',
        function: 'updateMessageStatus',
        userId,
        error: error.message
      });
    }
  });

  // Handler para exclusão de mensagem
  socket.on(MESSAGE_EVENTS.DELETE_MESSAGE, async (deleteData) => {
    try {
      // Validar dados
      if (!deleteData || !deleteData.conversationId || !deleteData.messageId) {
        return;
      }

      logger.info('Solicitação de exclusão de mensagem recebida', {
        service: 'socket',
        function: 'deleteMessage',
        userId,
        messageId: deleteData.messageId
      });

      // Verificar se o usuário tem permissão (deve ser o remetente da mensagem)
      try {
        // Executa lógica de autorização e exclusão
        await messageService.deleteMessage(
          deleteData.conversationId,
          deleteData.messageId
        );

        // Notificar todos na sala sobre a exclusão
        socketManager.emitToRoom(deleteData.conversationId, MESSAGE_EVENTS.MESSAGE_DELETED, {
          conversationId: deleteData.conversationId,
          messageId: deleteData.messageId,
          deletedBy: userId,
          timestamp: Date.now()
        });
      } catch (error) {
        logger.error('Erro ao excluir mensagem', {
          service: 'socket',
          function: 'deleteMessage',
          deleteData,
          error: error.message
        });

        // Opcional: notificar erro ao cliente
        socket.emit(MESSAGE_EVENTS.MESSAGE_DELETED, {
          error: 'Não foi possível excluir a mensagem',
          messageId: deleteData.messageId
        });
      }
    } catch (error) {
      logger.error('Erro ao processar delete_message', {
        service: 'socket',
        function: 'deleteMessage',
        userId,
        error: error.message
      });
    }
  });

  // Handler para status de digitação
  socket.on(TYPING_EVENTS.TYPING_STATUS, (typingData) => {
    try {
      // Validar dados
      if (!typingData || !typingData.conversationId) {
        return;
      }

      const isTyping = typingData.isTyping === true;

      // Registrar em log com nível mais baixo (pode gerar muitos logs)
      logger.debug('Atualização de status de digitação', {
        service: 'socket',
        function: 'typingStatus',
        userId,
        conversationId: typingData.conversationId,
        isTyping
      });

      // Transmitir para outros na sala
      socket.to(typingData.conversationId).emit(TYPING_EVENTS.TYPING_STATUS, {
        senderId: userId,
        conversationId: typingData.conversationId,
        isTyping,
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error('Erro ao processar typing_status', {
        service: 'socket',
        function: 'typingStatus',
        userId,
        error: error.message
      });
    }
  });
}

module.exports = registerMessageHandlers;