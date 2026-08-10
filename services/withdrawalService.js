'use strict';

/**
 * withdrawalService — Saque de sellers usando o Ledger Unificado.
 *
 * Fluxo de saque com partidas dobradas, integracao seller_billing_balance (D3),
 * taxa como lancamento separado (D5), e transferencia via Asaas (ou manual v1).
 *
 * ref: docs/specs/LEDGER-UNIFICADO.md (W7)
 */

const { getSupabaseClient } = require('../config/supabase');
const ledger = require('./unifiedLedgerService');
const asaasService = require('./asaasService');
const { logger } = require('../logger');

const SERVICE = 'withdrawalService';

// ---------------------------------------------------------------------------
// Config — taxas de saque
// ---------------------------------------------------------------------------

/**
 * Taxa fixa (R$) de transferencia PIX.
 * Pode ser sobreescrita via env WITHDRAWAL_FEE_FIXED.
 */
const FEE_FIXED = parseFloat(process.env.WITHDRAWAL_FEE_FIXED || '3.50');

/**
 * Taxa percentual (decimal) de transferencia PIX.
 * Pode ser sobreescrita via env WITHDRAWAL_FEE_PERCENT.
 * Padrao: 0 (apenas taxa fixa). Se quiser 2.49%, usar 0.0249.
 */
const FEE_PERCENT = parseFloat(process.env.WITHDRAWAL_FEE_PERCENT || '0');

/**
 * Valor minimo para saque (BRL).
 */
const MIN_WITHDRAWAL = parseFloat(process.env.WITHDRAWAL_MIN_AMOUNT || '10.00');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error(`[${SERVICE}] Supabase client not available`);
  return client;
}

/**
 * Calcula a taxa de saque.
 */
function _calculateFee(amountBrl) {
  const fee = Math.round((amountBrl * FEE_PERCENT + FEE_FIXED) * 100) / 100;
  return fee;
}

/**
 * Busca billing balance do seller.
 * @returns {Promise<{balance_brl: number, is_blocked: boolean}|null>}
 */
async function _getBillingBalance(sellerUserId) {
  const sb = _sb();
  const { data, error } = await sb
    .from('seller_billing_balance')
    .select('balance_brl, is_blocked')
    .eq('seller_user_id', sellerUserId)
    .maybeSingle();

  if (error) {
    logger.error(`[${SERVICE}] Erro ao consultar billing balance`, {
      service: SERVICE, sellerUserId, error: error.message,
    });
    throw error;
  }

  return data;
}

/**
 * Deduz valor do billing balance apos deducao no saque.
 */
async function _deductBillingBalance(sellerUserId, deductAmount) {
  const sb = _sb();
  const { data: current } = await sb
    .from('seller_billing_balance')
    .select('id, balance_brl')
    .eq('seller_user_id', sellerUserId)
    .single();

  if (!current) return;

  const newBalance = Math.round((Number(current.balance_brl) - deductAmount) * 100) / 100;

  await sb
    .from('seller_billing_balance')
    .update({ balance_brl: Math.max(0, newBalance) })
    .eq('id', current.id);
}

/**
 * Gera idempotency key para evitar saque duplicado.
 * Formato: withdrawal:{userId}:{timestamp_minuto}
 * Impede dois saques no mesmo minuto pelo mesmo usuario.
 */
function _idempotencyKey(userId) {
  const minuteTs = Math.floor(Date.now() / 60000);
  return `withdrawal:${userId}:${minuteTs}`;
}

/**
 * Verifica se existe saque recente (ultimos 2 minutos) para evitar duplicatas.
 */
