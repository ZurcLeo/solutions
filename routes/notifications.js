const express = require('express');
const router = express.Router();
const validate = require('../middlewares/validate');
const notificationSchema = require('../schemas/notificationSchema');
const notificationsController = require('../controllers/notificationsController');
const verifyToken = require('../middlewares/auth');
const { logger } = require('../logger')

// Lista de origens permitidas
const allowedOrigins = ['https://eloscloud.com', 'http://localhost:3000', 'https://eloscloudapp-1cefc4b4944e.herokuapp.com'];

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
 * /notifications:
 *   post:
 *     summary: Cria uma nova notificação
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *                 description: ID do usuário (para notificações privadas)
 *               type:
 *                 type: string
 *                 description: Tipo de notificação (private ou global)
 *                 example: "private"
 *               message:
 *                 type: string
 *                 description: Mensagem da notificação
 *                 example: "Você tem uma nova mensagem."
 *     responses:
 *       201:
 *         description: Notificação criada com sucesso
 *       400:
 *         description: Erro na solicitação
 *       500:
 *         description: Erro no servidor
 */
router.post('/', verifyToken, validate(notificationSchema), notificationsController.createNotification);

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
router.get('/:userId', verifyToken, validate(notificationSchema), notificationsController.getUserNotifications);

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
router.post('/:userId/markAsRead', verifyToken, validate(notificationSchema), notificationsController.markAsRead);

module.exports = router;
