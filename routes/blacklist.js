// routes/blacklist.js
const express = require('express');
const router = express.Router();
const { addTokenToBlacklist, checkTokenBlacklist } = require('../controllers/blacklistController');
const verifyToken = require('../middlewares/auth');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { logger } = require('../logger')

const ROUTE_NAME = 'blacklist'
// Aplicar middleware de health check a todas as rotas de interests
router.use(healthCheck(ROUTE_NAME));

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
router.post('/blacklist', verifyToken, writeLimit, addTokenToBlacklist);

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
router.get('/blacklist/:token', verifyToken, readLimit, checkTokenBlacklist);

module.exports = router;