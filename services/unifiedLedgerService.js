'use strict';

/**
 * unifiedLedgerService — Camada financeira BRL de partidas dobradas.
 *
 * Wrapper JS sobre as RPCs do Supabase (record_ledger_transaction,
 * ledger_balance, ledger_balance_full, ledger_check_integrity).
 *
 * Toda movimentacao e um par de lancamentos que soma zero.
 * Saldo e derivado, nunca armazenado.
 *
 * ref: docs/specs/LEDGER-UNIFICADO.md
 */

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const SERVICE = 'unifiedLedgerService';
const PLATFORM_ACCOUNT_ID = 'platform';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error(`[${SERVICE}] Supabase client not available`);
  return client;
}

/**
 * Converte entry JS (camelCase) para o formato JSONB esperado pela RPC (snake_case).
 */
function _toSnake(entry) {
  return {
    account_id:   entry.accountId,
    amount_brl:   entry.amountBrl,
    status:       entry.status || 'pending',
    available_at: entry.availableAt || null,
    source_type:  entry.sourceType,
    source_id:    entry.sourceId || null,
    description:  entry.description,
    asaas_ref:    entry.asaasRef || null,
  };
}

/**
 * Converte entry snake_case do banco para camelCase JS.
 */
function _toCamel(row) {
  return {
    id:            row.id,
    transactionId: row.transaction_id,
    accountId:     row.account_id,
    amountBrl:     parseFloat(row.amount_brl),
    status:        row.status,
    availableAt:   row.available_at,
    sourceType:    row.source_type,
    sourceId:      row.source_id,
    description:   row.description,
    asaasRef:      row.asaas_ref,
    createdAt:     row.created_at,
    reversedBy:    row.reversed_by,
  };
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/**
 * Garante que uma conta existe no ledger. Cria se nao existir (upsert).
 *
 * @param {'user'|'platform'|'caixinha'} ownerType
 * @param {string|null} ownerId - Firebase UID (null para platform)
 * @param {string} [asaasWalletId] - walletId da subconta Asaas, se houver
 * @returns {Promise<string>} ID da conta
 */
async function ensureAccount(ownerType, ownerId, asaasWalletId) {
  const sb = _sb();

  const { data, error } = await sb
    .from('ledger_accounts')
    .upsert(
      {
        owner_type:      ownerType,
        owner_id:        ownerId,
        asaas_wallet_id: asaasWalletId || null,
      },
      { onConflict: 'owner_type,owner_id' }
    )
    .select('id')
    .single();

  if (error) {
    logger.error(`[${SERVICE}] ensureAccount falhou`, {
      service: SERVICE, action: 'ENSURE_ACCOUNT_ERROR',
      ownerType, ownerId, error: error.message,
    });
    throw error;
  }

  return data.id;
}

/**
 * Busca conta pelo owner_type + owner_id.
 *
 * @param {'user'|'platform'|'caixinha'} ownerType
 * @param {string|null} ownerId
 * @returns {Promise<{id: string, ownerType: string, ownerId: string, asaasWalletId: string, createdAt: string}|null>}
 */
async function getAccountByOwner(ownerType, ownerId) {
  const sb = _sb();

  const query = sb
    .from('ledger_accounts')
    .select('id, owner_type, owner_id, asaas_wallet_id, created_at');

  if (ownerId === null) {
    query.eq('owner_type', ownerType).is('owner_id', null);
  } else {
    query.eq('owner_type', ownerType).eq('owner_id', ownerId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    logger.error(`[${SERVICE}] getAccountByOwner falhou`, {
      service: SERVICE, action: 'GET_ACCOUNT_ERROR',
      ownerType, ownerId, error: error.message,
    });
    throw error;
  }

  if (!data) return null;

  return {
    id:            data.id,
    ownerType:     data.owner_type,
    ownerId:       data.owner_id,
    asaasWalletId: data.asaas_wallet_id,
    createdAt:     data.created_at,
  };
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/**
 * Registra uma transacao atomica no ledger (partidas dobradas, SUM = 0).
 *
 * @param {Array<{accountId: string, amountBrl: number, status?: string, availableAt?: string, sourceType: string, sourceId?: string, description: string, asaasRef?: string}>} entries
 * @returns {Promise<string>} transactionId gerado pela RPC
 * @throws {Error} Se SUM != 0, < 2 entries, ou conta inexistente
 */
async function recordTransaction(entries) {
  if (!Array.isArray(entries) || entries.length < 2) {
    throw new Error(`[${SERVICE}] recordTransaction requer >= 2 entries`);
  }

  const sb = _sb();
  const snakeEntries = entries.map(_toSnake);

  const { data, error } = await sb.rpc('record_ledger_transaction', {
    p_entries: snakeEntries,
  });

  if (error) {
    logger.error(`[${SERVICE}] recordTransaction falhou`, {
      service: SERVICE, action: 'RECORD_TXN_ERROR',
      entriesCount: entries.length,
      sourceType: entries[0]?.sourceType,
      sourceId: entries[0]?.sourceId,
      error: error.message,
    });
    throw error;
  }

  const transactionId = data;

  logger.info(`[${SERVICE}] Transacao registrada`, {
    service: SERVICE, action: 'RECORD_TXN_OK',
    transactionId,
    entriesCount: entries.length,
    sourceType: entries[0]?.sourceType,
    sourceId: entries[0]?.sourceId,
  });

  return transactionId;
}

/**
 * Reverte uma transacao: cria lancamentos espelhados (valores invertidos)
 * e marca as entries originais com reversed_by.
 *
 * @param {string} transactionId - transaction_id a reverter
 * @param {string} reason - motivo do estorno
 * @returns {Promise<string>} novo transactionId da reversao
 */
async function reverseTransaction(transactionId, reason) {
  const sb = _sb();

  // Buscar entries originais
  const { data: originals, error: fetchErr } = await sb
    .from('ledger_entries')
    .select('*')
    .eq('transaction_id', transactionId);

  if (fetchErr) {
    logger.error(`[${SERVICE}] reverseTransaction fetch falhou`, {
      service: SERVICE, action: 'REVERSE_TXN_FETCH_ERROR',
      transactionId, error: fetchErr.message,
    });
    throw fetchErr;
  }

  if (!originals || originals.length === 0) {
    throw new Error(`[${SERVICE}] transaction_id "${transactionId}" nao encontrado`);
  }

  // Verificar se ja foi revertida
  const alreadyReversed = originals.some(e => e.reversed_by);
  if (alreadyReversed) {
    throw new Error(`[${SERVICE}] transaction_id "${transactionId}" ja foi revertida`);
  }

  // Criar entries espelhadas (valores invertidos)
  const reversalEntries = originals.map(e => ({
    accountId:   e.account_id,
    amountBrl:   -parseFloat(e.amount_brl),
    status:      'reversed',
    sourceType:  'refund',
    sourceId:    e.source_id,
    description: `Estorno: ${reason}`,
    asaasRef:    e.asaas_ref,
  }));

  const reversalTxnId = await recordTransaction(reversalEntries);

  // Marcar entries originais com reversed_by
  const reversalEntryIds = await sb
    .from('ledger_entries')
    .select('id, account_id')
    .eq('transaction_id', reversalTxnId);

  for (const original of originals) {
    const matching = reversalEntryIds.data?.find(r => r.account_id === original.account_id);
    if (matching) {
      await sb
        .from('ledger_entries')
        .update({ reversed_by: matching.id })
        .eq('id', original.id);
    }
  }

  logger.info(`[${SERVICE}] Transacao revertida`, {
    service: SERVICE, action: 'REVERSE_TXN_OK',
    originalTxnId: transactionId,
    reversalTxnId,
    reason,
  });

  return reversalTxnId;
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

/**
 * Saldo derivado de uma conta por status.
 *
 * @param {string} accountId
 * @param {string} [status='available'] - 'pending' | 'available' | 'settled' | 'reversed'
 * @returns {Promise<number>}
 */
async function getBalance(accountId, status = 'available') {
  const sb = _sb();

  const { data, error } = await sb.rpc('ledger_balance', {
    p_account_id: accountId,
    p_status: status,
  });

  if (error) {
    logger.error(`[${SERVICE}] getBalance falhou`, {
      service: SERVICE, action: 'GET_BALANCE_ERROR',
      accountId, status, error: error.message,
    });
    throw error;
  }

  return parseFloat(data) || 0;
}

/**
 * Saldo completo de uma conta, agrupado por status.
 *
 * @param {string} accountId
 * @returns {Promise<{pending: number, available: number, settled: number, reversed: number}>}
 */
async function getBalanceFull(accountId) {
  const sb = _sb();

  const { data, error } = await sb.rpc('ledger_balance_full', {
    p_account_id: accountId,
  });

  if (error) {
    logger.error(`[${SERVICE}] getBalanceFull falhou`, {
      service: SERVICE, action: 'GET_BALANCE_FULL_ERROR',
      accountId, error: error.message,
    });
    throw error;
  }

  const result = { pending: 0, available: 0, settled: 0, reversed: 0 };
  if (data) {
    for (const row of data) {
      result[row.status] = parseFloat(row.balance) || 0;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Statement (extrato)
// ---------------------------------------------------------------------------

/**
 * Extrato paginado de uma conta.
 *
 * @param {string} accountId
 * @param {Object} [options]
 * @param {number} [options.limit=50]
 * @param {number} [options.offset=0]
 * @param {string} [options.sourceType] - filtrar por source_type
 * @param {string} [options.fromDate] - ISO date (inclusive)
 * @param {string} [options.toDate] - ISO date (inclusive)
 * @returns {Promise<{entries: Array, total: number}>}
 */
async function getStatement(accountId, options = {}) {
  const { limit = 50, offset = 0, sourceType, fromDate, toDate } = options;
  const sb = _sb();

  let query = sb
    .from('ledger_entries')
    .select('*', { count: 'exact' })
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (sourceType) query = query.eq('source_type', sourceType);
  if (fromDate)   query = query.gte('created_at', fromDate);
  if (toDate)     query = query.lte('created_at', toDate);

  const { data, error, count } = await query;

  if (error) {
    logger.error(`[${SERVICE}] getStatement falhou`, {
      service: SERVICE, action: 'GET_STATEMENT_ERROR',
      accountId, error: error.message,
    });
    throw error;
  }

  return {
    entries: (data || []).map(_toCamel),
    total: count || 0,
  };
}

// ---------------------------------------------------------------------------
// Status promotion (D6)
// ---------------------------------------------------------------------------

/**
 * Promove entries de pending → available para um source especifico.
 * So promove se available_at IS NULL OR available_at <= now() (decisao D6).
 *
 * Chamado quando o pedido/servico muda para 'completed'.
 *
 * @param {string} sourceType
 * @param {string} sourceId
 * @returns {Promise<number>} quantidade de entries promovidas
 */
async function promoteToAvailable(sourceType, sourceId) {
  const sb = _sb();

  const { data, error } = await sb
    .from('ledger_entries')
    .update({ status: 'available' })
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .eq('status', 'pending')
    .or('available_at.is.null,available_at.lte.now()')
    .select('id');

  if (error) {
    logger.error(`[${SERVICE}] promoteToAvailable falhou`, {
      service: SERVICE, action: 'PROMOTE_ERROR',
      sourceType, sourceId, error: error.message,
    });
    throw error;
  }

  const count = data?.length || 0;

  if (count > 0) {
    logger.info(`[${SERVICE}] Entries promovidas para available`, {
      service: SERVICE, action: 'PROMOTE_OK',
      sourceType, sourceId, promoted: count,
    });
  }

  return count;
}

/**
 * Job helper: promove TODOS os entries pendentes que ja compensaram
 * (available_at <= now()) independente de source. Usado pelo cron diario.
 *
 * @returns {Promise<number>} quantidade de entries promovidas
 */
async function promoteAllCompensated() {
  const sb = _sb();

  const { data, error } = await sb
    .from('ledger_entries')
    .update({ status: 'available' })
    .eq('status', 'pending')
    .not('available_at', 'is', null)
    .lte('available_at', new Date().toISOString())
    .select('id');

  if (error) {
    logger.error(`[${SERVICE}] promoteAllCompensated falhou`, {
      service: SERVICE, action: 'PROMOTE_ALL_ERROR',
      error: error.message,
    });
    throw error;
  }

  return data?.length || 0;
}

// ---------------------------------------------------------------------------
// Integrity check (reconciliation)
// ---------------------------------------------------------------------------

/**
 * Executa verificacao de integridade do ledger via RPC.
 *
 * @returns {Promise<Array<{checkName: string, passed: boolean, expectedVal: number, actualVal: number, deltaVal: number}>>}
 */
async function checkIntegrity() {
  const sb = _sb();

  const { data, error } = await sb.rpc('ledger_check_integrity');

  if (error) {
    logger.error(`[${SERVICE}] checkIntegrity falhou`, {
      service: SERVICE, action: 'CHECK_INTEGRITY_ERROR',
      error: error.message,
    });
    throw error;
  }

  return (data || []).map(row => ({
    checkName:   row.check_name,
    passed:      row.passed,
    expectedVal: parseFloat(row.expected_val) || 0,
    actualVal:   parseFloat(row.actual_val) || 0,
    deltaVal:    parseFloat(row.delta_val) || 0,
  }));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  PLATFORM_ACCOUNT_ID,
  ensureAccount,
  getAccountByOwner,
  recordTransaction,
  reverseTransaction,
  getBalance,
  getBalanceFull,
  getStatement,
  promoteToAvailable,
  promoteAllCompensated,
  checkIntegrity,
};
