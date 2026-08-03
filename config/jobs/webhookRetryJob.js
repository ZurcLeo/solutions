/**
 * @fileoverview Webhook Retry Job
 * Processa webhooks falhados pendentes de re-tentativa.
 * Frequência: a cada 5 minutos.
 */

'use strict';

const { logger } = require('../../logger');

function startWebhookRetryJob() {
  logger.info('[webhookRetryJob] Iniciando job de retry de webhooks (cada 5min)');

  setInterval(async () => {
    try {
      const webhookOutboundService = require('../../services/webhookOutboundService');
      await webhookOutboundService.retryPendingWebhooks();
    } catch (err) {
      logger.error('[webhookRetryJob] Erro no retry de webhooks', { error: err.message });
    }
  }, 5 * 60 * 1000);
}

module.exports = { startWebhookRetryJob };
