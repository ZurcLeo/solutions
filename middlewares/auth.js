const { getAuth } = require('../firebaseAdmin');
const { logger } = require('../logger');
const { isTokenBlacklisted } = require('../services/blacklistService');

const auth = getAuth()

const verifyToken = async (req, res, next) => {
  try {
    // Verifica múltiplas fontes do token em ordem de prioridade
    const token = 
      req.cookies?.accessToken || 
      req.headers.authorization?.split(' ')[1] ||
      req.query?.token;  // opcional, dependendo dos requisitos de segurança
    
    if (!token) {
      logger.error('Token não fornecido', {
        service: 'authMiddleware',
        function: 'verifyToken',
        headers: req.headers,
        cookies: req.cookies
      });
      return res.status(401).json({ message: 'Token não fornecido' });
    }

    // Verifica o token com Firebase Admin
    const decodedToken = await auth.verifyIdToken(token);
    req.user = decodedToken;
    req.uid = decodedToken.uid;
    
    logger.info('Token verificado com sucesso', {
      service: 'authMiddleware',
      function: 'verifyToken',
      userId: decodedToken.uid
    });
    
    next();
  } catch (error) {
    logger.error('Erro na verificação do token', {
      service: 'authMiddleware',
      function: 'verifyToken',
      error: error.message,
      errorCode: error.code
    });
    
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({
        code: 'TOKEN_EXPIRED',
        requiresReauth: true
      });
    }
    
    return res.status(401).json({
      message: 'Token inválido',
      code: error.code || 'INVALID_TOKEN'
    });
  }
};

module.exports = verifyToken;