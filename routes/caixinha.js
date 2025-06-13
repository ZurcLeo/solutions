const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/auth');
const validate  = require('../middlewares/validate');
const {readLimit, writeLimit} = require('../middlewares/rateLimiter');
const caixinhaSchema = require('../schemas/caixinhaSchema');
const caixinhaInviteSchema = require('../schemas/caixinhaInviteSchema')
const caixinhaController = require('../controllers/caixinhaController');
const caixinhaInviteController = require('../controllers/caixinhaInviteController')
const { logger } = require('../logger');
const { healthCheck } = require('../middlewares/healthMiddleware');
const disputeController = require('../controllers/disputeController');
const loanController = require('../controllers/loanController')
const disputeSchema = require('../schemas/disputeSchema');
const loanSchema = require('../schemas/loanSchema')

const ROUTE_NAME = 'caixinha'
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
 *   name: Caixinhas
 *   description: Gerenciamento de caixinhas
 */

/**
 * @swagger
 * /caixinhas:
 *   get:
 *     summary: Retorna todas as caixinhas do usuario
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de caixinhas retornada com sucesso.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Caixinha'
 *       401:
 *         description: Não autorizado.
 *       500:
 *         description: Erro no servidor.
 */
router.get('/user/:userId', 
  verifyToken, 
  readLimit, 
  caixinhaController.getCaixinhas);

/**
 * @swagger
 * /caixinhas:
 *   post:
 *     summary: Cria uma nova caixinha
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Caixinha'
 *     responses:
 *       201:
 *         description: Caixinha criada com sucesso.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Caixinha'
 *       400:
 *         description: Solicitação inválida.
 *       500:
 *         description: Erro no servidor.
 */
router.post('/', 
  verifyToken, 
  validate(caixinhaSchema.create), 
  writeLimit, 
  caixinhaController.createCaixinha);

/**
 * @swagger
 * /caixinhas/{caixinhaId}:
 *   get:
 *     summary: Retorna uma caixinha pelo ID
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caixinhaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da caixinha
 *     responses:
 *       200:
 *         description: Caixinha retornada com sucesso.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Caixinha'
 *       404:
 *         description: Caixinha não encontrada.
 *       500:
 *         description: Erro no servidor.
 */
router.get('/id/:caixinhaId', 
  verifyToken, 
  readLimit, 
  caixinhaController.getCaixinhaById);

/**
 * @swagger
 * /caixinhas/{caixinhaId}:
 *   put:
 *     summary: Atualiza uma caixinha pelo ID
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caixinhaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da caixinha
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Caixinha'
 *     responses:
 *       200:
 *         description: Caixinha atualizada com sucesso.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Caixinha'
 *       404:
 *         description: Caixinha não encontrada.
 *       500:
 *         description: Erro no servidor.
 */
router.put('/:caixinhaId', 
  verifyToken, 
  // verifyRole(['admin']), 
  validate(caixinhaSchema.update), 
  writeLimit, 
  caixinhaController.updateCaixinha);

/**
 * @swagger
 * /caixinhas/{caixinhaId}:
 *   delete:
 *     summary: Deleta uma caixinha pelo ID
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caixinhaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da caixinha
 *     responses:
 *       200:
 *         description: Caixinha deletada com sucesso.
 *       404:
 *         description: Caixinha não encontrada.
 *       500:
 *         description: Erro no servidor.
 */
router.delete('/:caixinhaId', 
  verifyToken, 
  // verifyRole(['admin']), 
  writeLimit, 
  caixinhaController.deleteCaixinha);

/**
 * @swagger
 * /caixinhas/{caixinhaId}/membros:
 *   post:
 *     summary: Gerencia membros da caixinha
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caixinhaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da caixinha
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               acao:
 *                 type: string
 *                 enum: [adicionar, atualizar, remover, transferir]
 *                 description: Ação a ser realizada.
 *                 example: "adicionar"
 *               membroId:
 *                 type: string
 *                 description: ID do membro.
 *                 example: "user123"
 *               dados:
 *                 type: object
 *                 description: Dados adicionais para a ação.
 *     responses:
 *       200:
 *         description: Ação realizada com sucesso.
 *       400:
 *         description: Solicitação inválida.
 *       500:
 *         description: Erro no servidor.
 */