async function _checkRecentWithdrawal(accountId) {
  const sb = _sb();
  const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  const { data, error } = await sb
    .from('ledger_entries')
    .select('id, created_at')
    .eq('account_id', accountId)
    .eq('source_type', 'withdrawal')
    .lt('amount_brl', 0) // debito do seller
    .gte('created_at', twoMinAgo)
    .limit(1);

  if (error) {
    logger.warn(`[${SERVICE}] Erro ao checar saque recente`, {
      service: SERVICE, accountId, error: error.message,
    });
    // nao bloquear, apenas logar
    return false;
  }

  return data && data.length > 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Preview do saque SEM executar.
 *
 * @param {string} userId - Firebase UID do seller
 * @param {number} amountBrl - Valor bruto desejado para saque
 * @returns {Promise<Object>} preview com viabilidade
 */
async function getWithdrawalPreview(userId, amountBrl) {
  // 1. Buscar conta no ledger
  const account = await ledger.getAccountByOwner('user', userId);
  if (!account) {
    return {
      viable: false,
      reason: 'Voce ainda nao possui conta no ledger financeiro.',
      availableBalance: 0,
      requestedAmount: amountBrl,
      billingDebt: 0,
      fee: 0,
      netAmount: 0,
    };
  }

  // 2. Saldo disponivel
  const available = await ledger.getBalance(account.id, 'available');

  // 3. Billing debt (D3)
  const billing = await _getBillingBalance(userId);
  const billingDebt = billing ? Math.max(0, parseFloat(billing.balance_brl) || 0) : 0;
  const isBlocked = billing?.is_blocked === true;

  // 4. Calcula taxa (D5)
  const fee = _calculateFee(amountBrl);

  // 5. Valor liquido = valor - taxa - divida
  const netAmount = Math.round((amountBrl - fee - billingDebt) * 100) / 100;

  // 6. Verificacoes
  let viable = true;
  let reason = null;

  if (isBlocked) {
    viable = false;
    reason = 'Conta bloqueada por inadimplencia. Regularize sua assinatura antes de solicitar saque.';
  } else if (amountBrl < MIN_WITHDRAWAL) {
    viable = false;
    reason = `Valor minimo para saque: R$ ${MIN_WITHDRAWAL.toFixed(2).replace('.', ',')}.`;
  } else if (amountBrl > available) {
    viable = false;
    reason = `Saldo disponivel insuficiente. Disponivel: R$ ${available.toFixed(2).replace('.', ',')}.`;
  } else if (netAmount <= 0) {
    viable = false;
    reason = 'Valor liquido apos taxas e deducoes seria zero ou negativo.';
  }

  return {
    viable,
    reason,
    availableBalance: available,
    requestedAmount: amountBrl,
    billingDebt,
    fee,
    netAmount: Math.max(0, netAmount),
    feeFixed: FEE_FIXED,
    feePercent: FEE_PERCENT * 100,
    minWithdrawal: MIN_WITHDRAWAL,
  };
}

/**
 * Solicita saque do seller.
 *
 * Cria lancamentos no ledger (partidas dobradas) e tenta transferencia Asaas.
 * Se Asaas falhar, marca como pending_transfer para transferencia manual.
 *
 * @param {string} userId - Firebase UID do seller
 * @param {number} amountBrl - Valor bruto do saque
 * @param {string} pixKey - Chave PIX do seller
 * @param {Object} [options]
 * @param {string} [options.pixKeyType] - CPF, CNPJ, EMAIL, PHONE, EVP
 * @param {boolean} [options.platformAbsorbsFee] - Flag admin: plataforma absorve taxa
 * @returns {Promise<Object>} dados do saque
 */
async function requestWithdrawal(userId, amountBrl, pixKey, options = {}) {
  const { pixKeyType = 'EVP', platformAbsorbsFee = false } = options;

  logger.info(`[${SERVICE}] Iniciando saque`, {
    service: SERVICE, action: 'WITHDRAWAL_START',
    userId, amountBrl, pixKeyType,
  });

  // 1. Buscar conta do seller
  const account = await ledger.getAccountByOwner('user', userId);
  if (!account) {
    throw new Error('Conta no ledger nao encontrada. Voce precisa ter movimentacoes financeiras antes de solicitar saque.');
  }

  // 2. Idempotencia: checar saque recente
  const recentExists = await _checkRecentWithdrawal(account.id);
  if (recentExists) {
    throw new Error('Saque ja solicitado recentemente. Aguarde pelo menos 2 minutos entre saques.');
  }

  // 3. Saldo disponivel
  const available = await ledger.getBalance(account.id, 'available');
  if (available < amountBrl) {
    throw new Error(`Saldo disponivel insuficiente. Disponivel: R$ ${available.toFixed(2).replace('.', ',')}. Solicitado: R$ ${amountBrl.toFixed(2).replace('.', ',')}.`);
  }

  if (amountBrl < MIN_WITHDRAWAL) {
    throw new Error(`Valor minimo para saque: R$ ${MIN_WITHDRAWAL.toFixed(2).replace('.', ',')}.`);
  }

  // 4. Billing debt (D3)
  const billing = await _getBillingBalance(userId);
  if (billing?.is_blocked) {
    throw new Error('Conta bloqueada por inadimplencia. Regularize sua assinatura antes de solicitar saque.');
  }

  const billingDebt = billing ? Math.max(0, parseFloat(billing.balance_brl) || 0) : 0;

  // 5. Taxa (D5)
  const fee = _calculateFee(amountBrl);

  // 6. Valor liquido
  const netAmount = Math.round((amountBrl - fee - billingDebt) * 100) / 100;
  if (netAmount <= 0) {
    throw new Error('Valor liquido apos taxas e deducoes seria zero ou negativo. Aumente o valor do saque.');
  }

  // 7. Buscar/criar conta platform
  const platformAccountId = await ledger.ensureAccount('platform', null);

  // 8. Construir entries (partidas dobradas)
  const idempKey = _idempotencyKey(userId);
  const entries = [];

  // Entry principal: saque (seller debita, platform credita)
  entries.push({
    accountId:   account.id,
    amountBrl:   -amountBrl,
    status:      'settled',
    sourceType:  'withdrawal',
    sourceId:    idempKey,
    description: `Saque PIX — R$ ${amountBrl.toFixed(2).replace('.', ',')}`,
  });
  entries.push({
    accountId:   platformAccountId,
    amountBrl:   amountBrl,
    status:      'settled',
    sourceType:  'withdrawal',
    sourceId:    idempKey,
    description: `Saque seller — saida via PIX`,
  });

  // Registrar transacao principal
  const withdrawalTxnId = await ledger.recordTransaction(entries);

  // 9. Se ha divida de billing: entries separadas (D3)
  let debtTxnId = null;
  if (billingDebt > 0) {
    const debtEntries = [
      {
        accountId:   account.id,
        amountBrl:   -billingDebt,
        status:      'settled',
        sourceType:  'subscription_debt',
        sourceId:    idempKey,
        description: `Deducao divida assinatura — R$ ${billingDebt.toFixed(2).replace('.', ',')}`,
      },
      {
        accountId:   platformAccountId,
        amountBrl:   billingDebt,
        status:      'settled',
        sourceType:  'subscription_debt',
        sourceId:    idempKey,
        description: `Recebimento divida assinatura via saque`,
      },
    ];

    debtTxnId = await ledger.recordTransaction(debtEntries);

    // Atualizar billing balance
    await _deductBillingBalance(userId, billingDebt);

    logger.info(`[${SERVICE}] Divida de assinatura deduzida no saque`, {
      service: SERVICE, action: 'DEBT_DEDUCTED',
      userId, billingDebt, debtTxnId,
    });
  }

  // 10. Se ha taxa: entries separadas (D5)
  let feeTxnId = null;
  if (fee > 0) {
    const feeEntries = [];

    if (platformAbsorbsFee) {
      // Plataforma absorve: debita platform, credita platform (neutro contabil)
      feeEntries.push({
        accountId:   platformAccountId,
        amountBrl:   -fee,
        status:      'settled',
        sourceType:  'withdrawal_fee',
        sourceId:    idempKey,
        description: `Taxa de saque (absorvida pela plataforma) — R$ ${fee.toFixed(2).replace('.', ',')}`,
      });
      feeEntries.push({
        accountId:   platformAccountId,
        amountBrl:   fee,
        status:      'settled',
        sourceType:  'withdrawal_fee',
        sourceId:    idempKey,
        description: `Receita taxa de saque (absorvida)`,
      });
    } else {
      // Modo normal: seller paga a taxa
      feeEntries.push({
        accountId:   account.id,
        amountBrl:   -fee,
        status:      'settled',
        sourceType:  'withdrawal_fee',
        sourceId:    idempKey,
        description: `Taxa de transferencia PIX — R$ ${fee.toFixed(2).replace('.', ',')}`,
      });
      feeEntries.push({
        accountId:   platformAccountId,
        amountBrl:   fee,
        status:      'settled',
        sourceType:  'withdrawal_fee',
        sourceId:    idempKey,
        description: `Receita taxa de saque`,
      });
    }

    feeTxnId = await ledger.recordTransaction(feeEntries);
  }

  // 11. Tentar transferencia Asaas
  let transferResult = null;
  let transferStatus = 'pending_transfer'; // fallback: transferencia manual

  try {
    transferResult = await asaasService.createTransfer({
      pixAddressKey: pixKey,
      pixAddressKeyType: pixKeyType,
      value: netAmount,
      description: `ElosCloud — Saque seller ${userId.slice(0, 8)}`,
    });

    transferStatus = transferResult.status || 'PENDING';

    logger.info(`[${SERVICE}] Transferencia Asaas criada`, {
      service: SERVICE, action: 'ASAAS_TRANSFER_OK',
      userId, transferId: transferResult.id,
      status: transferResult.status, value: transferResult.value,
    });
  } catch (asaasErr) {
    // Asaas falhou — saque fica como pending_transfer para admin resolver manualmente
    logger.error(`[${SERVICE}] Transferencia Asaas falhou — saque sera manual`, {
      service: SERVICE, action: 'ASAAS_TRANSFER_FAILED',
      userId, amountBrl: netAmount,
      error: asaasErr.message,
    });
    // NAO faz throw — o saque esta registrado no ledger, admin transfere manualmente
  }

  // 12. Salvar registro do saque na tabela de controle
  const sb = _sb();
  const withdrawalRecord = {
    seller_user_id: userId,
    amount_brl: amountBrl,
    fee_brl: fee,
    billing_debt_brl: billingDebt,
    net_amount_brl: netAmount,
    pix_key: pixKey,
    pix_key_type: pixKeyType,
    ledger_txn_id: withdrawalTxnId,
    fee_txn_id: feeTxnId,
    debt_txn_id: debtTxnId,
    asaas_transfer_id: transferResult?.id || null,
    status: transferStatus,
    platform_absorbs_fee: platformAbsorbsFee,
  };

  const { data: savedRecord, error: insertErr } = await sb
    .from('seller_withdrawals')
    .insert(withdrawalRecord)
    .select('id, created_at')
    .single();

  if (insertErr) {
    // Nao-fatal: o saque ja esta no ledger. Logar e seguir.
    logger.error(`[${SERVICE}] Erro ao salvar registro de saque (nao-fatal)`, {
      service: SERVICE, action: 'SAVE_WITHDRAWAL_RECORD_ERROR',
      userId, error: insertErr.message,
    });
  }

  logger.info(`[${SERVICE}] Saque concluido`, {
    service: SERVICE, action: 'WITHDRAWAL_COMPLETE',
    userId, withdrawalId: savedRecord?.id,
    amountBrl, fee, billingDebt, netAmount,
    transferStatus,
    txnIds: { withdrawalTxnId, feeTxnId, debtTxnId },
  });

  return {
    withdrawalId: savedRecord?.id || null,
    transactionId: withdrawalTxnId,
    amountBrl,
    fee,
    billingDebt,
    netAmount,
    transferStatus,
    asaasTransferId: transferResult?.id || null,
    createdAt: savedRecord?.created_at || new Date().toISOString(),
  };
}

/**
 * Lista saques anteriores do seller.
 *
 * @param {string} userId - Firebase UID
 * @param {Object} [options]
 * @param {number} [options.limit=20]
 * @param {number} [options.offset=0]
 * @returns {Promise<{withdrawals: Array, total: number}>}
 */
async function listWithdrawals(userId, options = {}) {
  const { limit = 20, offset = 0 } = options;
  const sb = _sb();

  const { data, error, count } = await sb
    .from('seller_withdrawals')
    .select('*', { count: 'exact' })
    .eq('seller_user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error(`[${SERVICE}] Erro ao listar saques`, {
      service: SERVICE, action: 'LIST_WITHDRAWALS_ERROR',
      userId, error: error.message,
    });
    throw error;
  }

  const withdrawals = (data || []).map(row => ({
    id:               row.id,
    amountBrl:        parseFloat(row.amount_brl),
    feeBrl:           parseFloat(row.fee_brl),
    billingDebtBrl:   parseFloat(row.billing_debt_brl),
    netAmountBrl:     parseFloat(row.net_amount_brl),
    pixKey:           row.pix_key,
    pixKeyType:       row.pix_key_type,
    status:           row.status,
    asaasTransferId:  row.asaas_transfer_id,
    ledgerTxnId:      row.ledger_txn_id,
    createdAt:        row.created_at,
    platformAbsorbsFee: row.platform_absorbs_fee,
  }));

  return {
    withdrawals,
    total: count || 0,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  getWithdrawalPreview,
  requestWithdrawal,
  listWithdrawals,
  // Exposed for testing
  _calculateFee,
  MIN_WITHDRAWAL,
  FEE_FIXED,
  FEE_PERCENT,
};
