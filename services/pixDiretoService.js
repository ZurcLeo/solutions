'use strict';

const { createClient } = require('@supabase/supabase-js');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');
const BankAccount = require('../models/BankAccount');
const { randomUUID } = require('crypto');

const SERVICE = 'pixDiretoService';

// ── Helpers ──────────────────────────────────────────────────────────────────

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

function sbService() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados.');
  return createClient(url, key, { auth: { persistSession: false } });
}

function log(fn, msg, extra = {}) {
  logger.info(msg, { service: SERVICE, function: fn, ...extra });
}

function logError(fn, err, extra = {}) {
  logger.error(`Erro em ${fn}: ${err.message}`, {
    service: SERVICE, function: fn, error: err.message, ...extra,
  });
}

// ── BRCode EMV/BACEN ─────────────────────────────────────────────────────────

/**
 * Monta campo TLV (Tag-Length-Value) no padrão EMV
 */
function _tlv(id, value) {
  const len = value.length.toString().padStart(2, '0');
  return `${id}${len}${value}`;
}

/**
 * CRC16-CCITT (0xFFFF) — padrão BACEN para validação do BRCode
 */
function _calculateCRC16(payload) {
  const data = Buffer.from(payload, 'utf-8');
  let crc = 0xFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= (data[i] << 8);
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc <<= 1;
      }
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Monta o payload BRCode (EMV/BACEN) para PIX estático ou dinâmico.
 * Ref: Manual BRCode BACEN v3.3
 */
function _buildBRCodePayload({ pixKey, pixKeyType, amount, name, city, txid }) {
  // ID 00 — Payload Format Indicator
  let payload = _tlv('00', '01');

  // ID 26 — Merchant Account Information (PIX)
  const gui = _tlv('00', 'br.gov.bcb.pix');
  const chave = _tlv('01', pixKey);
  payload += _tlv('26', gui + chave);

  // ID 52 — Merchant Category Code
  payload += _tlv('52', '0000');

  // ID 53 — Transaction Currency (986 = BRL)
  payload += _tlv('53', '986');

  // ID 54 — Transaction Amount (opcional, mas incluímos)
  if (amount && amount > 0) {
    payload += _tlv('54', amount.toFixed(2));
  }

  // ID 58 — Country Code
  payload += _tlv('58', 'BR');

  // ID 59 — Merchant Name (max 25 chars, sem acentos)
  const cleanName = (name || 'ELOSCLOUD')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .substring(0, 25);
  payload += _tlv('59', cleanName);

  // ID 60 — Merchant City (max 15 chars)
  const cleanCity = (city || 'SAO PAULO')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .substring(0, 15);
  payload += _tlv('60', cleanCity);

  // ID 62 — Additional Data Field (txid)
  if (txid) {
    const txidField = _tlv('05', txid.substring(0, 25));
    payload += _tlv('62', txidField);
  }

  // ID 63 — CRC16 (placeholder para cálculo)
  payload += '6304';
  const crc = _calculateCRC16(payload);
  payload = payload.slice(0, -4) + `6304${crc}`;

  return payload;
}

/**
 * Mascara a chave PIX para exibição segura ao contribuinte.
 */
function _maskPixKey(pixKey, pixKeyType) {
  if (!pixKey) return '***';
  const type = (pixKeyType || '').toLowerCase();

  if (type === 'cpf' && pixKey.length >= 11) {
    // ***.***.456-**
    return `***.***${pixKey.substring(6, 9)}-**`;
  }
  if (type === 'cnpj' && pixKey.length >= 14) {
    return `**.***.***/${pixKey.substring(8, 12)}-**`;
  }
  if (type === 'email' && pixKey.includes('@')) {
    const [local, domain] = pixKey.split('@');
    const maskedLocal = local[0] + '***';
    const domParts = domain.split('.');
    const maskedDomain = domParts[0][0] + '***.' + domParts.slice(1).join('.');
    return `${maskedLocal}@${maskedDomain}`;
  }
  if (type === 'telefone' || type === 'phone') {
    return `****${pixKey.slice(-4)}`;
  }
  // EVP / aleatória
  if (pixKey.length > 8) {
    return `${pixKey.substring(0, 4)}...${pixKey.slice(-4)}`;
  }
  return '***';
}