router.post('/:caixinhaId/membros', 
  verifyToken, 
  // verifyRole(['admin']), 
  validate(caixinhaSchema.membro), 
  writeLimit, 
  caixinhaController.gerenciarMembros);

  /**
 * @swagger
 * /caixinhas/membros/{userId}/convites-enviados:
 *   get:
 *     summary: Lista todos os convites enviados por um usuário
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do usuário
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, accepted, rejected]
 *         description: Filtrar por status do convite
 *     responses:
 *       200:
 *         description: Lista de convites enviados
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   type:
 *                     type: string
 *                   caixinhaId:
 *                     type: string
 *                   targetId:
 *                     type: string
 *                   email:
 *                     type: string
 *                   status:
 *                     type: string
 *                   message:
 *                     type: string
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *       403:
 *         description: Usuário não tem permissão para acessar estes convites
 */
router.get('/membros/:caixinhaId', 
  verifyToken,
  readLimit, 
  caixinhaController.getMembers);

/**
 * @swagger
 * /caixinhas/{caixinhaId}/membros/convite:
 *   post:
 *     summary: Envia convite para um usuário existente
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caixinhaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da caixinha
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               targetId:
 *                 type: string
 *                 description: ID do usuário a ser convidado
 *               senderId:
 *                 type: string
 *                 description: ID do usuário que está enviando o convite
 *               message:
 *                 type: string
 *                 description: Mensagem personalizada do convite
 *     responses:
 *       200:
 *         description: Convite enviado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 inviteId:
 *                   type: string
 *       400:
 *         description: Dados do convite inválidos
 *       403:
 *         description: Usuário sem permissão para convidar
 */
router.post('/membros/:caixinhaId/convite', 
  verifyToken, 
  validate(caixinhaInviteSchema.create),
  writeLimit, 
  caixinhaInviteController.inviteExistingMember);

/**
 * @swagger
 * /caixinhas/{caixinhaId}/membros/convite-email:
 *   post:
 *     summary: Envia convite por email para um novo usuário
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caixinhaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da caixinha
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email do usuário a ser convidado
 *               senderId:
 *                 type: string
 *                 description: ID do usuário que está enviando o convite
 *               message:
 *                 type: string
 *                 description: Mensagem personalizada do convite
 *     responses:
 *       200:
 *         description: Convite enviado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 inviteId:
 *                   type: string
 *       400:
 *         description: Dados do convite inválidos
 *       403:
 *         description: Usuário sem permissão para convidar
 */
router.post('/membros/:caixinhaId/convite-email', 
  verifyToken, 
  validate(caixinhaSchema.conviteEmail),
  writeLimit, 
  caixinhaInviteController.inviteByEmail);

/**
 * @swagger
 * /caixinhas/membros/convite/{caxinhaInviteId}/aceitar:
 *   post:
 *     summary: Aceita um convite de caixinha
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caxinhaInviteId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do convite
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *                 description: ID do usuário que está aceitando o convite
 *     responses:
 *       200:
 *         description: Convite aceito com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 caixinhaId:
 *                   type: string
 *       404:
 *         description: Convite não encontrado
 *       403:
 *         description: Usuário não tem permissão para aceitar este convite
 */
router.post('/membros/convite/:caxinhaInviteId/aceitar', 
  verifyToken,
  writeLimit, 
  caixinhaInviteController.acceptInvite);

/**
 * @swagger
 * /caixinhas/membros/convite/{caxinhaInviteId}/aceitar:
 *   post:
 *     summary: Aceita um convite de caixinha
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caxinhaInviteId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do convite
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *                 description: ID do usuário que está aceitando o convite
 *     responses:
 *       200:
 *         description: Convite aceito com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 caixinhaId:
 *                   type: string
 *       404:
 *         description: Convite não encontrado
 *       403:
 *         description: Usuário não tem permissão para aceitar este convite
 */
