/**
 * @fileoverview eloCoinController — ElosCloud
 * Endpoint para extrato de ElosCoins.
 *
 * NOTA (2026-07-09): Endpoints de compra (packages, checkout, webhook) removidos.
 * ElosCoins é exclusivamente moeda de engajamento.
 */

const { logger } = require('../logger');
const eloCoinPackageService = require('../services/eloCoinPackageService');

const CTRL = 'eloCoinController';

function uid(req) {
  return req.user?.uid || req.user?.id;
}

// ──────────────────────────────────────────────────────
// GET /api/elcoin/statement — auth obrigatória
// query: page (default 1), limit (default 20, max 50)
// ──────────────────────────────────────────────────────
exports.getStatement = async (req, res) => {
  const userId = uid(req);
  const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

  try {
    const result = await eloCoinPackageService.getStatement(userId, page, limit);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    logger.error('getStatement falhou', { service: CTRL, error: err.message, userId });
    return res.status(500).json({ success: false, message: err.message });
  }
};
