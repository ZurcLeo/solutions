// routes/messagesV2.js
const express = require('express');
const router = express.Router();
const MessageController = require('../controllers/messageController');
const verifyToken = require('../middlewares/auth');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { logger } = require('../logger');
const { healthCheck } = require('../middlewares/healthMiddleware');

const ROUTE_NAME = 'messages';

// Aplicar middleware de health check a todas as rotas
router.use(healthCheck(ROUTE_NAME));

// Middleware de log para todas as requisições
router.use((req, res, next) => {
  logger.info(`[ROUTE] Requisição recebida em ${ROUTE_NAME}`, {
    path: req.path,
    method: req.method,
    userId: req.user?.uid,
    params: req.params,
    query: req.query
  });
  next();
});

/**
 * @swagger
 * tags:
 *   name: MessagesV2
 *   description: API de mensagens otimizada - Nova versão
 */

/**
 * @swagger
 * /api/v2/messages/conversations:
 *   get:
 *     summary: Obtém todas as conversas do usuário
 *     tags: [MessagesV2]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de conversas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Conversation'
 *       401:
 *         description: Não autorizado
 *       500:
 *         description: Erro no servidor
 */
router.get('/conversations', verifyToken, readLimit, MessageController.getUserConversations);

/**
 * @swagger
 * /api/v2/messages/conversations/{conversationId}:
 *   get:
 *     summary: Obtém mensagens de uma conversa
 *     tags: [MessagesV2]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da conversa
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Limite de mensagens retornadas
 *       - in: query
 *         name: before
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Timestamp para paginação (retorna mensagens antes deste timestamp)
 *     responses:
 *       200:
 *         description: Lista de mensagens
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Message'
 *       401:
 *         description: Não autorizado
 *       403:
 *         description: Acesso proibido
 *       500:
 *         description: Erro no servidor
 */
router.get('/conversations/:conversationId', verifyToken, readLimit, MessageController.getConversationMessages);

/**
 * @swagger
 * /api/v2/messages/user/{otherUserId}:
 *   get:
 *     summary: Obtém mensagens entre o usuário atual e outro usuário
 *     tags: [MessagesV2]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: otherUserId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do outro usuário
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Limite de mensagens retornadas
 *       - in: query
 *         name: before
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Timestamp para paginação
 *     responses:
 *       200:
 *         description: Lista de mensagens
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Message'
 *       401:
 *         description: Não autorizado
 *       500:
 *         description: Erro no servidor
 */
router.get('/user/:otherUserId', verifyToken, readLimit, MessageController.getMessagesBetweenUsers);

/**
 * @swagger
 * /api/v2/messages:
 *   post:
 *     summary: Cria uma nova mensagem
 *     tags: [MessagesV2]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - recipient
 *               - content
 *             properties:
 *               recipient:
 *                 type: string
 *                 description: ID do destinatário
 *               content:
 *                 type: string
 *                 description: Conteúdo da mensagem
 *               type:
 *                 type: string
 *                 description: Tipo da mensagem (text, image, etc.)
 *                 default: text
 *     responses:
 *       201:
 *         description: Mensagem criada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Message'
 *       400:
 *         description: Dados inválidos
 *       401:
 *         description: Não autorizado
 *       500:
 *         description: Erro no servidor
 */
router.post('/', verifyToken, writeLimit, MessageController.createMessage);

/**
 * @swagger
 * /api/v2/messages/conversations/{conversationId}/read:
 *   post:
 *     summary: Marca mensagens como lidas
 *     tags: [MessagesV2]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da conversa
 *     responses:
 *       200:
 *         description: Mensagens marcadas como lidas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     count:
 *                       type: integer
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: Não autorizado
 *       403:
 *         description: Acesso proibido
 *       500:
 *         description: Erro no servidor
 */
router.post('/conversations/:conversationId/read', verifyToken, writeLimit, MessageController.markMessagesAsRead);

/**
 * @swagger
 * /api/v2/messages/conversations/{conversationId}/messages/{messageId}/status:
 *   patch:
 *     summary: Atualiza o status de uma mensagem
 *     tags: [MessagesV2]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da conversa
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da mensagem
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               delivered:
 *                 type: boolean
 *               read:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Status da mensagem atualizado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     status:
 *                       type: object
 *       401:
 *         description: Não autorizado
 *       403:
 *         description: Acesso proibido
 *       500:
 *         description: Erro no servidor
 */
