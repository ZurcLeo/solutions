const { auth } = require('../firebaseAdmin');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided or invalid format' });
  }

  const idToken = authHeader.split(' ')[1];

  try {
    const decodedToken = await auth.verifyIdToken(idToken);
    console.log('Firebase Decoded Token:', decodedToken);
    req.user = decodedToken; // or use decodedToken more explicitly
    return next();
  } catch (error) {
    console.error('Token verification failed:', error.message, error);
    return res.status(401).json({ message: 'Unauthorized', error: error.message });
  }
};

module.exports = verifyToken;