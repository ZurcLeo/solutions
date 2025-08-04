// controllers/messageControllerV2.js
const MessageService = require('../services/messageService');
const { logger } = require('../logger');

class MessageController {
  /**
   * Obtém todas as conversas de um usuário
   * @param {Object} req - Objeto de requisição Express
   * @param {Object} res - Objeto de resposta Express
   */
  static async getUserConversations(req, res) {
    try {
      const userId = req.uid; // ID do usuário autenticado
      
      if (!userId) {
        return res.status(401).json({ 
          success: false, 
          message: 'Usuário não autenticado' 
        });
      }

      const conversations = await MessageService.getUserConversations(userId);
      
      return res.status(200).json({
        success: true,
        data: conversations
      });
    } catch (error) {
      logger.error('Erro ao buscar conversas:', error);
      return res.status(500).json({
        success: false,
        message: 'Erro ao buscar conversas',
        error: error.message
      });
    }
  }

  /**
   * Obtém mensagens de uma conversa
   * @param {Object} req - Objeto de requisição Express
   * @param {Object} res - Objeto de resposta Express
   */
  static async getConversationMessages(req, res) {
    try {
      const userId = req.uid; // ID do usuário autenticado
      const { conversationId } = req.params;
      const { limit = 50, before = null } = req.query;

      console.log(`[CONTROLLER DEBUG] getConversationMessages iniciado`);
      console.log(`[CONTROLLER DEBUG] userId: ${userId}`);
      console.log(`[CONTROLLER DEBUG] conversationId: ${conversationId}`);
      console.log(`[CONTROLLER DEBUG] limit: ${limit}, before: ${before}`);

      if (!userId) {
        return res.status(401).json({ 
          success: false, 
          message: 'Usuário não autenticado' 
        });
      }

      if (!conversationId) {
        return res.status(400).json({
          success: false,
          message: 'ID da conversa não fornecido'
        });
      }

      // Verificar se o usuário é participante da conversa
      // Primeiro, tentar verificar se o conversationId está no formato userId1_userId2
      const participants = conversationId.split('_');
      console.log(`[CONTROLLER DEBUG] Participantes extraídos do ID: ${JSON.stringify(participants)}`);
      
      if (participants.length === 2 && participants.includes(userId)) {
        console.log(`[CONTROLLER DEBUG] Formato padrão userId1_userId2 detectado e usuário é participante`);
        // Formato padrão userId1_userId2 e usuário é participante
        const messages = await MessageService.getMessagesByConversationId(
          conversationId,
          parseInt(limit),
          before ? new Date(before) : null
        );

        console.log(`[CONTROLLER DEBUG] Mensagens encontradas: ${messages.length}`);
        return res.status(200).json({
          success: true,
          data: messages
        });
      }

      console.log(`[CONTROLLER DEBUG] Formato não padrão detectado, verificando no Firestore...`);
      // Se não estiver no formato padrão, verificar no Firestore se o usuário é participante
      const isParticipant = await MessageService.isUserParticipantOfConversation(conversationId, userId);
      console.log(`[CONTROLLER DEBUG] isParticipant resultado: ${isParticipant}`);
      
      if (!isParticipant) {
        console.log(`[CONTROLLER DEBUG] Usuário não é participante, retornando 403`);
        return res.status(403).json({
          success: false,
          message: '[getConversationMessages] Você não tem permissão para acessar esta conversa'
        });
      }

      console.log(`[CONTROLLER DEBUG] Usuário é participante, buscando mensagens...`);
      const messages = await MessageService.getMessagesByConversationId(
        conversationId,
        parseInt(limit),
        before ? new Date(before) : null
      );

      console.log(`[CONTROLLER DEBUG] Mensagens encontradas: ${messages.length}`);
      return res.status(200).json({
        success: true,
        data: messages
      });
    } catch (error) {
      console.log(`[CONTROLLER ERROR] Erro no getConversationMessages:`, error);
      logger.error('Erro ao buscar mensagens:', error);
      return res.status(500).json({
        success: false,
        message: 'Erro ao buscar mensagens',
        error: error.message
      });
    }
  }

  /**
   * Obtém mensagens entre dois usuários específicos
   * @param {Object} req - Objeto de requisição Express
   * @param {Object} res - Objeto de resposta Express
   */
  static async getMessagesBetweenUsers(req, res) {
    try {
      const userId = req.uid; // ID do usuário autenticado
      const { otherUserId } = req.params;
      const { limit = 50, before = null } = req.query;

      if (!userId) {
        return res.status(401).json({ 
          success: false, 
          message: 'Usuário não autenticado' 
        });
      }

      if (!otherUserId) {
        return res.status(400).json({
          success: false,
          message: 'ID do outro usuário não fornecido'
        });
      }

      const messages = await MessageService.getConversationMessages(
        userId,
        otherUserId,
        parseInt(limit),
        before ? new Date(before) : null
      );

      return res.status(200).json({
        success: true,
        data: messages
      });
    } catch (error) {
      logger.error('Erro ao buscar mensagens entre usuários:', error);
      return res.status(500).json({
        success: false,
        message: 'Erro ao buscar mensagens',
        error: error.message
      });
    }
  }

  /**
   * Cria uma nova mensagem
   * @param {Object} req - Objeto de requisição Express
   * @param {Object} res - Objeto de resposta Express
   */
  static async createMessage(req, res) {
    try {
      const sender = req.uid; // ID do usuário autenticado
      const { recipient, content, type = 'text' } = req.body;

      if (!sender) {
        return res.status(401).json({ 
          success: false, 
          message: 'Usuário não autenticado' 
        });
      }

      if (!recipient || !content) {
        return res.status(400).json({
          success: false,
          message: 'Dados incompletos para criar mensagem'
        });
      }

      const messageData = {
        sender,
        recipient,
        content,
        type
      };

      const newMessage = await MessageService.createMessage(messageData);

      return res.status(201).json({
        success: true,
        data: newMessage
      });
    } catch (error) {
      logger.error('Erro ao criar mensagem:', error);
      return res.status(500).json({
        success: false,
        message: 'Erro ao criar mensagem',
        error: error.message
      });
    }
  }