// ── Crédito após aprovação ───────────────────────────────────────────────────

async function _creditAfterApproval(receipt) {
  const fn = '_creditAfterApproval';
  const paymentId = `PIXDIRETO_${receipt.id}`;

  const ledgerService = require('./ledgerService');
  const result = await ledgerService.creditMember({
    caixinhaId: receipt.caixinha_id,
    userId: receipt.contributor_id,
    amount: Number(receipt.amount),
    paymentId,
    description: `Contribuição via PIX Direto (comprovante ${receipt.id.substring(0, 8)})`,
  });

  if (result.alreadyProcessed) {
    log(fn, 'Crédito já processado (idempotência)', { receiptId: receipt.id, paymentId });
    return result;
  }

  log(fn, 'Crédito aplicado via ledger', { receiptId: receipt.id, txId: result.txId });

  // Gamificação — fire-and-forget
  setImmediate(async () => {
    try {
      const gamificationService = require('./gamificationService');
      await gamificationService.triggerEvent('contribution_paid', receipt.contributor_id, {
        amount: 1,
        metadata: { caixinhaId: receipt.caixinha_id, paymentId },
      });
    } catch (err) {
      logger.warn('Falha ao trigger gamification (pix direto)', { error: err.message });
    }
  });

  return result;
}

// ── Serviço Principal ────────────────────────────────────────────────────────

/**
 * Gera QR Code PIX a partir da chave do admin da caixinha.
 * Retorna QR code (base64), BRCode (copia e cola) e dados mascarados.
 */
async function generatePixData(caixinhaId, contributorId, amount) {
  const fn = 'generatePixData';
  log(fn, 'Gerando PIX Direto', { caixinhaId, contributorId, amount });

  if (!amount || amount <= 0) {
    throw new Error('Valor deve ser maior que zero.');
  }

  const supabase = sbService();

  // 1. Buscar admin da caixinha
  const { data: caixinha, error: caixErr } = await supabase
    .from('caixinhas')
    .select('admin_id, name, pix_direto_enabled')
    .eq('id', caixinhaId)
    .maybeSingle();

  if (caixErr) throw new Error(`Falha ao buscar caixinha: ${caixErr.message}`);
  if (!caixinha) throw new Error('Caixinha não encontrada.');
  if (!caixinha.pix_direto_enabled) throw new Error('PIX Direto não está habilitado nesta caixinha.');

  const adminId = caixinha.admin_id;

  // 2. Buscar conta bancária ativa do admin para esta caixinha
  const accounts = await BankAccount.find(adminId, {
    caixinhaId,
    isActive: true,
    includeDecrypted: true,
  });

  if (!accounts.length) {
    throw new Error('Nenhuma conta bancária ativa encontrada para esta caixinha.');
  }

  const account = accounts[0];
  if (!account.pixKey) {
    throw new Error('A conta bancária do administrador não possui chave PIX cadastrada.');
  }

  // 3. Gerar BRCode
  const txid = randomUUID().replace(/-/g, '').substring(0, 25);
  const brcode = _buildBRCodePayload({
    pixKey: account.pixKey,
    pixKeyType: account.pixKeyType,
    amount: Number(amount),
    name: account.accountHolder,
    city: 'SAO PAULO',
    txid,
  });

  // 4. Gerar QR Code (imagem base64)
  let qrBase64 = null;
  try {
    const QRCode = require('qrcode');
    qrBase64 = await QRCode.toDataURL(brcode, {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      width: 300,
      margin: 2,
    });
  } catch (err) {
    logError(fn, err, { detail: 'Falha ao gerar QR Code image' });
    // QR image é nice-to-have; BRCode copia-e-cola é suficiente
  }

  // 5. Criar row contribution_receipts (status: pending_upload)
  const receiptId = randomUUID();
  const paymentId = `PIXDIRETO_${receiptId}`;

  const { error: insertErr } = await supabase
    .from('contribution_receipts')
    .insert({
      id: receiptId,
      caixinha_id: caixinhaId,
      contributor_id: contributorId,
      admin_id: adminId,
      amount: Number(amount),
      payment_mode: 'pix_direto',
      status: 'pending_upload',
      payment_id: paymentId,
    });

  if (insertErr) throw new Error(`Falha ao criar comprovante: ${insertErr.message}`);

  log(fn, 'PIX Direto gerado', { receiptId, caixinhaId, amount });

  return {
    receiptId,
    pixCopiaECola: brcode,
    qrCodeBase64: qrBase64,
    pixKeyMasked: _maskPixKey(account.pixKey, account.pixKeyType),
    pixKeyType: account.pixKeyType,
    adminName: account.accountHolder,
    amount: Number(amount),
    txid,
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  };
}

