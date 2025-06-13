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

router.post('/pix', verifyToken, paymentsController.createPixPayment);
router.get('/status/:paymentId', verifyToken, paymentsController.checkPixPaymentStatus);

/**
 * @swagger
 * /payments/card:
 *   post:
 *     summary: Processa pagamento com cartão usando MercadoPago SDK V2
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - device_id
 *               - amount
 *               - payer
 *             properties:
 *               token:
 *                 type: string
 *                 description: Token do cartão gerado pelo SDK V2
 *               device_id:
 *                 type: string
 *                 description: ID do dispositivo gerado automaticamente pelo SDK V2
 *               amount:
 *                 type: number
 *                 description: Valor do pagamento
 *               currency:
 *                 type: string
 *                 default: BRL
 *               description:
 *                 type: string
 *                 description: Descrição do pagamento
 *               payer:
 *                 type: object
 *                 required:
 *                   - email
 *                   - identification
 *                 properties:
 *                   email:
 *                     type: string
 *                   first_name:
 *                     type: string
 *                   last_name:
 *                     type: string
 *                   identification:
 *                     type: object
 *                     properties:
 *                       type:
 *                         type: string
 *                         enum: [CPF, CNPJ]
 *                       number:
 *                         type: string
 *               installments:
 *                 type: integer
 *                 default: 1
 *               payment_method_id:
 *                 type: string
 *                 description: ID do método de pagamento (visa, mastercard, etc)
 *               issuer_id:
 *                 type: string
 *                 description: ID do emissor do cartão
 *               metadata:
 *                 type: object
 *                 description: Metadados adicionais
 *     responses:
 *       200:
 *         description: Pagamento processado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [approved, pending, rejected]
 *                 status_detail:
 *                   type: string
 *                 payment_method_id:
 *                   type: string
 *                 amount:
 *                   type: number
 *                 installments:
 *                   type: integer
 *                 date_created:
 *                   type: string
 *                 date_approved:
 *                   type: string
 *       400:
 *         description: Dados inválidos ou pagamento rejeitado
 *       401:
 *         description: Não autorizado
 *       500:
 *         description: Erro no servidor
 */
router.post('/card', verifyToken, writeLimit, paymentsController.createCardPayment);

module.exports = router;
