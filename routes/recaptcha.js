const express = require('express');
const router = express.Router();
const recaptchaController = require('../controllers/recaptchaController');
const { logger } = require('../logger')
const { rateLimiter } = require('../middlewares/rateLimiter')
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
 *   description: Rotas de verificação reCAPTCHA
 */

router.route('/verify')
  .post(rateLimiter, recaptchaController.verifyRecaptcha);

module.exports = router;