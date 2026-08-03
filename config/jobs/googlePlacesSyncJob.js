'use strict';

/**
 * googlePlacesSyncJob — Cron job para sincronizacao periodica do Google Places.
 *
 * Chama googlePlacesService.batchSyncPlaces() diariamente as 05:00 BRT
 * para manter rating, reviews, status e horarios de funcionamento
 * atualizados para todos os sellers vinculados ao Google Places.
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

const JOB_NAME = 'googlePlacesSyncJob';
let _started = false;

async function _runOnce() {
  logger.info(`[${JOB_NAME}] Iniciando sync Google Places programado`, {
    service: JOB_NAME, action: 'GOOGLE_PLACES_SYNC_START',
  });
  try {
    const googlePlacesService = require('../../services/googlePlacesService');
    const result = await googlePlacesService.batchSyncPlaces({ limit: 100, delayMs: 200 });
    logger.info(`[${JOB_NAME}] Sync Google Places concluido`, {
      service: JOB_NAME,
      action: 'GOOGLE_PLACES_SYNC_DONE',
      synced: result.synced,
      failed: result.failed,
      skipped: result.skipped,
    });
    return result;
  } catch (err) {
    logger.error(`[${JOB_NAME}] Erro no sync Google Places programado`, {
      service: JOB_NAME,
      action: 'GOOGLE_PLACES_SYNC_ERROR',
      error: err.message,
    });
    throw err;
  }
}

function startGooglePlacesSyncJob() {
  if (_started) return;
  _started = true;

  // Cron: diariamente as 05:00 BRT (dados do Google mudam lentamente)
  cron.schedule('0 5 * * *', () => {
    _runOnce().catch(() => { /* erros ja logados em _runOnce */ });
  }, { timezone: 'America/Sao_Paulo' });

  // Primeira execucao 5min apos boot (dar tempo do app estabilizar)
  setTimeout(() => {
    _runOnce().catch(() => { /* erros ja logados em _runOnce */ });
  }, 5 * 60 * 1000);

  logger.info(`[${JOB_NAME}] Job iniciado (cron: diario 05:00 BRT, primeiro sync em 5min)`, {
    service: JOB_NAME,
    action: 'GOOGLE_PLACES_SYNC_JOB_REGISTERED',
  });
}

function stopGooglePlacesSyncJob() {
  // node-cron nao expoe handle direto ao usar schedule() sem salvar referencia,
  // mas o flag _started impede re-registro. Em graceful shutdown o processo encerra.
  _started = false;
  logger.info(`[${JOB_NAME}] Job marcado como parado`, {
    service: JOB_NAME,
    action: 'GOOGLE_PLACES_SYNC_JOB_STOPPED',
  });
}

module.exports = { startGooglePlacesSyncJob, stopGooglePlacesSyncJob, _runOnce };
