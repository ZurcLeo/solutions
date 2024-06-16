const admin = require('firebase-admin');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const decodeBase64Secret = (secret) => Buffer.from(secret, 'base64');

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const recaptchaToken = req.headers['recaptcha-token'];

    if (authHeader) {
        const idToken = authHeader.split(' ')[1];

        try {
            // Firebase ID Token Verification
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            req.user = decodedToken;
            return next();
        } catch (firebaseError) {
            console.log("Firebase ID token verification failed:", firebaseError.message);
            try {
                // VideoSDK Token Verification
                const decodedSecret = decodeBase64Secret(process.env.VIDEO_SDK_SECRET_KEY);
                console.log("Decoded VideoSDK secret:", decodedSecret.toString('utf8'));
                const decodedToken = jwt.verify(idToken, decodedSecret);
                console.log("Decoded VideoSDK token:", decodedToken);
                req.user = decodedToken;
                return next();
            } catch (videosdkError) {
                console.log("VideoSDK token verification failed:", videosdkError.message);
                return res.status(401).json({ message: 'Unauthorized', error: videosdkError.message });
            }
        }
    } else if (recaptchaToken) {
        try {
            // reCAPTCHA Token Verification
            const response = await axios.post(`https://www.google.com/recaptcha/api/siteverify`, null, {
                params: {
                    secret: process.env.RECAPTCHA_SECRET_KEY,
                    response: recaptchaToken
                }
            });

            if (response.data.success) {
                return next();
            } else {
                return res.status(401).json({ message: 'reCAPTCHA verification failed' });
            }
        } catch (recaptchaError) {
            return res.status(500).json({ message: 'Internal server error', error: recaptchaError.message });
        }
    } else {
        return res.status(401).json({ message: 'No token provided' });
    }
};

module.exports = verifyToken;
