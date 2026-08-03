const { logger } = require('../logger');
const { getSupabaseClient } = require('../config/supabase');
const asaasService = require('./asaasService');
const { randomUUID } = require('crypto');

// Firestore como backup fire-and-forget durante a transição
const { getFirestore } = require('../firebaseAdmin');

const sb = () => getSupabaseClient();

// ─── Paths Firestore (backup) ─────────────────────────────────────────────────

const _fsTransacoesRef = (caixinhaId) =>
  getFirestore().collection('caixinhas').doc(caixinhaId).collection('transacoes');
const _fsCaixinhaRef = (caixinhaId) =>
  getFirestore().collection('caixinhas').doc(caixinhaId);
const _fsSaquesRef = (caixinhaId) =>
  getFirestore().collection('caixinhas').doc(caixinhaId).collection('saques');
const _fsLedgerRef = (caixinhaId, userId) =>
  getFirestore().collection('caixinhas').doc(caixinhaId).collection('ledger').doc(userId);

// ─── creditMember ─────────────────────────────────────────────────────────────

/**
 * Credita o saldo virtual de um membro.
 * Idempotente: rejeita silenciosamente se paymentId já foi processado.
 */
exports.creditMember = async ({ caixinhaId, userId, amount, paymentId, description }) => {
  logger.info('Iniciando crédito de membro', {
    service: 'ledgerService', method: 'creditMember', caixinhaId, userId, amount, paymentId
  });

  const supabase = sb();

  if (supabase) {
    // Idempotência via Supabase (payment_id UNIQUE — [MIGR-006] resolvido)
    if (paymentId) {
      const { data: existing } = await supabase
        .from('transacoes')
        .select('id')
        .eq('payment_id', paymentId)
        .maybeSingle();
      if (existing) {
        logger.warn('Pagamento já processado — crédito ignorado (Supabase)', {
          service: 'ledgerService', paymentId, caixinhaId, userId
        });
        return { alreadyProcessed: true };
      }
    }

    const txId = randomUUID();
    const now = new Date().toISOString();

    // 1. Inserir transação (payment_id garante idempotência via UNIQUE index)
    const { error: errTrans } = await supabase
      .from('transacoes')
      .insert({
        id: txId,
        caixinha_id: caixinhaId,
        user_id: userId,
        tipo: 'contribuicao',
        valor: amount,
        data: now,
        ...(paymentId && { payment_id: paymentId })
      });

    if (errTrans) throw new Error(`Supabase transacoes insert: ${errTrans.message}`);

    // 2. Atualizar saldo virtual do membro (caixinha_members.saldo_virtual)
    const { data: memberRow } = await supabase
      .from('caixinha_members')
      .select('saldo_virtual')
      .eq('caixinha_id', caixinhaId)
      .eq('user_id', userId)
      .maybeSingle();

    if (memberRow !== null && memberRow !== undefined) {
      await supabase
        .from('caixinha_members')
        .update({
          saldo_virtual: (Number(memberRow.saldo_virtual) || 0) + amount,
          saldo_virtual_updated_at: now
        })
        .eq('caixinha_id', caixinhaId)
        .eq('user_id', userId);
    }

    // 3. Atualizar saldoTotal da caixinha
    const { data: caixinha } = await supabase
      .from('caixinhas')
      .select('saldo_total')
      .eq('id', caixinhaId)
      .single();

    if (!caixinha) throw new Error(`Caixinha ${caixinhaId} não encontrada`);

    await supabase
      .from('caixinhas')
      .update({ saldo_total: (Number(caixinha.saldo_total) || 0) + amount, updated_at: now })
      .eq('id', caixinhaId);

    // Backup Firestore fire-and-forget
    try {
      const { FieldValue } = require('../firebaseAdmin');
      const db = getFirestore();
      const batch = db.batch();
      const txRef = _fsTransacoesRef(caixinhaId).doc(txId);
      const ledger = _fsLedgerRef(caixinhaId, userId);
      const ledgerDoc = await ledger.get();
      batch.set(txRef, { type: 'contribuicao', amount, userId, caixinhaId, paymentId, description: description || 'Contribuição via PIX', date: new Date(), createdAt: new Date() });
      if (ledgerDoc.exists) {
        batch.update(ledger, { saldoVirtual: (ledgerDoc.data().saldoVirtual || 0) + amount, ultimaAtualizacao: new Date() });
      } else {
        batch.set(ledger, { userId, caixinhaId, saldoVirtual: amount, ultimaAtualizacao: new Date() });
      }
      batch.update(_fsCaixinhaRef(caixinhaId), { saldoTotal: FieldValue.increment(amount), dataUltimaTransacao: new Date() });
      batch.commit().catch(() => {});
    } catch (_) {}

    // Notificar membro
    setImmediate(async () => {
      try {
        const NotificationDispatcher = require('./NotificationDispatcher');
        await NotificationDispatcher.dispatch({
          userId, type: 'payment_confirmed', importance: 'high',
          data: { amount, description: description || 'Contribuição recebida' },
          metadata: { triggeredBy: 'system', correlationId: paymentId || txId }
        });
      } catch (err) {
        logger.warn('Falha ao notificar crédito de membro', { error: err.message, userId, amount });
      }
    });

    logger.info('Crédito de membro concluído (Supabase)', {
      service: 'ledgerService', txId, caixinhaId, userId, amount
    });
    return { txId, alreadyProcessed: false };
  }

  // Fallback Firestore completo
  const { FieldValue } = require('../firebaseAdmin');
  const db = getFirestore();
  const existingTx = await _fsTransacoesRef(caixinhaId).where('paymentId', '==', paymentId).limit(1).get();
  if (!existingTx.empty) return { alreadyProcessed: true };

  const batch = db.batch();
  const txDocRef = _fsTransacoesRef(caixinhaId).doc();
  batch.set(txDocRef, { type: 'contribuicao', amount, userId, caixinhaId, paymentId, description: description || 'Contribuição via PIX', date: new Date(), createdAt: new Date() });
  const ledger = _fsLedgerRef(caixinhaId, userId);
  const ledgerDoc = await ledger.get();
  if (ledgerDoc.exists) {
    batch.update(ledger, { saldoVirtual: (ledgerDoc.data().saldoVirtual || 0) + amount, ultimaAtualizacao: new Date() });
  } else {
    batch.set(ledger, { userId, caixinhaId, saldoVirtual: amount, ultimaAtualizacao: new Date() });
  }
  const caixDoc = await _fsCaixinhaRef(caixinhaId).get();
  if (!caixDoc.exists) throw new Error(`Caixinha ${caixinhaId} não encontrada`);
  batch.update(_fsCaixinhaRef(caixinhaId), { saldoTotal: FieldValue.increment(amount), dataUltimaTransacao: new Date() });
  await batch.commit();

  setImmediate(async () => {
    try {
      const NotificationDispatcher = require('./NotificationDispatcher');
      await NotificationDispatcher.dispatch({ userId, type: 'payment_confirmed', importance: 'high', data: { amount, description: description || 'Contribuição recebida' }, metadata: { triggeredBy: 'system', correlationId: paymentId || txDocRef.id } });
    } catch (err) { logger.warn('Falha ao notificar crédito de membro', { error: err.message }); }
  });

  return { txId: txDocRef.id, alreadyProcessed: false };
};

