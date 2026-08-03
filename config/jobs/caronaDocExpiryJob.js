'use strict';

/**
 * caronaDocExpiryJob — Cron job diario 08:00 BRT.
 *
 * [CARONA-GAP-007] Verifica motoristas com documentos proximos de expirar
 * (30 dias) e envia notificacoes. Auto-expira verificacoes vencidas.
 *
 * Dedup: maximo 1 notificacao a cada 7 dias por motorista.
 */

const cron = require('node-cron');
const { logger } = require('../../logger');

const JOB_NAME = 'caronaDocExpiryJob';
let _started = false;

async function _runOnce() {
  logger.info(`[${JOB_NAME}] Iniciando verificacao de validade de documentos`, {
    service: JOB_NAME, action: 'DOC_EXPIRY_CHECK_START',
  });

  try {
    const caronaService = require('../../services/caronaService');
    const result = await caronaService.checkDriverDocExpiry();

    logger.info(`[${JOB_NAME}] Verificacao concluida`, {
      service: JOB_NAME, action: 'DOC_EXPIRY_CHECK_DONE',
      notified: result.notified,
      expired: result.expired,
    });

    return result;
  } catch (err) {
    logger.error(`[${JOB_NAME}] Erro na verificacao de validade`, {
      service: JOB_NAME, action: 'DOC_EXPIRY_CHECK_ERROR', error: err.message,
    });
    throw err;
  }
}

function startCaronaDocExpiryJob() {
  if (_started) return;
  _started = true;

  // Diario as 08:00 BRT
  cron.schedule('0 8 * * *', () => {
    _runOnce().catch(() => {});
  }, { timezone: 'America/Sao_Paulo' });

  logger.info(`[${JOB_NAME}] Job iniciado (cron: diario 08:00 BRT)`, {
    service: JOB_NAME, action: 'DOC_EXPIRY_JOB_REGISTERED',
  });
}

function stopCaronaDocExpiryJob() {
  _started = false;
}

module.exports = { startCaronaDocExpiryJob, stopCaronaDocExpiryJob, _runOnce };
