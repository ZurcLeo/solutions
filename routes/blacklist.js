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
 * tags:
 *   name: Blacklist
 *   description: Rotas para gerenciamento de tokens na blacklist
 */

/**
 * @swagger
 * /blacklist:
 *   post:
 *     summary: Adiciona um token à blacklist
 *     tags: [Blacklist]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token:
 *                 type: string
 *                 description: Token a ser adicionado à blacklist
 *     responses:
 *       200:
 *         description: Token adicionado à blacklist com sucesso
 *       400:
 *         description: Erro na requisição
 *       500:
 *         description: Erro no servidor
 */
router.post('/blacklist', verifyToken, addTokenToBlacklist);

/**
 * @swagger
 * /blacklist/{token}:
 *   get:
 *     summary: Verifica se um token está na blacklist
 *     tags: [Blacklist]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Token a ser verificado
 *     responses:
 *       200:
 *         description: Token verificado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 blacklisted:
 *                   type: boolean
 *                   description: Indica se o token está na blacklist
 *       400:
 *         description: Erro na requisição
 *       500:
 *         description: Erro no servidor
 */
router.get('/blacklist/:token', verifyToken, checkTokenBlacklist);

module.exports = router;