const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/auth');
const validate  = require('../middlewares/validate');
const {readLimit, writeLimit} = require('../middlewares/rateLimiter');
const caixinhaSchema = require('../schemas/caixinhaSchema');
const caixinhaController = require('../controllers/caixinhaController');
const { logger } = require('../logger');
const { healthCheck } = require('../middlewares/healthMiddleware');

const ROUTE_NAME = 'caixinha'
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
  readLimit, 
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
  writeLimit, 
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
  readLimit, 
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
  writeLimit, 
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
  writeLimit, 
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
  writeLimit, 
  caixinhaController.gerenciarMembros);

module.exports = router;