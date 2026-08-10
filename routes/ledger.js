/**
 * routes/ledger.js — Rotas do Ledger Unificado para o seller.
 * Todas as rotas exigem autenticacao (verifyToken).
 *
 * ref: docs/specs/LEDGER-UNIFICADO.md (W6, W7)
 */

'use strict';

const express = require('express');
const router = express.Router();
const ledgerController = require('../controllers/ledgerController');
const verifyToken = require('../middlewares/auth');

// Todas as rotas requerem autenticacao
router.use(verifyToken);

// ── W6: consulta ─────────────────────────────────────

// GET /api/ledger/balance — saldo completo (pending, available, settled, reversed)
router.get('/balance', ledgerController.getBalance);

// GET /api/ledger/statement — extrato paginado com filtros
router.get('/statement', ledgerController.getStatement);

// GET /api/ledger/summary — resumo consolidado para o dashboard
router.get('/summary', ledgerController.getSummary);

// ── W7: saque ────────────────────────────────────────

// POST /api/ledger/withdrawal — solicitar saque
router.post('/withdrawal', ledgerController.requestWithdrawal);

// GET /api/ledger/withdrawal/preview?amount=X — preview do saque
router.get('/withdrawal/preview', ledgerController.getWithdrawalPreview);

// GET /api/ledger/withdrawals — listar saques anteriores
router.get('/withdrawals', ledgerController.listWithdrawals);

module.exports = router;
