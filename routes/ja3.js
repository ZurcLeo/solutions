const express = require('express');
const router = express.Router();
const { calculateJA3 } = require('../controllers/ja3Controller');
const { writeLimit } = require('../middlewares/rateLimiter');
const { logger } = require('../logger')
const { healthCheck } = require('../middlewares/healthMiddleware');

const ROUTE_NAME = 'ja3'
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
 *   name: JA3
 *   description: Cálculo de JA3
 */

/**
 * @swagger
 * /ja3/calculate:
 *   post:
 *     summary: Calcula o hash JA3
 *     tags: [JA3]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               data:
 *                 type: string
 *                 description: Dados para calcular o hash JA3
 *                 example: "example data"
 *     responses:
 *       200:
 *         description: Hash JA3 calculado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 hash:
 *                   type: string
 *                   description: Hash JA3 calculado
 *                   example: "calculated_ja3_hash"
 *       400:
 *         description: Erro na solicitação
 *       500:
 *         description: Erro no servidor
 */
router.post('/calculate', writeLimit, calculateJA3);

module.exports = router;
