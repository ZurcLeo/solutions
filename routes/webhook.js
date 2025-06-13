const express = require('express');
const webhookController = require('../controllers/webhookController');
const { logger } = require('../logger');

const router = express.Router();

/**
 * Middleware para logging de webhooks
 */
const webhookLogger = (req, res, next) => {
  logger.info('Webhook recebido', {
    route: 'webhook',
    method: req.method,
    path: req.path,
    headers: {
      'x-signature': req.headers['x-signature'],
      'x-request-id': req.headers['x-request-id'],
      'user-agent': req.headers['user-agent']
    },
    body: req.body,
    action: 'WEBHOOK_RECEIVED'
  });
  next();
};

/**
 * Webhook do Mercado Pago para notificações de pagamento
 * Não requer autenticação pois é chamado pelo Mercado Pago
 */
router.post('/mercadopago', webhookLogger, webhookController.mercadoPagoWebhook);

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