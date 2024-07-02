//middlewares/auth.js
const { auth } = require('../firebaseAdmin');
const Blacklist = require('../models/BlackList');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided or invalid format' });
  }

  const idToken = authHeader.split(' ')[1];

  try {
    const decodedToken = await auth.verifyIdToken(idToken);
    req.user = decodedToken;
    return next();
  } catch (error) {
    console.error('Token verification failed:', error.message, error);
    return res.status(401).json({ message: 'Unauthorized', error: error.message });
  }
};

module.exports = verifyToken;