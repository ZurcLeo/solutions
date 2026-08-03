'use strict';

/**
 * ContractService.js
 *
 * Orquestra o ciclo de vida completo de contratos digitais de empréstimo:
 *   draft → pending_signatures → fully_signed | cancelled | expired
 *
 * Fluxo por tipo:
 *   Tipo 1 (bilateral):    tomador + admin da caixinha assinam via Clicksign
 *   Tipo 2 (multilateral): tomador + todos os membros votantes assinam via Clicksign
 *
 * Processamento de PDF:
 *   Assíncrono via setImmediate (BullMQ-ready: substituir _enqueueProcessing por job)
 *   O cliente recebe 202 + contractId imediatamente; status fica `draft` até processamento.
 *
 * Autor: infra-agent
 * Data: 2026-05-18
 */

const crypto = require('crypto');
const { getSupabaseClient }     = require('../config/supabase');
const { logger }                = require('../logger');
const { generateBilateralPdf, generateMultilateralPdf } = require('./ContractPdfGenerator');
const { uploadContractDocument, getContractSignedUrl, FILENAMES } = require('../config/contractStorage/contractStorageHelper');
const clicksign                 = require('../config/clicksign/clicksignClient');

// ─── TTL padrão de coleta de assinaturas: 7 dias ─────────────────────────────
const DEFAULT_EXPIRY_DAYS = 7;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _expiresAt(days = DEFAULT_EXPIRY_DAYS) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function _sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Loga e relança erro com contexto */
function _fail(method, msg, cause) {
  logger.error(`ContractService.${method}: ${msg}`, { error: cause?.message });
  const err = new Error(msg);
  err.cause = cause;
  throw err;
}

// ─── Leitura de dados de domínio ──────────────────────────────────────────────

async function _fetchLoan(supabase, caixinhaId, loanId) {
  const { data, error } = await supabase
    .from('emprestimos')
    .select('id, user_id, valor, parcelas, taxa_juros, data_vencimento, status')
    .eq('id', loanId)
    .eq('caixinha_id', caixinhaId)
    .maybeSingle();
  if (error) _fail('_fetchLoan', 'Erro ao buscar empréstimo', error);
  if (!data)  _fail('_fetchLoan', 'Empréstimo não encontrado');
  return data;
}

async function _fetchCaixinha(supabase, caixinhaId) {
  const { data, error } = await supabase
    .from('caixinhas')
    .select('id, nome, admin_id')
    .eq('id', caixinhaId)
    .maybeSingle();
  if (error) _fail('_fetchCaixinha', 'Erro ao buscar caixinha', error);
  if (!data)  _fail('_fetchCaixinha', 'Caixinha não encontrada');
  return data;
}

async function _fetchUser(supabase, userId) {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, username')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return { id: userId, full_name: userId, email: '', username: '' };
  return data;
}

async function _fetchActiveMembers(supabase, caixinhaId, excludeUserId) {
  const { data, error } = await supabase
    .from('caixinha_members')
    .select('user_id')
    .eq('caixinha_id', caixinhaId)
    .neq('user_id', excludeUserId)
    .in('status', ['ativo', 'active', null]);
  if (error) _fail('_fetchActiveMembers', 'Erro ao buscar membros', error);
  return data ?? [];
}

// ─── Núcleo de processamento assíncrono ───────────────────────────────────────

/**
 * Enfileira o processamento do contrato.
 * Atualmente usa setImmediate (sem Redis).
 * Para BullMQ: substituir pelo enqueue de um job na fila.
 */
function _enqueueProcessing(contractId, caixinhaId, loanId, type) {
  setImmediate(() => {
    _processContractAsync(contractId, caixinhaId, loanId, type).catch(err => {
      logger.error('ContractService: falha no processamento assíncrono', {
        contractId, error: err.message,
      });
      // Marcar contrato como cancelado em caso de falha grave
      getSupabaseClient()?.from('contracts').update({
        status: 'cancelled',
        cancellation_reason: `processing_error: ${err.message}`,
        cancelled_at: new Date().toISOString(),
      }).eq('id', contractId).then(() => {});
    });
  });
}

