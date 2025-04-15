const { getFirestore } = require('../firebaseAdmin'); // getFirestore ainda será usado para o Firestore
const { FieldValue } = require('firebase-admin/firestore');
const { logger } = require('../logger');

class Blacklist {
  constructor() {
    this.blacklistRef = getFirestore().collection('blacklist'); // Garante que o Firestore está inicializado
  }

  async addToBlacklist(token) {
    logger.info(`Iniciando a adição do token ${token} à blacklist`, {
      service: 'blacklistService',
      function: 'addToBlacklist',
     
    });

    try {
      const tokenDoc = this.blacklistRef.doc(token);
      await tokenDoc.set({
        createdAt: FieldValue.serverTimestamp(),
      });

      logger.info(`Token ${token} adicionado à blacklist com sucesso`, {
        service: 'blacklistService',
        function: 'addToBlacklist',
       
      });
    } catch (error) {
      logger.error(`Erro ao adicionar o token ${token} à blacklist`, {
        service: 'blacklistService',
        function: 'addToBlacklist',
       
        error: error.message,
      });

      throw new Error('Erro ao adicionar token à blacklist.');
    }
  }

  async isTokenBlacklisted(token) {
    logger.info(`Verificando se o token ${token} está na blacklist`, {
      service: 'blacklistService',
      function: 'isTokenBlacklisted'
    });

    try {
      const tokenDoc = await this.blacklistRef.doc(token).get();

      if (tokenDoc.exists) {
        logger.info(`Token ${token} está na blacklist`, {
          service: 'blacklistService',
          function: 'isTokenBlacklisted',
        });
      } else {
        logger.warn(`Token ${token} não está na blacklist`, {
          service: 'blacklistService',
          function: 'isTokenBlacklisted',
        });
      }

      return tokenDoc.exists;
    } catch (error) {
      logger.error(`Erro ao verificar se o token ${token} está na blacklist`, {
        service: 'blacklistService',
        function: 'isTokenBlacklisted',
        error: error.message,
      });

      throw new Error('Erro ao verificar token na blacklist.');
    }
  }

  async removeExpiredTokens() {
    logger.info('Iniciando a remoção de tokens expirados da blacklist', {
      service: 'blacklistService',
      function: 'removeExpiredTokens',
    });

    try {
      const now = admin.firestore.Timestamp.now();
      const snapshot = await this.blacklistRef.where('createdAt', '<', now.toDate()).get();

      if (snapshot.empty) {
        logger.info('Nenhum token expirado encontrado para remoção', {
          service: 'blacklistService',
          function: 'removeExpiredTokens',
        });
        return;
      }

      const batch = getFirestore().batch(); // Continua usando getFirestore para inicializar o batch
      snapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });

      await batch.commit();

      logger.info('Tokens expirados removidos com sucesso', {
        service: 'blacklistService',
        function: 'removeExpiredTokens',
      });
    } catch (error) {
      logger.error('Erro ao remover tokens expirados da blacklist', {
        service: 'blacklistService',
        function: 'removeExpiredTokens',
        error: error.message,
      });

      throw new Error('Erro ao remover tokens expirados.');
    }
  }
}

module.exports = Blacklist;