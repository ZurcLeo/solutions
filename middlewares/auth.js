//middlewares/auth.js
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

    try {
        const decodedToken = jwt.verify(idToken, decodedSecret, { algorithms: ['HS256'] });
        console.log('Decoded Token:', decodedToken);
        req.user = decodedToken;
        return next();
    } catch (error) {
        console.log('Token verification failed:', error.message);
        return res.status(401).json({ message: 'Unauthorized', error: error.message });
    }
};

module.exports = verifyToken;
