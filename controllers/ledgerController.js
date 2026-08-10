/**
 * @fileoverview ledgerController — Endpoints REST para o seller visualizar
 * seu saldo e extrato do Ledger Unificado, e solicitar saques.
 *
 * Camada fina: extrai parametros da request, delega aos services,
 * retorna resposta padronizada { success, data } ou { success: false, message }.
 *
 * ref: docs/specs/LEDGER-UNIFICADO.md (W6, W7)
 */

'use strict';

const Joi = require('joi');
const ledgerService = require('../services/unifiedLedgerService');
const withdrawalService = require('../services/withdrawalService');
const { logger } = require('../logger');

const CTRL = 'ledgerController';

// ──────────────────────────────────────────────────────
// Schemas Joi
// ──────────────────────────────────────────────────────

const statementQuerySchema = Joi.object({
  limit:      Joi.number().integer().min(1).max(200).default(50),
  offset:     Joi.number().integer().min(0).default(0),
  sourceType: Joi.string().trim().max(50).optional(),
  fromDate:   Joi.string().isoDate().optional(),
  toDate:     Joi.string().isoDate().optional(),
});

const withdrawalBodySchema = Joi.object({
  amountBrl: Joi.number().positive().precision(2).required()
    .messages({ 'number.positive': 'Valor do saque deve ser positivo.' }),
  pixKey:    Joi.string().trim().min(1).max(100).required()
    .messages({ 'string.empty': 'Chave PIX e obrigatoria.' }),
  pixKeyType: Joi.string().valid('CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP').default('EVP'),
});

const withdrawalPreviewSchema = Joi.object({
  amount: Joi.number().positive().precision(2).required()
    .messages({ 'number.positive': 'Valor deve ser positivo.' }),
});

const withdrawalsListSchema = Joi.object({
  limit:  Joi.number().integer().min(1).max(100).default(20),
  offset: Joi.number().integer().min(0).default(0),
});

// ──────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────

/**
 * Resolve a conta ledger do usuario autenticado.
 * Retorna null se o usuario ainda nao tem conta no ledger.
 */
async function _resolveAccount(userId) {
  return ledgerService.getAccountByOwner('user', userId);
}

// ──────────────────────────────────────────────────────
// GET /api/ledger/balance
// ──────────────────────────────────────────────────────

/**
 * Retorna saldo completo do usuario (pending, available, settled, reversed).
 * Se o usuario nao possui conta no ledger, retorna zeros.
 */
exports.getBalance = async (req, res) => {
  try {
    const account = await _resolveAccount(req.user.uid);

    if (!account) {
      return res.status(200).json({
        success: true,
        data: { pending: 0, available: 0, settled: 0, reversed: 0 },
      });
    }

    const balance = await ledgerService.getBalanceFull(account.id);
    res.status(200).json({ success: true, data: balance });
  } catch (err) {
    logger.error(`[${CTRL}] getBalance error`, {
      controller: CTRL, action: 'GET_BALANCE_ERROR',
      userId: req.user?.uid, error: err.message,
    });
    res.status(500).json({ success: false, message: 'Erro ao buscar saldo.' });
  }
};

// ──────────────────────────────────────────────────────
// GET /api/ledger/statement
// ──────────────────────────────────────────────────────

/**
 * Retorna extrato paginado do usuario com filtros opcionais.
 */
exports.getStatement = async (req, res) => {
  const { error: validationError, value } = statementQuerySchema.validate(req.query, {
    allowUnknown: false,
    stripUnknown: true,
  });

  if (validationError) {
    return res.status(400).json({
      success: false,
      message: validationError.details[0].message,
    });
  }

  try {
    const account = await _resolveAccount(req.user.uid);

    if (!account) {
      return res.status(200).json({
        success: true,
        data: { entries: [], total: 0 },
      });
    }

    const { limit, offset, sourceType, fromDate, toDate } = value;

    const result = await ledgerService.getStatement(account.id, {
      limit,
      offset,
      sourceType,
      fromDate,
      toDate,
    });

    res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error(`[${CTRL}] getStatement error`, {
      controller: CTRL, action: 'GET_STATEMENT_ERROR',
      userId: req.user?.uid, error: err.message,
    });
    res.status(500).json({ success: false, message: 'Erro ao buscar extrato.' });
  }
};

// ──────────────────────────────────────────────────────
// GET /api/ledger/summary
// ──────────────────────────────────────────────────────

/**
 * Retorna resumo consolidado: saldo por status + total de entries +
 * breakdown por source_type. Util para o dashboard do seller.
 */
