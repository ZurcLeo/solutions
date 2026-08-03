'use strict';
// raffleExpirationJob.js — JOGOS-OPS-001
// Libera bilhetes de rifa reservados há mais de 30min sem pagamento confirmado.

const { logger } = require('../../logger');
const raffleGamesService = require('../../services/raffleGamesService');

const JOB_NAME    = 'raffleExpirationJob';
const INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

let _intervalId = null;

async function _runOnce() {
  try {
    const result = await raffleGamesService.cancelExpiredReservations();
    if (result?.released > 0) {
      logger.info(`[${JOB_NAME}] ${result.released} bilhete(s) expirado(s) liberado(s)`);
    }
  } catch (err) {
    logger.error(`[${JOB_NAME}] Erro ao liberar bilhetes expirados`, { error: err.message });
  }
}

function startRaffleExpirationJob() {
  if (_intervalId) return; // já rodando
  _runOnce(); // executa imediatamente no startup
  _intervalId = setInterval(_runOnce, INTERVAL_MS);
  logger.info(`[${JOB_NAME}] Job iniciado (intervalo: ${INTERVAL_MS / 1000}s)`);
}

function stopRaffleExpirationJob() {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
    logger.info(`[${JOB_NAME}] Job parado`);
  }
}

module.exports = { startRaffleExpirationJob, stopRaffleExpirationJob };
