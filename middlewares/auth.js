const admin = require('firebase-admin');

const verifyToken = async (req, res, next) => {
  const idToken = req.headers.authorization?.split(' ')[1];

  if (!idToken) {
    return res.status(401).json({ message: 'No token provided' });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Unauthorized', error: error.message });
  }
};

module.exports = verifyToken;
