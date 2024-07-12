const express = require('express');
const router = express.Router();
const groupsCaixinhaController = require('../controllers/groupsCaixinhaController');
const verifyToken = require('../middlewares/auth');
const { logger } = require('../logger')

// Lista de origens permitidas
const allowedOrigins = ['https://eloscloud.com', 'http://localhost:3000'];

// Middleware to add CORS headers for all requests
router.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Credentials', 'true');

  // Handle preflight OPTIONS request
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
router.get('/', verifyToken, groupsCaixinhaController.getGroups);

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
router.get('/:id', verifyToken, groupsCaixinhaController.getGroupById);

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
router.post('/', verifyToken, groupsCaixinhaController.createGroup);

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
router.put('/:id', verifyToken, groupsCaixinhaController.updateGroup);

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
router.delete('/:id', verifyToken, groupsCaixinhaController.deleteGroup);

module.exports = router;