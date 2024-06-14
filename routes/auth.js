const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const verifyToken = require('../middlewares/auth'); // Middleware de autenticação

// Adicione os cabeçalhos CORS para todas as solicitações
router.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', 'https://eloscloud.com');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    next();
});

router.post('/facebook-login', authController.facebookLogin);
router.get('/facebook-friends', authController.getFacebookFriends);
router.post('/register', authController.registerWithEmail);
router.post('/login', authController.signInWithEmail);
router.post('/logout', authController.logout);
router.post('/login-with-provider', authController.signInWithProvider);
router.post('/register-with-provider', authController.registerWithProvider);
router.post('/resend-verification-email', authController.resendVerificationEmail);
router.get('/token', verifyToken, authController.getToken); // Nova rota para obter o token

module.exports = router;
