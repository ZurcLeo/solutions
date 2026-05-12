const cron = require('node-cron');
const SreAgentService = require('./services/SreAgentService');
const { logger } = require('./logger');

/**
 * SRE Diagnostic Worker
 * Roda a cada 5 minutos em busca de incidentes críticos para diagnosticar via IA.
 */
function startSreWorker() {
  logger.info('SRE Diagnostic Worker: Starting...');

  // Roda a cada 2 minutos
  cron.schedule('*/2 * * * *', async () => {
    logger.info('SRE Diagnostic Worker: Checking for pending incidents');
    
    try {
      const processedCount = await SreAgentService.processPendingIncidents(5);
      if (processedCount > 0) {
        logger.info(`SRE Diagnostic Worker: Successfully processed ${processedCount} incidents`);
      }
    } catch (error) {
      logger.error('SRE Diagnostic Worker: Execution failed', { error: error.message });
    }
  });

  logger.info('SRE Diagnostic Worker: Scheduled (every 2 minutes)');
}

module.exports = { startSreWorker };
