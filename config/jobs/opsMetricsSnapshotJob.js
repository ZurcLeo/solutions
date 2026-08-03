'use strict';

/**
 * opsMetricsSnapshotJob — Cron diario 06:00 BRT (03:00 UTC).
 *
 * Agrega metricas de negocio e salva snapshot diario.
 */

const cron = require('node-cron');
const { logger } = require('../../logger');

const JOB_NAME = 'opsMetricsSnapshotJob';
let _started = false;

async function _runOnce() {
  logger.info(`[${JOB_NAME}] Iniciando snapshot de metricas`, {
    service: JOB_NAME, action: 'OPS_SNAPSHOT_START',
  });

  try {
    const opsMetricsService = require('../../services/opsMetricsService');
    const result = await opsMetricsService.snapshotDaily();

    logger.info(`[${JOB_NAME}] Snapshot concluido`, {
      service: JOB_NAME, action: 'OPS_SNAPSHOT_DONE',
      date: result?.snapshot_date,
    });

    return result;
  } catch (err) {
    logger.error(`[${JOB_NAME}] Erro no snapshot`, {
      service: JOB_NAME, action: 'OPS_SNAPSHOT_ERROR', error: err.message,
    });
    throw err;
  }
}

function startOpsMetricsSnapshotJob() {
  if (_started) return;
  _started = true;

  // Diario as 06:00 BRT (03:00 UTC)
  cron.schedule('0 6 * * *', () => {
    _runOnce().catch(() => {});
  }, { timezone: 'America/Sao_Paulo' });

  logger.info(`[${JOB_NAME}] Job iniciado (cron: diario 06:00 BRT)`, {
    service: JOB_NAME, action: 'OPS_SNAPSHOT_JOB_REGISTERED',
  });
}

function stopOpsMetricsSnapshotJob() {
  _started = false;
}

module.exports = { startOpsMetricsSnapshotJob, stopOpsMetricsSnapshotJob, _runOnce };