router.patch('/conversations/:conversationId/messages/:messageId/status', 
  verifyToken, writeLimit, MessageController.updateMessageStatus);

/**
 * @swagger
 * /api/v2/messages/conversations/{conversationId}/messages/{messageId}:
 *   delete:
 *     summary: Exclui uma mensagem
 *     tags: [MessagesV2]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da conversa
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da mensagem
 *     responses:
 *       200:
 *         description: Mensagem excluída
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     deleted:
 *                       type: boolean
 *       401:
 *         description: Não autorizado
 *       403:
 *         description: Acesso proibido
 *       500:
 *         description: Erro no servidor
 */
router.delete('/conversations/:conversationId/messages/:messageId', 
  verifyToken, writeLimit, MessageController.deleteMessage);

/**
 * @swagger
 * /api/v2/messages/stats:
 *   get:
 *     summary: Obtém estatísticas de mensagens do usuário
 *     tags: [MessagesV2]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Estatísticas de mensagens
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalConversations:
 *                       type: integer
 *                     totalUnread:
 *                       type: integer
 *                     lastActive:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: Não autorizado
 *       500:
 *         description: Erro no servidor
 */
router.get('/stats', verifyToken, readLimit, MessageController.getUserMessageStats);

/**
 * @swagger
 * /api/v2/messages/migrate:
 *   post:
 *     summary: Migra mensagens do modelo antigo para o novo (apenas para admins)
 *     tags: [MessagesV2]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Migração concluída
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     migratedConversations:
 *                       type: integer
 *                     migratedMessages:
 *                       type: integer
 *       401:
 *         description: Não autorizado
 *       403:
 *         description: Acesso proibido
 *       500:
 *         description: Erro no servidor
 */
// router.post('/migrate', verifyToken, writeLimit, MessageController.migrateUserMessages);

// Finalizar o módulo exportando o router
module.exports = router;

// //routes/messages.js
// const express = require('express');
// const router = express.Router();
// const messageController = require('../controllers/messageController');
// const verifyToken = require('../middlewares/auth');
// const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
// const { logger } = require('../logger')
// const { healthCheck } = require('../middlewares/healthMiddleware');

// const ROUTE_NAME = 'messages'
// // Aplicar middleware de health check a todas as rotas de interests
// router.use(healthCheck(ROUTE_NAME));

// // Middleware de log para todas as requisições
// router.use((req, res, next) => {
//   logger.info(`[ROUTE] Requisição recebida em ${ROUTE_NAME}`, {
//     path: req.path,
//     method: req.method,
//     userId: req.user?.uid,
//     params: req.params,
//     body: req.body,
//     query: req.query,
//   });
//   next();
// });

// /**
//  * @swagger
//  * tags:
//  *   name: Messages
//  *   description: Gerenciamento de mensagens
//  */

// /**
//  * @swagger
//  * /messages:
//  *   get:
//  *     summary: Retorna todas as mensagens
//  *     tags: [Messages]
//  *     responses:
//  *       200:
//  *         description: Mensagens retornadas com sucesso
//  *         content:
//  *           application/json:
//  *             schema:
//  *               type: array
//  *               items:
//  *                 $ref: '#/components/schemas/Message'
//  *       500:
//  *         description: Erro no servidor
//  */
// router.get('/', verifyToken, readLimit, messageController.getAllMessages);

// /**
//  * @swagger
//  * /messages/{uidRemetente}/{uidDestinatario}/{id}:
//  *   get:
//  *     summary: Retorna uma mensagem pelo ID
//  *     tags: [Messages]
//  *     parameters:
//  *       - in: path
//  *         name: uidRemetente
//  *         schema:
//  *           type: string
//  *         required: true
//  *         description: ID do remetente
//  *       - in: path
//  *         name: uidDestinatario
//  *         schema:
//  *           type: string
//  *         required: true
//  *         description: ID do destinatário
//  *       - in: path
//  *         name: id
//  *         schema:
//  *           type: string
//  *         required: true
//  *         description: ID da mensagem
//  *     responses:
//  *       200:
//  *         description: Mensagem retornada com sucesso
//  *         content:
//  *           application/json:
//  *             schema:
//  *               $ref: '#/components/schemas/Message'
//  *       400:
//  *         description: Erro na solicitação
//  *       404:
//  *         description: Mensagem não encontrada
//  *       500:
//  *         description: Erro no servidor
//  */
// router.get('/:uidRemetente/:uidDestinatario/:id', verifyToken, readLimit, messageController.getMessageById);

