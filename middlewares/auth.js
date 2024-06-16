const admin = require('firebase-admin');
const axios = require('axios');
const jwt = require('jsonwebtoken');

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
        } catch (error) {
            try {
                // VideoSDK Token Verification
                const decodedToken = jwt.verify(idToken, process.env.VIDEO_SDK_SECRET_KEY);
                req.user = decodedToken;
                return next();
            } catch (error) {
                return res.status(401).json({ message: 'Unauthorized', error: error.message });
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
        } catch (error) {
            return res.status(500).json({ message: 'Internal server error', error: error.message });
        }
    } else {
        return res.status(401).json({ message: 'No token provided' });
    }
};

module.exports = verifyToken;
