// models/blacklist.js
const { getFirestore, initializeFirebaseAdmin } = require('../firebaseAdmin');
const { logger } = require('../logger');

initializeFirebaseAdmin(); 

class Blacklist {
  constructor() {
    this.blacklistRef = getFirestore().collection('blacklist');
  }

  async addToBlacklist(token) {
    logger.info(`Iniciando a adição do token ${token} à blacklist`, {
      service: 'blacklistService',
      function: 'addToBlacklist',
      token
    });

    try {
      const tokenDoc = this.blacklistRef.doc(token);
      await tokenDoc.set({
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      logger.info(`Token ${token} adicionado à blacklist com sucesso`, {
        service: 'blacklistService',
        function: 'addToBlacklist',
        token
      });
    } catch (error) {
      logger.error(`Erro ao adicionar o token ${token} à blacklist`, {
        service: 'blacklistService',
        function: 'addToBlacklist',
        token,
        error: error.message
      });

      throw new Error('Erro ao adicionar token à blacklist.');
    }
  }

  async isTokenBlacklisted(token) {
    logger.info(`Verificando se o token ${token} está na blacklist`, {
      service: 'blacklistService',
      function: 'isTokenBlacklisted',
      token
    });

    try {
      const tokenDoc = await this.blacklistRef.doc(token).get();
      
      if (tokenDoc.exists) {
        logger.info(`Token ${token} está na blacklist`, {
          service: 'blacklistService',
          function: 'isTokenBlacklisted',
          token
        });
      } else {
        logger.warn(`Token ${token} não está na blacklist`, {
          service: 'blacklistService',
          function: 'isTokenBlacklisted',
          token
        });
      }

      return tokenDoc.exists;
    } catch (error) {
      logger.error(`Erro ao verificar se o token ${token} está na blacklist`, {
        service: 'blacklistService',
        function: 'isTokenBlacklisted',
        token,
        error: error.message
      });

      throw new Error('Erro ao verificar token na blacklist.');
    }
  }

  async removeExpiredTokens() {
    logger.info('Iniciando a remoção de tokens expirados da blacklist', {
      service: 'blacklistService',
      function: 'removeExpiredTokens'
    });

    try {
      const now = admin.firestore.Timestamp.now();
      const snapshot = await this.blacklistRef.where('createdAt', '<', now.toDate()).get();
      
      if (snapshot.empty) {
        logger.info('Nenhum token expirado encontrado para remoção', {
          service: 'blacklistService',
          function: 'removeExpiredTokens'
        });
        return;
      }

      const batch = getFirestore().batch();
      snapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();

      logger.info('Tokens expirados removidos com sucesso', {
        service: 'blacklistService',
        function: 'removeExpiredTokens'
      });
    } catch (error) {
      logger.error('Erro ao remover tokens expirados da blacklist', {
        service: 'blacklistService',
        function: 'removeExpiredTokens',
        error: error.message
      });

      throw new Error('Erro ao remover tokens expirados.');
    }
  }
}

module.exports = Blacklist;