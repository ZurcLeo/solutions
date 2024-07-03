// middlewares/auth.js
const { auth } = require('../firebaseAdmin');
const { isTokenBlacklisted } = require('../services/blacklistService');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  console.log('Authorization Header:', authHeader); // Adiciona log do cabeçalho de autorização
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('No token provided or invalid format');
    return res.status(401).json({ message: 'No token provided or invalid format' });
  }

  const idToken = authHeader.split(' ')[1];
  console.log('Extracted ID Token:', idToken); // Adiciona log do token extraído

  try {
    const blacklisted = await isTokenBlacklisted(idToken);
    if (blacklisted) {
      console.error('Token is blacklisted');
      return res.status(401).json({ message: 'Token is blacklisted' });
    }

    const decodedToken = await auth.verifyIdToken(idToken);
    console.log('Decoded Token:', decodedToken); // Adiciona log do token decodificado
    req.user = decodedToken;
    return next();
  } catch (error) {
    console.error('Token verification failed:', error.message, error);
    return res.status(401).json({ message: 'Unauthorized', error: error.message });
  }
};

module.exports = verifyToken;