// routes/openai.js
const express = require('express');
const router = express.Router();
const openaiController = require('../controllers/openaiController');
const { logger } = require('../logger');

// Lista de origens permitidas
const allowedOrigins = ['https://eloscloud.com', 'http://localhost:3000'];

// Middleware para adicionar cabeçalhos CORS
router.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Credentials', 'true');

  // Responder a requisições OPTIONS de pré-vôo
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

// Middleware para logar todas as requisições
router.use((req, res, next) => {
  logger.info('Requisição recebida', {
    service: 'api',
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
 *   name: OpenAI
 *   description: Rotas para validação de texto usando OpenAI
 */

/**
 * @swagger
 * /openai/validate-text:
 *   post:
 *     summary: Valida um texto usando OpenAI
 *     tags: [OpenAI]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               text:
 *                 type: string
 *                 description: O texto a ser validado
 *     responses:
 *       200:
 *         description: Validação bem-sucedida
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 validation:
 *                   type: string
 *                   description: O resultado da validação
 *       500:
 *         description: Erro ao validar texto
 */
router.post('/validate-text', openaiController.validateText);

module.exports = router;