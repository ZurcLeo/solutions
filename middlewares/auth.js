const { auth } = require('../firebaseAdmin');
const { logger } = require('../logger');
const { isTokenBlacklisted } = require('../services/blacklistService');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  
  logger.info('Verificação de token iniciada', {
    service: 'authMiddleware',
    function: 'verifyToken'
  });

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.error('Token não fornecido ou formato inválido');
    return res.status(401).json({ message: 'Token não fornecido ou formato inválido' });
  }

  const idToken = req.cookies?.accessToken || 
  req.headers.authorization?.split(' ')[1] ||
  req.query?.token; 

  if (!idToken) {
    return res.status(401).json({ message: 'Token não fornecido' });
  }

  try {
    // Verifica se o token está na blacklist
    const blacklisted = await isTokenBlacklisted(idToken);
    logger.info('Resultado da checagem de blacklist:', blacklisted);
    
    if (blacklisted) {
      logger.error('Token está na blacklist');
      return res.status(401).json({ message: 'Token inválido' });
    }

    try {
      if (!idToken) {
        logger.error('Token não fornecido', {
          service: 'authMiddleware',
          function: 'verifyToken',
          headers: req.headers,
          cookies: req.cookies
        });
        return res.status(401).json({ message: 'Token não fornecido' });
      }
      // Usa o Firebase Admin para verificar o token
      const decodedToken = await auth.verifyIdToken(token);
      req.user = decodedToken;
      req.uid = decodedToken.uid;// true força verificação de revogação
      
      // Define os dados do usuário no request
      req.user = decodedToken;
      req.uid = decodedToken.uid;
      
      logger.info('Token verificado com sucesso', {
        userId: decodedToken.uid
      });
      
      return next();
    } catch (error) {
      if (error.code === 'auth/id-token-expired') {
        logger.info('Token expirado, verificando refresh token');
        
        const refreshToken = req.cookies?.refreshToken;
        if (!refreshToken) {
          logger.error('Refresh token não fornecido');
          return res.status(401).json({ 
            message: 'Unauthorized', 
            code: 'TOKEN_EXPIRED',
            requiresReauth: true 
          });
        }

        try {
          // O cliente deve lidar com a reautenticação
          return res.status(401).json({ 
            message: 'Token expired', 
            code: 'TOKEN_EXPIRED',
            requiresReauth: true 
          });
        } catch (refreshError) {
          logger.error('Erro ao renovar tokens', {
            error: refreshError.message
          });
          return res.status(401).json({ 
            message: 'Token renewal failed', 
            code: 'TOKEN_RENEWAL_FAILED',
            requiresReauth: true 
          });
        }
      }
      
      logger.error('Erro na verificação do token', {
        error: error.message
      });
      return res.status(401).json({ 
        message: 'Token inválido',
        code: 'INVALID_TOKEN',
        requiresReauth: true 
      });
    }
  } catch (error) {
    logger.error('Erro no middleware de autenticação', {
      error: error.message
    });
    return res.status(500).json({ message: 'Erro interno do servidor' });
  }
};

module.exports = verifyToken;