'use strict';

/**
 * addonDeactivationJob — Cron job diário 08:30 BRT.
 *
 * Processa add-ons com status 'pending_deactivation' cujo
 * deactivates_at já passou → inativa e desprovisiona.
 */

const cron = require('node-cron');
const { logger } = require('../../logger');

const JOB_NAME = 'addonDeactivationJob';
let _started = false;

async function _runOnce() {
  logger.info(`[${JOB_NAME}] Iniciando verificação de add-ons pendentes`, {
    service: JOB_NAME, action: 'ADDON_DEACTIVATION_START',
  });

  try {
    const addonService = require('../../services/addonService');
    const result = await addonService.processScheduledDeactivations();

    logger.info(`[${JOB_NAME}] Verificação concluída`, {
      service: JOB_NAME, action: 'ADDON_DEACTIVATION_DONE',
      processed: result.processed,
    });

    return result;
  } catch (err) {
    logger.error(`[${JOB_NAME}] Erro na verificação de add-ons`, {
      service: JOB_NAME, action: 'ADDON_DEACTIVATION_ERROR', error: err.message,
    });
    throw err;
  }
}

function startAddonDeactivationJob() {
  if (_started) return;
  _started = true;

  // Diário às 08:30 BRT (após exemptionExpiration 08:00)
  cron.schedule('30 8 * * *', () => {
    _runOnce().catch(() => {});
  }, { timezone: 'America/Sao_Paulo' });

  logger.info(`[${JOB_NAME}] Job iniciado (cron: diário 08:30 BRT)`, {
    service: JOB_NAME, action: 'ADDON_DEACTIVATION_JOB_REGISTERED',
  });
}

function stopAddonDeactivationJob() {
  _started = false;
}

module.exports = { startAddonDeactivationJob, stopAddonDeactivationJob, _runOnce };
