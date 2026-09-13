'use strict';

/**
 * recallJob — Cron diario 10:00 BRT.
 *
 * Varre todos os sellers com regras de recall ativas e
 * dispara lembretes automaticos para clientes que nao
 * interagem ha N dias (orders ou bookings).
 *
 * Dedup via recall_log.dedup_key (semanal) evita duplicatas.
 *
 * RECALL-003 / RECALL-004 / RECALL-005
 */

const cron = require('node-cron');
const { logger } = require('../../logger');

const JOB_NAME = 'recallJob';
let _started = false;

async function _runOnce() {
  logger.info(`[${JOB_NAME}] Iniciando processamento de recall`, {
    service: JOB_NAME, action: 'RECALL_JOB_START',
  });

  try {
    const recallService = require('../../services/recallService');
    const { sellersProcessed, totalRecalls } = await recallService.processAllSellers();

    logger.info(`[${JOB_NAME}] Processamento concluido`, {
      service: JOB_NAME,
      action: 'RECALL_JOB_DONE',
      sellersProcessed,
      totalRecalls,
    });

    return { sellersProcessed, totalRecalls };
  } catch (err) {
    logger.error(`[${JOB_NAME}] Erro no job de recall`, {
      service: JOB_NAME, action: 'RECALL_JOB_ERROR', error: err.message,
    });
    throw err;
  }
}

function startRecallJob() {
  if (_started) return;
  _started = true;

  // Diario as 10:00 BRT (13:00 UTC)
  cron.schedule('0 10 * * *', () => {
    _runOnce().catch(() => {});
  }, { timezone: 'America/Sao_Paulo' });

  logger.info(`[${JOB_NAME}] Job iniciado (cron: diario 10:00 BRT)`, {
    service: JOB_NAME, action: 'RECALL_JOB_REGISTERED',
  });
}

function stopRecallJob() {
  _started = false;
}

module.exports = { startRecallJob, stopRecallJob, _runOnce };
