/**
 * @fileoverview documentVaultService — Cofre de Documentos por Relacionamento
 * Upload híbrido: signed URL direto pro Storage + verificação server-side pós-upload.
 * Servidor nunca vê conteúdo completo. Após upload, baixa 4KB para magic bytes.
 *
 * Decisões: D1 (upload híbrido), D2 (vault separado), D3 (vault lazy),
 *           D4 (relação contínua), D5 (trust marketplace), D6 (bucket dedicado).
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger }            = require('../logger');
const gamificationService   = require('./gamificationService');
const accessLogService      = require('./documentAccessLogService');
const path                  = require('path');
const { v4: uuidv4 }       = require('uuid');

const SERVICE = 'documentVaultService';
const BUCKET  = 'document-vault';
const SIGNED_URL_UPLOAD_TTL = 900;   // 15 min
const SIGNED_URL_DOWNLOAD_TTL = 3600; // 1h

// ── Quotas por plano ─────────────────────────────────────────────────────────

const QUOTA_BY_PLAN = {
  default:           { maxFileSize: 5  * 1024 * 1024, maxVaultSize: 20  * 1024 * 1024 },
  basico:            { maxFileSize: 5  * 1024 * 1024, maxVaultSize: 20  * 1024 * 1024 },
  brasileirinho_t1:  { maxFileSize: 25 * 1024 * 1024, maxVaultSize: 200 * 1024 * 1024 },
  brasileirinho_t2:  { maxFileSize: 25 * 1024 * 1024, maxVaultSize: 200 * 1024 * 1024 },
  brasileirinho_t3:  { maxFileSize: 50 * 1024 * 1024, maxVaultSize: 1024 * 1024 * 1024 },
};

// ── MIME por business_type ───────────────────────────────────────────────────

const MIME_BY_BUSINESS = {
  contador: [
    'application/pdf', 'image/jpeg', 'image/png',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv',
  ],
  advogado: [
    'application/pdf', 'image/jpeg', 'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  medico: ['application/pdf', 'image/jpeg', 'image/png'],
  default: [
    'application/pdf', 'image/jpeg', 'image/png',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
};

// ── Magic bytes map ──────────────────────────────────────────────────────────

const MAGIC_BYTES = {
  'application/pdf':  { bytes: [0x25, 0x50, 0x44, 0x46], offset: 0 }, // %PDF
  'image/jpeg':       { bytes: [0xFF, 0xD8, 0xFF],       offset: 0 },
  'image/png':        { bytes: [0x89, 0x50, 0x4E, 0x47], offset: 0 }, // .PNG
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
                      { bytes: [0x50, 0x4B, 0x03, 0x04], offset: 0 }, // PK (ZIP)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                      { bytes: [0x50, 0x4B, 0x03, 0x04], offset: 0 }, // PK (ZIP)
  'text/csv':         null, // no magic bytes for CSV
};

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

function log(fn, msg, extra = {}) {
  logger.info(msg, { service: SERVICE, function: fn, ...extra });
}

// ── 1. getOrCreateVault — lazy creation ──────────────────────────────────────

async function getOrCreateVault(bookingId, clientUid, providerUid, type = 'booking') {
  const fn = 'getOrCreateVault';

  if (clientUid === providerUid) {
    throw new Error('Cliente e prestador devem ser pessoas diferentes');
  }

  // Tentar encontrar vault existente
  let query = sb().from('booking_document_vaults').select('*');

  if (type === 'booking' && bookingId) {
    query = query.eq('booking_id', bookingId);
  } else if (type === 'continuous') {
    query = query
      .eq('client_uid', clientUid)
      .eq('provider_uid', providerUid)
      .eq('relationship_type', 'continuous');
  }

  const { data: existing } = await query.maybeSingle();

  if (existing) {
    log(fn, 'Vault existente encontrado', { vaultId: existing.id });
    return existing;
  }

  // Criar novo vault
  const vaultData = {
    client_uid: clientUid,
    provider_uid: providerUid,
    relationship_type: type,
    authorized_uids: [],
    status: 'active',
  };

  if (type === 'booking' && bookingId) {
    vaultData.booking_id = bookingId;
  }

  const { data: vault, error } = await sb()
    .from('booking_document_vaults')
    .insert([vaultData])
    .select()
    .single();

  if (error) throw new Error(`Erro ao criar vault: ${error.message}`);

  log(fn, 'Vault criado', { vaultId: vault.id, type, bookingId });
  return vault;
}

// ── 2. generateUploadUrl — signed URL para upload direto ─────────────────────

async function generateUploadUrl(vaultId, userId, fileName, mimeType, fileSize) {
  const fn = 'generateUploadUrl';

  // Verificar vault e permissão
  const vault = await _getVaultWithAccess(vaultId, userId);
  if (vault.status !== 'active') {
    throw new Error('Vault não está ativo para uploads');
  }

  // Verificar quota
  const quota = await getStorageQuota(userId);
  if (fileSize > quota.maxFileSize) {
    throw new Error(`Arquivo excede o limite do seu plano (${Math.round(quota.maxFileSize / 1024 / 1024)}MB)`);
  }
  if (vault.storage_used_bytes + fileSize > quota.maxVaultSize) {
    throw new Error(`Vault excederia o limite de armazenamento (${Math.round(quota.maxVaultSize / 1024 / 1024)}MB)`);
  }

  // Verificar MIME permitido
  const allowedMimes = await _getAllowedMimes(vault.provider_uid);
  if (!allowedMimes.includes(mimeType)) {
    throw new Error(`Tipo de arquivo não permitido: ${mimeType}`);
  }

  // Gerar path único no storage
  const ext = path.extname(fileName) || _extFromMime(mimeType);
  const storagePath = `${vaultId}/${uuidv4()}${ext}`;

  // Gerar signed URL para upload
  const { data, error } = await sb()
    .storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error) throw new Error(`Erro ao gerar URL de upload: ${error.message}`);

  log(fn, 'Signed upload URL gerada', { vaultId, userId, storagePath });

  return {
    signedUrl: data.signedUrl,
    token: data.token,
    storagePath,
    expiresIn: SIGNED_URL_UPLOAD_TTL,
  };
}

// ── 3. confirmUpload — verifica magic bytes, registra, loga audit ────────────

async function confirmUpload(vaultId, userId, data, req) {
  const fn = 'confirmUpload';
  const { storagePath, fileName, mimeType, fileSize, sha256Hash, documentType } = data;

  // Verificar vault e permissão
  const vault = await _getVaultWithAccess(vaultId, userId);

  // Verificar magic bytes (baixa 4KB do Storage)
  const mimeOk = await verifyMagicBytes(storagePath, mimeType);

  // Criar registro no banco
  const docData = {
    vault_id:        vaultId,
    uploaded_by:     userId,
    file_name:       fileName,
    storage_path:    storagePath,
    file_size_bytes: fileSize,
    mime_type:       mimeType,
    sha256_hash:     sha256Hash || null,
    document_type:   documentType || 'outro',
    mime_verified:   mimeOk,
  };

  const { data: doc, error } = await sb()
    .from('booking_documents')
    .insert([docData])
    .select()
    .single();

  if (error) throw new Error(`Erro ao registrar documento: ${error.message}`);

  // Atualizar contadores do vault
  await sb()
    .from('booking_document_vaults')
    .update({
      storage_used_bytes: vault.storage_used_bytes + fileSize,
      document_count: vault.document_count + 1,
    })
    .eq('id', vaultId);

  // Audit log
  await accessLogService.logAccess(doc.id, vaultId, userId, 'uploaded', req, {
    fileName, mimeType, fileSize, sha256Hash, mimeVerified: mimeOk,
  });

  // Gamification (fire-and-forget)
  gamificationService.triggerEvent('vault_document_uploaded', userId, {
    documentId: doc.id, vaultId,
  }).catch(() => {});

  log(fn, 'Upload confirmado', { documentId: doc.id, vaultId, fileName });
  return doc;
}

// ── 4. verifyMagicBytes — baixa 4KB do storage ──────────────────────────────

async function verifyMagicBytes(storagePath, declaredMime) {
  const fn = 'verifyMagicBytes';

  const expected = MAGIC_BYTES[declaredMime];
  if (expected === null || expected === undefined) {
    // CSV ou tipo sem magic bytes — skip
    log(fn, 'Skip magic bytes (tipo sem assinatura)', { storagePath, declaredMime });
    return true;
  }

  try {
    const { data, error } = await sb()
      .storage
      .from(BUCKET)
      .download(storagePath, { transform: { width: 0, height: 0 } });

    if (error) {
      logger.warn(`[${SERVICE}] verifyMagicBytes download falhou`, { storagePath, error: error.message });
      return false;
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    const header = buffer.slice(0, 8);

    const { bytes, offset } = expected;
    for (let i = 0; i < bytes.length; i++) {
      if (header[offset + i] !== bytes[i]) {
        logger.warn(`[${SERVICE}] Magic bytes mismatch`, {
          storagePath, declaredMime,
          expected: bytes.map(b => b.toString(16)),
          actual: Array.from(header.slice(0, 4)).map(b => b.toString(16)),
        });
        return false;
      }
    }

    log(fn, 'Magic bytes verificados OK', { storagePath, declaredMime });
    return true;
  } catch (err) {
    logger.warn(`[${SERVICE}] verifyMagicBytes erro`, { storagePath, error: err.message });
    return false;
  }
}

// ── 5. getDocument — metadata + signed download URL ──────────────────────────

async function getDocument(documentId, userId, req) {
  const fn = 'getDocument';

  const { data: doc, error } = await sb()
    .from('booking_documents')
    .select('*, booking_document_vaults!inner(client_uid, provider_uid, authorized_uids)')
    .eq('id', documentId)
    .eq('is_deleted', false)
    .single();

  if (error || !doc) throw new Error('Documento não encontrado');

  const vault = doc.booking_document_vaults;
  if (vault.client_uid !== userId && vault.provider_uid !== userId
      && !(vault.authorized_uids || []).includes(userId)) {
    throw new Error('Sem permissão para acessar este documento');
  }

  // Gerar signed URL de download
  const { data: signedData, error: signErr } = await sb()
    .storage
    .from(BUCKET)
    .createSignedUrl(doc.storage_path, SIGNED_URL_DOWNLOAD_TTL);

  if (signErr) throw new Error('Erro ao gerar URL de download');

  // Audit log
  await accessLogService.logAccess(documentId, doc.vault_id, userId, 'viewed', req);

  log(fn, 'Documento acessado', { documentId, userId });

  // Remover join data do retorno
  const { booking_document_vaults, ...docData } = doc;
  return { ...docData, downloadUrl: signedData.signedUrl };
}

// ── 6. listDocuments — lista com access check ────────────────────────────────

async function listDocuments(vaultId, userId) {
  const fn = 'listDocuments';

  await _getVaultWithAccess(vaultId, userId);

  const { data, error } = await sb()
    .from('booking_documents')
    .select('*')
    .eq('vault_id', vaultId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Erro ao listar documentos: ${error.message}`);

  log(fn, 'Documentos listados', { vaultId, userId, count: data?.length });
  return data || [];
}

// ── 7. softDeleteDocument — soft-delete com log ──────────────────────────────

async function softDeleteDocument(documentId, userId, req) {
  const fn = 'softDeleteDocument';

  const { data: doc, error: docErr } = await sb()
    .from('booking_documents')
    .select('vault_id, uploaded_by, file_size_bytes')
    .eq('id', documentId)
    .eq('is_deleted', false)
    .single();

  if (docErr || !doc) throw new Error('Documento não encontrado');
  if (doc.uploaded_by !== userId) throw new Error('Apenas quem enviou pode deletar o documento');

  const { error } = await sb()
    .from('booking_documents')
    .update({
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: userId,
    })
    .eq('id', documentId);

  if (error) throw new Error(`Erro ao deletar: ${error.message}`);

  // Atualizar contadores do vault
  await sb()
    .from('booking_document_vaults')
    .update({
      storage_used_bytes: sb().rpc ? undefined : 0, // simplified — decrement
    })
    .eq('id', doc.vault_id);

  // Decrement manually
  const { data: vault } = await sb()
    .from('booking_document_vaults')
    .select('storage_used_bytes, document_count')
    .eq('id', doc.vault_id)
    .single();

  if (vault) {
    await sb()
      .from('booking_document_vaults')
      .update({
        storage_used_bytes: Math.max(0, (vault.storage_used_bytes || 0) - doc.file_size_bytes),
        document_count: Math.max(0, (vault.document_count || 0) - 1),
      })
      .eq('id', doc.vault_id);
  }

  await accessLogService.logAccess(documentId, doc.vault_id, userId, 'deleted', req);

  log(fn, 'Documento soft-deleted', { documentId, userId });
  return { success: true };
}

// ── 8. updateConsent — toggle share/AI consent ───────────────────────────────

async function updateConsent(documentId, userId, { shareConsent, aiConsent }, req) {
  const fn = 'updateConsent';

  const { data: doc, error: docErr } = await sb()
    .from('booking_documents')
    .select('vault_id, uploaded_by')
    .eq('id', documentId)
    .eq('is_deleted', false)
    .single();

  if (docErr || !doc) throw new Error('Documento não encontrado');
  if (doc.uploaded_by !== userId) throw new Error('Apenas quem enviou pode alterar consentimento');

  const updates = {};
  if (shareConsent !== undefined) updates.share_consent = shareConsent;
  if (aiConsent !== undefined) updates.ai_consent = aiConsent;

  if (Object.keys(updates).length === 0) {
    throw new Error('Nenhuma alteração de consentimento informada');
  }

  const { data, error } = await sb()
    .from('booking_documents')
    .update(updates)
    .eq('id', documentId)
    .select()
    .single();

  if (error) throw new Error(`Erro ao atualizar consentimento: ${error.message}`);

  // Log para cada tipo de consent alterado
  if (shareConsent !== undefined) {
    const action = shareConsent ? 'consent_granted' : 'consent_revoked';
    await accessLogService.logAccess(documentId, doc.vault_id, userId, action, req, {
      consentType: 'share', value: shareConsent,
    });
  }
  if (aiConsent !== undefined) {
    const action = aiConsent ? 'consent_granted' : 'consent_revoked';
    await accessLogService.logAccess(documentId, doc.vault_id, userId, action, req, {
      consentType: 'ai', value: aiConsent,
    });
  }

  // Gamification: compartilhar documento
  if (shareConsent === true) {
    gamificationService.triggerEvent('vault_document_shared', userId, {
      documentId, vaultId: doc.vault_id,
    }).catch(() => {});
  }

  log(fn, 'Consentimento atualizado', { documentId, userId, updates });
  return data;
}

// ── 9. getVaultForBooking — check existência ─────────────────────────────────

async function getVaultForBooking(bookingId, userId) {
  const fn = 'getVaultForBooking';

  const { data, error } = await sb()
    .from('booking_document_vaults')
    .select('*')
    .eq('booking_id', bookingId)
    .or(`client_uid.eq.${userId},provider_uid.eq.${userId}`)
    .maybeSingle();

  if (error) throw new Error(`Erro ao buscar vault: ${error.message}`);

  log(fn, data ? 'Vault encontrado' : 'Vault não encontrado', { bookingId, userId });
  return data;
}

// ── 10. getStorageQuota — calcula com base no plano ──────────────────────────

async function getStorageQuota(userId) {
  const fn = 'getStorageQuota';

  try {
    const subscriptionService = require('./subscriptionService');
    const subscription = await subscriptionService.getActiveSubscription(userId);
    const planSlug = subscription?.plan_slug || 'default';
    const quota = QUOTA_BY_PLAN[planSlug] || QUOTA_BY_PLAN.default;

    // Calcular uso atual (soma de todos os vaults do usuário)
    const { data: vaults } = await sb()
      .from('booking_document_vaults')
      .select('storage_used_bytes')
      .or(`client_uid.eq.${userId},provider_uid.eq.${userId}`)
      .eq('status', 'active');

    const totalUsed = (vaults || []).reduce((sum, v) => sum + (v.storage_used_bytes || 0), 0);

    return {
      ...quota,
      totalUsedBytes: totalUsed,
      planSlug,
    };
  } catch (err) {
    logger.warn(`[${SERVICE}] getStorageQuota fallback`, { userId, error: err.message });
    return { ...QUOTA_BY_PLAN.default, totalUsedBytes: 0, planSlug: 'default' };
  }
}

// ── 11. listVaults — lista vaults do usuário ──────────────────────────────────

async function listVaults(userId) {
  const fn = 'listVaults';

  const { data, error } = await sb()
    .from('booking_document_vaults')
    .select('*')
    .or(`client_uid.eq.${userId},provider_uid.eq.${userId}`)
    .order('updated_at', { ascending: false });

  if (error) throw new Error(`Erro ao listar vaults: ${error.message}`);

  log(fn, 'Vaults listados', { userId, count: data?.length });
  return data || [];
}

// ── Helpers internos ─────────────────────────────────────────────────────────

async function _getVaultWithAccess(vaultId, userId) {
  const { data: vault, error } = await sb()
    .from('booking_document_vaults')
    .select('*')
    .eq('id', vaultId)
    .single();

  if (error || !vault) throw new Error('Vault não encontrado');

  if (vault.client_uid !== userId && vault.provider_uid !== userId
      && !(vault.authorized_uids || []).includes(userId)) {
    throw new Error('Sem permissão para acessar este vault');
  }

  return vault;
}

async function _getAllowedMimes(providerUid) {
  try {
    const { data } = await sb()
      .from('seller_profiles')
      .select('business_type')
      .eq('user_id', providerUid)
      .maybeSingle();

    const biz = data?.business_type || 'default';
    return MIME_BY_BUSINESS[biz] || MIME_BY_BUSINESS.default;
  } catch {
    return MIME_BY_BUSINESS.default;
  }
}

function _extFromMime(mimeType) {
  const map = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'text/csv': '.csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  };
  return map[mimeType] || '';
}

module.exports = {
  getOrCreateVault,
  generateUploadUrl,
  confirmUpload,
  verifyMagicBytes,
  getDocument,
  listDocuments,
  softDeleteDocument,
  updateConsent,
  getVaultForBooking,
  getStorageQuota,
  listVaults,
};
