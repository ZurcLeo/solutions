const express = require('express');
const webhookController = require('../controllers/webhookController');
const { logger } = require('../logger');

const router = express.Router();

/**
 * Middleware para logging de webhooks
 */
const webhookLogger = (req, res, next) => {
  logger.info('Webhook recebido', { sreContext: req.sreContext || 'no-context' });
  next();
};

/**
 * Webhook do Mercado Pago para notificações de pagamento
 * Não requer autenticação pois é chamado pelo Mercado Pago
 */
router.post('/mercadopago', webhookLogger, webhookController.mercadoPagoWebhook);

/**
 * Webhook do Asaas para notificações de pagamento PIX
 * Não requer autenticação JWT — validação via asaas-access-token header
 */
router.post('/asaas', webhookLogger, webhookController.asaasWebhook);

/**
 * Endpoint de teste para webhook (apenas em desenvolvimento)
 */
if (process.env.NODE_ENV === 'development') {
  router.post('/test', (req, res) => {
    logger.info('Webhook de teste chamado', {
      route: 'webhook',
      body: req.body,
      action: 'TEST_WEBHOOK'
    });
    res.json({ status: 'test webhook received', timestamp: new Date().toISOString() });
  });
}

module.exports = router;