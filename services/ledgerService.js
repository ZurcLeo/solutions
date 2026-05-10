const { getFirestore } = require('../firebaseAdmin');
const { logger } = require('../logger');
const asaasService = require('./asaasService');

const db = getFirestore();

// ─── Paths ────────────────────────────────────────────────────────────────────

const ledgerRef = (caixinhaId, userId) =>
  db.collection('caixinhas').doc(caixinhaId).collection('ledger').doc(userId);

const transacoesRef = (caixinhaId) =>
  db.collection('caixinhas').doc(caixinhaId).collection('transacoes');

const caixinhaRef = (caixinhaId) =>
  db.collection('caixinhas').doc(caixinhaId);

const saquesRef = (caixinhaId) =>
  db.collection('caixinhas').doc(caixinhaId).collection('saques');

// ─── Operações de ledger ──────────────────────────────────────────────────────

/**
 * Credita o saldo virtual de um membro.
 * Idempotente: rejeita silenciosamente se paymentId já foi processado.
 */
exports.creditMember = async ({ caixinhaId, userId, amount, paymentId, description }) => {
  logger.info('Iniciando crédito de membro', {
    service: 'ledgerService',
    method: 'creditMember',
    caixinhaId,
    userId,
    amount,
    paymentId
  });

  // Idempotência: verificar se paymentId já foi registrado
  const existingTx = await transacoesRef(caixinhaId)
    .where('paymentId', '==', paymentId)
    .limit(1)
    .get();

  if (!existingTx.empty) {
    logger.warn('Pagamento já processado — crédito ignorado', {
      service: 'ledgerService',
      method: 'creditMember',
      paymentId,
      caixinhaId,
      userId
    });
    return { alreadyProcessed: true };
  }

  const batch = db.batch();

  // 1. Criar registro de transação auditável
  const txDocRef = transacoesRef(caixinhaId).doc();
  batch.set(txDocRef, {
    type: 'contribuicao',
    amount,
    userId,
    caixinhaId,
    paymentId,
    description: description || 'Contribuição via PIX',
    date: new Date(),
    createdAt: new Date()
  });

  // 2. Atualizar saldo virtual do membro no ledger
  const memberLedger = ledgerRef(caixinhaId, userId);
  const ledgerDoc = await memberLedger.get();

  if (ledgerDoc.exists) {
    batch.update(memberLedger, {
      saldoVirtual: (ledgerDoc.data().saldoVirtual || 0) + amount,
      ultimaAtualizacao: new Date()
    });
  } else {
    batch.set(memberLedger, {
      userId,
      caixinhaId,
      saldoVirtual: amount,
      ultimaAtualizacao: new Date()
    });
  }

  // 3. Atualizar saldoTotal da caixinha
  const caixDoc = await caixinhaRef(caixinhaId).get();
  if (!caixDoc.exists) throw new Error(`Caixinha ${caixinhaId} não encontrada`);

  batch.update(caixinhaRef(caixinhaId), {
    saldoTotal: (caixDoc.data().saldoTotal || 0) + amount,
    dataUltimaTransacao: new Date()
  });

  await batch.commit();

  logger.info('Crédito de membro concluído', {
    service: 'ledgerService',
    method: 'creditMember',
    txId: txDocRef.id,
    caixinhaId,
    userId,
    amount
  });

  return { txId: txDocRef.id, alreadyProcessed: false };
};

/**
 * Debita o saldo virtual de um membro (empréstimo aprovado, saque processado).
 * Bloqueia se saldo insuficiente.
 */
exports.debitMember = async ({ caixinhaId, userId, amount, reason, description }) => {
  logger.info('Iniciando débito de membro', {
    service: 'ledgerService',
    method: 'debitMember',
    caixinhaId,
    userId,
    amount,
    reason
  });

  const memberLedger = ledgerRef(caixinhaId, userId);
  const ledgerDoc = await memberLedger.get();
  const saldoAtual = ledgerDoc.exists ? (ledgerDoc.data().saldoVirtual || 0) : 0;

  if (saldoAtual < amount) {
    throw new Error(
      `Saldo insuficiente: disponível R$ ${saldoAtual.toFixed(2)}, solicitado R$ ${amount.toFixed(2)}`
    );
  }

  const batch = db.batch();

  // Registro de transação (valor negativo = débito)
  const txDocRef = transacoesRef(caixinhaId).doc();
  batch.set(txDocRef, {
    type: reason || 'debito',
    amount: -amount,
    userId,
    caixinhaId,
    description: description || 'Débito no ledger',
    date: new Date(),
    createdAt: new Date()
  });

  // Atualizar saldo do membro
  batch.update(memberLedger, {
    saldoVirtual: saldoAtual - amount,
    ultimaAtualizacao: new Date()
  });

  // Atualizar saldoTotal da caixinha
  const caixDoc = await caixinhaRef(caixinhaId).get();
  batch.update(caixinhaRef(caixinhaId), {
    saldoTotal: (caixDoc.data().saldoTotal || 0) - amount,
    dataUltimaTransacao: new Date()
  });

  await batch.commit();

  logger.info('Débito de membro concluído', {
    service: 'ledgerService',
    method: 'debitMember',
    txId: txDocRef.id,
    caixinhaId,
    userId,
    amount
  });

  return { txId: txDocRef.id };
};

