const express = require('express');
const router = express.Router();
const recaptchaController = require('../controllers/recaptchaController');

// Lista de origens permitidas
const allowedOrigins = ['https://eloscloud.com', 'http://localhost:3001'];

// Middleware to add CORS headers for all requests
router.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Credentials', 'true');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

router.post('/verify', recaptchaController.verifyRecaptcha);

module.exports = router;
