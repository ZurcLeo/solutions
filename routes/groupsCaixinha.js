const express = require('express');
const router = express.Router();
const groupsCaixinhaController = require('../controllers/groupsCaixinhaController');
const verifyToken = require('../middlewares/auth');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { logger } = require('../logger')

const ROUTE_NAME = 'groupsCaixinha'
// Aplicar middleware de health check a todas as rotas de interests
// router.use(healthCheck(ROUTE_NAME));

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
 *   name: GroupsCaixinha
 *   description: Gerenciamento de grupos de caixinhas
 */

/**
 * @swagger
 * /groups:
 *   get:
 *     summary: Retorna todos os grupos de caixinhas
 *     tags: [GroupsCaixinha]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de grupos de caixinhas
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/GroupCaixinha'
 */
router.get('/', verifyToken, readLimit, groupsCaixinhaController.getGroups);

/**
 * @swagger
 * /groups/{id}:
 *   get:
 *     summary: Retorna um grupo de caixinhas pelo ID
 *     tags: [GroupsCaixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID do grupo de caixinhas
 *     responses:
 *       200:
 *         description: Detalhes do grupo de caixinhas
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GroupCaixinha'
 */
router.get('/:id', verifyToken, readLimit, groupsCaixinhaController.getGroupById);

/**
 * @swagger
 * /groups:
 *   post:
 *     summary: Cria um novo grupo de caixinhas
 *     tags: [GroupsCaixinha]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GroupCaixinha'
 *     responses:
 *       201:
 *         description: Grupo de caixinhas criado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GroupCaixinha'
 */
router.post('/', verifyToken, writeLimit, groupsCaixinhaController.createGroup);

/**
 * @swagger
 * /groups/{id}:
 *   put:
 *     summary: Atualiza um grupo de caixinhas pelo ID
 *     tags: [GroupsCaixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID do grupo de caixinhas
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GroupCaixinha'
 *     responses:
 *       200:
 *         description: Grupo de caixinhas atualizado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GroupCaixinha'
 */
router.put('/:id', verifyToken, writeLimit, groupsCaixinhaController.updateGroup);

/**
 * @swagger
 * /groups/{id}:
 *   delete:
 *     summary: Deleta um grupo de caixinhas pelo ID
 *     tags: [GroupsCaixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID do grupo de caixinhas
 *     responses:
 *       200:
 *         description: Grupo de caixinhas deletado
 */
router.delete('/:id', verifyToken, writeLimit, groupsCaixinhaController.deleteGroup);

module.exports = router;