/**
 * Processamento principal (roda assincronamente após o 202):
 * 1. Busca dados do loan, caixinha e usuários
 * 2. Gera PDF com pdfkit
 * 3. Criptografa e faz upload para Supabase Storage
 * 4. Cria documento + signatários no Clicksign
 * 5. Finaliza o envelope (dispara emails de assinatura)
 * 6. Atualiza contrato no Supabase para `pending_signatures`
 */
async function _processContractAsync(contractId, caixinhaId, loanId, type) {
  const supabase = getSupabaseClient();
  logger.info('ContractService: iniciando processamento', { contractId, type });

  // 1. Dados de domínio
  const [loan, caixinha] = await Promise.all([
    _fetchLoan(supabase, caixinhaId, loanId),
    _fetchCaixinha(supabase, caixinhaId),
  ]);

  const borrower  = await _fetchUser(supabase, loan.user_id);
  const generatedAt = new Date();
  const expiresAt   = _expiresAt();

  let pdfBuffer, signatories;

  if (type === 'bilateral') {
    const approver = await _fetchUser(supabase, caixinha.admin_id);
    pdfBuffer = await generateBilateralPdf({
      loan: {
        id: loan.id,
        valor: loan.valor,
        parcelas: loan.parcelas,
        taxaJuros: loan.taxa_juros ?? 0,
        dataVencimento: loan.data_vencimento,
      },
      caixinha: { id: caixinha.id, nome: caixinha.nome },
      borrower: { id: borrower.id, nome: borrower.full_name, email: borrower.email },
      approver: { id: approver.id, nome: approver.full_name, email: approver.email },
      contractId,
      generatedAt,
    });
    signatories = [
      { user: borrower,  role: 'borrower',  signAs: 'sign'    },
      { user: approver,  role: 'approver',  signAs: 'approve' },
    ];
  } else {
    // multilateral
    const membersRaw = await _fetchActiveMembers(supabase, caixinhaId, borrower.id);
    const members = await Promise.all(membersRaw.map(m => _fetchUser(supabase, m.user_id)));
    pdfBuffer = await generateMultilateralPdf({
      loan: {
        id: loan.id,
        valor: loan.valor,
        parcelas: loan.parcelas,
        taxaJuros: loan.taxa_juros ?? 0,
        dataVencimento: loan.data_vencimento,
      },
      caixinha: { id: caixinha.id, nome: caixinha.nome },
      borrower: { id: borrower.id, nome: borrower.full_name, email: borrower.email },
      members:  members.map(m => ({ id: m.id, nome: m.full_name, email: m.email })),
      contractId,
      generatedAt,
    });
    signatories = [
      { user: borrower, role: 'borrower', signAs: 'sign' },
      ...members.map(m => ({ user: m, role: 'member', signAs: 'sign' })),
    ];
  }

  // 2. Hash do PDF original (antes da criptografia)
  const documentHash = _sha256(pdfBuffer);

  // 3. Upload criptografado para Supabase Storage
  await uploadContractDocument(caixinhaId, contractId, 'CONTRACT_PDF', pdfBuffer);
  logger.info('ContractService: PDF carregado no Storage', { contractId });

  // 4. Criar documento no Clicksign
  const clicksignDoc = await clicksign.createDocument({
    pdfBuffer,
    filename: `contrato-${contractId}.pdf`,
    deadlineAt: expiresAt,
    autoClose: true,
  });

  // 5. Criar signatários e associar ao documento
  const signatoryRecords = [];
  for (const s of signatories) {
    if (!s.user.email) continue; // usuário sem email não pode assinar via Clicksign

    const { key: signerKey } = await clicksign.createSigner({
      name:  s.user.full_name || s.user.email,
      email: s.user.email,
    });

    const { key: listKey } = await clicksign.addSignerToDocument({
      documentKey: clicksignDoc.key,
      signerKey,
      signAs: s.signAs,
    });

    signatoryRecords.push({
      contract_id:          contractId,
      user_id:              s.user.id,
      role:                 s.role,
      clicksign_signer_key: signerKey,
    });

    // Registrar no audit trail
    await supabase.from('contract_signature_events').insert({
      contract_id: contractId,
      event_type:  'sent_to_signer',
      event_data:  { signer_key: signerKey, list_key: listKey, role: s.role },
    });
  }

  // Inserir signatários em lote
  if (signatoryRecords.length > 0) {
    const { error: sigErr } = await supabase
      .from('contract_signatories')
      .insert(signatoryRecords);
    if (sigErr) _fail('_processContractAsync', 'Erro ao inserir signatários', sigErr);
  }

  // 6. Finalizar envelope (dispara emails Clicksign)
  await clicksign.finalizeDocument(clicksignDoc.key);

  // 7. Atualizar contrato → pending_signatures
  const { error: updateErr } = await supabase
    .from('contracts')
    .update({
      status:                'pending_signatures',
      clicksign_document_key: clicksignDoc.key,
      document_hash:          documentHash,
      storage_path:           `${caixinhaId}/${contractId}/${FILENAMES.CONTRACT_PDF}`,
      expires_at:             expiresAt,
      updated_at:             new Date().toISOString(),
    })
    .eq('id', contractId);

  if (updateErr) _fail('_processContractAsync', 'Erro ao atualizar contrato', updateErr);

  // Audit trail: criação
  await supabase.from('contract_signature_events').insert({
    contract_id: contractId,
    event_type:  'created',
    event_data:  {
      clicksign_document_key: clicksignDoc.key,
      type,
      signatories_count: signatoryRecords.length,
    },
    document_hash: documentHash,
  });

  logger.info('ContractService: contrato em pending_signatures', {
    contractId,
    clicksignKey: clicksignDoc.key,
    signatories: signatoryRecords.length,
  });
}

