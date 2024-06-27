const express = require('express');
const router = express.Router();
const connectionsController = require('../controllers/connectionsController');
const verifyToken = require('../middlewares/auth');

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

/**
 * @swagger
 * tags:
 *   name: Conexões
 *   description: Rotas para gerenciamento de conexões
 */

/**
 * @swagger
 * /connections/active/{id}:
 *   get:
 *     summary: Retorna uma conexão ativa pelo ID
 *     tags: [Conexões]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da conexão ativa
 *     responses:
 *       200:
 *         description: Conexão ativa encontrada
 *       404:
 *         description: Conexão ativa não encontrada
 */
router.get('/active/:id', verifyToken, connectionsController.getActiveConnectionById);

/**
 * @swagger
 * /connections/active:
 *   post:
 *     summary: Cria uma nova conexão ativa
 *     tags: [Conexões]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               interessesPessoais:
 *                 type: array
 *                 items:
 *                   type: string
 *               nome:
 *                 type: string
 *               fotoDoPerfil:
 *                 type: string
 *               interessesNegocios:
 *                 type: array
 *                 items:
 *                   type: string
 *               email:
 *                 type: string
 *               status:
 *                 type: string
 *               dataDoAceite:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Conexão ativa criada com sucesso
 *       500:
 *         description: Erro ao criar conexão ativa
 */
router.post('/active', verifyToken, connectionsController.createActiveConnection);

/**
 * @swagger
 * /connections/active/{id}:
 *   put:
 *     summary: Atualiza uma conexão ativa pelo ID
 *     tags: [Conexões]
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
 *             type: object
 *             properties:
 *               interessesPessoais:
 *                 type: array
 *                 items:
 *                   type: string
 *               nome:
 *                 type: string
 *               fotoDoPerfil:
 *                 type: string
 *               interessesNegocios:
 *                 type: array
 *                 items:
 *                   type: string
 *               email:
 *                 type: string
 *               status:
 *                 type: string
 *               dataDoAceite:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       200:
 *         description: Conexão ativa atualizada com sucesso
 *       500:
 *         description: Erro ao atualizar conexão ativa
 */
router.put('/active/:id', verifyToken, connectionsController.updateActiveConnection);

/**
 * @swagger
 * /connections/active/{id}:
 *   delete:
 *     summary: Deleta uma conexão ativa pelo ID
 *     tags: [Conexões]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da conexão ativa
 *     responses:
 *       204:
 *         description: Conexão ativa deletada com sucesso
 *       500:
 *         description: Erro ao deletar conexão ativa
 */
router.delete('/active/:id', verifyToken, connectionsController.deleteActiveConnection);

/**
 * @swagger
 * /connections/inactive/{id}:
 *   get:
 *     summary: Retorna uma conexão inativa pelo ID
 *     tags: [Conexões]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da conexão inativa
 *     responses:
 *       200:
 *         description: Conexão inativa encontrada
 *       404:
 *         description: Conexão inativa não encontrada
 */
router.get('/inactive/:id', verifyToken, connectionsController.getInactiveConnectionById);

/**
 * @swagger
 * /connections/inactive:
 *   post:
 *     summary: Cria uma nova conexão inativa
 *     tags: [Conexões]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nome:
 *                 type: string
 *               fotoDoPerfil:
 *                 type: string
 *               status:
 *                 type: string
 *               dataSolicitacao:
 *                 type: string
 *                 format: date-time
 *               dataDesfeita:
 *                 type: string
 *                 format: date-time
 *               dataAmizadeDesfeita:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Conexão inativa criada com sucesso
 *       500:
 *         description: Erro ao criar conexão inativa
 */
router.post('/inactive', verifyToken, connectionsController.createInactiveConnection);

/**
 * @swagger
 * /connections/inactive/{id}:
 *   put:
 *     summary: Atualiza uma conexão inativa pelo ID
 *     tags: [Conexões]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da conexão inativa
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nome:
 *                 type: string
 *               fotoDoPerfil:
 *                 type: string
 *               status:
 *                 type: string
 *               dataSolicitacao:
 *                 type: string
 *                 format: date-time
 *               dataDesfeita:
 *                 type: string
 *                 format: date-time
 *               dataAmizadeDesfeita:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       200:
 *         description: Conexão inativa atualizada com sucesso
 *       500:
 *         description: Erro ao atualizar conexão inativa
 */
router.put('/inactive/:id', verifyToken, connectionsController.updateInactiveConnection);

/**
 * @swagger
 * /connections/inactive/{id}:
 *   delete:
 *     summary: Deleta uma conexão inativa pelo ID
 *     tags: [Conexões]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da conexão inativa
 *     responses:
 *       204:
 *         description: Conexão inativa deletada com sucesso
 *       500:
 *         description: Erro ao deletar conexão inativa
 */
router.delete('/inactive/:id', verifyToken, connectionsController.deleteInactiveConnection);

/**
 * @swagger
 * /connections/requested/{id}:
 *   get:
 *     summary: Retorna uma conexão solicitada pelo ID
 *     tags: [Conexões]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da conexão solicitada
 *     responses:
 *       200:
 *         description: Conexão solicitada encontrada
 *       404:
 *         description: Conexão solicitada não encontrada
 */
router.get('/requested/:id', verifyToken, connectionsController.getRequestedConnectionById);

/**
 * @swagger
 * /connections/requested:
 *   post:
 *     summary: Cria uma nova conexão solicitada
 *     tags: [Conexões]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nome:
 *                 type: string
 *               fotoDoPerfil:
 *                 type: string
 *               email:
 *                 type: string
 *               status:
 *                 type: string
 *               dataSolicitacao:
 *                 type: string
 *                 format: date-time
 *               dataDoAceite:
 *                 type: string
 *                 format: date-time
 *               dataDesfeita:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Conexão solicitada criada com sucesso
 *       500:
 *         description: Erro ao criar conexão solicitada
 */
router.post('/requested', verifyToken, connectionsController.createRequestedConnection);

/**
 * @swagger
 * /connections/requested/{id}:
 *   put:
 *     summary: Atualiza uma conexão solicitada pelo ID
 *     tags: [Conexões]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da conexão solicitada
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nome:
 *                 type: string
 *               fotoDoPerfil:
 *                 type: string
 *               email:
 *                 type: string
 *               status:
 *                 type: string
 *               dataSolicitacao:
 *                 type: string
 *                 format: date-time
 *               dataDoAceite:
 *                 type: string
 *                 format: date-time
 *               dataDesfeita:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       200:
 *         description: Conexão solicitada atualizada com sucesso
 *       500:
 *         description: Erro ao atualizar conexão solicitada
 */
router.put('/requested/:id', verifyToken, connectionsController.updateRequestedConnection);

/**
 * @swagger
 * /connections/requested/{id}:
 *   delete:
 *     summary: Deleta uma conexão solicitada pelo ID
 *     tags: [Conexões]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da conexão solicitada
 *     responses:
 *       204:
 *         description: Conexão solicitada deletada com sucesso
 *       500:
 *         description: Erro ao deletar conexão solicitada
 */
router.delete('/requested/:id', verifyToken, connectionsController.deleteRequestedConnection);

module.exports = router;