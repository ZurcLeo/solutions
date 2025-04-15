// services/MessageServiceV2.js
const Message = require('../models/Message');
const { logger } = require('../logger');

class MessageService {
  /**
   * Obtém todas as conversas de um usuário
   * @param {string} userId - ID do usuário
   * @returns {Promise<Array>} - Lista de conversas
   */
  static async getUserConversations(userId) {
    try {
      logger.info(`Buscando conversas para usuário: ${userId}`);
      const conversations = await Message.getUserConversations(userId);
      logger.debug(`Encontradas ${conversations.length} conversas para o usuário ${userId}`);
      return conversations;
    } catch (error) {
      logger.error(`Erro ao buscar conversas para usuário ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Obtém mensagens de uma conversa entre dois usuários
   * @param {string} userId1 - ID do primeiro usuário
   * @param {string} userId2 - ID do segundo usuário
   * @param {number} limit - Limite de mensagens
   * @param {Date} before - Timestamp para paginação
   * @returns {Promise<Array>} - Lista de mensagens
   */
  static async getConversationMessages(userId1, userId2, limit = 50, before = null) {
    try {
      // Ordenar IDs para garantir consistência
      const sortedIds = [userId1, userId2].sort();
      const conversationId = sortedIds.join('_');
      
      logger.info(`Buscando mensagens para conversa: ${conversationId}`);
      const messages = await Message.getConversationMessages(conversationId, limit, before);
      logger.debug(`Encontradas ${messages.length} mensagens na conversa ${conversationId}`);
      return messages;
    } catch (error) {
      logger.error(`Erro ao buscar mensagens entre usuários ${userId1} e ${userId2}:`, error);
      throw error;
    }
  }

  /**
   * Obtém mensagens por ID de conversa
   * @param {string} conversationId - ID da conversa
   * @param {number} limit - Limite de mensagens
   * @param {Date} before - Timestamp para paginação
   * @returns {Promise<Array>} - Lista de mensagens
   */
  static async getMessagesByConversationId(conversationId, limit = 50, before = null) {
    try {
      logger.info(`Buscando mensagens para conversationId: ${conversationId}`);
      const messages = await Message.getConversationMessages(conversationId, limit, before);
      logger.debug(`Encontradas ${messages.length} mensagens na conversa ${conversationId}`);
      return messages;
    } catch (error) {
      logger.error(`Erro ao buscar mensagens para conversationId ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Cria uma nova mensagem
   * @param {Object} messageData - Dados da mensagem
   * @returns {Promise<Object>} - Mensagem criada
   */
  static async createMessage(messageData) {
    try {
      logger.info(`Criando mensagem de ${messageData.sender} para ${messageData.recipient}`);
      const newMessage = await Message.createMessage(messageData);
      logger.debug(`Mensagem criada com ID: ${newMessage.id}`);
      return newMessage;
    } catch (error) {
      logger.error(`Erro ao criar mensagem:`, error);
      throw error;
    }
  }

  /**
   * Marca mensagens como lidas
   * @param {string} conversationId - ID da conversa
   * @param {string} userId - ID do usuário que está lendo as mensagens
   * @returns {Promise<Object>} - Resultado da operação
   */
  static async markMessagesAsRead(conversationId, userId) {
    try {
      logger.info(`Marcando mensagens como lidas para usuário ${userId} na conversa ${conversationId}`);
      const result = await Message.markMessagesAsRead(conversationId, userId);
      logger.debug(`Marcadas ${result.count} mensagens como lidas`);
      return result;
    } catch (error) {
      logger.error(`Erro ao marcar mensagens como lidas para usuário ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Atualiza o status de uma mensagem
   * @param {string} conversationId - ID da conversa
   * @param {string} messageId - ID da mensagem
   * @param {Object} statusUpdate - Dados de atualização
   * @returns {Promise<Object>} - Resultado da operação
   */
  static async updateMessageStatus(conversationId, messageId, statusUpdate) {
    try {
      logger.info(`Atualizando status da mensagem ${messageId} na conversa ${conversationId}`);
      const result = await Message.updateMessageStatus(conversationId, messageId, statusUpdate);
      logger.debug(`Status da mensagem atualizado: ${JSON.stringify(result.status)}`);
      return result;
    } catch (error) {
      logger.error(`Erro ao atualizar status da mensagem ${messageId}:`, error);
      throw error;
    }
  }

  /**
   * Exclui uma mensagem
   * @param {string} conversationId - ID da conversa
   * @param {string} messageId - ID da mensagem
   * @param {string} userId - ID do usuário solicitando a exclusão
   * @returns {Promise<Object>} - Resultado da operação
   */
  static async deleteMessage(conversationId, messageId, userId) {
    try {
      logger.info(`Excluindo mensagem ${messageId} pelo usuário ${userId}`);
      const result = await Message.deleteMessage(conversationId, messageId, userId);
      logger.debug(`Mensagem ${messageId} excluída com sucesso`);
      return result;
    } catch (error) {
      logger.error(`Erro ao excluir mensagem ${messageId}:`, error);
      throw error;
    }
  }

  /**
   * Obtém estatísticas de mensagens do usuário
   * @param {string} userId - ID do usuário
   * @returns {Promise<Object>} - Estatísticas
   */
  static async getUserMessageStats(userId) {
    try {
      logger.info(`Obtendo estatísticas de mensagens para usuário ${userId}`);
      const stats = await Message.getUserMessageStats(userId);
      logger.debug(`Estatísticas obtidas: ${JSON.stringify(stats)}`);
      return stats;
    } catch (error) {
      logger.error(`Erro ao obter estatísticas de mensagens para usuário ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Migra dados do modelo antigo para o novo
   * @param {string} userId - ID do usuário para migrar
   * @returns {Promise<Object>} - Resultado da migração
   */
  static async migrateUserMessages(userId) {
    try {
      logger.info(`Iniciando migração de mensagens para usuário ${userId}`);
      
      // Implementar código de migração aqui
      // Este é um stub para representar a lógica de migração
      
      return {
        success: true,
        migratedConversations: 0,
        migratedMessages: 0
      };
    } catch (error) {
      logger.error(`Erro ao migrar mensagens para usuário ${userId}:`, error);
      throw error;
    }
  }
}

module.exports = MessageService;