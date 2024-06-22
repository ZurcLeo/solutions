const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');

const decodeBase64Secret = (secret) => Buffer.from(secret, 'base64');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ message: 'No token provided' });
  }

  const idToken = authHeader.split(' ')[1];
  const decodedSecret = decodeBase64Secret(process.env.VIDEO_SDK_SECRET_KEY);

  // Attempt to verify Firebase token first
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    console.log('Firebase Decoded Token:', decodedToken);
    req.user = decodedToken;
    return next();
  } catch (error) {
    console.log('Firebase token verification failed:', error.message);

    // Attempt to verify Video SDK token
    try {
      const decodedToken = jwt.verify(idToken, decodedSecret, { algorithms: ['HS256'] });
      console.log('Video SDK Decoded Token:', decodedToken);
      req.user = decodedToken;
      return next();
    } catch (error) {
      console.log('Video SDK token verification failed:', error.message);
      return res.status(401).json({ message: 'Unauthorized', error: error.message });
    }
  }
};

module.exports = verifyToken;
