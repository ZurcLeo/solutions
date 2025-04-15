// firstAccessMiddleware.js
const { getAuth } = require('../firebaseAdmin');
const { logger } = require('../logger');
const FirestoreService = require('../utils/firestoreService');
const dbServiceUser = FirestoreService.collection('usuario');
const {calculateJA3Hash} = require('../services/ja3Service');

const firstAccess = async (req, res, next) => {
  // Só verificar se o token foi fornecido
  if (!req.body.firebaseToken) {
    return next();
  }

  try {
    // Verificar o token do Firebase
    const auth = getAuth();
    const decodedToken = await auth.verifyIdToken(req.body.firebaseToken);
    const userId = decodedToken.uid;

    let fingerPrintRawData = req.headers['x-browser-fingerprint'] ? 
      JSON.parse(req.headers['x-browser-fingerprint']) : null;
    
    // Preparar os dados de fingerprint
    const fingerPrintData = fingerPrintRawData ? {
      version: fingerPrintRawData.version || fingerPrintRawData.userAgent || '',
      cipherSuites: fingerPrintRawData.cipherSuites || [],
      extensions: fingerPrintRawData.extensions || [],
      ellipticCurves: fingerPrintRawData.ellipticCurves || [],
      ellipticCurvePointFormats: fingerPrintRawData.ellipticCurvePointFormats || [],
      userId: userId
    } : null;

    if (fingerPrintData && isValidFingerPrintData(fingerPrintData)) {
      try {
        const { ja3Hash } = await calculateJA3Hash(fingerPrintData);
        // Armazenar o JA3 hash no objeto req para uso posterior
        req.ja3Hash = ja3Hash;
        logger.info('JA3 hash calculado e armazenado na requisição', { userId, ja3Hash });
      } catch (ja3Error) {
        logger.error('Erro ao calcular JA3 hash', { userId, error: ja3Error.message });
      }
    }

    // Verificar se o usuário já existe
    try {
      const userDoc = await dbServiceUser.doc(userId).get();
      
      if (!userDoc.exists) {
        // Novo usuário - marcar como primeiro acesso
        req.isFirstAccess = true;
      } else {
        // Usuário existente
        req.isFirstAccess = false;
      }
      
      return next();
    } catch (error) {
      logger.error('Erro ao verificar usuário', {
        userId,
        error: error.message
      });
      return next(error);
    }
  } catch (tokenError) {
    logger.error('Erro ao verificar token', {
      error: tokenError.message
    });
    return next();
  }
};

// Função auxiliar para verificar se os dados de fingerprint são válidos
function isValidFingerPrintData(data) {
  return (
    data.version && 
    Array.isArray(data.cipherSuites) && data.cipherSuites.length > 0 &&
    Array.isArray(data.extensions) && 
    Array.isArray(data.ellipticCurves) && 
    Array.isArray(data.ellipticCurvePointFormats) &&
    data.userId
  );
}

module.exports = firstAccess;