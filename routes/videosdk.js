const express = require('express');
const router = express.Router();
const videoSdkController = require('../controllers/videoSdkController');
const verifyToken = require('../middlewares/auth');
const { logger } = require('../logger')

const ROUTE_NAME = 'video-sdk'
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
 *   name: VideoSDK
 *   description: Gerenciamento de sessões de vídeo
 */

/**
 * @swagger
 * /video-sdk/get-token:
 *   post:
 *     summary: Obtém um token de autenticação para o SDK de vídeo
 *     tags: [VideoSDK]
 *     responses:
 *       200:
 *         description: Token obtido com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   description: Token de autenticação
 *       500:
 *         description: Erro no servidor
 */
router.post('/get-token', videoSdkController.getToken);

/**
 * @swagger
 * /video-sdk/start-session:
 *   post:
 *     summary: Inicia uma nova sessão de vídeo
 *     tags: [VideoSDK]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Sessão iniciada com sucesso
 *       401:
 *         description: Não autorizado
 *       500:
 *         description: Erro no servidor
 */
router.post('/start-session', verifyToken, videoSdkController.startSession);

/**
 * @swagger
 * /video-sdk/end-session:
 *   post:
 *     summary: Encerra uma sessão de vídeo
 *     tags: [VideoSDK]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Sessão encerrada com sucesso
 *       401:
 *         description: Não autorizado
 *       500:
 *         description: Erro no servidor
 */
router.post('/end-session', verifyToken, videoSdkController.endSession);

/**
 * @swagger
 * /video-sdk/create-meeting:
 *   post:
 *     summary: Cria uma nova reunião de vídeo
 *     tags: [VideoSDK]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Reunião criada com sucesso
 *       401:
 *         description: Não autorizado
 *       500:
 *         description: Erro no servidor
 */
router.post('/create-meeting', verifyToken, videoSdkController.createMeeting);

/**
 * @swagger
 * /video-sdk/validate-meeting/{meetingId}:
 *   post:
 *     summary: Valida uma reunião de vídeo
 *     tags: [VideoSDK]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: meetingId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da reunião
 *     responses:
 *       200:
 *         description: Reunião validada com sucesso
 *       401:
 *         description: Não autorizado
 *       404:
 *         description: Reunião não encontrada
 *       500:
 *         description: Erro no servidor
 */
router.post('/validate-meeting/:meetingId', verifyToken, videoSdkController.validateMeeting);

module.exports = router;