// ─── debitMember ──────────────────────────────────────────────────────────────

exports.debitMember = async ({ caixinhaId, userId, amount, reason, description }) => {
  logger.info('Iniciando débito de membro', {
    service: 'ledgerService', method: 'debitMember', caixinhaId, userId, amount, reason
  });

  const balance = await exports.getMemberBalance(caixinhaId, userId);
  if (balance < amount) {
    throw new Error(`Saldo insuficiente: disponível R$ ${balance.toFixed(2)}, solicitado R$ ${amount.toFixed(2)}`);
  }

  const supabase = sb();
  const txId = randomUUID();
  const now = new Date().toISOString();

  if (supabase) {
    // 1. Inserir transação de débito
    const { error: errTrans } = await supabase
      .from('transacoes')
      .insert({
        id: txId,
        caixinha_id: caixinhaId,
        user_id: userId,
        tipo: reason || 'debito',
        valor: -amount,
        data: now
      });

    if (errTrans) throw new Error(`Supabase transacoes insert (débito): ${errTrans.message}`);

    // 2. Atualizar saldo virtual do membro
    await supabase
      .from('caixinha_members')
      .update({ saldo_virtual: balance - amount, saldo_virtual_updated_at: now })
      .eq('caixinha_id', caixinhaId)
      .eq('user_id', userId);

    // 3. Atualizar saldoTotal da caixinha
    const { data: caixinha } = await supabase
      .from('caixinhas').select('saldo_total').eq('id', caixinhaId).single();
    if (caixinha) {
      await supabase.from('caixinhas')
        .update({ saldo_total: (Number(caixinha.saldo_total) || 0) - amount, updated_at: now })
        .eq('id', caixinhaId);
    }

    // Backup Firestore fire-and-forget
    try {
      const { FieldValue } = require('../firebaseAdmin');
      const db = getFirestore();
      const batch = db.batch();
      batch.set(_fsTransacoesRef(caixinhaId).doc(txId), { type: reason || 'debito', amount: -amount, userId, caixinhaId, description: description || 'Débito no ledger', date: new Date(), createdAt: new Date() });
      const ledger = _fsLedgerRef(caixinhaId, userId);
      batch.update(ledger, { saldoVirtual: balance - amount, ultimaAtualizacao: new Date() });
      batch.update(_fsCaixinhaRef(caixinhaId), { saldoTotal: FieldValue.increment(-amount), dataUltimaTransacao: new Date() });
      batch.commit().catch(() => {});
    } catch (_) {}

    logger.info('Débito de membro concluído (Supabase)', { service: 'ledgerService', txId, caixinhaId, userId, amount });
    return { txId };
  }

  // Fallback Firestore
  const { FieldValue } = require('../firebaseAdmin');
  const db = getFirestore();
  const batch = db.batch();
  const txDocRef = _fsTransacoesRef(caixinhaId).doc();
  batch.set(txDocRef, { type: reason || 'debito', amount: -amount, userId, caixinhaId, description: description || 'Débito no ledger', date: new Date(), createdAt: new Date() });
  const ledger = _fsLedgerRef(caixinhaId, userId);
  const ledgerDoc = await ledger.get();
  batch.update(ledger, { saldoVirtual: (ledgerDoc.exists ? (ledgerDoc.data().saldoVirtual || 0) : 0) - amount, ultimaAtualizacao: new Date() });
  const caixDoc = await _fsCaixinhaRef(caixinhaId).get();
  batch.update(_fsCaixinhaRef(caixinhaId), { saldoTotal: FieldValue.increment(-amount), dataUltimaTransacao: new Date() });
  await batch.commit();
  return { txId: txDocRef.id };
};