exports.getSummary = async (req, res) => {
  try {
    const account = await _resolveAccount(req.user.uid);

    if (!account) {
      return res.status(200).json({
        success: true,
        data: {
          balance: { pending: 0, available: 0, settled: 0, reversed: 0 },
          totalEntries: 0,
          bySourceType: {},
        },
      });
    }

    // Saldo por status
    const balance = await ledgerService.getBalanceFull(account.id);

    // Buscar todas as entries para contagem e breakdown (sem paginacao)
    // Usamos um limit alto o suficiente para o sumario
    const { getSupabaseClient } = require('../config/supabase');
    const sb = getSupabaseClient();

    const { data: entries, error: entriesErr, count } = await sb
      .from('ledger_entries')
      .select('source_type, amount_brl, status', { count: 'exact' })
      .eq('account_id', account.id);

    if (entriesErr) {
      throw entriesErr;
    }

    // Breakdown por source_type: soma amount_brl agrupado
    const bySourceType = {};
    for (const entry of (entries || [])) {
      const st = entry.source_type || 'unknown';
      if (!bySourceType[st]) {
        bySourceType[st] = { count: 0, totalBrl: 0 };
      }
      bySourceType[st].count += 1;
      bySourceType[st].totalBrl += parseFloat(entry.amount_brl) || 0;
    }

    // Arredondar totais para evitar floating point noise
    for (const key of Object.keys(bySourceType)) {
      bySourceType[key].totalBrl = Math.round(bySourceType[key].totalBrl * 100) / 100;
    }

    res.status(200).json({
      success: true,
      data: {
        balance,
        totalEntries: count || 0,
        bySourceType,
      },
    });
  } catch (err) {
    logger.error(`[${CTRL}] getSummary error`, {
      controller: CTRL, action: 'GET_SUMMARY_ERROR',
      userId: req.user?.uid, error: err.message,
    });
    res.status(500).json({ success: false, message: 'Erro ao buscar resumo financeiro.' });
  }
};

// ──────────────────────────────────────────────────────
// POST /api/ledger/withdrawal — solicitar saque
// ──────────────────────────────────────────────────────

/**
 * Solicita saque do seller. Registra lancamentos no ledger e
 * tenta transferencia PIX via Asaas. Se Asaas falhar, fica
 * como pending_transfer para admin transferir manualmente.
 */
exports.requestWithdrawal = async (req, res) => {
  const { error: validationError, value } = withdrawalBodySchema.validate(req.body, {
    allowUnknown: false,
    stripUnknown: true,
  });

  if (validationError) {
    return res.status(400).json({
      success: false,
      message: validationError.details[0].message,
    });
  }

  try {
    const result = await withdrawalService.requestWithdrawal(
      req.user.uid,
      value.amountBrl,
      value.pixKey,
      { pixKeyType: value.pixKeyType }
    );

    res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error(`[${CTRL}] requestWithdrawal error`, {
      controller: CTRL, action: 'REQUEST_WITHDRAWAL_ERROR',
      userId: req.user?.uid, error: err.message,
    });

    // Erros de validacao do service retornam 400, outros 500
    const isValidation = err.message.includes('insuficiente')
      || err.message.includes('bloqueada')
      || err.message.includes('minimo')
      || err.message.includes('recentemente')
      || err.message.includes('negativo')
      || err.message.includes('nao encontrada');

    res.status(isValidation ? 400 : 500).json({
      success: false,
      message: err.message || 'Erro ao processar saque.',
    });
  }
};

// ──────────────────────────────────────────────────────
// GET /api/ledger/withdrawal/preview?amount=X
// ──────────────────────────────────────────────────────

/**
 * Retorna preview do saque SEM executar.
 * Inclui saldo, taxa, divida, valor liquido e viabilidade.
 */
exports.getWithdrawalPreview = async (req, res) => {
  const { error: validationError, value } = withdrawalPreviewSchema.validate(req.query, {
    allowUnknown: false,
    stripUnknown: true,
  });

  if (validationError) {
    return res.status(400).json({
      success: false,
      message: validationError.details[0].message,
    });
  }

  try {
    const preview = await withdrawalService.getWithdrawalPreview(
      req.user.uid,
      value.amount
    );

    res.status(200).json({ success: true, data: preview });
  } catch (err) {
    logger.error(`[${CTRL}] getWithdrawalPreview error`, {
      controller: CTRL, action: 'GET_WITHDRAWAL_PREVIEW_ERROR',
      userId: req.user?.uid, error: err.message,
    });
    res.status(500).json({ success: false, message: 'Erro ao gerar preview do saque.' });
  }
};

// ──────────────────────────────────────────────────────
// GET /api/ledger/withdrawals — listar saques anteriores
// ──────────────────────────────────────────────────────

/**
 * Lista saques anteriores do seller, paginado.
 */
exports.listWithdrawals = async (req, res) => {
  const { error: validationError, value } = withdrawalsListSchema.validate(req.query, {
    allowUnknown: false,
    stripUnknown: true,
  });

  if (validationError) {
    return res.status(400).json({
      success: false,
      message: validationError.details[0].message,
    });
  }

  try {
    const result = await withdrawalService.listWithdrawals(
      req.user.uid,
      { limit: value.limit, offset: value.offset }
    );

    res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error(`[${CTRL}] listWithdrawals error`, {
      controller: CTRL, action: 'LIST_WITHDRAWALS_ERROR',
      userId: req.user?.uid, error: err.message,
    });
    res.status(500).json({ success: false, message: 'Erro ao listar saques.' });
  }
};