// ─── API pública do service ───────────────────────────────────────────────────

/**
 * Inicia a geração de um contrato para um empréstimo.
 * Retorna imediatamente com o contractId; processamento ocorre em background.
 *
 * @param {object} opts
 * @param {string} opts.caixinhaId
 * @param {string} opts.loanId
 * @param {'bilateral'|'multilateral'} opts.type
 * @param {number} opts.valueTotal  — valor do empréstimo (para threshold de advogado)
 * @returns {Promise<{contractId: string, status: 'draft'}>}
 */
async function generateContract({ caixinhaId, loanId, type, valueTotal }) {
  const supabase = getSupabaseClient();
  if (!supabase) _fail('generateContract', 'Supabase indisponível');

  const contractId = crypto.randomUUID();
  const expiresAt  = _expiresAt();

  const { error } = await supabase.from('contracts').insert({
    id:           contractId,
    caixinha_id:  caixinhaId,
    loan_id:      loanId,
    type,
    status:       'draft',
    value_total:  valueTotal,
    expires_at:   expiresAt,
    requires_lawyer: false, // threshold será verificado em sprint futuro
  });

  if (error) _fail('generateContract', 'Erro ao criar registro do contrato', error);

  logger.info('ContractService: contrato criado (draft)', { contractId, type, caixinhaId, loanId });

  // Enfileira processamento assíncrono — cliente não aguarda
  _enqueueProcessing(contractId, caixinhaId, loanId, type);

  return { contractId, status: 'draft' };
}

/**
 * Retorna o status atual de um contrato.
 * Verifica autorização: apenas signatários e admins podem ver.
 *
 * @param {string} contractId
 * @param {string} requestingUserId
 */
async function getContract(contractId, requestingUserId) {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('contracts')
    .select(`
      id, caixinha_id, loan_id, type, status,
      value_total, requires_lawyer, expires_at,
      fully_signed_at, cancelled_at, cancellation_reason,
      created_at, updated_at,
      contract_signatories ( user_id, role, signed_at, refused_at )
    `)
    .eq('id', contractId)
    .maybeSingle();

  if (error) _fail('getContract', 'Erro ao buscar contrato', error);
  if (!data)  _fail('getContract', 'Contrato não encontrado');

  // Verificar se o usuário é signatário ou admin (o backend usa service_role, mas auditamos aqui)
  const isSignatory = data.contract_signatories?.some(s => s.user_id === requestingUserId);
  const { data: adminCheck } = await supabase.rpc('check_global_role', {
    p_user_id: requestingUserId, p_role_name: 'admin',
  });

  if (!isSignatory && !adminCheck) {
    const err = new Error('Acesso negado ao contrato');
    err.statusCode = 403;
    throw err;
  }

  return data;
}

