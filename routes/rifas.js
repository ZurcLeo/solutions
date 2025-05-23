const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const rifaSchema = require('../schemas/rifaSchema');
const rifaController = require('../controllers/rifaController');
const { logger } = require('../logger');
const { healthCheck } = require('../middlewares/healthMiddleware');

const ROUTE_NAME = 'rifas';

// Aplicar middleware de health check a todas as rotas de rifas
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
 *   name: Rifas
 *   description: Gerenciamento de rifas
 */

/**
 * @swagger
 * /caixinha/{caixinhaId}/rifas:
 *   get:
 *     summary: Lista todas as rifas de uma caixinha
 *     tags: [Rifas]
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
 *         description: Lista de rifas retornada com sucesso
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
 *                     $ref: '#/components/schemas/Rifa'
 *       401:
 *         description: Usuário não autenticado
 *       500:
 *         description: Erro no servidor
 */
router.get('/:caixinhaId/all',
  verifyToken,
  readLimit,
  rifaController.listarRifas
);

/**
 * @swagger
 * /caixinha/{caixinhaId}/rifas/{rifaId}:
 *   get:
 *     summary: Obtém uma rifa específica
 *     tags: [Rifas]
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
 *         name: rifaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da rifa
 *     responses:
 *       200:
 *         description: Rifa retornada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Rifa'
 *       401:
 *         description: Usuário não autenticado
 *       404:
 *         description: Rifa não encontrada
 *       500:
 *         description: Erro no servidor
 */
router.get('/:caixinhaId/:rifaId',
  verifyToken,
  readLimit,
  rifaController.obterRifa
);

/**
 * @swagger
 * /caixinha/{caixinhaId}/rifas:
 *   post:
 *     summary: Cria uma nova rifa
 *     tags: [Rifas]
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
 *             $ref: '#/components/schemas/RifaCreate'
 *     responses:
 *       201:
 *         description: Rifa criada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Rifa'
 *       400:
 *         description: Dados inválidos
 *       401:
 *         description: Usuário não autenticado
 *       500:
 *         description: Erro no servidor
 */
router.post('/:caixinhaId',
  verifyToken,
  validate(rifaSchema.create),
  writeLimit,
  rifaController.criarRifa
);

/**
 * @swagger
 * /caixinha/{caixinhaId}/rifas/{rifaId}:
 *   put:
 *     summary: Atualiza uma rifa existente
 *     tags: [Rifas]
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
 *         name: rifaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da rifa
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RifaUpdate'
 *     responses:
 *       200:
 *         description: Rifa atualizada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Rifa'
 *       400:
 *         description: Dados inválidos
 *       401:
 *         description: Usuário não autenticado
 *       404:
 *         description: Rifa não encontrada
 *       500:
 *         description: Erro no servidor
 */
router.put('/:caixinhaId/update/:rifaId',
  verifyToken,
  validate(rifaSchema.update),
  writeLimit,
  rifaController.atualizarRifa
);

/**
 * @swagger
 * /caixinha/{caixinhaId}/rifas/{rifaId}/cancelar:
 *   post:
 *     summary: Cancela uma rifa
 *     tags: [Rifas]
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
 *         name: rifaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da rifa
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               motivo:
 *                 type: string
 *                 description: Motivo do cancelamento
 *     responses:
 *       200:
 *         description: Rifa cancelada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Rifa'
 *       401:
 *         description: Usuário não autenticado
 *       404:
 *         description: Rifa não encontrada
 *       500:
 *         description: Erro no servidor
 */
router.post('/:caixinhaId/cancel/:rifaId',
  verifyToken,
  writeLimit,
  rifaController.cancelarRifa
);

/**
 * @swagger
 * /caixinha/{caixinhaId}/rifas/{rifaId}/bilhetes:
 *   post:
 *     summary: Vende um bilhete da rifa
 *     tags: [Rifas]
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
 *         name: rifaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da rifa
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               numeroBilhete:
 *                 type: integer
 *                 description: Número do bilhete a ser vendido
 *     responses:
 *       200:
 *         description: Bilhete vendido com sucesso
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
 *                     numero:
 *                       type: integer
 *                     membroId:
 *                       type: string
 *                     dataCompra:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Dados inválidos ou bilhete já vendido
 *       401:
 *         description: Usuário não autenticado
 *       404:
 *         description: Rifa não encontrada
 *       500:
 *         description: Erro no servidor
 */
router.post('/:caixinhaId/bilhetes/:rifaId',
  verifyToken,
  validate(rifaSchema.venderBilhete),
  writeLimit,
  rifaController.venderBilhete
);

/**
 * @swagger
 * /caixinha/{caixinhaId}/rifas/{rifaId}/sorteio:
 *   post:
 *     summary: Realiza o sorteio da rifa
 *     tags: [Rifas]
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
 *         name: rifaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da rifa
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               metodo:
 *                 type: string
 *                 enum: [LOTERIA, RANDOM_ORG, NIST]
 *                 description: Método de sorteio
 *               referencia:
 *                 type: string
 *                 description: Referência externa (número do concurso, etc)
 *     responses:
 *       200:
 *         description: Sorteio realizado com sucesso
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
 *                     numeroSorteado:
 *                       type: integer
 *                     bilheteVencedor:
 *                       type: object
 *                     verificacaoHash:
 *                       type: string
 *                     dataSorteio:
 *                       type: string
 *                       format: date-time
 *                     comprovante:
 *                       type: string
 *       400:
 *         description: Dados inválidos ou rifa já sorteada
 *       401:
 *         description: Usuário não autenticado
 *       404:
 *         description: Rifa não encontrada
 *       500:
 *         description: Erro no servidor
 */
router.post('/:caixinhaId/sorteio/:rifaId',
  verifyToken,
  validate(rifaSchema.realizarSorteio),
  writeLimit,
  rifaController.realizarSorteio
);

/**
 * @swagger
 * /caixinha/{caixinhaId}/rifas/{rifaId}/autenticidade:
 *   get:
 *     summary: Verifica a autenticidade do sorteio
 *     tags: [Rifas]
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
 *         name: rifaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da rifa
 *     responses:
 *       200:
 *         description: Autenticidade verificada com sucesso
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
 *                     rifaId:
 *                       type: string
 *                     dataVerificacao:
 *                       type: string
 *                       format: date-time
 *                     integridadeOk:
 *                       type: boolean
 *                     fonteExternaOk:
 *                       type: boolean
 *                     metodoSorteio:
 *                       type: string
 *                     hashArmazenado:
 *                       type: string
 *                     hashCalculado:
 *                       type: string
 *       401:
 *         description: Usuário não autenticado
 *       404:
 *         description: Rifa não encontrada ou não sorteada
 *       500:
 *         description: Erro no servidor
 */
router.get('/:caixinhaId/autenticidade/:rifaId',
  verifyToken,
  readLimit,
  rifaController.verificarAutenticidade
);

/**
 * @swagger
 * /caixinha/{caixinhaId}/rifas/{rifaId}/comprovante:
 *   get:
 *     summary: Gera o comprovante do sorteio
 *     tags: [Rifas]
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
 *         name: rifaId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da rifa
 *     responses:
 *       200:
 *         description: Comprovante gerado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: string
 *                   description: URL do comprovante
 *       401:
 *         description: Usuário não autenticado
 *       404:
 *         description: Rifa não encontrada ou não sorteada
 *       500:
 *         description: Erro no servidor
 */
router.get('/:caixinhaId/rifas/:rifaId/comprovante',
  verifyToken,
  readLimit,
  rifaController.gerarComprovante
);

module.exports = router;