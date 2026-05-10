/**
 * @fileoverview Utilitários para Firebase Auth Admin SDK.
 * Arquivo separado para evitar dependência circular entre authService e inviteService.
 * @module utils/firebaseAuthUtils
 */

const { getAuth } = require('../firebaseAdmin');
const { logger } = require('../logger');

/**
 * Verifica se um email já está cadastrado no Firebase Auth.
 * @async
 * @function userExistsByEmail
 * @param {string} email - Email a verificar.
 * @returns {Promise<boolean>} true se o usuário existe, false se não encontrado.
 * @throws {Error} Propaga erros de rede ou do Firebase Admin (não engole silenciosamente).
 */
const userExistsByEmail = async (email) => {
  const auth = getAuth();
  try {
    await auth.getUserByEmail(email.toLowerCase());
    logger.info('Verificação de email: usuário encontrado no Firebase Auth', {
      service: 'firebaseAuthUtils',
      function: 'userExistsByEmail',
      exists: true
    });
    return true;
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      logger.info('Verificação de email: usuário não encontrado no Firebase Auth', {
        service: 'firebaseAuthUtils',
        function: 'userExistsByEmail',
        exists: false
      });
      return false;
    }
    logger.error('Erro ao verificar existência de email no Firebase Auth', {
      service: 'firebaseAuthUtils',
      function: 'userExistsByEmail',
      errorCode: error.code || 'unknown'
    });
    throw error;
  }
};

module.exports = { userExistsByEmail };
