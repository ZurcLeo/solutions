'use strict';

/**
 * contractStorageHelper.js
 *
 * Helper de infraestrutura para o bucket `contracts/` no Supabase Storage.
 *
 * Responsabilidades:
 *  - Criptografia AES-256-GCM a nível de aplicação (antes do upload)
 *  - Upload e download de documentos criptografados
 *  - Geração de Signed URLs com TTL máximo de 1 hora (hard limit — não configurável)
 *
 * NÃO pertence ao ContractService (lógica de negócio).
 * Este helper é infraestrutura pura — apenas move bits com segurança.
 *
 * Autor: infra-agent
 * Data: 2026-05-18
 */

const crypto = require('crypto');
const { getSupabaseClient } = require('../supabase');
const { logger } = require('../../logger');

// ─── Constantes de segurança (não alterar sem aprovação do compliance-agent) ─────

const BUCKET = 'contracts';

/** TTL máximo para Signed URLs — 1 hora. Hard limit. Nunca aumentar. */
const SIGNED_URL_TTL_SECONDS = 3600;

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // 96 bits — recomendado para GCM
const TAG_LENGTH = 16;  // 128 bits — autenticação do GCM
const KEY_LENGTH = 32;  // 256 bits

// ─── Chave de criptografia de documentos ─────────────────────────────────────────

/**
 * Retorna a chave de criptografia de documentos.
 * Separada da chave geral de criptografia para isolamento de domínio.
 * Secret Fly.io: DOCUMENT_ENCRYPTION_KEY (32 bytes hex = 64 chars)
 */
function _getDocumentKey() {
  const keyHex = process.env.DOCUMENT_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error(
      'DOCUMENT_ENCRYPTION_KEY ausente ou inválida. ' +
      'Deve ser 32 bytes em hex (64 chars). ' +
      'Gere com: openssl rand -hex 32'
    );
  }
  return Buffer.from(keyHex, 'hex');
}

// ─── Criptografia ─────────────────────────────────────────────────────────────────

/**
 * Criptografa um Buffer com AES-256-GCM.
 * Formato de saída: [iv (12 bytes)] + [authTag (16 bytes)] + [ciphertext]
 *
 * @param {Buffer} plainBuffer - Conteúdo a criptografar
 * @returns {Buffer} - Buffer criptografado
 */
function encryptDocument(plainBuffer) {
  const key = _getDocumentKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Layout: iv (12) | authTag (16) | ciphertext
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Descriptografa um Buffer produzido por encryptDocument().
 *
 * @param {Buffer} encryptedBuffer - Buffer criptografado
 * @returns {Buffer} - Conteúdo original
 */
function decryptDocument(encryptedBuffer) {
  const key = _getDocumentKey();

  const iv = encryptedBuffer.subarray(0, IV_LENGTH);
  const authTag = encryptedBuffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = encryptedBuffer.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ─── Paths ────────────────────────────────────────────────────────────────────────

/**
 * Retorna o path canônico de um arquivo de contrato no bucket.
 * Estrutura: {caixinha_id}/{contract_id}/{filename}
 */
function contractPath(caixinhaId, contractId, filename) {
  return `${caixinhaId}/${contractId}/${filename}`;
}

const FILENAMES = {
  CONTRACT_PDF: 'contract.pdf.enc',
  CLICKSIGN_REPORT: 'clicksign_report.pdf.enc',
};

// ─── Upload ───────────────────────────────────────────────────────────────────────

/**
 * Criptografa e faz upload de um documento para o bucket contracts/.
 * Apenas o service_role (backend) pode chamar upload.
 *
 * @param {string} caixinhaId
 * @param {string} contractId
 * @param {'CONTRACT_PDF'|'CLICKSIGN_REPORT'} fileType
 * @param {Buffer} plaintextBuffer - Conteúdo original (PDF em memória)
 * @returns {Promise<{path: string, size: number}>}
 */
async function uploadContractDocument(caixinhaId, contractId, fileType, plaintextBuffer) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase client não disponível');

  const filename = FILENAMES[fileType];
  if (!filename) throw new Error(`Tipo de arquivo inválido: ${fileType}`);

  const path = contractPath(caixinhaId, contractId, filename);
  const encryptedBuffer = encryptDocument(plaintextBuffer);

  logger.info('ContractStorage: upload iniciado', { path, originalSize: plaintextBuffer.length });

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, encryptedBuffer, {
      contentType: 'application/octet-stream',
      upsert: false, // contratos são imutáveis — nunca sobrescrever silenciosamente
    });

  if (error) {
    logger.error('ContractStorage: falha no upload', { path, error: error.message });
    throw new Error(`Falha ao fazer upload do contrato: ${error.message}`);
  }

  logger.info('ContractStorage: upload concluído', { path, encryptedSize: encryptedBuffer.length });
  return { path, size: encryptedBuffer.length };
}

