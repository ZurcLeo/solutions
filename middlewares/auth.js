const { auth } = require('../firebaseAdmin');
const { logger } = require('../logger');
const { isTokenBlacklisted } = require('../services/blacklistService');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  logger.info('Verificação de token iniciada', {
    service: 'authMiddleware',
    function: 'verifyToken',
    authHeader
  });

  // Verifica se o cabeçalho de autorização está presente e tem o formato correto
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.error('Token não fornecido ou formato inválido', {
      service: 'authMiddleware',
      function: 'verifyToken'
    });
    return res.status(401).json({ message: 'Token não fornecido ou formato inválido' });
  }

  // Extrai o token do cabeçalho de autorização
  const idToken = authHeader.split(' ')[1];
  logger.info('Token extraído', {
    service: 'authMiddleware',
    function: 'verifyToken',
    idToken
  });

  try {
    // Verifica se o token está na lista negra
    const blacklisted = await isTokenBlacklisted(idToken);
    if (blacklisted) {
      logger.error('Token está na lista negra', {
        service: 'authMiddleware',
        function: 'verifyToken',
        idToken
      });
      return res.status(401).json({ message: 'Token está na lista negra' });
    }

    // Verifica e decodifica o token
    const decodedToken = await auth.verifyIdToken(idToken);
    logger.info('Token decodificado', {
      service: 'authMiddleware',
      function: 'verifyToken',
      decodedToken
    });

    // Adiciona as informações do usuário ao objeto req
    req.user = decodedToken;
    req.uid = decodedToken.uid;

    // Chama o próximo middleware ou rota
    logger.info('Token verificado com sucesso', {
      service: 'authMiddleware',
      function: 'verifyToken',
      userId: decodedToken.uid
    });
    return next();
  } catch (error) {
    // Trata erros de verificação do token
    logger.error('Falha na verificação do token', {
      service: 'authMiddleware',
      function: 'verifyToken',
      error: error.message
    });
    return res.status(401).json({ message: 'Não autorizado', error: error.message });
  }
};

module.exports = verifyToken;