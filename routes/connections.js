const express = require('express');
const router = express.Router();
const connectionsController = require('../controllers/connectionsController');
const verifyToken = require('../middlewares/auth');
const { logger } = require('../logger');
const { healthCheck } = require('../middlewares/healthMiddleware');

const ROUTE_NAME = 'connections';
// Aplicar middleware de health check a todas as rotas de conexões
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

// ===== Conexões Ativas =====
router.route('/requests/:senderId/accept')  /**
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
  .post(verifyToken, connectionsController.acceptConnectionRequest);

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

router.route('/active/bestfriend/:friendId')
  /**
   * @swagger
   * /connections/active/bestfriend/{friendId}:
   *   put:
   *     summary: Adiciona um amigo como melhor amigo
   *     tags: [Conexões]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: friendId
   *         required: true
   *         schema:
   *           type: string
   *         description: ID do amigo
   *     responses:
   *       200:
   *         description: Melhor amigo adicionado com sucesso.
   *       404:
   *         description: Amigo não encontrado.
   *       500:
   *         description: Erro no servidor.
   */
  .put(verifyToken, connectionsController.addBestFriend)
  /**
   * @swagger
   * /connections/active/bestfriend/{friendId}:
   *   delete:
   *     summary: Remove um amigo da lista de melhores amigos
   *     tags: [Conexões]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: friendId
   *         required: true
   *         schema:
   *           type: string
   *         description: ID do amigo
   *     responses:
   *       200:
   *         description: Melhor amigo removido com sucesso.
   *       404:
   *         description: Amigo não encontrado.
   *       500:
   *         description: Erro no servidor.
   */
  .delete(verifyToken, connectionsController.removeBestFriend);
  
router.route('/active/:connectionId')
  /**
   * @swagger
   * /connections/active/{connectionId}:
   *   get:
   *     summary: Obtém uma conexão ativa específica
   *     tags: [Conexões]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: connectionId
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
   * /connections/active/{connectionId}:
   *   put:
   *     summary: Atualiza uma conexão ativa
   *     tags: [Conexões]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: connectionId
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
   * /connections/active/{connectionId}:
   *   delete:
   *     summary: Remove uma conexão ativa
   *     tags: [Conexões]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: connectionId
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

// ===== Conexões Solicitadas =====
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

router.route('/requested/user/:userId')
  /**
   * @swagger
   * /connections/requested/user/{userId}:
   *   get:
   *     summary: Lista todas as solicitações de conexão de um usuário
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
   *         description: Lista de solicitações retornada com sucesso.
   *       404:
   *         description: Usuário não encontrado.
   *       500:
   *         description: Erro no servidor.
   */
  .get(verifyToken, connectionsController.getRequestedConnectionById);

router.route('/requested/:requestId')
  /**
   * @swagger
   * /connections/requested/{requestId}:
   *   put:
   *     summary: Atualiza uma solicitação de conexão
   *     tags: [Conexões]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: requestId
   *         required: true
   *         schema:
   *           type: string
   *         description: ID da solicitação de conexão
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/RequestedConnection'
   *     responses:
   *       200:
   *         description: Solicitação atualizada com sucesso.
   *       404:
   *         description: Solicitação não encontrada.
   *       500:
   *         description: Erro no servidor.
   */
  .put(verifyToken, connectionsController.updateRequestedConnection)
  /**
   * @swagger
   * /connections/requested/{requestId}:
   *   delete:
   *     summary: Remove uma solicitação de conexão
   *     tags: [Conexões]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: requestId
   *         required: true
   *         schema:
   *           type: string
   *         description: ID da solicitação de conexão
   *     responses:
   *       204:
   *         description: Solicitação removida com sucesso.
   *       404:
   *         description: Solicitação não encontrada.
   *       500:
   *         description: Erro no servidor.
   */
  .delete(verifyToken, connectionsController.deleteRequestedConnection);

// ===== Conexões Inativas =====
router.route('/inactive')
  /**
   * @swagger
   * /connections/inactive:
   *   post:
   *     summary: Registra uma nova conexão inativa
   *     tags: [Conexões]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/InactiveConnection'
   *     responses:
   *       201:
   *         description: Conexão inativa registrada com sucesso.
   *       400:
   *         description: Erro de validação ou dados inválidos.
   *       500:
   *         description: Erro no servidor.
   */
  .post(verifyToken, connectionsController.createInactiveConnection);

// router.route('/inactive/user/:userId')
  /**
   * @swagger
   * /connections/inactive/user/{userId}:
   *   get:
   *     summary: Lista todas as conexões inativas de um usuário
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
   *         description: Lista de conexões inativas retornada com sucesso.
   *       404:
   *         description: Usuário não encontrado.
   *       500:
   *         description: Erro no servidor.
   */
  // .get(verifyToken, connectionsController.getInactiveConnectionsByUserId);

router.route('/inactive/:connectionId')
  /**
   * @swagger
   * /connections/inactive/{connectionId}:
   *   get:
   *     summary: Obtém uma conexão inativa específica
   *     tags: [Conexões]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: connectionId
   *         required: true
   *         schema:
   *           type: string
   *         description: ID da conexão inativa
   *     responses:
   *       200:
   *         description: Conexão inativa retornada com sucesso.
   *       404:
   *         description: Conexão inativa não encontrada.
   *       500:
   *         description: Erro no servidor.
   */
  .get(verifyToken, connectionsController.getInactiveConnectionById)
  /**
   * @swagger
   * /connections/inactive/{connectionId}:
   *   put:
   *     summary: Atualiza uma conexão inativa
   *     tags: [Conexões]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: connectionId
   *         required: true
   *         schema:
   *           type: string
   *         description: ID da conexão inativa
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/InactiveConnection'
   *     responses:
   *       200:
   *         description: Conexão inativa atualizada com sucesso.
   *       404:
   *         description: Conexão inativa não encontrada.
   *       500:
   *         description: Erro no servidor.
   */
  .put(verifyToken, connectionsController.updateInactiveConnection)
  /**
   * @swagger
   * /connections/inactive/{connectionId}:
   *   delete:
   *     summary: Remove uma conexão inativa
   *     tags: [Conexões]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: connectionId
   *         required: true
   *         schema:
   *           type: string
   *         description: ID da conexão inativa
   *     responses:
   *       204:
   *         description: Conexão inativa removida com sucesso.
   *       404:
   *         description: Conexão inativa não encontrada.
   *       500:
   *         description: Erro no servidor.
   */
  .delete(verifyToken, connectionsController.deleteInactiveConnection);

module.exports = router;