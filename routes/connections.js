const express = require('express');
const router = express.Router();
const connectionsController = require('../controllers/connectionsController');
const verifyToken = require('../middlewares/auth');
const { logger } = require('../logger');

// Lista de origens permitidas
const allowedOrigins = ['https://eloscloud.com', 'http://localhost:3000'];

// Middleware CORS e Logger
router.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

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

// Conexões Ativas
router.route('/active')
/**
 * @swagger
 * /connections/active:
 *   post:
 *     summary: Cria uma nova conexão ativa
 *     tags: [Conexões]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ActiveConnection'
 *     responses:
 *       201:
 *         description: Conexão criada com sucesso.
 *       400:
 *         description: Erro de validação ou dados inválidos.
 *       500:
 *         description: Erro no servidor.
 */
  .post(verifyToken, connectionsController.createActiveConnection);

router.route('/active/user/:userId')
/**
 * @swagger
 * /connections/active/user/{userId}:
 *   get:
 *     summary: Lista todas as conexões de um usuário
 *     tags: [Conexões]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do usuário
 *     responses:
 *       200:
 *         description: Lista de conexões retornada com sucesso.
 *       404:
 *         description: Usuário não encontrado.
 *       500:
 *         description: Erro no servidor.
 */
  .get(verifyToken, connectionsController.getConnectionsByUserId);

router.route('/active/:id')
/**
 * @swagger
 * /connections/active/{id}:
 *   get:
 *     summary: Obtém uma conexão ativa específica
 *     tags: [Conexões]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da conexão ativa
 *     responses:
 *       200:
 *         description: Conexão retornada com sucesso.
 *       404:
 *         description: Conexão não encontrada.
 *       500:
 *         description: Erro no servidor.
 */
  .get(verifyToken, connectionsController.getActiveConnectionById)

/**
 * @swagger
 * /connections/active/{id}:
 *   put:
 *     summary: Atualiza uma conexão ativa
 *     tags: [Conexões]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da conexão ativa
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ActiveConnection'
 *     responses:
 *       200:
 *         description: Conexão atualizada com sucesso.
 *       404:
 *         description: Conexão não encontrada.
 *       500:
 *         description: Erro no servidor.
 */
  .put(verifyToken, connectionsController.updateActiveConnection)

/**
 * @swagger
 * /connections/active/{id}:
 *   delete:
 *     summary: Remove uma conexão ativa
 *     tags: [Conexões]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da conexão ativa
 *     responses:
 *       204:
 *         description: Conexão removida com sucesso.
 *       404:
 *         description: Conexão não encontrada.
 *       500:
 *         description: Erro no servidor.
 */
  .delete(verifyToken, connectionsController.deleteActiveConnection);

// Conexões Solicitadas
router.route('/requested')
/**
 * @swagger
 * /connections/requested:
 *   post:
 *     summary: Cria uma nova solicitação de conexão
 *     tags: [Conexões]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RequestedConnection'
 *     responses:
 *       201:
 *         description: Solicitação criada com sucesso.
 *       400:
 *         description: Solicitação já existente.
 *       500:
 *         description: Erro no servidor.
 */
  .post(verifyToken, connectionsController.createRequestedConnection);

router.route('/requested/:id')
/**
 * @swagger
 * /connections/requested/{id}:
 *   get:
 *     summary: Obtém uma solicitação de conexão específica
 *     tags: [Conexões]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da solicitação de conexão
 *     responses:
 *       200:
 *         description: Solicitação retornada com sucesso.
 *       404:
 *         description: Solicitação não encontrada.
 *       500:
 *         description: Erro no servidor.
 */
  .get(verifyToken, connectionsController.getRequestedConnectionById)
  .put(verifyToken, connectionsController.updateRequestedConnection)
  .delete(verifyToken, connectionsController.deleteRequestedConnection);

// Conexões Inativas
router.route('/inactive')
  /**
   * @swagger
   * /connections/inactive:
   *   post:
   *     summary: Registra uma conexão inativa
   */
  .post(verifyToken, connectionsController.createInactiveConnection);

router.route('/inactive/:id')
  /**
   * @swagger
   * /connections/inactive/{id}:
   *   get:
   *     summary: Obtém uma conexão inativa
   *   put:
   *     summary: Atualiza uma conexão inativa
   *   delete:
   *     summary: Remove uma conexão inativa
   */
  .get(verifyToken, connectionsController.getInactiveConnectionById)
  .put(verifyToken, connectionsController.updateInactiveConnection)
  .delete(verifyToken, connectionsController.deleteInactiveConnection);

module.exports = router;