  /**
   * Marca mensagens como lidas
   * @param {Object} req - Objeto de requisição Express
   * @param {Object} res - Objeto de resposta Express
   */
  static async markMessagesAsRead(req, res) {
    try {
      const userId = req.uid; // ID do usuário autenticado
      const { conversationId } = req.params;
    logger.info('markAsRead:', userId, conversationId);
      if (!userId) {
        return res.status(401).json({ 
          success: false, 
          message: 'Usuário não autenticado' 
        });
      }

      if (!conversationId) {
        return res.status(400).json({
          success: false,
          message: 'ID da conversa não fornecido'
        });
      }

      // Verificar se o usuário é participante da conversa
      const participants = conversationId.split('_');
      
      // Se não estiver no formato padrão userId1_userId2, verificar no Firestore
      if (participants.length !== 2 || !participants.includes(userId)) {
        const isParticipant = await MessageService.isUserParticipantOfConversation(conversationId, userId);
        if (!isParticipant) {
          return res.status(403).json({
            success: false,
            message: '[markMessagesAsRead] Você não tem permissão para acessar esta conversa'
          });
        }
      }

      const result = await MessageService.markMessagesAsRead(conversationId, userId);

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Erro ao marcar mensagens como lidas:', error);
      return res.status(500).json({
        success: false,
        message: 'Erro ao marcar mensagens como lidas',
        error: error.message
      });
    }
  }

  /**
   * Atualiza o status de uma mensagem
   * @param {Object} req - Objeto de requisição Express
   * @param {Object} res - Objeto de resposta Express
   */
  static async updateMessageStatus(req, res) {
    try {
      const userId = req.uid; // ID do usuário autenticado
      const { conversationId, messageId } = req.params;
      const statusUpdate = req.body;

      if (!userId) {
        return res.status(401).json({ 
          success: false, 
          message: 'Usuário não autenticado' 
        });
      }

      if (!conversationId || !messageId) {
        return res.status(400).json({
          success: false,
          message: 'IDs da conversa ou da mensagem não fornecidos'
        });
      }

      // Verificar se o usuário é participante da conversa
      const participants = conversationId.split('_');
      
      // Se não estiver no formato padrão userId1_userId2, verificar no Firestore
      if (participants.length !== 2 || !participants.includes(userId)) {
        const isParticipant = await MessageService.isUserParticipantOfConversation(conversationId, userId);
        if (!isParticipant) {
          return res.status(403).json({
            success: false,
            message: '[updateMessageStatus] Você não tem permissão para acessar esta conversa'
          });
        }
      }

      const result = await MessageService.updateMessageStatus(
        conversationId, 
        messageId, 
        statusUpdate
      );

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Erro ao atualizar status da mensagem:', error);
      return res.status(500).json({
        success: false,
        message: 'Erro ao atualizar status da mensagem',
        error: error.message
      });
    }
  }

  /**
   * Exclui uma mensagem
   * @param {Object} req - Objeto de requisição Express
   * @param {Object} res - Objeto de resposta Express
   */
  static async deleteMessage(req, res) {
    try {
      const userId = req.uid; // ID do usuário autenticado
      const { conversationId, messageId } = req.params;

      if (!userId) {
        return res.status(401).json({ 
          success: false, 
          message: 'Usuário não autenticado' 
        });
      }

      if (!conversationId || !messageId) {
        return res.status(400).json({
          success: false,
          message: 'IDs da conversa ou da mensagem não fornecidos'
        });
      }

      const result = await MessageService.deleteMessage(
        conversationId,
        messageId,
        userId
      );

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Erro ao excluir mensagem:', error);
      return res.status(500).json({
        success: false,
        message: 'Erro ao excluir mensagem',
        error: error.message
      });
    }
  }

  /**
   * Obtém estatísticas de mensagens do usuário
   * @param {Object} req - Objeto de requisição Express
   * @param {Object} res - Objeto de resposta Express
   */
  static async getUserMessageStats(req, res) {
    try {
      const userId = req.uid; // ID do usuário autenticado

      if (!userId) {
        return res.status(401).json({ 
          success: false, 
          message: 'Usuário não autenticado' 
        });
      }

      const stats = await MessageService.getUserMessageStats(userId);

      return res.status(200).json({
        success: true,
        data: stats
      });
    } catch (error) {
      logger.error('Erro ao obter estatísticas de mensagens:', error);
      return res.status(500).json({
        success: false,
        message: 'Erro ao obter estatísticas de mensagens',
        error: error.message
      });
    }
  }

  /**
   * Migra dados do modelo antigo para o novo
   * @param {Object} req - Objeto de requisição Express
   * @param {Object} res - Objeto de resposta Express
   */
  static async migrateUserMessages(req, res) {
    try {
      const userId = req.uid; // ID do usuário autenticado
      const isAdmin = req.user && req.user.isAdmin; // Verificar se é admin

      if (!userId) {
        return res.status(401).json({ 
          success: false, 
          message: 'Usuário não autenticado' 
        });
      }

      // Restringir migração apenas para admins
      if (!isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Permissão negada: apenas administradores podem executar migrações'
        });
      }

      const result = await MessageService.migrateUserMessages(userId);

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Erro ao migrar mensagens:', error);
      return res.status(500).json({
        success: false,
        message: 'Erro ao migrar mensagens',
        error: error.message
      });
    }
  }
}

module.exports = MessageController;