// /**
//  * @swagger
//  * /messages/user/{uidRemetente}/{uidDestinatario}:
//  *   get:
//  *     summary: Retorna mensagens por ID de usuário
//  *     tags: [Messages]
//  *     parameters:
//  *       - in: path
//  *         name: uidRemetente
//  *         schema:
//  *           type: string
//  *         required: true
//  *         description: ID do remetente
//  *       - in: path
//  *         name: uidDestinatario
//  *         schema:
//  *           type: string
//  *         required: true
//  *         description: ID do destinatário
//  *     responses:
//  *       200:
//  *         description: Mensagens retornadas com sucesso
//  *         content:
//  *           application/json:
//  *             schema:
//  *               type: array
//  *               items:
//  *                 $ref: '#/components/schemas/Message'
//  *       400:
//  *         description: Erro na solicitação
//  *       404:
//  *         description: Usuário não encontrado ou sem mensagens
//  *       500:
//  *         description: Erro no servidor
//  */
// router.get('/:uidRemetente/:uidDestinatario', verifyToken, messageController.getMessagesByUserId);

// /**
//  * @swagger
//  * /messages:
//  *   post:
//  *     summary: Cria uma nova mensagem
//  *     tags: [Messages]
//  *     requestBody:
//  *       required: true
//  *       content:
//  *         application/json:
//  *           schema:
//  *             $ref: '#/components/schemas/Message'
//  *     responses:
//  *       201:
//  *         description: Mensagem criada com sucesso
//  *         content:
//  *           application/json:
//  *             schema:
//  *               $ref: '#/components/schemas/Message'
//  *       400:
//  *         description: Erro na solicitação
//  *       500:
//  *         description: Erro no servidor
//  */
// router.post('/', verifyToken, writeLimit, messageController.createMessage);

// /**
//  * @swagger
//  * /messages/{uidRemetente}/{uidDestinatario}/{id}:
//  *   put:
//  *     summary: Atualiza uma mensagem pelo ID
//  *     tags: [Messages]
//  *     parameters:
//  *       - in: path
//  *         name: uidRemetente
//  *         schema:
//  *           type: string
//  *         required: true
//  *         description: ID do remetente
//  *       - in: path
//  *         name: uidDestinatario
//  *         schema:
//  *           type: string
//  *         required: true
//  *         description: ID do destinatário
//  *       - in: path
//  *         name: id
//  *         schema:
//  *           type: string
//  *         required: true
//  *         description: ID da mensagem
//  *     requestBody:
//  *       required: true
//  *       content:
//  *         application/json:
//  *           schema:
//  *             $ref: '#/components/schemas/Message'
//  *     responses:
//  *       200:
//  *         description: Mensagem atualizada com sucesso
//  *         content:
//  *           application/json:
//  *             schema:
//  *               $ref: '#/components/schemas/Message'
//  *       400:
//  *         description: Erro na solicitação
//  *       404:
//  *         description: Mensagem não encontrada
//  *       500:
//  *         description: Erro no servidor
//  */
// router.put('/:uidRemetente/:uidDestinatario/:id', verifyToken, writeLimit, messageController.updateMessage);

// /**
//  * @swagger
//  * /messages/{uidRemetente}/{uidDestinatario}/{id}:
//  *   delete:
//  *     summary: Deleta uma mensagem pelo ID
//  *     tags: [Messages]
//  *     parameters:
//  *       - in: path
//  *         name: uidRemetente
//  *         schema:
//  *           type: string
//  *         required: true
//  *         description: ID do remetente
//  *       - in: path
//  *         name: uidDestinatario
//  *         schema:
//  *           type: string
//  *         required: true
//  *         description: ID do destinatário
//  *       - in: path
//  *         name: id
//  *         schema:
//  *           type: string
//  *         required: true
//  *         description: ID da mensagem
//  *     responses:
//  *       200:
//  *         description: Mensagem deletada com sucesso
//  *       400:
//  *         description: Erro na solicitação
//  *       404:
//  *         description: Mensagem não encontrada
//  *       500:
//  *         description: Erro no servidor
//  */
// router.delete('/:uidRemetente/:uidDestinatario/:id', verifyToken, writeLimit, messageController.deleteMessage);

// module.exports = router;