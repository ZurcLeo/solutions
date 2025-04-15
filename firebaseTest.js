require('dotenv').config(); // Garanta que dotenv seja carregado no teste também
const { getApp } = require('./firebaseAdmin'); // Ajuste o caminho se necessário
const { logger } = require('./logger');


async function testFirebaseInitialization() {
  try {
    const firebaseApp = getApp();
    logger.info('Firebase App inicializado com sucesso no teste:', firebaseApp);
  } catch (error) {
    logger.error('Erro na inicialização do Firebase no teste:', error);
  }
}

testFirebaseInitialization();