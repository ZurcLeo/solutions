// routes/blacklist.js
const express = require('express');
const router = express.Router();
const { addTokenToBlacklist, checkTokenBlacklist } = require('../controllers/blacklistController');
const verifyToken = require('../middlewares/auth');
const { logger } = require('../logger')

// Lista de origens permitidas
const allowedOrigins = ['https://eloscloud.com', 'http://localhost:3000'];

// Middleware para adicionar cabeçalhos CORS para todas as requisições
router.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Credentials', 'true');

  // Lida com requisições OPTIONS (preflight)
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
 * /blacklist:
 *   post:
 *     summary: Adiciona um token à blacklist
 *     description: Esta rota permite adicionar um token à blacklist para evitar seu uso.
 *     tags: [Blacklist]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token:
 *                 type: string
 *                 description: O token a ser adicionado à blacklist.
 *                 example: "eyJhbGciOiJIUzI1..."
 *     responses:
 *       200:
 *         description: Token adicionado à blacklist com sucesso.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   description: Confirmação da adição.
 *                   example: "Token added to blacklist"
 *       400:
 *         description: Erro na requisição. Parâmetros ausentes ou inválidos.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Erro interno do servidor.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

router.post('/blacklist', verifyToken, addTokenToBlacklist);

/**
 * @swagger
 * /blacklist/{token}:
 *   get:
 *     summary: Verifica se um token está na blacklist
 *     description: Permite verificar se um token específico está presente na blacklist.
 *     tags: [Blacklist]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: O token a ser verificado.
 *         example: "eyJhbGciOiJIUzI1..."
 *     responses:
 *       200:
 *         description: Verificação realizada com sucesso.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 blacklisted:
 *                   type: boolean
 *                   description: Indica se o token está ou não na blacklist.
 *                   example: true
 *       400:
 *         description: Erro na requisição. Parâmetros ausentes ou inválidos.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Erro interno do servidor.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/blacklist/:token', verifyToken, checkTokenBlacklist);

module.exports = router;