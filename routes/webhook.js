const express = require('express');
const webhookController = require('../controllers/webhookController');
const webhookIconController = require('../controllers/webhookIconController');
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
 * Webhook do Asaas para notificações de pagamento
 * Não requer autenticação JWT — validação via asaas-access-token header
 */
router.post('/asaas', webhookLogger, webhookController.asaasWebhook);

/**
 * Webhook do IconChat para eventos de retorno (entrega, falha, opt-out)
 * Não requer autenticação JWT — validação via HMAC (X-Icon-Signature)
 */
router.post('/icon-events', webhookLogger, webhookIconController.handleIconEvent);

/**
 * Webhook do Resend para emails inbound
 */
router.post('/resend-inbound', webhookLogger, webhookController.resendInboundWebhook);

/**
 * Webhook do Resend para eventos de delivery (sent, delivered, bounced, complained)
 */
router.post('/resend-delivery', webhookLogger, webhookController.resendDeliveryWebhook);

/**
 * Webhook do Melhor Envio para atualizacoes de rastreio
 * Nao requer autenticacao JWT — validacao via shared secret
 */
router.post('/melhor-envio', webhookLogger, webhookController.melhorEnvioWebhook);

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
