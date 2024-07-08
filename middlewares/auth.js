// middlewares/auth.js
const { auth } = require('../firebaseAdmin');
const { isTokenBlacklisted } = require('../services/blacklistService');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  console.log('Authorization Header:', authHeader); 
  
  // Verifica se o cabeçalho de autorização está presente e tem o formato correto
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('No token provided or invalid format');
    return res.status(401).json({ message: 'No token provided or invalid format' });
  }

  // Extrai o token do cabeçalho de autorização
  const idToken = authHeader.split(' ')[1];
  console.log('Extracted ID Token:', idToken);

  try {
    // Verifica se o token está na lista negra
    const blacklisted = await isTokenBlacklisted(idToken);
    if (blacklisted) {
      console.error('Token is blacklisted');
      return res.status(401).json({ message: 'Token is blacklisted' });
    }

    // Verifica e decodifica o token
    const decodedToken = await auth.verifyIdToken(idToken);
    console.log('Decoded Token:', decodedToken);

    // Adiciona as informações do usuário ao objeto req
    req.user = decodedToken;
    req.uid = decodedToken.uid;

    // Chama o próximo middleware ou rota
    return next();
  } catch (error) {
    // Trata erros de verificação do token
    console.error('Token verification failed:', error.message, error);
    return res.status(401).json({ message: 'Unauthorized', error: error.message });
  }
};

module.exports = verifyToken;