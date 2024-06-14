const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const verifyToken = require('../middlewares/auth');

// Middleware to add CORS headers for all requests
router.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', 'https://eloscloud.com');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

router.post('/facebook-login', authController.facebookLogin);
router.post('/register', authController.registerWithEmail);
router.post('/login', authController.signInWithEmail);
router.post('/logout', authController.logout);
router.post('/login-with-provider', authController.signInWithProvider);
router.post('/register-with-provider', authController.registerWithProvider);
router.post('/resend-verification-email', authController.resendVerificationEmail);
router.get('/token', verifyToken, authController.getToken);

module.exports = router;