// ─── Download ─────────────────────────────────────────────────────────────────────

/**
 * Baixa e descriptografa um documento do bucket contracts/.
 *
 * @param {string} caixinhaId
 * @param {string} contractId
 * @param {'CONTRACT_PDF'|'CLICKSIGN_REPORT'} fileType
 * @returns {Promise<Buffer>} - Conteúdo original descriptografado
 */
async function downloadContractDocument(caixinhaId, contractId, fileType) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase client não disponível');

  const filename = FILENAMES[fileType];
  if (!filename) throw new Error(`Tipo de arquivo inválido: ${fileType}`);

  const path = contractPath(caixinhaId, contractId, filename);

  const { data, error } = await supabase.storage.from(BUCKET).download(path);

  if (error) {
    logger.error('ContractStorage: falha no download', { path, error: error.message });
    throw new Error(`Falha ao baixar contrato: ${error.message}`);
  }

  const encryptedBuffer = Buffer.from(await data.arrayBuffer());
  return decryptDocument(encryptedBuffer);
}

// ─── Signed URL ───────────────────────────────────────────────────────────────────

/**
 * Gera uma Signed URL para download de um arquivo de contrato.
 *
 * TTL: SIGNED_URL_TTL_SECONDS (3600s = 1 hora). Hard limit — não aceita parâmetro.
 * A URL dá acesso ao arquivo CRIPTOGRAFADO — o frontend não consegue ler sem descriptografar.
 * Para entrega ao usuário final, prefira downloadContractDocument() e servir via stream.
 *
 * @param {string} caixinhaId
 * @param {string} contractId
 * @param {'CONTRACT_PDF'|'CLICKSIGN_REPORT'} fileType
 * @returns {Promise<string>} - Signed URL com validade de 1 hora
 */
async function getContractSignedUrl(caixinhaId, contractId, fileType) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase client não disponível');

  const filename = FILENAMES[fileType];
  if (!filename) throw new Error(`Tipo de arquivo inválido: ${fileType}`);

  const path = contractPath(caixinhaId, contractId, filename);

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error) {
    logger.error('ContractStorage: falha ao gerar Signed URL', { path, error: error.message });
    throw new Error(`Falha ao gerar URL de acesso: ${error.message}`);
  }

  logger.info('ContractStorage: Signed URL gerada', {
    path,
    ttlSeconds: SIGNED_URL_TTL_SECONDS,
    expiresAt: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
  });

  return data.signedUrl;
}

// ─── Exports ──────────────────────────────────────────────────────────────────────

module.exports = {
  // Upload / Download
  uploadContractDocument,
  downloadContractDocument,

  // Signed URL (TTL 1h hard limit)
  getContractSignedUrl,

  // Criptografia (exposta para uso em testes e scripts de migração)
  encryptDocument,
  decryptDocument,

  // Constantes
  BUCKET,
  SIGNED_URL_TTL_SECONDS,
  FILENAMES,
  contractPath,
};
