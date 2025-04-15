const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const inviteSchema = require('../schemas/inviteSchema');
const inviteController = require('../controllers/inviteController');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { logger } = require('../logger');
const { healthCheck } = require('../middlewares/healthMiddleware');

const ROUTE_NAME = 'invites'
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
 * tags:
 *   name: Convite
 *   description: Gerenciamento de convites
 */

/**
 * @swagger
 * /invite/check/{inviteId}:
 *   get:
 *     summary: Verifica a existência e validade de um convite sem validá-lo
 *     tags: [Convite]
 *     parameters:
 *       - in: path
 *         name: inviteId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do convite a ser verificado
 *     responses:
 *       200:
 *         description: Informações básicas do convite retornadas
 *       404:
 *         description: Convite não encontrado
 *       500:
 *         description: Erro no servidor
 */
router.get('/check/:inviteId', inviteController.checkInvite);

/**
 * @swagger
 * /invite/validate:
 *   post:
 *     summary: Valida um convite
 *     tags: [Convite]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               inviteToken:
 *                 type: string
 *                 description: Token do convite a ser validado
 *                 example: some_invite_token
 *     responses:
 *       200:
 *         description: Convite validado com sucesso
 *       400:
 *         description: Erro na solicitação
 *       500:
 *         description: Erro no servidor
 */
router.post('/validate/:inviteId', inviteController.validateInvite);

/**
 * @swagger
 * /invite/invalidate:
 *   post:
 *     summary: Invalida um convite
 *     tags: [Convite]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               inviteToken:
 *                 type: string
 *                 description: Token do convite a ser invalidado
 *                 example: some_invite_token
 *     responses:
 *       200:
 *         description: Convite invalidado com sucesso
 *       400:
 *         description: Erro na solicitação
 *       500:
 *         description: Erro no servidor
 */
router.post('/invalidate', verifyToken, writeLimit, validate(inviteSchema), inviteController.invalidateInvite);

/**
 * @swagger
 * /invite/generate:
 *   post:
 *     summary: Gera um novo convite
 *     tags: [Convite]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 description: Email para o qual o convite será gerado
 *                 example: user@example.com
 *               nome:
 *                 type: string
 *                 description: Nome do amigo
 *                 example: João Silva
 *     responses:
 *       201:
 *         description: Convite gerado com sucesso
 *       400:
 *         description: Erro na solicitação
 *       500:
 *         description: Erro no servidor
 */
router.post('/generate', verifyToken, writeLimit, validate(inviteSchema), inviteController.sendInvite);

/**
 * @swagger
 * /invite/sent/{userId}:
 *   get:
 *     summary: Retorna todos os convites enviados pelo usuário autenticado
 *     tags: [Convite]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do remetente dos convites
 *     responses:
 *       200:
 *         description: Convites enviados retornados com sucesso
 *       500:
 *         description: Erro no servidor
 */
router.get('/sent/:userId', verifyToken, readLimit, validate(inviteSchema), inviteController.getSentInvites);

/**
 * @swagger
 * /invite/resend/{inviteId}:
 *   post:
 *     summary: Reenvia um convite
 *     tags: [Convite]
 *     parameters:
 *       - in: path
 *         name: inviteId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do convite a ser reenviado
 *     responses:
 *       200:
 *         description: Convite reenviado com sucesso
 *       500:
 *         description: Erro no servidor
 */
router.post('/resend/:inviteId', verifyToken, writeLimit, inviteController.resendInvite);

/**
 * @swagger
 * /invite/view/{inviteId}:
 *   get:
 *     summary: Retorna a visualização de um convite por ID.
 *     tags: [Convite]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do remetente dos convites
 *     responses:
 *       200:
 *         description: Convites enviados retornados com sucesso
 *       500:
 *         description: Erro no servidor
 */
router.get('/view/:inviteId', validate(inviteSchema), readLimit, inviteController.getInviteById);

/**
 * @swagger
 * /invite/cancel/{id}:
 *   put:
 *     summary: Cancela um convite
 *     tags: [Convite]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do convite
 *     responses:
 *       200:
 *         description: Convite cancelado com sucesso
 *       500:
 *         description: Erro no servidor
 */
router.put('/cancel/:inviteId', verifyToken, writeLimit, validate(inviteSchema), inviteController.cancelInvite);

module.exports = router;