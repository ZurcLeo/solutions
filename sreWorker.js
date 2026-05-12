const cron = require('node-cron');
const SreAgentService = require('./services/SreAgentService');
const { checkPublicServices } = require('./services/healthService');
const healthHistoryService = require('./services/healthHistoryService');
const { logger } = require('./logger');

/**
 * SRE Diagnostic Worker
 * Roda a cada 2 minutos:
 *   1. Processa incidentes pendentes de diagnóstico via IA
 *   2. Captura snapshot do Health Score e persiste em health_history (Fase B)
 */
function startSreWorker() {
  logger.info('SRE Diagnostic Worker: Starting...');

  cron.schedule('*/2 * * * *', async () => {
    logger.info('SRE Diagnostic Worker: Checking for pending incidents');

    // 1. Diagnósticos SRE
    try {
      const processedCount = await SreAgentService.processPendingIncidents(5);
      if (processedCount > 0) {
        logger.info(`SRE Diagnostic Worker: Successfully processed ${processedCount} incidents`);
      }
    } catch (error) {
      logger.error('SRE Diagnostic Worker: Execution failed', { error: error.message });
    }

    // 2. Snapshot periódico de Health Score → health_history
    try {
      const health = await checkPublicServices();
      if (health.healthScore !== undefined) {
        await healthHistoryService.saveSnapshot({
          healthScore:      health.healthScore,
          overallStatus:    health.overallStatus,
          confidence:       health.confidence,
          dependencies:     health.dependencies,
          latencyPenalties: health.latencyPenalties,
        });
        logger.info(`SRE Diagnostic Worker: Health snapshot saved (score=${health.healthScore}, status=${health.overallStatus}, confidence=${health.confidence})`);
      }
    } catch (error) {
      logger.error('SRE Diagnostic Worker: Health snapshot failed', { error: error.message });
    }
  });

  logger.info('SRE Diagnostic Worker: Scheduled (every 2 minutes)');
}

module.exports = { startSreWorker };