router.post('/membros/convite/:caxinhaInviteId/cancelar', 
  verifyToken,
  writeLimit, 
  caixinhaInviteController.cancelInvite);

/**
 * @swagger
 * /caixinhas/membros/convite/{caxinhaInviteId}/aceitar:
 *   post:
 *     summary: Aceita um convite de caixinha
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caxinhaInviteId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do convite
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *                 description: ID do usuário que está aceitando o convite
 *     responses:
 *       200:
 *         description: Convite aceito com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 caixinhaId:
 *                   type: string
 *       404:
 *         description: Convite não encontrado
 *       403:
 *         description: Usuário não tem permissão para aceitar este convite
 */
router.post('/membros/convite/:caxinhaInviteId/reenviar', 
  verifyToken,
  writeLimit, 
  caixinhaInviteController.resendInvite);

/**
 * @swagger
 * /caixinhas/membros/convite/{caxinhaInviteId}/rejeitar:
 *   post:
 *     summary: Rejeita um convite de caixinha
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caxinhaInviteId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do convite
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *                 description: ID do usuário que está rejeitando o convite
 *     responses:
 *       200:
 *         description: Convite rejeitado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       404:
 *         description: Convite não encontrado
 *       403:
 *         description: Usuário não tem permissão para rejeitar este convite
 */
router.post('/membros/convite/:caxinhaInviteId/rejeitar', 
  verifyToken,
  writeLimit, 
  caixinhaInviteController.rejectInvite);

/**
 * @swagger
 * /caixinhas/membros/{userId}/convites-recebidos:
 *   get:
 *     summary: Lista todos os convites recebidos por um usuário
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do usuário
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, accepted, rejected]
 *         description: Filtrar por status do convite
 *     responses:
 *       200:
 *         description: Lista de convites recebidos
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   type:
 *                     type: string
 *                   caixinhaId:
 *                     type: string
 *                   senderId:
 *                     type: string
 *                   status:
 *                     type: string
 *                   message:
 *                     type: string
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *       403:
 *         description: Usuário não tem permissão para acessar estes convites
 */
router.get('/membros/:userId/convites-recebidos', 
  verifyToken,
  readLimit, 
  caixinhaInviteController.getReceivedInvites);

/**
 * @swagger
 * /caixinhas/membros/{userId}/convites-enviados:
 *   get:
 *     summary: Lista todos os convites enviados por um usuário
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do usuário
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, accepted, rejected]
 *         description: Filtrar por status do convite
 *     responses:
 *       200:
 *         description: Lista de convites enviados
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   type:
 *                     type: string
 *                   caixinhaId:
 *                     type: string
 *                   targetId:
 *                     type: string
 *                   email:
 *                     type: string
 *                   status:
 *                     type: string
 *                   message:
 *                     type: string
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *       403:
 *         description: Usuário não tem permissão para acessar estes convites
 */
router.get('/membros/:userId/convites-enviados', 
  verifyToken,
  readLimit, 
  caixinhaInviteController.getSentInvites);

  router.post('/membros/:caixinhaId/convite/:caxinhaInviteId/reenviar-email', caixinhaInviteController.resendInviteEmail);

  router.get('/membros/:caixinhaId/convites', caixinhaInviteController.getCaixinhaInvites);
  router.get('/membros/convite/:caxinhaInviteId', caixinhaInviteController.getInviteDetails);

/**
 * @swagger
 * /caixinha/{caixinhaId}/disputes:
 *   get:
 *     summary: Obtém disputas de uma caixinha
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caixinhaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da caixinha
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, resolved]
 *         description: Filtrar por status da disputa
 *     responses:
 *       200:
 *         description: Lista de disputas retornada com sucesso
 *       500:
 *         description: Erro no servidor
 */
router.get('/:caixinhaId/disputes', 
  verifyToken, 
  readLimit, 
  disputeController.getDisputes);