/**
 * Upload do comprovante para Supabase Storage.
 */
async function uploadReceipt(receiptId, contributorId, fileBuffer, mimeType, originalName) {
  const fn = 'uploadReceipt';
  log(fn, 'Upload de comprovante', { receiptId, contributorId, mimeType });

  const supabase = sbService();

  // 1. Validar receipt existe e pertence ao contribuinte
  const { data: receipt, error: fetchErr } = await supabase
    .from('contribution_receipts')
    .select('*')
    .eq('id', receiptId)
    .eq('contributor_id', contributorId)
    .maybeSingle();

  if (fetchErr) throw new Error(`Falha ao buscar comprovante: ${fetchErr.message}`);
  if (!receipt) throw new Error('Comprovante não encontrado ou não pertence a você.');
  if (receipt.status !== 'pending_upload') {
    throw new Error(`Comprovante já processado (status: ${receipt.status}).`);
  }
  if (new Date(receipt.expires_at) < new Date()) {
    throw new Error('O prazo para envio do comprovante expirou.');
  }

  // 2. Upload para Supabase Storage
  const ext = mimeType === 'application/pdf' ? 'pdf'
    : mimeType === 'image/png' ? 'png'
    : mimeType === 'image/webp' ? 'webp'
    : 'jpg';
  const storagePath = `${receipt.caixinha_id}/${receiptId}/comprovante.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from('contribution-receipts')
    .upload(storagePath, fileBuffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadErr) throw new Error(`Falha no upload: ${uploadErr.message}`);

  // 3. Gerar signed URL (1h)
  const { data: signedData } = await supabase.storage
    .from('contribution-receipts')
    .createSignedUrl(storagePath, 3600);

  const receiptUrl = signedData?.signedUrl || null;

  // 4. Atualizar receipt com caminho do arquivo
  const { error: updateErr } = await supabase
    .from('contribution_receipts')
    .update({
      receipt_url: receiptUrl,
      receipt_path: storagePath,
      status: 'pending_review',
    })
    .eq('id', receiptId);

  if (updateErr) throw new Error(`Falha ao atualizar comprovante: ${updateErr.message}`);

  log(fn, 'Upload concluído', { receiptId, storagePath });

  // 5. Tentar auto-validação
  const autoResult = await validateReceipt(receiptId);

  // 6. Notificar admin — fire-and-forget
  if (autoResult.status !== 'auto_approved') {
    setImmediate(async () => {
      try {
        const NotificationDispatcher = require('./NotificationDispatcher');
        await NotificationDispatcher.dispatch({
          userId: receipt.admin_id,
          type: 'receipt_pending_review',
          importance: 'high',
          data: {
            receiptId,
            contributorId,
            amount: receipt.amount,
            caixinhaId: receipt.caixinha_id,
          },
          metadata: { triggeredBy: 'system', correlationId: receiptId },
        });
      } catch (err) {
        logger.warn('Falha ao notificar admin sobre comprovante', { error: err.message });
      }
    });
  }

  return {
    receiptId,
    status: autoResult.status,
    receiptUrl,
    aiValidation: autoResult.aiValidation || null,
  };
}

/**
 * Auto-validação: amount match exato + upload dentro do prazo → auto_approved.
 * Caso contrário → pending_review.
 */
async function validateReceipt(receiptId) {
  const fn = 'validateReceipt';
  const supabase = sbService();

  const { data: receipt, error } = await supabase
    .from('contribution_receipts')
    .select('*')
    .eq('id', receiptId)
    .maybeSingle();

  if (error || !receipt) {
    log(fn, 'Receipt não encontrado para validação', { receiptId });
    return { status: 'pending_review' };
  }

  if (receipt.status !== 'pending_review') {
    return { status: receipt.status };
  }

  // 1. Validação inteligente via Claude Vision
  let aiResult = { status: 'failed', confidence: 0, extractedData: {} };
  try {
    const { analyzeReceipt } = require('./receiptValidationService');
    aiResult = await analyzeReceipt(receiptId);
    log(fn, 'Resultado da validação IA', { receiptId, aiStatus: aiResult.status, confidence: aiResult.confidence });
  } catch (aiErr) {
    logError(fn, aiErr, { receiptId, detail: 'Falha na validação IA — fallback para revisão manual' });
  }

  // 2. Auto-aprovar somente se IA confirma match
  if (aiResult.status === 'match') {
    const { error: updateErr } = await supabase
      .from('contribution_receipts')
      .update({
        status: 'auto_approved',
        reviewed_at: new Date().toISOString(),
        reviewed_by: 'ai_validation',
      })
      .eq('id', receiptId)
      .eq('status', 'pending_review'); // Lock otimista

    if (updateErr) {
      logError(fn, updateErr, { receiptId });
      return { status: 'pending_review', aiValidation: aiResult.status };
    }

    // Creditar via ledger
    try {
      await _creditAfterApproval(receipt);
    } catch (creditErr) {
      logError(fn, creditErr, { receiptId, detail: 'Falha ao creditar após auto-aprovação IA' });
      await supabase
        .from('contribution_receipts')
        .update({ status: 'pending_review', reviewed_at: null, reviewed_by: null })
        .eq('id', receiptId);
      return { status: 'pending_review', aiValidation: aiResult.status };
    }

    // Notificar admin (informativo)
    setImmediate(async () => {
      try {
        const NotificationDispatcher = require('./NotificationDispatcher');
        await NotificationDispatcher.dispatch({
          userId: receipt.admin_id,
          type: 'receipt_auto_approved',
          importance: 'low',
          data: { receiptId, amount: receipt.amount, contributorId: receipt.contributor_id },
          metadata: { triggeredBy: 'ai_validation', correlationId: receiptId },
        });
      } catch (_) {}
    });

    log(fn, 'Receipt auto-aprovado via IA', { receiptId, confidence: aiResult.confidence });
    return { status: 'auto_approved', aiValidation: aiResult.status };
  }

  // 3. Qualquer outro resultado (mismatch, uncertain, failed) → revisão manual
  // Notificar admin com contexto da IA
  setImmediate(async () => {
    try {
      const NotificationDispatcher = require('./NotificationDispatcher');
      await NotificationDispatcher.dispatch({
        userId: receipt.admin_id,
        type: 'receipt_pending_review',
        importance: 'high',
        data: {
          receiptId,
          amount: receipt.amount,
          contributorId: receipt.contributor_id,
          aiValidation: aiResult.status,
          aiExtracted: aiResult.extractedData,
        },
        metadata: { triggeredBy: 'system', correlationId: receiptId },
      });
    } catch (_) {}
  });

  log(fn, 'Receipt enviado para revisão manual', { receiptId, aiStatus: aiResult.status });
  return { status: 'pending_review', aiValidation: aiResult.status };
}

/**
 * Admin aprova comprovante manualmente.
 */
async function approveReceipt(receiptId, adminId, notes) {
  const fn = 'approveReceipt';
  log(fn, 'Admin aprovando comprovante', { receiptId, adminId });

  const supabase = sbService();

  // 1. Buscar receipt
  const { data: receipt, error } = await supabase
    .from('contribution_receipts')
    .select('*')
    .eq('id', receiptId)
    .eq('admin_id', adminId)
    .maybeSingle();

  if (error || !receipt) throw new Error('Comprovante não encontrado.');
  if (receipt.status === 'auto_approved' || receipt.status === 'admin_approved') {
    return { alreadyApproved: true, receiptId };
  }
  if (receipt.status !== 'pending_review') {
    throw new Error(`Comprovante não pode ser aprovado (status: ${receipt.status}).`);
  }

  // 2. Atualizar status
  const { error: updateErr } = await supabase
    .from('contribution_receipts')
    .update({
      status: 'admin_approved',
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
      admin_notes: notes || null,
    })
    .eq('id', receiptId)
    .eq('status', 'pending_review'); // Lock otimista

  if (updateErr) throw new Error(`Falha ao aprovar: ${updateErr.message}`);

  // 3. Creditar via ledger
  await _creditAfterApproval(receipt);

  // 4. Notificar contribuinte
  setImmediate(async () => {
    try {
      const NotificationDispatcher = require('./NotificationDispatcher');
      await NotificationDispatcher.dispatch({
        userId: receipt.contributor_id,
        type: 'receipt_approved',
        importance: 'high',
        data: { receiptId, amount: receipt.amount, caixinhaId: receipt.caixinha_id },
        metadata: { triggeredBy: adminId, correlationId: receiptId },
      });
    } catch (err) {
      logger.warn('Falha ao notificar contribuinte sobre aprovação', { error: err.message });
    }
  });

  // 5. Gamificação para admin que revisou
  setImmediate(async () => {
    try {
      const gamificationService = require('./gamificationService');
      await gamificationService.triggerEvent('receipt_reviewed', adminId, {
        metadata: { receiptId, caixinhaId: receipt.caixinha_id },
      });
    } catch (_) {}
  });

  log(fn, 'Comprovante aprovado pelo admin', { receiptId, adminId });
  return { receiptId, status: 'admin_approved' };
}

/**
 * Admin rejeita comprovante com motivo obrigatório.
 */
async function rejectReceipt(receiptId, adminId, reason) {
  const fn = 'rejectReceipt';
  log(fn, 'Admin rejeitando comprovante', { receiptId, adminId });

  if (!reason || reason.trim().length < 5) {
    throw new Error('Motivo da rejeição é obrigatório (mínimo 5 caracteres).');
  }

  const supabase = sbService();

  const { data: receipt, error } = await supabase
    .from('contribution_receipts')
    .select('*')
    .eq('id', receiptId)
    .eq('admin_id', adminId)
    .maybeSingle();

  if (error || !receipt) throw new Error('Comprovante não encontrado.');
  if (receipt.status !== 'pending_review') {
    throw new Error(`Comprovante não pode ser rejeitado (status: ${receipt.status}).`);
  }

  const { error: updateErr } = await supabase
    .from('contribution_receipts')
    .update({
      status: 'admin_rejected',
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
      rejection_reason: reason.trim(),
    })
    .eq('id', receiptId)
    .eq('status', 'pending_review');

  if (updateErr) throw new Error(`Falha ao rejeitar: ${updateErr.message}`);

  // Notificar contribuinte
  setImmediate(async () => {
    try {
      const NotificationDispatcher = require('./NotificationDispatcher');
      await NotificationDispatcher.dispatch({
        userId: receipt.contributor_id,
        type: 'receipt_rejected',
        importance: 'high',
        data: { receiptId, amount: receipt.amount, reason: reason.trim(), caixinhaId: receipt.caixinha_id },
        metadata: { triggeredBy: adminId, correlationId: receiptId },
      });
    } catch (err) {
      logger.warn('Falha ao notificar contribuinte sobre rejeição', { error: err.message });
    }
  });

  log(fn, 'Comprovante rejeitado', { receiptId, adminId, reason });
  return { receiptId, status: 'admin_rejected' };
}

/**
 * Lista comprovantes para revisão do admin.
 */
async function listReceiptsForAdmin(caixinhaId, adminId, filters = {}) {
  const fn = 'listReceiptsForAdmin';
  const supabase = sbService();

  // Verificar se é admin da caixinha
  const { data: caixinha } = await supabase
    .from('caixinhas')
    .select('admin_id')
    .eq('id', caixinhaId)
    .maybeSingle();

  if (!caixinha || caixinha.admin_id !== adminId) {
    throw new Error('Você não é administrador desta caixinha.');
  }

  let query = supabase
    .from('contribution_receipts')
    .select('*')
    .eq('caixinha_id', caixinhaId)
    .order('created_at', { ascending: false });

  if (filters.status) {
    query = query.eq('status', filters.status);
  }
  if (filters.limit) {
    query = query.limit(filters.limit);
  }
  if (filters.offset) {
    query = query.range(filters.offset, filters.offset + (filters.limit || 20) - 1);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Falha ao listar comprovantes: ${error.message}`);

  // Gerar signed URLs para previews
  const receipts = await Promise.all((data || []).map(async (r) => {
    let signedUrl = null;
    if (r.receipt_path) {
      const { data: signed } = await supabase.storage
        .from('contribution-receipts')
        .createSignedUrl(r.receipt_path, 3600);
      signedUrl = signed?.signedUrl || null;
    }
    return { ...r, receipt_url: signedUrl };
  }));

  log(fn, 'Comprovantes listados', { caixinhaId, count: receipts.length });
  return receipts;
}

