/**
 * @fileoverview Serviço para gerenciar conexões de usuários (amigos e melhores amigos).
 * @module services/connectionService
 * @requires ../models/ActiveConnection
 */

const ActiveConnection = require('../models/ActiveConnection');

const connectionService = {
    /**
   * Obtém as conexões (amigos e melhores amigos) de um usuário.
   * @async
   * @function getConnectionsByUserId
   * @param {string} userId - O ID do usuário para o qual as conexões serão buscadas.
   * @returns {Promise<{friends: Array<Object>, bestFriends: Array<Object>}>} Um objeto contendo listas de amigos e melhores amigos.
   * @throws {Error} Se ocorrer um erro ao buscar as conexões.
   * @description Recupera todos os amigos e melhores amigos de um usuário específico do banco de dados.
   */
  getConnectionsByUserId: async (userId) => {
    try {
      const { friends, bestFriends } = await ActiveConnection.getConnectionsByUserId(userId);
      return { friends, bestFriends };
    } catch (error) {
      throw new Error(`Erro ao buscar conexões: ${error.message}`);
    }
  },

  /**
   * Cria uma solicitação de conexão (amizade) para outro usuário.
   * @async
   * @function createConnectionRequest
   * @param {string} targetUserId - O ID do usuário para quem a solicitação de conexão será enviada.
   * @returns {Promise<Object>} O objeto da solicitação de convite criada.
   * @throws {Error} Se o usuário atual não estiver autenticado, ou ocorrer um erro durante a criação da solicitação.
   * @description Envia uma solicitação de amizade de um usuário autenticado para um usuário alvo, com tratamento de retentativas e eventos.
   */
  async createConnectionRequest(targetUserId) {
  // Obter o usuário atual de forma segura
  this.getCurrentUser();

  // Verificar se o usuário está autenticado
  if (!this._currentUser) {
      throw new Error('Usuário não autenticado');
  }

  try {
      const userId = this._currentUser.uid;

      const response = await this._executeWithRetry(async () => {
          return await this.apiService.post(`/api/connections/requested`, {
              userId: userId,
              friendId: targetUserId
          });
      }, 'createConnectionRequest');

      // Extrair dados de resposta
      const invitation = response.data;

      // Emitir evento padrão
      this._emitEvent(CONNECTION_EVENTS.CONNECTION_REQUESTED, {invitation});

      return invitation;
  } catch (error) {
      // Melhorar tratamento de erros para prover feedback específico ao usuário
      if (error.response && error.response.data) {
          const { message, code, requestId } = error.response.data;
          
          // Emitir evento com informações detalhadas do erro
          this._emitEvent(CONNECTION_EVENTS.CONNECTION_REQUEST_ERROR, {
              error: error.message,
              errorCode: code,
              errorMessage: message,
              requestId,
              targetUserId
          });
          
          // Propagar o erro com informações detalhadas
          const enhancedError = new Error(message);
          enhancedError.code = code;
          enhancedError.requestId = requestId;
          throw enhancedError;
      }
      
      this._logError(error, 'createConnectionRequest');
      throw error;
  }
}
};

module.exports = connectionService;