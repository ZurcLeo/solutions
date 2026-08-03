'use strict';

/**
 * clicksignClient.js
 * Cliente HTTP para a API Clicksign v2.
 *
 * Docs: https://developers.clicksign.com/docs/api-v2
 * Auth: access_token como query param em cada requisição.
 *
 * Ambientes:
 *   production: https://app.clicksign.com
 *   sandbox:    https://sandbox.clicksign.com
 *
 * Secret Fly.io:
 *   CLICKSIGN_ACCESS_TOKEN  — token da conta Clicksign
 *   CLICKSIGN_ENV           — 'production' | 'sandbox' (default: sandbox)
 *
 * Autor: infra-agent
 * Data: 2026-05-18
 */

const axios = require('axios');
const { logger } = require('../../logger');

const BASE_URLS = {
  production: 'https://app.clicksign.com',
  sandbox: 'https://sandbox.clicksign.com',
};

function _client() {
  const token = process.env.CLICKSIGN_ACCESS_TOKEN;
  if (!token) throw new Error('CLICKSIGN_ACCESS_TOKEN não configurado');

  const env = process.env.CLICKSIGN_ENV === 'production' ? 'production' : 'sandbox';
  const baseURL = BASE_URLS[env];

  return axios.create({
    baseURL,
    params: { access_token: token },
    headers: { 'Content-Type': 'application/json' },
    timeout: 30_000,
  });
}

/** Faz log de erros Clicksign sem expor o access_token */
function _logError(method, path, err) {
  const status = err.response?.status;
  const data   = err.response?.data;
  logger.error('Clicksign API error', { method, path, status, data, message: err.message });
}

// ─── Documentos ───────────────────────────────────────────────────────────────

/**
 * Cria um documento no Clicksign a partir de um Buffer PDF.
 *
 * @param {object} opts
 * @param {Buffer}  opts.pdfBuffer    — conteúdo do PDF (plaintext, sem criptografia)
 * @param {string}  opts.filename     — ex: 'contrato-abc123.pdf'
 * @param {string}  opts.deadlineAt   — ISO 8601, data de expiração do envelope
 * @param {boolean} [opts.autoClose]  — fechar automaticamente após todos assinarem (default: true)
 * @returns {Promise<{key: string, status: string}>}
 */
async function createDocument({ pdfBuffer, filename, deadlineAt, autoClose = true }) {
  const client = _client();
  const contentBase64 = pdfBuffer.toString('base64');

  const path = '/api/v2/documents';
  try {
    const { data } = await client.post(path, {
      document: {
        path: `/${filename}`,
        content_base64: `data:application/pdf;base64,${contentBase64}`,
        deadline_at: deadlineAt,
        auto_close: autoClose,
        locale: 'pt-BR',
        sequence_enabled: false,  // todos podem assinar em qualquer ordem
        remind_interval: 3,       // lembrete a cada 3 dias
      },
    });
    logger.info('Clicksign: documento criado', { key: data.document.key });
    return { key: data.document.key, status: data.document.status };
  } catch (err) {
    _logError('POST', path, err);
    throw new Error(`Clicksign: falha ao criar documento — ${err.response?.data?.errors || err.message}`);
  }
}

/**
 * Retorna os dados de um documento.
 * @param {string} documentKey
 */
async function getDocument(documentKey) {
  const client = _client();
  const path = `/api/v2/documents/${documentKey}`;
  try {
    const { data } = await client.get(path);
    return data.document;
  } catch (err) {
    _logError('GET', path, err);
    throw new Error(`Clicksign: falha ao buscar documento — ${err.message}`);
  }
}

/**
 * Cancela (deleta) um documento no Clicksign.
 * @param {string} documentKey
 */
async function cancelDocument(documentKey) {
  const client = _client();
  const path = `/api/v2/documents/${documentKey}`;
  try {
    await client.delete(path);
    logger.info('Clicksign: documento cancelado', { key: documentKey });
  } catch (err) {
    _logError('DELETE', path, err);
    throw new Error(`Clicksign: falha ao cancelar documento — ${err.message}`);
  }
}