/**
 * Histórico de comprovantes do contribuinte.
 */
async function getContributorReceipts(contributorId, caixinhaId) {
  const fn = 'getContributorReceipts';
  const supabase = sbService();

  let query = supabase
    .from('contribution_receipts')
    .select('id, caixinha_id, amount, status, payment_mode, created_at, reviewed_at, rejection_reason, expires_at')
    .eq('contributor_id', contributorId)
    .order('created_at', { ascending: false });

  if (caixinhaId) {
    query = query.eq('caixinha_id', caixinhaId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Falha ao buscar comprovantes: ${error.message}`);

  log(fn, 'Comprovantes do contribuinte', { contributorId, count: (data || []).length });
  return data || [];
}

/**
 * Retorna modos de pagamento disponíveis para a caixinha.
 */
async function getPaymentModes(caixinhaId) {
  const fn = 'getPaymentModes';
  const supabase = sbService();

  const { data: caixinha, error } = await supabase
    .from('caixinhas')
    .select('admin_id, pix_direto_enabled, asaas_wallet_id, asaas_subconta_status')
    .eq('id', caixinhaId)
    .maybeSingle();

  if (error || !caixinha) throw new Error('Caixinha não encontrada.');

  // PIX Direto: precisa de bank_account ativa com pixKey
  let pixDiretoAvailable = false;
  if (caixinha.pix_direto_enabled) {
    try {
      const accounts = await BankAccount.find(caixinha.admin_id, {
        caixinhaId,
        isActive: true,
        includeDecrypted: false, // Não precisa descriptografar para checar existência
      });
      pixDiretoAvailable = accounts.length > 0;
    } catch (_) {}
  }

  // PIX Asaas: precisa de subconta ativa
  const pixAsaasAvailable = !!(
    caixinha.asaas_wallet_id && caixinha.asaas_subconta_status === 'active'
  );

  log(fn, 'Modos de pagamento consultados', {
    caixinhaId, pixDiretoAvailable, pixAsaasAvailable,
  });

  return { pixDiretoAvailable, pixAsaasAvailable };
}

/**
 * Admin registra pagamento em dinheiro (espécie) de um membro.
 * Cria receipt já aprovado e credita o ledger.
 */
async function registerCashPayment(adminId, { caixinhaId, memberId, amount, paymentDate, notes }) {
  const fn = 'registerCashPayment';
  log(fn, 'Registrando pagamento em dinheiro', { adminId, caixinhaId, memberId, amount });

  const supabase = sbService();

  // 1. Verificar que o requisitante é admin da caixinha
  const { data: caixinha, error: cxErr } = await supabase
    .from('caixinhas')
    .select('admin_id')
    .eq('id', caixinhaId)
    .maybeSingle();

  if (cxErr) throw new Error(`Falha ao buscar caixinha: ${cxErr.message}`);
  if (!caixinha) throw new Error('Caixinha não encontrada.');
  if (caixinha.admin_id !== adminId) throw new Error('Somente o administrador pode registrar pagamentos.');

  // 2. Verificar que memberId é membro ativo da caixinha
  const { data: member, error: memErr } = await supabase
    .from('caixinha_members')
    .select('user_id, role, status')
    .eq('caixinha_id', caixinhaId)
    .eq('user_id', memberId)
    .maybeSingle();

  if (memErr) throw new Error(`Falha ao verificar membro: ${memErr.message}`);
  if (!member) throw new Error('Usuário não é membro desta caixinha.');
  if (member.status && member.status !== 'active') {
    throw new Error('Membro não está ativo nesta caixinha.');
  }

  // 3. Criar receipt já aprovado
  const receiptId = randomUUID();
  const paymentId = `CASH_${receiptId}`;

  const { error: insertErr } = await supabase
    .from('contribution_receipts')
    .insert({
      id: receiptId,
      caixinha_id: caixinhaId,
      contributor_id: memberId,
      admin_id: adminId,
      amount: Number(amount),
      payment_mode: 'cash',
      status: 'admin_approved',
      payment_id: paymentId,
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
      admin_notes: notes || 'Pagamento em dinheiro registrado pelo administrador',
      // Sem receipt_url/receipt_path (não tem comprovante)
      expires_at: new Date().toISOString(), // Já resolvido, sem prazo
    });

  if (insertErr) throw new Error(`Falha ao registrar pagamento: ${insertErr.message}`);

  // 4. Creditar via ledger
  const receipt = {
    id: receiptId,
    caixinha_id: caixinhaId,
    contributor_id: memberId,
    amount: Number(amount),
    payment_id: paymentId,
  };

  await _creditAfterApproval(receipt);

  // 5. Notificar o membro
  setImmediate(async () => {
    try {
      const NotificationDispatcher = require('./NotificationDispatcher');
      await NotificationDispatcher.dispatch({
        userId: memberId,
        type: 'receipt_approved',
        importance: 'high',
        data: {
          receiptId,
          amount: Number(amount),
          caixinhaId,
          paymentMode: 'cash',
          message: `O administrador registrou sua contribuição de R$ ${Number(amount).toFixed(2)}`,
        },
        metadata: { triggeredBy: adminId, correlationId: receiptId },
      });
    } catch (_) {}
  });

  log(fn, 'Pagamento em dinheiro registrado', { receiptId, caixinhaId, memberId, amount });

  return {
    receiptId,
    paymentId,
    status: 'admin_approved',
    amount: Number(amount),
    memberId,
  };
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  generatePixData,
  uploadReceipt,
  validateReceipt,
  approveReceipt,
  rejectReceipt,
  listReceiptsForAdmin,
  getContributorReceipts,
  getPaymentModes,
  registerCashPayment,
};
