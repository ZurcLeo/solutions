const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
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
 *   name: Messages
 *   description: Gerenciamento de mensagens
 */

/**
 * @swagger
 * /messages:
 *   get:
 *     summary: Retorna todas as mensagens
 *     tags: [Messages]
 *     responses:
 *       200:
 *         description: Mensagens retornadas com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Message'
 *       500:
 *         description: Erro no servidor
 */
router.get('/', verifyToken, messageController.getAllMessages);

/**
 * @swagger
 * /messages/{uidRemetente}/{uidDestinatario}/{id}:
 *   get:
 *     summary: Retorna uma mensagem pelo ID
 *     tags: [Messages]
 *     parameters:
 *       - in: path
 *         name: uidRemetente
 *         schema:
 *           type: string
 *         required: true
 *         description: ID do remetente
 *       - in: path
 *         name: uidDestinatario
 *         schema:
 *           type: string
 *         required: true
 *         description: ID do destinatário
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da mensagem
 *     responses:
 *       200:
 *         description: Mensagem retornada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Message'
 *       400:
 *         description: Erro na solicitação
 *       404:
 *         description: Mensagem não encontrada
 *       500:
 *         description: Erro no servidor
 */
router.get('/:uidRemetente/:uidDestinatario/:id', verifyToken, messageController.getMessageById);

/**
 * @swagger
 * /messages/user/{uidRemetente}/{uidDestinatario}:
 *   get:
 *     summary: Retorna mensagens por ID de usuário
 *     tags: [Messages]
 *     parameters:
 *       - in: path
 *         name: uidRemetente
 *         schema:
 *           type: string
 *         required: true
 *         description: ID do remetente
 *       - in: path
 *         name: uidDestinatario
 *         schema:
 *           type: string
 *         required: true
 *         description: ID do destinatário
 *     responses:
 *       200:
 *         description: Mensagens retornadas com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Message'
 *       400:
 *         description: Erro na solicitação
 *       404:
 *         description: Usuário não encontrado ou sem mensagens
 *       500:
 *         description: Erro no servidor
 */
router.get('/user/:uidRemetente/:uidDestinatario', verifyToken, messageController.getMessagesByUserId);

/**
 * @swagger
 * /messages:
 *   post:
 *     summary: Cria uma nova mensagem
 *     tags: [Messages]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Message'
 *     responses:
 *       201:
 *         description: Mensagem criada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Message'
 *       400:
 *         description: Erro na solicitação
 *       500:
 *         description: Erro no servidor
 */
router.post('/', verifyToken, messageController.createMessage);

/**
 * @swagger
 * /messages/{uidRemetente}/{uidDestinatario}/{id}:
 *   put:
 *     summary: Atualiza uma mensagem pelo ID
 *     tags: [Messages]
 *     parameters:
 *       - in: path
 *         name: uidRemetente
 *         schema:
 *           type: string
 *         required: true
 *         description: ID do remetente
 *       - in: path
 *         name: uidDestinatario
 *         schema:
 *           type: string
 *         required: true
 *         description: ID do destinatário
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da mensagem
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Message'
 *     responses:
 *       200:
 *         description: Mensagem atualizada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Message'
 *       400:
 *         description: Erro na solicitação
 *       404:
 *         description: Mensagem não encontrada
 *       500:
 *         description: Erro no servidor
 */
router.put('/:uidRemetente/:uidDestinatario/:id', verifyToken, messageController.updateMessage);

/**
 * @swagger
 * /messages/{uidRemetente}/{uidDestinatario}/{id}:
 *   delete:
 *     summary: Deleta uma mensagem pelo ID
 *     tags: [Messages]
 *     parameters:
 *       - in: path
 *         name: uidRemetente
 *         schema:
 *           type: string
 *         required: true
 *         description: ID do remetente
 *       - in: path
 *         name: uidDestinatario
 *         schema:
 *           type: string
 *         required: true
 *         description: ID do destinatário
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da mensagem
 *     responses:
 *       200:
 *         description: Mensagem deletada com sucesso
 *       400:
 *         description: Erro na solicitação
 *       404:
 *         description: Mensagem não encontrada
 *       500:
 *         description: Erro no servidor
 */
router.delete('/:uidRemetente/:uidDestinatario/:id', verifyToken, messageController.deleteMessage);

module.exports = router;