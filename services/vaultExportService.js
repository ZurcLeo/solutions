/**
 * @fileoverview vaultExportService — Export LGPD Art. 18 (portabilidade de dados)
 * Baixa todos os documentos não-deletados de um vault, gera metadata.json
 * com info + access log, empacota em ZIP e retorna signed URL.
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger }            = require('../logger');
const accessLogService      = require('./documentAccessLogService');
const archiver              = require('archiver');
const { PassThrough }       = require('stream');

const SERVICE = 'vaultExportService';
const BUCKET = 'document-vault';
const EXPORT_BUCKET = 'document-vault'; // reuse same bucket, different path
const EXPORT_TTL = 3600; // 1h signed URL

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

function log(fn, msg, extra = {}) {
  logger.info(msg, { service: SERVICE, function: fn, ...extra });
}

// ── exportVault — export ZIP (portabilidade LGPD Art. 18) ────────────────────

async function exportVault(vaultId, userId) {
  const fn = 'exportVault';

  // Verificar pertencimento ao vault
  const { data: vault, error: vaultErr } = await sb()
    .from('booking_document_vaults')
    .select('*')
    .eq('id', vaultId)
    .single();

  if (vaultErr || !vault) throw new Error('Vault não encontrado');
  if (vault.client_uid !== userId && vault.provider_uid !== userId) {
    throw new Error('Sem permissão para exportar este vault');
  }

  // Buscar documentos não-deletados
  const { data: docs, error: docsErr } = await sb()
    .from('booking_documents')
    .select('*')
    .eq('vault_id', vaultId)
    .eq('is_deleted', false)
    .order('created_at');

  if (docsErr) throw new Error(`Erro ao buscar documentos: ${docsErr.message}`);

  // Buscar access log
  const { entries } = await accessLogService.getAccessLog(vaultId, userId, { limit: 500 });

  // Gerar metadata.json
  const metadata = {
    export_date: new Date().toISOString(),
    vault_id: vaultId,
    relationship_type: vault.relationship_type,
    client_uid: vault.client_uid,
    provider_uid: vault.provider_uid,
    document_count: docs?.length || 0,
    total_size_bytes: (docs || []).reduce((s, d) => s + (d.file_size_bytes || 0), 0),
    documents: (docs || []).map(d => ({
      id: d.id,
      file_name: d.file_name,
      mime_type: d.mime_type,
      file_size_bytes: d.file_size_bytes,
      document_type: d.document_type,
      sha256_hash: d.sha256_hash,
      share_consent: d.share_consent,
      ai_consent: d.ai_consent,
      created_at: d.created_at,
    })),
    access_log: entries || [],
    lgpd_notice: 'Este arquivo foi gerado em conformidade com o Art. 18 da LGPD (Lei 13.709/2018) — Direito à portabilidade dos dados.',
  };

  // Criar ZIP em memória
  const archive = archiver('zip', { zlib: { level: 6 } });
  const chunks = [];

  const passthrough = new PassThrough();
  passthrough.on('data', chunk => chunks.push(chunk));

  archive.pipe(passthrough);

  // Adicionar metadata.json
  archive.append(JSON.stringify(metadata, null, 2), { name: 'metadata.json' });

  // Baixar e adicionar cada documento
  for (const doc of (docs || [])) {
    try {
      if (doc.storage_path.startsWith('[REMOVED')) continue;

      const { data: fileData, error: downloadErr } = await sb()
        .storage
        .from(BUCKET)
        .download(doc.storage_path);

      if (downloadErr) {
        logger.warn(`[${SERVICE}] Falha ao baixar ${doc.id}`, { error: downloadErr.message });
        continue;
      }

      const buffer = Buffer.from(await fileData.arrayBuffer());
      archive.append(buffer, { name: `documentos/${doc.file_name}` });
    } catch (err) {
      logger.warn(`[${SERVICE}] Erro ao incluir doc ${doc.id} no ZIP`, { error: err.message });
    }
  }

  await archive.finalize();

  // Esperar stream finalizar
  await new Promise((resolve, reject) => {
    passthrough.on('end', resolve);
    passthrough.on('error', reject);
  });

  const zipBuffer = Buffer.concat(chunks);

  // Upload ZIP para Storage
  const exportPath = `${vaultId}/exports/export_${Date.now()}.zip`;
  const { error: uploadErr } = await sb()
    .storage
    .from(EXPORT_BUCKET)
    .upload(exportPath, zipBuffer, {
      contentType: 'application/zip',
      upsert: true,
    });

  if (uploadErr) throw new Error(`Erro ao salvar export: ${uploadErr.message}`);

  // Gerar signed URL
  const { data: signedData, error: signErr } = await sb()
    .storage
    .from(EXPORT_BUCKET)
    .createSignedUrl(exportPath, EXPORT_TTL);

  if (signErr) throw new Error(`Erro ao gerar URL de download: ${signErr.message}`);

  // Registrar no audit log
  await accessLogService.logAccess(null, vaultId, userId, 'exported', {}, {
    documentCount: docs?.length || 0,
    exportPath,
  });

  log(fn, 'Vault exportado', {
    vaultId, userId,
    documentCount: docs?.length || 0,
    zipSize: zipBuffer.length,
  });

  return {
    downloadUrl: signedData.signedUrl,
    expiresIn: EXPORT_TTL,
    documentCount: docs?.length || 0,
    totalSizeBytes: metadata.total_size_bytes,
  };
}

module.exports = { exportVault };