/**
 * Retorna o saldo virtual atual do membro.
 * Fonte: documento de ledger (desnormalizado, consistência eventual via batch).
 */
exports.getMemberBalance = async (caixinhaId, userId) => {
  const doc = await ledgerRef(caixinhaId, userId).get();
  return doc.exists ? (doc.data().saldoVirtual || 0) : 0;
};

// ─── Fluxo de saque ───────────────────────────────────────────────────────────

/**
 * Registra solicitação de saque com status pending_approval.
 * Admin aprova via approveWithdrawal.
 */
exports.requestWithdrawal = async ({ caixinhaId, userId, amount, pixKey, pixKeyType }) => {
  logger.info('Registrando solicitação de saque', {
    service: 'ledgerService',
    method: 'requestWithdrawal',
    caixinhaId,
    userId,
    amount
  });

  const balance = await exports.getMemberBalance(caixinhaId, userId);
  if (balance < amount) {
    throw new Error(
      `Saldo insuficiente para saque: disponível R$ ${balance.toFixed(2)}`
    );
  }

  const saqueDocRef = saquesRef(caixinhaId).doc();
  await saqueDocRef.set({
    userId,
    caixinhaId,
    amount,
    pixKey,
    pixKeyType: pixKeyType || 'CPF',
    status: 'pending_approval',
    requestedAt: new Date(),
    approvedAt: null,
    approvedBy: null,
    transferId: null
  });

  logger.info('Solicitação de saque registrada', {
    service: 'ledgerService',
    method: 'requestWithdrawal',
    saqueId: saqueDocRef.id
  });

  return { saqueId: saqueDocRef.id };
};

/**
 * Admin aprova saque: debita ledger, executa transferência PIX via Asaas.
 */
exports.approveWithdrawal = async ({ withdrawalId, caixinhaId, adminId }) => {
  logger.info('Aprovando saque', {
    service: 'ledgerService',
    method: 'approveWithdrawal',
    withdrawalId,
    caixinhaId,
    adminId
  });

  const saqueDocRef = saquesRef(caixinhaId).doc(withdrawalId);
  const saqueDoc = await saqueDocRef.get();

  if (!saqueDoc.exists) throw new Error('Solicitação de saque não encontrada');

  const saque = saqueDoc.data();

  if (saque.status !== 'pending_approval') {
    throw new Error(`Saque já foi processado (status: ${saque.status})`);
  }

  // Debitar do ledger antes de acionar a transferência
  await exports.debitMember({
    caixinhaId,
    userId: saque.userId,
    amount: saque.amount,
    reason: 'saque',
    description: `Saque aprovado por ${adminId}`
  });

  // Executar transferência PIX via Asaas
  let transfer;
  try {
    transfer = await asaasService.createTransfer({
      pixAddressKey: saque.pixKey,
      pixAddressKeyType: saque.pixKeyType,
      value: saque.amount,
      description: `Saque ElosCloud — caixinha ${caixinhaId}`
    });
  } catch (error) {
    // Reverter débito se a transferência falhar
    await exports.creditMember({
      caixinhaId,
      userId: saque.userId,
      amount: saque.amount,
      paymentId: `REVERSAL_${withdrawalId}_${Date.now()}`,
      description: `Estorno: falha no saque ${withdrawalId}`
    });

    logger.error('Falha na transferência — débito revertido', {
      service: 'ledgerService',
      method: 'approveWithdrawal',
      withdrawalId,
      error: error.message
    });

    throw error;
  }

  // Atualizar status do saque
  await saqueDocRef.update({
    status: 'completed',
    approvedAt: new Date(),
    approvedBy: adminId,
    transferId: transfer.id,
    transferStatus: transfer.status
  });

  logger.info('Saque aprovado e transferência iniciada', {
    service: 'ledgerService',
    method: 'approveWithdrawal',
    withdrawalId,
    transferId: transfer.id
  });

  return { transferId: transfer.id, status: transfer.status };
};