/**
 * Gera uma Signed URL temporária (TTL 1h) para download do PDF do contrato.
 * O arquivo está criptografado — para PDF legível, use streamContractPdf().
 *
 * @param {string} contractId
 * @param {string} caixinhaId
 * @param {string} requestingUserId
 * @returns {Promise<string>} — Signed URL
 */
async function getDownloadUrl(contractId, caixinhaId, requestingUserId) {
  // Reusar getContract para verificar autorização
  await getContract(contractId, requestingUserId);

  return getContractSignedUrl(caixinhaId, contractId, 'CONTRACT_PDF');
}

/**
 * Retorna o link de assinatura do Clicksign para um signatário específico.
 * O signatário usa esse link para assinar dentro da plataforma (redirect ou iframe).
 *
 * @param {string} contractId
 * @param {string} userId — deve ser signatário do contrato
 */
async function getSigningLink(contractId, userId) {
  const supabase = getSupabaseClient();

  const { data: signatory, error } = await supabase
    .from('contract_signatories')
    .select('clicksign_signer_key, signed_at, refused_at')
    .eq('contract_id', contractId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !signatory) {
    const err = new Error('Usuário não é signatário deste contrato');
    err.statusCode = 403;
    throw err;
  }

  if (signatory.signed_at) {
    const err = new Error('Contrato já assinado por este usuário');
    err.statusCode = 409;
    throw err;
  }

  // Buscar clicksign_document_key do contrato
  const { data: contract } = await supabase
    .from('contracts')
    .select('clicksign_document_key, status, expires_at')
    .eq('id', contractId)
    .maybeSingle();

  if (!contract?.clicksign_document_key) {
    const err = new Error('Contrato ainda sendo processado. Tente novamente em instantes.');
    err.statusCode = 202;
    throw err;
  }

  if (contract.status !== 'pending_signatures') {
    const err = new Error(`Contrato não está disponível para assinatura (status: ${contract.status})`);
    err.statusCode = 409;
    throw err;
  }

  const url = await clicksign.getSigningUrl(
    contract.clicksign_document_key,
    signatory.clicksign_signer_key
  );

  return { signingUrl: url, expiresAt: contract.expires_at };
}

/**
 * Processa um evento de webhook recebido do Clicksign.
 * Atualiza o status do contrato/signatário e registra no audit trail.
 *
 * @param {object} payload — corpo do webhook Clicksign
 */
