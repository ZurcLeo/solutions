//routes/auth.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Rota OPTIONS para lidar com requisições preflight
router.options('*', (req, res) => {
    res.set('Access-Control-Allow-Origin', 'https://eloscloud.com');
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
    res.status(204).send('');
});

router.post('/facebook-login', authController.facebookLogin);
router.get('/facebook-friends', authController.getFacebookFriends);
router.post('/register', authController.registerWithEmail);
router.post('/login', authController.signInWithEmail);
router.post('/logout', authController.logout);
router.post('/login-with-provider', authController.signInWithProvider);
router.post('/register-with-provider', authController.registerWithProvider);
router.post('/resend-verification-email', authController.resendVerificationEmail);


module.exports = router;
