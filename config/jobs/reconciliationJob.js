/**
 * reconciliationJob — Cron jobs para reconciliação de pagamentos PIX.
 *
 * Jobs registrados:
 *   1. DLQ processor   — a cada hora aos :30 → dlqService.processQueue()
 *   2. Scan periódico  — a cada 6h           → dlqService.periodicReconciliation()
 *   3. Cleanup mensal  — todo dia às 03:00    → limpeza indireta via periodicReconciliation
 *
 * Ativação: chamado em index.js após server.listen()
 */
const cron = require('node-cron');
const { logger } = require('../../logger');

let _started = false;

function startReconciliationJob() {
  if (_started) return;
  _started = true;

  const dlqService = require('../../services/dlqService');

  // Job 1: processar DLQ a cada hora aos :30 (evita conflito com outros jobs no :00)
  cron.schedule('30 * * * *', async () => {
    logger.info('reconciliationJob: iniciando DLQ processor', {
      service: 'reconciliationJob', action: 'DLQ_PROCESS_START'
    });
    try {
      await dlqService.processQueue();
    } catch (err) {
      logger.error('reconciliationJob: erro no DLQ processor', {
        service: 'reconciliationJob', error: err.message
      });
    }
  }, { timezone: 'America/Sao_Paulo' });

  // Job 2: scan periódico a cada 6h (00:00, 06:00, 12:00, 18:00 BRT)
  cron.schedule('0 0,6,12,18 * * *', async () => {
    logger.info('reconciliationJob: iniciando scan periódico', {
      service: 'reconciliationJob', action: 'PERIODIC_SCAN_START'
    });
    try {
      await dlqService.periodicReconciliation();
    } catch (err) {
      logger.error('reconciliationJob: erro no scan periódico', {
        service: 'reconciliationJob', error: err.message
      });
    }
  }, { timezone: 'America/Sao_Paulo' });

  logger.info('reconciliationJob: jobs registrados', {
    service: 'reconciliationJob',
    jobs: ['DLQ processor (cada 1h aos :30)', 'Scan periódico (6h: 00:00/06:00/12:00/18:00)']
  });
}

module.exports = { startReconciliationJob };
