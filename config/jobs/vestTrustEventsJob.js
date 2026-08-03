'use strict';

/**
 * vestTrustEventsJob — Cron job para vesting de trust events do marketplace.
 *
 * A cada hora, transiciona trust_events com vesting_status='pending'
 * e vests_at <= NOW() para 'vested', desde que o pedido não esteja em disputa.
 *
 * Padrão: vaultCleanupJob.js / googlePlacesSyncJob.js
 * Ativação: chamado em index.js após server.listen()
 * Migration: 20260701000016_trust_marketplace.sql
 */

const cron = require('node-cron');
const { logger } = require('../../logger');

const JOB_NAME = 'vestTrustEventsJob';
let _started = false;

async function _runOnce() {
  logger.info(`[${JOB_NAME}] Iniciando vesting de trust events`, {
    service: JOB_NAME, action: 'VEST_TRUST_START',
  });

  try {
    const trustMarketplaceService = require('../../services/trustMarketplaceService');
    const result = await trustMarketplaceService.vestPendingEvents();

    logger.info(`[${JOB_NAME}] Vesting concluído`, {
      service: JOB_NAME, action: 'VEST_TRUST_DONE',
      vested: result.vested,
      skipped: result.skipped,
    });

    return result;
  } catch (err) {
    logger.error(`[${JOB_NAME}] Erro no vesting`, {
      service: JOB_NAME, action: 'VEST_TRUST_ERROR',
      error: err.message,
    });
    throw err;
  }
}

function startVestTrustEventsJob() {
  if (_started) return;
  _started = true;

  // Cron: a cada hora (minuto 15)
  cron.schedule('15 * * * *', () => {
    _runOnce().catch(() => { /* erros já logados em _runOnce */ });
  }, { timezone: 'America/Sao_Paulo' });

  // Primeiro run 5 minutos após boot
  setTimeout(() => {
    _runOnce().catch(() => {});
  }, 5 * 60 * 1000);

  logger.info(`[${JOB_NAME}] Job registrado (cron: :15 de cada hora, primeiro em 5min)`, {
    service: JOB_NAME, action: 'VEST_TRUST_JOB_REGISTERED',
  });
}

function stopVestTrustEventsJob() {
  _started = false;
  logger.info(`[${JOB_NAME}] Job marcado como parado`, {
    service: JOB_NAME, action: 'VEST_TRUST_JOB_STOPPED',
  });
}

module.exports = { startVestTrustEventsJob, stopVestTrustEventsJob, _runOnce };
