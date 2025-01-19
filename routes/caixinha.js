const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/auth');
const validate  = require('../middlewares/validate');
const rateLimiterMiddleware = require('../middlewares/rateLimiter');
const caixinhaSchema = require('../schemas/caixinhaSchema');
const caixinhaController = require('../controllers/caixinhaController');
const { logger } = require('../logger');

// Lista de origens permitidas para CORS
const allowedOrigins = ['https://eloscloud.com', 'http://localhost:3000'];

// Middleware para CORS
router.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

// Middleware de log para todas as requisições
router.use((req, res, next) => {
  logger.info('Requisição recebida em rota de caixinha', {
    path: req.path,
    method: req.method,
    userId: req.user?.uid,
    params: req.params,
    query: req.query,
  });
  next();
});

/**
 * @swagger
 * tags:
 *   name: Caixinhas
 *   description: Gerenciamento de caixinhas
 */

/**
 * @swagger
 * /caixinhas:
 *   get:
 *     summary: Retorna todas as caixinhas do usuario
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de caixinhas retornada com sucesso.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Caixinha'
 *       401:
 *         description: Não autorizado.
 *       500:
 *         description: Erro no servidor.
 */
router.get('/:userId', 
  verifyToken, 
  rateLimiterMiddleware.rateLimiter, 
  caixinhaController.getCaixinhas
);

/**
 * @swagger
 * /caixinhas:
 *   post:
 *     summary: Cria uma nova caixinha
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Caixinha'
 *     responses:
 *       201:
 *         description: Caixinha criada com sucesso.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Caixinha'
 *       400:
 *         description: Solicitação inválida.
 *       500:
 *         description: Erro no servidor.
 */
router.post('/', 
  verifyToken, 
  validate(caixinhaSchema.create), 
  rateLimiterMiddleware.rateLimiter, 
  caixinhaController.createCaixinha);

/**
 * @swagger
 * /caixinhas/{caixinhaId}:
 *   get:
 *     summary: Retorna uma caixinha pelo ID
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caixinhaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da caixinha
 *     responses:
 *       200:
 *         description: Caixinha retornada com sucesso.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Caixinha'
 *       404:
 *         description: Caixinha não encontrada.
 *       500:
 *         description: Erro no servidor.
 */
router.get('/:caixinhaId', 
  verifyToken, 
  rateLimiterMiddleware.rateLimiter, 
  caixinhaController.getCaixinhaById);

/**
 * @swagger
 * /caixinhas/{caixinhaId}:
 *   put:
 *     summary: Atualiza uma caixinha pelo ID
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caixinhaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da caixinha
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Caixinha'
 *     responses:
 *       200:
 *         description: Caixinha atualizada com sucesso.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Caixinha'
 *       404:
 *         description: Caixinha não encontrada.
 *       500:
 *         description: Erro no servidor.
 */
router.put('/:caixinhaId', 
  verifyToken, 
  // verifyRole(['admin']), 
  validate(caixinhaSchema.update), 
  rateLimiterMiddleware.rateLimiter, 
  caixinhaController.updateCaixinha);

/**
 * @swagger
 * /caixinhas/{caixinhaId}:
 *   delete:
 *     summary: Deleta uma caixinha pelo ID
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caixinhaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da caixinha
 *     responses:
 *       200:
 *         description: Caixinha deletada com sucesso.
 *       404:
 *         description: Caixinha não encontrada.
 *       500:
 *         description: Erro no servidor.
 */
router.delete('/:caixinhaId', 
  verifyToken, 
  // verifyRole(['admin']), 
  rateLimiterMiddleware.rateLimiter, 
  caixinhaController.deleteCaixinha);

/**
 * @swagger
 * /caixinhas/{caixinhaId}/membros:
 *   post:
 *     summary: Gerencia membros da caixinha
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caixinhaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da caixinha
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               acao:
 *                 type: string
 *                 enum: [adicionar, atualizar, remover, transferir]
 *                 description: Ação a ser realizada.
 *                 example: "adicionar"
 *               membroId:
 *                 type: string
 *                 description: ID do membro.
 *                 example: "user123"
 *               dados:
 *                 type: object
 *                 description: Dados adicionais para a ação.
 *     responses:
 *       200:
 *         description: Ação realizada com sucesso.
 *       400:
 *         description: Solicitação inválida.
 *       500:
 *         description: Erro no servidor.
 */
router.post('/:caixinhaId/membros', 
  verifyToken, 
  // verifyRole(['admin']), 
  validate(caixinhaSchema.membro), 
  rateLimiterMiddleware.rateLimiter, 
  caixinhaController.gerenciarMembros);

module.exports = router;