/**
 * @swagger
 * /caixinha/{caixinhaId}/disputes/{disputeId}:
 *   get:
 *     summary: Obtém uma disputa específica
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caixinhaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da caixinha
 *       - in: path
 *         name: disputeId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da disputa
 *     responses:
 *       200:
 *         description: Disputa retornada com sucesso
 *       404:
 *         description: Disputa não encontrada
 *       500:
 *         description: Erro no servidor
 */
router.get('/:caixinhaId/disputes/:disputeId', 
  verifyToken, 
  readLimit, 
  disputeController.getDisputeById);

/**
 * @swagger
 * /caixinha/{caixinhaId}/disputes:
 *   post:
 *     summary: Cria uma nova disputa
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caixinhaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da caixinha
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [RULE_CHANGE, LOAN_APPROVAL, MEMBER_REMOVAL]
 *               proposedChanges:
 *                 type: object
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Disputa criada com sucesso
 *       400:
 *         description: Solicitação inválida
 *       500:
 *         description: Erro no servidor
 */
router.post('/:caixinhaId/disputes', 
  verifyToken, 
  validate(disputeSchema.create),
  writeLimit, 
  disputeController.createDispute);

/**
 * @swagger
 * /caixinha/{caixinhaId}/disputes/{disputeId}/vote:
 *   post:
 *     summary: Vota em uma disputa
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caixinhaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da caixinha
 *       - in: path
 *         name: disputeId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da disputa
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *               vote:
 *                 type: boolean
 *               comment:
 *                 type: string
 *     responses:
 *       200:
 *         description: Voto registrado com sucesso
 *       400:
 *         description: Solicitação inválida
 *       404:
 *         description: Disputa não encontrada
 *       500:
 *         description: Erro no servidor
 */
router.post('/:caixinhaId/disputes/:disputeId/vote', 
  verifyToken, 
  validate(disputeSchema.vote),
  writeLimit, 
  disputeController.voteOnDispute);

/**
 * @swagger
 * /caixinha/{caixinhaId}/disputes/{disputeId}/cancel:
 *   post:
 *     summary: Cancela uma disputa
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caixinhaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da caixinha
 *       - in: path
 *         name: disputeId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da disputa
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Disputa cancelada com sucesso
 *       400:
 *         description: Solicitação inválida
 *       403:
 *         description: Usuário sem permissão para cancelar
 *       404:
 *         description: Disputa não encontrada
 *       500:
 *         description: Erro no servidor
 */
router.post('/:caixinhaId/disputes/:disputeId/cancel', 
  verifyToken, 
  validate(disputeSchema.cancel),
  writeLimit, 
  disputeController.cancelDispute);

/**
 * @swagger
 * /caixinha/{caixinhaId}/disputes/check:
 *   get:
 *     summary: Verifica se uma ação requer disputas
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caixinhaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da caixinha
 *       - in: query
 *         name: changeType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [RULE_CHANGE, LOAN_APPROVAL, MEMBER_REMOVAL, INITIAL_CONFIG]
 *         description: Tipo de alteração a ser verificada
 *     responses:
 *       200:
 *         description: Resultado da verificação retornado com sucesso
 *       500:
 *         description: Erro no servidor
 */
router.get('/:caixinhaId/disputes/check', 
  verifyToken, 
  readLimit, 
  disputeController.checkDisputeRequirement);

/**
 * @swagger
 * /caixinha/{caixinhaId}/disputes/rule-change:
 *   post:
 *     summary: Cria uma disputa de alteração de regras
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caixinhaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da caixinha
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               currentRules:
 *                 type: object
 *               proposedRules:
 *                 type: object
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Disputa de alteração de regras criada com sucesso
 *       400:
 *         description: Solicitação inválida
 *       500:
 *         description: Erro no servidor
 */
router.post('/:caixinhaId/disputes/rule-change', 
  verifyToken, 
  writeLimit, 
  disputeController.createRuleChangeDispute);

  /**
 * @swagger
 * /caixinha/{caixinhaId}/emprestimos:
 *   get:
 *     summary: Obtém todos os empréstimos de uma caixinha
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caixinhaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da caixinha
 *     responses:
 *       200:
 *         description: Lista de empréstimos retornada com sucesso
 *       500:
 *         description: Erro no servidor
 */
