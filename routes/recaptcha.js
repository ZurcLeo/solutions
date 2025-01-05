const express = require('express');
const router = express.Router();
const recaptchaController = require('../controllers/recaptchaController');
const { rateLimiter } = require('../middlewares/rateLimiter');
const { logger } = require('../logger');

router.use((req, res, next) => {
  const allowedOrigins = [
    'https://eloscloud.com',
    'http://localhost:3000'
  ];
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.set('Access-Control-Allow-Methods', 'POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

router.use((req, res, next) => {
  logger.info('Requisição recebida', {
    service: 'recaptcha',
    function: req.originalUrl,
    method: req.method,
    url: req.originalUrl,
    headers: req.headers,
    body: req.body
  });
  next();
});

/**
 * @swagger
 * tags:
 *   name: Recaptcha
 *   description: Rotas de verificação reCAPTCHA
 */

router.route('/verify')
  .post(rateLimiter, recaptchaController.verifyRecaptcha);

module.exports = router;