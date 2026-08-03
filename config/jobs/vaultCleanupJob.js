'use strict';

/**
 * vaultCleanupJob — Cron job para limpeza LGPD do cofre de documentos.
 *
 * Diariamente as 04:00 BRT:
 *   1. Hard-delete documentos com expires_at <= NOW()
 *   2. Hard-delete documentos com is_deleted=true E deleted_at < NOW() - 30d
 *   3. Remove arquivos correspondentes do Supabase Storage
 *   4. Mantém registro no banco (audit trail) — apenas remove do Storage
 *
 * Padrão: googlePlacesSyncJob.js
 * Ativação: chamado em index.js após server.listen()
 */

const cron = require('node-cron');
const { logger } = require('../../logger');
const { getSupabaseClient } = require('../../config/supabase');

const JOB_NAME = 'vaultCleanupJob';
const BUCKET = 'document-vault';
const RETENTION_DAYS = 30;
let _started = false;

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

async function _runOnce() {
  logger.info(`[${JOB_NAME}] Iniciando limpeza LGPD do cofre`, {
    service: JOB_NAME, action: 'VAULT_CLEANUP_START',
  });

  let expiredCount = 0;
  let deletedCount = 0;
  let storageRemoved = 0;
  let errors = 0;

  try {
    const now = new Date().toISOString();
    const retentionCutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // 1. Buscar documentos expirados
    const { data: expired } = await sb()
      .from('booking_documents')
      .select('id, storage_path, vault_id, file_size_bytes')
      .not('expires_at', 'is', null)
      .lte('expires_at', now)
      .eq('is_deleted', false)
      .limit(100);

    // 2. Buscar documentos soft-deleted além da retenção
    const { data: softDeleted } = await sb()
      .from('booking_documents')
      .select('id, storage_path, vault_id, file_size_bytes')
      .eq('is_deleted', true)
      .lte('deleted_at', retentionCutoff)
      .limit(100);

    const toClean = [...(expired || []), ...(softDeleted || [])];

    for (const doc of toClean) {
      try {
        // Remover do Storage
        const { error: storageErr } = await sb()
          .storage
          .from(BUCKET)
          .remove([doc.storage_path]);

        if (!storageErr) storageRemoved++;

        // Marcar como hard-deleted (limpar storage_path, manter registro para audit)
        await sb()
          .from('booking_documents')
          .update({
            storage_path: `[REMOVED:${now}]`,
            is_deleted: true,
            deleted_at: doc.is_deleted ? undefined : now,
            deleted_by: 'system:vault_cleanup',
          })
          .eq('id', doc.id);

        // Decrementar storage do vault
        const { data: vault } = await sb()
          .from('booking_document_vaults')
          .select('storage_used_bytes')
          .eq('id', doc.vault_id)
          .single();

        if (vault) {
          await sb()
            .from('booking_document_vaults')
            .update({
              storage_used_bytes: Math.max(0, (vault.storage_used_bytes || 0) - (doc.file_size_bytes || 0)),
            })
            .eq('id', doc.vault_id);
        }

        if (doc.expires_at) expiredCount++;
        else deletedCount++;
      } catch (err) {
        errors++;
        logger.warn(`[${JOB_NAME}] Erro ao limpar documento ${doc.id}`, {
          error: err.message,
        });
      }
    }

    logger.info(`[${JOB_NAME}] Limpeza LGPD concluída`, {
      service: JOB_NAME, action: 'VAULT_CLEANUP_DONE',
      expiredCount, deletedCount, storageRemoved, errors,
    });

    return { expiredCount, deletedCount, storageRemoved, errors };
  } catch (err) {
    logger.error(`[${JOB_NAME}] Erro crítico na limpeza LGPD`, {
      service: JOB_NAME, action: 'VAULT_CLEANUP_ERROR',
      error: err.message,
    });
    throw err;
  }
}

function startVaultCleanupJob() {
  if (_started) return;
  _started = true;

  // Cron: diariamente às 04:00 BRT
  cron.schedule('0 4 * * *', () => {
    _runOnce().catch(() => { /* erros já logados em _runOnce */ });
  }, { timezone: 'America/Sao_Paulo' });

  logger.info(`[${JOB_NAME}] Job iniciado (cron: diário 04:00 BRT)`, {
    service: JOB_NAME, action: 'VAULT_CLEANUP_JOB_REGISTERED',
  });
}

function stopVaultCleanupJob() {
  _started = false;
  logger.info(`[${JOB_NAME}] Job marcado como parado`, {
    service: JOB_NAME, action: 'VAULT_CLEANUP_JOB_STOPPED',
  });
}

module.exports = { startVaultCleanupJob, stopVaultCleanupJob, _runOnce };
