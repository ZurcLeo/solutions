//services/connectionService.js
const ActiveConnection = require('../models/ActiveConnection');

const connectionService = {
  getConnectionsByUserId: async (userId) => {
    try {
      const { friends, bestFriends } = await ActiveConnection.getConnectionsByUserId(userId);
      return { friends, bestFriends };
    } catch (error) {
      throw new Error(`Erro ao buscar conexões: ${error.message}`);
    }
  },
  // Melhoria para o método createConnectionRequest no ConnectionService
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