const express = require('express');
const router = express.Router();
const recaptchaController = require('../controllers/recaptchaController');
const { logger } = require('../logger')

const ROUTE_NAME = 'recaptcha'
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
 *   name: Recaptcha
 *   description: Verificação de reCAPTCHA
 */

/**
 * @swagger
 * /recaptcha/verify:
 *   post:
 *     summary: Verifica o token reCAPTCHA
 *     tags: [Recaptcha]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token:
 *                 type: string
 *                 description: Token reCAPTCHA a ser verificado
 *                 example: "token_do_recaptcha"
 *     responses:
 *       200:
 *         description: Token verificado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   description: Indica se a verificação foi bem-sucedida
 *                 score:
 *                   type: number
 *                   description: Pontuação do reCAPTCHA
 *                 action:
 *                   type: string
 *                   description: Ação do reCAPTCHA
 *       400:
 *         description: Erro na solicitação
 *       500:
 *         description: Erro no servidor
 */
router.post('/verify', recaptchaController.verifyRecaptcha);

module.exports = router;
