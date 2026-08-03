'use strict';

/**
 * exemptionExpirationJob — Cron job diario 08:00 BRT.
 *
 * Expira isencoes vencidas e falha ativacoes que nao atingiram
 * o minimo de pedidos dentro do prazo de 30 dias.
 */

const cron = require('node-cron');
const { logger } = require('../../logger');

const JOB_NAME = 'exemptionExpirationJob';
let _started = false;

async function _runOnce() {
  logger.info(`[${JOB_NAME}] Iniciando verificacao de isencoes`, {
    service: JOB_NAME, action: 'EXEMPTION_EXPIRATION_START',
  });

  try {
    const exemptionService = require('../../services/exemptionService');
    const result = await exemptionService.checkExpiration();

    logger.info(`[${JOB_NAME}] Verificacao concluida`, {
      service: JOB_NAME, action: 'EXEMPTION_EXPIRATION_DONE',
      expired: result.expired,
      failed: result.failed,
    });

    return result;
  } catch (err) {
    logger.error(`[${JOB_NAME}] Erro na verificacao de isencoes`, {
      service: JOB_NAME, action: 'EXEMPTION_EXPIRATION_ERROR', error: err.message,
    });
    throw err;
  }
}

function startExemptionExpirationJob() {
  if (_started) return;
  _started = true;

  // Diario as 08:00 BRT
  cron.schedule('0 8 * * *', () => {
    _runOnce().catch(() => {});
  }, { timezone: 'America/Sao_Paulo' });

  logger.info(`[${JOB_NAME}] Job iniciado (cron: diario 08:00 BRT)`, {
    service: JOB_NAME, action: 'EXEMPTION_EXPIRATION_JOB_REGISTERED',
  });
}

function stopExemptionExpirationJob() {
  _started = false;
}

module.exports = { startExemptionExpirationJob, stopExemptionExpirationJob, _runOnce };
