const express = require('express');
const router = express.Router();
const notificationsController = require('../controllers/notificationsController');
const verifyToken = require('../middlewares/auth');

// Lista de origens permitidas
const allowedOrigins = ['https://eloscloud.com', 'http://localhost:3000'];

// Middleware to add CORS headers for all requests
router.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
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
 *   name: Notifications
 *   description: Gerenciamento de notificações
 */

/**
 * @swagger
 * /notifications:
 *   get:
 *     summary: Retorna todas as notificações
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de todas as notificações
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Notification'
 *       401:
 *         description: Não autorizado
 *       500:
 *         description: Erro no servidor
 */
router.get('/', verifyToken, notificationsController.getAllNotifications);

/**
 * @swagger
 * /notifications/{userId}:
 *   get:
 *     summary: Retorna notificações de um usuário específico
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID do usuário
 *     responses:
 *       200:
 *         description: Lista de notificações do usuário
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Notification'
 *       401:
 *         description: Não autorizado
 *       404:
 *         description: Usuário não encontrado
 *       500:
 *         description: Erro no servidor
 */
router.get('/:userId', verifyToken, notificationsController.getUserNotifications);

/**
 * @swagger
 * /notifications/{userId}/markAsRead:
 *   post:
 *     summary: Marca notificações como lidas para um usuário específico
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID do usuário
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notificationId:
 *                 type: string
 *                 description: ID da notificação
 *                 example: "notificationId"
 *               type:
 *                 type: string
 *                 description: Tipo da notificação
 *                 example: "type"
 *     responses:
 *       200:
 *         description: Notificação marcada como lida
 *       400:
 *         description: Erro na solicitação
 *       401:
 *         description: Não autorizado
 *       404:
 *         description: Notificação não encontrada
 *       500:
 *         description: Erro no servidor
 */
router.post('/:userId/markAsRead', verifyToken, notificationsController.markAsRead);

module.exports = router;