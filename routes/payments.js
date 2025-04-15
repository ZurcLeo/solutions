const express = require('express');
const router = express.Router();
const paymentsController = require('../controllers/paymentsController');
const verifyToken = require('../middlewares/auth');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { logger } = require('../logger')

const ROUTE_NAME = 'payments'
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
 *   name: Payments
 *   description: Gerenciamento de pagamentos
 */

/**
 * @swagger
 * /payments/all-purchases:
 *   get:
 *     summary: Retorna todas as compras
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de todas as compras
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Purchase'
 *       401:
 *         description: Não autorizado
 *       500:
 *         description: Erro no servidor
 */
router.get('/all-purchases', verifyToken, readLimit, paymentsController.getAllPurchases);

/**
 * @swagger
 * /payments/create-payment-intent:
 *   post:
 *     summary: Cria uma nova intenção de pagamento
 *     tags: [Payments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PaymentIntentRequest'
 *     responses:
 *       200:
 *         description: Intenção de pagamento criada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaymentIntentResponse'
 *       400:
 *         description: Erro na solicitação
 *       500:
 *         description: Erro no servidor
 */
router.post('/create-payment-intent', writeLimit, paymentsController.createPaymentIntent);

/**
 * @swagger
 * /payments/session-status:
 *   get:
 *     summary: Verifica o status da sessão de pagamento
 *     tags: [Payments]
 *     parameters:
 *       - in: query
 *         name: payment_intent
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da intenção de pagamento
 *     responses:
 *       200:
 *         description: Status da sessão de pagamento
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SessionStatus'
 *       400:
 *         description: Erro na solicitação
 *       500:
 *         description: Erro no servidor
 */
router.get('/session-status', readLimit, paymentsController.sessionStatus);

/**
 * @swagger
 * /payments/purchases:
 *   get:
 *     summary: Retorna compras do usuário autenticado
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de compras do usuário
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Purchase'
 *       401:
 *         description: Não autorizado
 *       500:
 *         description: Erro no servidor
 */
router.get('/purchases', readLimit, paymentsController.getPurchases);

module.exports = router;