// ─── getMemberBalance ─────────────────────────────────────────────────────────

exports.getMemberBalance = async (caixinhaId, userId) => {
  const supabase = sb();
  if (supabase) {
    const { data } = await supabase
      .from('caixinha_members')
      .select('saldo_virtual')
      .eq('caixinha_id', caixinhaId)
      .eq('user_id', userId)
      .maybeSingle();
    if (data !== null && data !== undefined) return Number(data.saldo_virtual) || 0;
  }

  // Fallback Firestore
  const doc = await _fsLedgerRef(caixinhaId, userId).get();
  return doc.exists ? (doc.data().saldoVirtual || 0) : 0;
};

// ─── requestWithdrawal ────────────────────────────────────────────────────────

exports.requestWithdrawal = async ({ caixinhaId, userId, amount, pixKey, pixKeyType }) => {
  logger.info('Registrando solicitação de saque', {
    service: 'ledgerService', method: 'requestWithdrawal', caixinhaId, userId, amount
  });

  const balance = await exports.getMemberBalance(caixinhaId, userId);
  if (balance < amount) {
    throw new Error(`Saldo insuficiente para saque: disponível R$ ${balance.toFixed(2)}`);
  }

  const supabase = sb();

  if (supabase) {
    const { data: saque, error } = await supabase
      .from('caixinha_withdrawals')
      .insert({
        caixinha_id: caixinhaId,
        user_id: userId,
        amount,
        pix_key: pixKey,
        pix_key_type: pixKeyType || 'CPF',
        status: 'pending_approval',
        requested_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (error) throw new Error(`Supabase caixinha_withdrawals insert: ${error.message}`);

    // Backup Firestore fire-and-forget
    try {
      _fsSaquesRef(caixinhaId).doc(saque.id).set({
        userId, caixinhaId, amount, pixKey, pixKeyType: pixKeyType || 'CPF',
        status: 'pending_approval', requestedAt: new Date(), approvedAt: null, approvedBy: null, transferId: null
      }).catch(() => {});
    } catch (_) {}

    logger.info('Solicitação de saque registrada (Supabase)', { service: 'ledgerService', saqueId: saque.id });
    return { saqueId: saque.id };
  }

  // Fallback Firestore
  const saqueDocRef = _fsSaquesRef(caixinhaId).doc();
  await saqueDocRef.set({ userId, caixinhaId, amount, pixKey, pixKeyType: pixKeyType || 'CPF', status: 'pending_approval', requestedAt: new Date(), approvedAt: null, approvedBy: null, transferId: null });
  return { saqueId: saqueDocRef.id };
};

// ─── approveWithdrawal ────────────────────────────────────────────────────────

exports.approveWithdrawal = async ({ withdrawalId, caixinhaId, adminId }) => {
  logger.info('Aprovando saque', {
    service: 'ledgerService', method: 'approveWithdrawal', withdrawalId, caixinhaId, adminId
  });

  const supabase = sb();
  let saque;

  if (supabase) {
    const { data, error } = await supabase
      .from('caixinha_withdrawals')
      .select('*')
      .eq('id', withdrawalId)
      .eq('caixinha_id', caixinhaId)
      .single();

    if (error || !data) throw new Error('Solicitação de saque não encontrada');
    saque = { userId: data.user_id, amount: data.amount, pixKey: data.pix_key, pixKeyType: data.pix_key_type, status: data.status };
  } else {
    const saqueDoc = await _fsSaquesRef(caixinhaId).doc(withdrawalId).get();
    if (!saqueDoc.exists) throw new Error('Solicitação de saque não encontrada');
    saque = saqueDoc.data();
  }

  if (saque.status !== 'pending_approval') {
    throw new Error(`Saque já foi processado (status: ${saque.status})`);
  }

  // Debitar do ledger
  await exports.debitMember({
    caixinhaId, userId: saque.userId, amount: saque.amount,
    reason: 'saque', description: `Saque aprovado por ${adminId}`
  });

  // Executar transferência PIX — usa subconta da caixinha se disponível
  let transfer;
  try {
    // Buscar apiKey da subconta para transferir do saldo real segregado
    let subcontaApiKey;
    try {
      const supabase = sb();
      if (supabase) {
        const { data: secret } = await supabase
          .from('caixinha_asaas_secrets')
          .select('asaas_api_key')
          .eq('caixinha_id', caixinhaId)
          .maybeSingle();
        subcontaApiKey = secret?.asaas_api_key || null;
      }
    } catch (_) {}

    if (subcontaApiKey) {
      transfer = await asaasService.createSubcontaTransfer({
        subcontaApiKey,
        pixAddressKey: saque.pixKey,
        pixAddressKeyType: saque.pixKeyType,
        value: saque.amount,
        description: `Saque ElosCloud — caixinha ${caixinhaId}`
      });
    } else {
      // Fallback: conta mestre (caixinha ainda não tem subconta ativa)
      transfer = await asaasService.createTransfer({
        pixAddressKey: saque.pixKey,
        pixAddressKeyType: saque.pixKeyType,
        value: saque.amount,
        description: `Saque ElosCloud — caixinha ${caixinhaId}`
      });
    }
  } catch (error) {
    // Reverter débito
    await exports.creditMember({
      caixinhaId, userId: saque.userId, amount: saque.amount,
      paymentId: `REVERSAL_${withdrawalId}_${Date.now()}`,
      description: `Estorno: falha no saque ${withdrawalId}`
    });
    logger.error('Falha na transferência — débito revertido', { service: 'ledgerService', withdrawalId, error: error.message });
    throw error;
  }

  // Atualizar status do saque
  const now = new Date().toISOString();
  if (supabase) {
    await supabase
      .from('caixinha_withdrawals')
      .update({ status: 'completed', approved_at: now, approved_by: adminId, transfer_id: transfer.id, transfer_status: transfer.status })
      .eq('id', withdrawalId);
  }

  // Backup Firestore fire-and-forget
  try {
    _fsSaquesRef(caixinhaId).doc(withdrawalId).update({
      status: 'completed', approvedAt: new Date(), approvedBy: adminId, transferId: transfer.id, transferStatus: transfer.status
    }).catch(() => {});
  } catch (_) {}

  logger.info('Saque aprovado e transferência iniciada', { service: 'ledgerService', withdrawalId, transferId: transfer.id });
  return { transferId: transfer.id, status: transfer.status };
};
