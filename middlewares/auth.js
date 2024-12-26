const { auth } = require('../firebaseAdmin');
const { logger } = require('../logger');
const { isTokenBlacklisted } = require('../services/blacklistService');
const authService = require('../services/authService');

const verifyToken = async (req, res, next) => {

  const authHeader = req.headers['authorization'];
  logger.info('Verificação de token iniciada', {
    service: 'authMiddleware',
    function: 'verifyToken',
    authHeader,
  });

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.error('Token não fornecido ou formato inválido', {
      service: 'authMiddleware',
      function: 'verifyToken',
    });
    return res.status(401).json({ message: 'Token não fornecido ou formato inválido' });
  }

  const idToken = authHeader.split(' ')[1];
  logger.info('Token extraído', {
    service: 'authMiddleware',
    function: 'verifyToken',
    idToken,
  });

  try {
    const blacklisted = await isTokenBlacklisted(idToken);
    if (blacklisted) {
      logger.error('Token está na lista negra', {
        service: 'authMiddleware',
        function: 'verifyToken',
        idToken,
      });
      return res.status(401).json({ message: 'Token está na lista negra' });
    }

    let decodedToken;

    try {
      decodedToken = await authService.verifyIdToken(idToken);

      req.user = decodedToken;
      req.uid = decodedToken.uid;

      logger.info('Token verificado com sucesso', {
        service: 'authMiddleware',
        function: 'verifyToken',
        userId: decodedToken.uid,
      });
      return next();
    } catch (error) {
      if (error.code === 'auth/id-token-expired') {
        logger.info('Token expirado, verificando refresh token', {
          service: 'authMiddleware',
          function: 'verifyToken',
        });

        const refreshToken = req.cookies?.refreshToken; // Recupera o refresh token do cookie
        if (!refreshToken) {
          logger.error('Refresh token não fornecido', {
            service: 'authMiddleware',
            function: 'verifyToken',
          });
          return res.status(401).json({ message: 'Refresh token não fornecido' });
        }

        try {
          const newTokens = await authService.verifyAndGenerateNewToken(refreshToken); // Renova os tokens
          if (!newTokens) {
            return res.status(403).json({ message: 'Token inválido ou expirado' });
          }

          // Atualize o token de acesso e o refresh token
          res.setHeader('Authorization', `Bearer ${newTokens.accessToken}`);
          res.cookie('refreshToken', newTokens.refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Strict',
            maxAge: 24 * 60 * 60 * 1000,
          });

          req.user = await authService.verifyIdToken(newTokens.accessToken);
          req.uid = req.user.uid; 

          logger.info('Token renovado e verificado com sucesso', {
            service: 'authMiddleware',
            function: 'verifyToken',
            userId: req.uid,
          });
          return next();
        } catch (err) {
          logger.error('Falha ao renovar o token', {
            service: 'authMiddleware',
            function: 'verifyToken',
            error: err.message,
          });
          return res.status(401).json({ message: 'Falha ao renovar o token', error: err.message });
        }
      } else {
        logger.error('Erro na verificação do token', {
          service: 'authMiddleware',
          function: 'verifyToken',
          error: error.message,
        });
        return res.status(401).json({ message: 'Não autorizado', error: error.message });
      }
    }
  } catch (error) {
    logger.error('Falha na verificação do token', {
      service: 'authMiddleware',
      function: 'verifyToken',
      error: error.message,
    });
    return res.status(401).json({ message: 'Não autorizado', error: error.message });
  }
};

module.exports = verifyToken;