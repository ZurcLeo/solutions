//routes/email.js
const express = require('express');
const router = express.Router();
const emailController = require('../controllers/emailController');

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
 *   name: Email
 *   description: Rotas para envio de emails
 */

/**
 * @swagger
 * /email/send-invite:
 *   post:
 *     summary: Envia um email de convite
 *     tags: [Email]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               to:
 *                 type: string
 *                 description: Email do destinatário
 *               subject:
 *                 type: string
 *                 description: Assunto do email
 *               message:
 *                 type: string
 *                 description: Mensagem do email
 *     responses:
 *       200:
 *         description: Email enviado com sucesso
 *       400:
 *         description: Erro na requisição
 *       500:
 *         description: Erro no servidor
 */
router.post('/send-invite', emailController.sendInviteEmail);

module.exports = router;
