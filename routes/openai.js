// routes/openai.js
const express = require('express');
const router = express.Router();
const openaiController = require('../controllers/openaiController');
const { writeLimit } = require('../middlewares/rateLimiter');
const { logger } = require('../logger');

const ROUTE_NAME = 'openai'
// Aplicar middleware de health check a todas as rotas de interests

// Middleware de log para todas as requisições
router.use((req, res, next) => {
  logger.info(`[ROUTE] Requisição recebida em ${ROUTE_NAME}`, {
    path: req.path,
    method: req.method,
    userId: req.user?.uid,
    params: req.params,
    body: req.body,
    query: req.query,
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
router.post('/validate-text', writeLimit, openaiController.validateText);

module.exports = router;