// ─── Signatários ──────────────────────────────────────────────────────────────

/**
 * Cria um signatário no Clicksign.
 *
 * @param {object} opts
 * @param {string} opts.name
 * @param {string} opts.email
 * @param {string} [opts.cpf]       — sem pontos/traços
 * @param {string} [opts.birthday]  — YYYY-MM-DD
 * @param {string} [opts.phone]     — +5511999999999
 * @returns {Promise<{key: string}>}
 */
async function createSigner({ name, email, cpf, birthday, phone }) {
  const client = _client();
  const path = '/api/v2/signers';

  const signerPayload = {
    email,
    name,
    auth_type: 'email',           // autenticação via link no email
    ...(phone    && { phone_number: phone }),
    ...(cpf      && { documentation: cpf, has_documentation: true }),
    ...(birthday && { birthday }),
  };

  try {
    const { data } = await client.post(path, { signer: signerPayload });
    logger.info('Clicksign: signatário criado', { key: data.signer.key, email });
    return { key: data.signer.key };
  } catch (err) {
    _logError('POST', path, err);
    throw new Error(`Clicksign: falha ao criar signatário — ${err.message}`);
  }
}

// ─── Listas (associar signatário ao documento) ────────────────────────────────

/**
 * Associa um signatário a um documento.
 *
 * @param {object} opts
 * @param {string} opts.documentKey
 * @param {string} opts.signerKey
 * @param {string} [opts.signAs]    — 'sign' | 'approve' | 'party' | 'witness' (default: 'sign')
 * @param {string} [opts.message]   — mensagem personalizada para o signatário
 * @returns {Promise<{key: string}>} — chave da associação (list key)
 */
async function addSignerToDocument({ documentKey, signerKey, signAs = 'sign', message }) {
  const client = _client();
  const path = '/api/v2/lists';
  try {
    const { data } = await client.post(path, {
      list: {
        document_key: documentKey,
        signer_key: signerKey,
        sign_as: signAs,
        ...(message && { message }),
      },
    });
    logger.info('Clicksign: signatário associado ao documento', { documentKey, signerKey });
    return { key: data.list.key };
  } catch (err) {
    _logError('POST', path, err);
    throw new Error(`Clicksign: falha ao associar signatário — ${err.message}`);
  }
}

/**
 * Finaliza o documento (notifica os signatários por email).
 * Após isso, não é possível adicionar mais signatários.
 * @param {string} documentKey
 */
async function finalizeDocument(documentKey) {
  const client = _client();
  const path = `/api/v2/documents/${documentKey}/finish`;
  try {
    const { data } = await client.patch(path);
    logger.info('Clicksign: documento finalizado (notificações enviadas)', { key: documentKey });
    return data.document;
  } catch (err) {
    _logError('PATCH', path, err);
    throw new Error(`Clicksign: falha ao finalizar documento — ${err.message}`);
  }
}

/**
 * Gera um link direto de assinatura para um signatário específico.
 * Útil para redirecionar o usuário dentro da plataforma.
 *
 * @param {string} documentKey
 * @param {string} signerKey
 * @returns {Promise<string>} — URL de assinatura
 */
async function getSigningUrl(documentKey, signerKey) {
  const client = _client();
  const path = '/api/v2/signature_requests';
  try {
    const { data } = await client.post(path, {
      list: { document_key: documentKey, signer_key: signerKey },
    });
    return data.list?.url ?? null;
  } catch (err) {
    _logError('POST', path, err);
    throw new Error(`Clicksign: falha ao gerar link de assinatura — ${err.message}`);
  }
}

module.exports = {
  createDocument,
  getDocument,
  cancelDocument,
  createSigner,
  addSignerToDocument,
  finalizeDocument,
  getSigningUrl,
};
