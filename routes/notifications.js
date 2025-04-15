// src/routes/notifications.js
const express = require('express');
const router = express.Router();
const validate = require('../middlewares/validate');
const notificationSchema = require('../schemas/notificationSchema');
const notificationsController = require('../controllers/notificationsController');
const verifyToken = require('../middlewares/auth');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { logger } = require('../logger');
const { healthCheck } = require('../middlewares/healthMiddleware');

const ROUTE_NAME = 'notifications'
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
router.post('/', verifyToken, writeLimit, validate(notificationSchema), notificationsController.createNotification);

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
router.get('/:userId', verifyToken, readLimit, notificationsController.getUserNotifications);

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
router.post('/:userId/markAsRead/:notificationId', verifyToken, writeLimit, validate(notificationSchema), notificationsController.markNotificationAsRead);

module.exports = router;