'use strict';

/**
 * icalSyncJob — Cron job para sincronizacao automatica de calendarios iCal.
 *
 * Chama icalSyncService.syncAllActiveSources() a cada 30 minutos
 * para manter as datas bloqueadas de imoveis de temporada atualizadas
 * com reservas de plataformas externas (Airbnb, Booking, VRBO).
 *
 * Padroes:
 *   - node-cron (ja presente no package.json)
 *   - Primeiro sync 5min apos boot (estabilizacao)
 *   - Log estruturado via winston logger
 *
 * Ativacao: chamado em index.js apos server.listen()
 */

const cron = require('node-cron');
const { logger } = require('../../logger');

const JOB_NAME = 'icalSyncJob';
let _started = false;

async function _runOnce() {
  logger.info(`[${JOB_NAME}] Iniciando sync iCal programado`, {
    service: JOB_NAME, action: 'ICAL_SYNC_START',
  });
  try {
    const icalSyncService = require('../../services/icalSyncService');
    const result = await icalSyncService.syncAllActiveSources();
    logger.info(`[${JOB_NAME}] Sync iCal concluido`, {
      service: JOB_NAME,
      action: 'ICAL_SYNC_DONE',
      synced: result.synced,
      skipped: result.skipped,
      errors: result.errors,
    });
    return result;
  } catch (err) {
    logger.error(`[${JOB_NAME}] Erro no sync iCal programado`, {
      service: JOB_NAME,
      action: 'ICAL_SYNC_ERROR',
      error: err.message,
    });
    throw err;
  }
}

function startIcalSyncJob() {
  if (_started) return;
  _started = true;

  // Cron: a cada 30 minutos (minuto 0 e 30 de cada hora)
  cron.schedule('0,30 * * * *', () => {
    _runOnce().catch(() => { /* erros ja logados em _runOnce */ });
  }, { timezone: 'America/Sao_Paulo' });

  // Primeira execucao 5min apos boot (dar tempo do app estabilizar)
  setTimeout(() => {
    _runOnce().catch(() => { /* erros ja logados em _runOnce */ });
  }, 5 * 60 * 1000);

  logger.info(`[${JOB_NAME}] Job iniciado (cron: a cada 30min, primeiro sync em 5min)`, {
    service: JOB_NAME,
    action: 'ICAL_SYNC_JOB_REGISTERED',
  });
}

function stopIcalSyncJob() {
  // node-cron nao expoe handle direto ao usar schedule() sem salvar referencia,
  // mas o flag _started impede re-registro. Em graceful shutdown o processo encerra.
  _started = false;
  logger.info(`[${JOB_NAME}] Job marcado como parado`, {
    service: JOB_NAME,
    action: 'ICAL_SYNC_JOB_STOPPED',
  });
}

module.exports = { startIcalSyncJob, stopIcalSyncJob, _runOnce };
