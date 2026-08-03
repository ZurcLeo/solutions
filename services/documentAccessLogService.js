/**
 * @fileoverview documentAccessLogService — Audit trail imutável para cofre de documentos.
 * Append-only: usa service_role para INSERT (RLS bloqueia authenticated).
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger }            = require('../logger');

const SERVICE = 'documentAccessLogService';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

function log(fn, msg, extra = {}) {
  logger.info(msg, { service: SERVICE, function: fn, ...extra });
}

// ── 1. logAccess — insert append-only ─────────────────────────────────────

async function logAccess(documentId, vaultId, userId, action, req = {}, metadata = {}) {
  const fn = 'logAccess';
  try {
    const entry = {
      document_id: documentId,
      vault_id:    vaultId,
      user_id:     userId,
      action,
      ip_address:  req.ip || req.headers?.['x-forwarded-for'] || null,
      user_agent:  req.headers?.['user-agent'] || null,
      metadata,
    };

    const { error } = await sb()
      .from('document_access_log')
      .insert([entry]);

    if (error) throw error;

    log(fn, `Acesso registrado: ${action}`, { documentId, vaultId, userId, action });
  } catch (err) {
    // Audit log nunca deve bloquear a operação principal
    logger.warn(`[${SERVICE}] logAccess falhou: ${err.message}`, {
      service: SERVICE, function: fn,
      documentId, vaultId, userId, action,
      error: err.message,
    });
  }
}

// ── 2. getAccessLog — histórico do vault ─────────────────────────────────

async function getAccessLog(vaultId, userId, { limit = 50, offset = 0 } = {}) {
  const fn = 'getAccessLog';

  // Verificar pertencimento ao vault
  const { data: vault, error: vaultErr } = await sb()
    .from('booking_document_vaults')
    .select('id')
    .eq('id', vaultId)
    .or(`client_uid.eq.${userId},provider_uid.eq.${userId}`)
    .single();

  if (vaultErr || !vault) {
    throw new Error('Vault não encontrado ou sem permissão');
  }

  const { data, error, count } = await sb()
    .from('document_access_log')
    .select('*', { count: 'exact' })
    .eq('vault_id', vaultId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;

  log(fn, 'Access log consultado', { vaultId, userId, count });
  return { entries: data || [], total: count || 0 };
}

// ── 3. getDocumentHistory — histórico de um documento ─────────────────────

async function getDocumentHistory(documentId, userId) {
  const fn = 'getDocumentHistory';

  // Verificar se o documento pertence a um vault do usuário
  const { data: doc, error: docErr } = await sb()
    .from('booking_documents')
    .select('vault_id')
    .eq('id', documentId)
    .single();

  if (docErr || !doc) throw new Error('Documento não encontrado');

  const { data: vault, error: vaultErr } = await sb()
    .from('booking_document_vaults')
    .select('id')
    .eq('id', doc.vault_id)
    .or(`client_uid.eq.${userId},provider_uid.eq.${userId}`)
    .single();

  if (vaultErr || !vault) {
    throw new Error('Sem permissão para visualizar histórico');
  }

  const { data, error } = await sb()
    .from('document_access_log')
    .select('*')
    .eq('document_id', documentId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  log(fn, 'Histórico do documento consultado', { documentId, userId, entries: data?.length });
  return data || [];
}

module.exports = {
  logAccess,
  getAccessLog,
  getDocumentHistory,
};