router.get('/:caixinhaId/emprestimos', 
  verifyToken, 
  readLimit, 
  loanController.getLoans);

/**
 * @swagger
 * /caixinha/{caixinhaId}/emprestimos/{loanId}:
 *   get:
 *     summary: Obtém detalhes de um empréstimo específico
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caixinhaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da caixinha
 *       - in: path
 *         name: loanId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do empréstimo
 *     responses:
 *       200:
 *         description: Detalhes do empréstimo retornados com sucesso
 *       404:
 *         description: Empréstimo não encontrado
 *       500:
 *         description: Erro no servidor
 */
router.get('/:caixinhaId/emprestimos/:loanId', 
  verifyToken, 
  readLimit, 
  loanController.getLoanById);

/**
 * @swagger
 * /caixinha/{caixinhaId}/emprestimos:
 *   post:
 *     summary: Solicita um novo empréstimo
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caixinhaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da caixinha
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *                 description: ID do usuário solicitante
 *               valor:
 *                 type: number
 *                 description: Valor solicitado
 *               parcelas:
 *                 type: number
 *                 description: Número de parcelas
 *               motivo:
 *                 type: string
 *                 description: Motivo do empréstimo
 *     responses:
 *       201:
 *         description: Empréstimo solicitado com sucesso
 *       400:
 *         description: Dados inválidos
 *       500:
 *         description: Erro no servidor
 */
router.post('/:caixinhaId/emprestimos', 
  verifyToken, 
  validate(loanSchema.create),
  writeLimit, 
  loanController.requestLoan);

/**
 * @swagger
 * /caixinha/{caixinhaId}/emprestimos/{loanId}/pagamento:
 *   post:
 *     summary: Registra pagamento de um empréstimo
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caixinhaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da caixinha
 *       - in: path
 *         name: loanId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do empréstimo
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               valor:
 *                 type: number
 *                 description: Valor do pagamento
 *               metodo:
 *                 type: string
 *                 description: Método de pagamento (pix, transferencia, etc)
 *     responses:
 *       200:
 *         description: Pagamento registrado com sucesso
 *       400:
 *         description: Dados inválidos
 *       404:
 *         description: Empréstimo não encontrado
 *       500:
 *         description: Erro no servidor
 */
router.post('/:caixinhaId/emprestimos/:loanId/pagamento', 
  verifyToken, 
  validate(loanSchema.payment),
  writeLimit, 
  loanController.makePayment);

/**
 * @swagger
 * /caixinha/{caixinhaId}/emprestimos/{loanId}/aprovar:
 *   post:
 *     summary: Aprova um empréstimo
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caixinhaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da caixinha
 *       - in: path
 *         name: loanId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do empréstimo
 *     responses:
 *       200:
 *         description: Empréstimo aprovado com sucesso
 *       403:
 *         description: Usuário sem permissão
 *       404:
 *         description: Empréstimo não encontrado
 *       500:
 *         description: Erro no servidor
 */
router.post('/:caixinhaId/emprestimos/:loanId/aprovar', 
  verifyToken, 
  writeLimit, 
  loanController.approveLoan);

/**
 * @swagger
 * /caixinha/{caixinhaId}/emprestimos/{loanId}/rejeitar:
 *   post:
 *     summary: Rejeita um empréstimo
 *     tags: [Caixinhas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caixinhaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da caixinha
 *       - in: path
 *         name: loanId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do empréstimo
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Motivo da rejeição
 *     responses:
 *       200:
 *         description: Empréstimo rejeitado com sucesso
 *       403:
 *         description: Usuário sem permissão
 *       404:
 *         description: Empréstimo não encontrado
 *       500:
 *         description: Erro no servidor
 */
router.post('/:caixinhaId/emprestimos/:loanId/rejeitar', 
  verifyToken, 
  validate(loanSchema.reject),
  writeLimit, 
  loanController.rejectLoan);


module.exports = router;