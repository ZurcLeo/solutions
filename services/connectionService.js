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
  }
};

module.exports = connectionService;