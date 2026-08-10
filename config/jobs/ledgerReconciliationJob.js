'use strict';

/**
 * ledgerReconciliationJob — Cron diario de reconciliacao do ledger unificado.
 *
 * Executa diariamente as 05:00 BRT (08:00 UTC):
 *   1. Promove entries pendentes ja compensadas (available_at <= now())
 *   2. Verifica integridade (soma global zero + cada transaction_id soma zero)
 *   3. Se algum check falhar: log CRITICAL
 *
 * ref: docs/specs/LEDGER-UNIFICADO.md §Reconciliacao diaria
 *
 * Ativacao: chamado em index.js apos server.listen()
 */

const cron = require('node-cron');
const { logger } = require('../../logger');

const JOB_NAME = 'ledgerReconciliationJob';
let _started = false;

async function _runOnce() {
  logger.info(`[${JOB_NAME}] Iniciando reconciliacao do ledger`, {
    service: JOB_NAME, action: 'LEDGER_RECON_START',
  });

  try {
    const ledger = require('../../services/unifiedLedgerService');

    // Fase 1: Promover entries pendentes ja compensadas
    const promoted = await ledger.promoteAllCompensated();
    if (promoted > 0) {
      logger.info(`[${JOB_NAME}] Entries promovidas para available`, {
        service: JOB_NAME, action: 'LEDGER_PROMOTE_BATCH', promoted,
      });
    }

    // Fase 2: Verificar integridade
    const checks = await ledger.checkIntegrity();

    const failed = checks.filter(c => !c.passed);
    if (failed.length > 0) {
      logger.error(`[${JOB_NAME}] ALERTA CRITICO — integridade do ledger comprometida`, {
        service: JOB_NAME,
        action: 'LEDGER_INTEGRITY_FAILED',
        severity: 'CRITICAL',
        failedChecks: failed,
      });
    } else {
      logger.info(`[${JOB_NAME}] Reconciliacao concluida — integridade OK`, {
        service: JOB_NAME,
        action: 'LEDGER_RECON_DONE',
        promoted,
        checks: checks.map(c => ({ name: c.checkName, passed: c.passed })),
      });
    }

    return { promoted, checks, failed: failed.length };
  } catch (err) {
    logger.error(`[${JOB_NAME}] Erro na reconciliacao do ledger`, {
      service: JOB_NAME,
      action: 'LEDGER_RECON_ERROR',
      severity: 'CRITICAL',
      error: err.message,
    });
    throw err;
  }
}

function startLedgerReconciliationJob() {
  if (_started) return;
  _started = true;

  // Cron: diariamente as 05:00 BRT
  cron.schedule('0 5 * * *', () => {
    _runOnce().catch(() => { /* erros ja logados em _runOnce */ });
  }, { timezone: 'America/Sao_Paulo' });

  logger.info(`[${JOB_NAME}] Job iniciado (cron: diario 05:00 BRT)`, {
    service: JOB_NAME,
    action: 'LEDGER_RECON_JOB_REGISTERED',
  });
}

function stopLedgerReconciliationJob() {
  _started = false;
  logger.info(`[${JOB_NAME}] Job marcado como parado`, {
    service: JOB_NAME,
    action: 'LEDGER_RECON_JOB_STOPPED',
  });
}

module.exports = { startLedgerReconciliationJob, stopLedgerReconciliationJob, _runOnce };
