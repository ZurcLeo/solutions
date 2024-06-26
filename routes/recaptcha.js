const express = require('express');
const router = express.Router();
const recaptchaController = require('../controllers/recaptchaController');

// Lista de origens permitidas
const allowedOrigins = ['https://eloscloud.com', 'http://localhost:3000'];

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

/**
 * @swagger
 * tags:
 *   name: Recaptcha
 *   description: Verificação de reCAPTCHA
 */

/**
 * @swagger
 * /recaptcha/verify:
 *   post:
 *     summary: Verifica o token reCAPTCHA
 *     tags: [Recaptcha]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token:
 *                 type: string
 *                 description: Token reCAPTCHA a ser verificado
 *                 example: "token_do_recaptcha"
 *     responses:
 *       200:
 *         description: Token verificado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   description: Indica se a verificação foi bem-sucedida
 *                 score:
 *                   type: number
 *                   description: Pontuação do reCAPTCHA
 *                 action:
 *                   type: string
 *                   description: Ação do reCAPTCHA
 *       400:
 *         description: Erro na solicitação
 *       500:
 *         description: Erro no servidor
 */
router.post('/verify', recaptchaController.verifyRecaptcha);

module.exports = router;