async function handleClicksignWebhook(payload) {
  const supabase = getSupabaseClient();
  const event    = payload?.event?.name;
  const docKey   = payload?.document?.key;
  const signerEmail = payload?.signer?.email;

  if (!event || !docKey) {
    logger.warn('ContractService webhook: payload inválido', { payload });
    return;
  }

  logger.info('ContractService webhook recebido', { event, docKey });

  // Buscar contrato pelo clicksign_document_key
  const { data: contract } = await supabase
    .from('contracts')
    .select('id, caixinha_id, status')
    .eq('clicksign_document_key', docKey)
    .maybeSingle();

  if (!contract) {
    logger.warn('ContractService webhook: contrato não encontrado para document_key', { docKey });
    return;
  }

  // Registrar evento bruto no audit trail
  await supabase.from('contract_signature_events').insert({
    contract_id: contract.id,
    event_type:  'clicksign_webhook',
    event_data:  payload,
  });

  // Processar eventos específicos
  if (event === 'sign') {
    // Marcar signatário como assinado
    if (signerEmail) {
      const { data: signatory } = await supabase
        .from('contract_signatories')
        .select('id, user_id')
        .eq('contract_id', contract.id)
        .maybeSingle(); // fallback: buscar por email se tiver (não temos email salvo)

      if (signatory) {
        await supabase.from('contract_signatories').update({
          signed_at: new Date().toISOString(),
        }).eq('id', signatory.id);

        await supabase.from('contract_signature_events').insert({
          contract_id:  contract.id,
          signatory_id: signatory.id,
          event_type:   'signed',
          event_data:   { signer_email: signerEmail },
        });
      }
    }

    // Verificar se todos assinaram
    const { data: pendingSignatories } = await supabase
      .from('contract_signatories')
      .select('id')
      .eq('contract_id', contract.id)
      .is('signed_at', null)
      .is('refused_at', null);

    if (!pendingSignatories?.length) {
      await supabase.from('contracts').update({
        status:          'fully_signed',
        fully_signed_at: new Date().toISOString(),
        updated_at:      new Date().toISOString(),
      }).eq('id', contract.id);

      logger.info('ContractService: contrato fully_signed', { contractId: contract.id });
    }

  } else if (event === 'refuse') {
    // Um signatário recusou — cancelar contrato
    await supabase.from('contracts').update({
      status:              'cancelled',
      cancellation_reason: `signer_refused: ${signerEmail}`,
      cancelled_at:        new Date().toISOString(),
      updated_at:          new Date().toISOString(),
    }).eq('id', contract.id);

    logger.info('ContractService: contrato cancelado por recusa', {
      contractId: contract.id, signerEmail,
    });

  } else if (event === 'deadline_reached') {
    await supabase.from('contracts').update({
      status:     'expired',
      updated_at: new Date().toISOString(),
    }).eq('id', contract.id);
  }
}

/**
 * Cancela um contrato manualmente (ex: membro saiu da caixinha).
 *
 * @param {string} contractId
 * @param {string} reason     — motivo de cancelamento
 * @param {string} requestingUserId
 */
async function cancelContract(contractId, reason, requestingUserId) {
  const supabase = getSupabaseClient();

  const contract = await getContract(contractId, requestingUserId);

  if (['fully_signed', 'cancelled', 'expired'].includes(contract.status)) {
    const err = new Error(`Não é possível cancelar contrato com status: ${contract.status}`);
    err.statusCode = 409;
    throw err;
  }

  // Cancelar no Clicksign se já foi enviado
  if (contract.clicksign_document_key) {
    try {
      await clicksign.cancelDocument(contract.clicksign_document_key);
    } catch (err) {
      logger.warn('ContractService: falha ao cancelar no Clicksign (prosseguindo)', {
        contractId, error: err.message,
      });
    }
  }

  await supabase.from('contracts').update({
    status:              'cancelled',
    cancellation_reason: reason,
    cancelled_at:        new Date().toISOString(),
    updated_at:          new Date().toISOString(),
  }).eq('id', contractId);

  await supabase.from('contract_signature_events').insert({
    contract_id: contractId,
    event_type:  'cancelled',
    event_data:  { reason, cancelled_by: requestingUserId },
  });

  logger.info('ContractService: contrato cancelado', { contractId, reason });
}

/**
 * Lista contratos de um usuário (como signatário).
 *
 * @param {string} userId
 * @param {object} [filters] — { status?, caixinhaId? }
 */
async function listUserContracts(userId, filters = {}) {
  const supabase = getSupabaseClient();

  // Buscar contratos onde o usuário é signatário
  let query = supabase
    .from('contract_signatories')
    .select(`
      role, signed_at,
      contracts (
        id, caixinha_id, loan_id, type, status,
        value_total, expires_at, fully_signed_at, created_at
      )
    `)
    .eq('user_id', userId);

  const { data, error } = await query;
  if (error) _fail('listUserContracts', 'Erro ao listar contratos', error);

  let contracts = (data ?? []).map(s => ({ ...s.contracts, userRole: s.role, userSignedAt: s.signed_at }));

  if (filters.status)     contracts = contracts.filter(c => c.status === filters.status);
  if (filters.caixinhaId) contracts = contracts.filter(c => c.caixinha_id === filters.caixinhaId);

  return contracts;
}

module.exports = {
  generateContract,
  getContract,
  getDownloadUrl,
  getSigningLink,
  handleClicksignWebhook,
  cancelContract,
  listUserContracts,
};
