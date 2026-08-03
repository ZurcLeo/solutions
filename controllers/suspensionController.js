/**
 * @fileoverview Controller de suspensão de usuários e sellers.
 * Todos os endpoints requerem role admin.
 *
 * @module controllers/suspensionController
 */

const suspensionService = require('../services/suspensionService');
const { logger } = require('../logger');

// ── Suspensão de Usuários ────────────────────────────────────────────────────

/**
 * POST /api/admin/suspensions/users
 * Body: { userId, reason, category?, durationDays? }
 */
exports.suspendUser = async (req, res) => {
  const { userId, reason, category, durationDays } = req.body;
  const adminId = req.user.uid;

  if (!userId) return res.status(400).json({ error: 'userId é obrigatório' });
  if (!reason || reason.length < 5) {
    return res.status(400).json({ error: 'reason é obrigatório (min 5 caracteres)' });
  }

  try {
    const suspension = await suspensionService.suspendUser(
      userId,
      { reason, category, durationDays: durationDays ? parseInt(durationDays, 10) : null },
      adminId,
    );
    res.status(201).json({ success: true, data: suspension });
  } catch (err) {
    const status = err.message.includes('obrigatório') || err.message.includes('inválid') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
};

/**
 * POST /api/admin/suspensions/users/:suspensionId/lift
 * Body: { liftReason }
 */
exports.liftSuspension = async (req, res) => {
  const { suspensionId } = req.params;
  const { liftReason } = req.body;
  const adminId = req.user.uid;

  if (!liftReason || liftReason.length < 5) {
    return res.status(400).json({ error: 'liftReason é obrigatório (min 5 caracteres)' });
  }

  try {
    const result = await suspensionService.liftSuspension(suspensionId, adminId, liftReason);
    res.json({ success: true, ...result });
  } catch (err) {
    const status = err.message.includes('não encontrada') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
};

/**
 * GET /api/admin/suspensions/users?page=1&limit=20&status=active
 */
exports.listSuspensions = async (req, res) => {
  const { page = 1, limit = 20, status = 'active' } = req.query;

  try {
    const result = await suspensionService.listSuspensions({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      status,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/admin/suspensions/users/:userId/history
 */
exports.getUserHistory = async (req, res) => {
  const { userId } = req.params;

  try {
    const history = await suspensionService.getUserSuspensionHistory(userId);
    res.json({ data: history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Suspensão de Sellers ─────────────────────────────────────────────────────

/**
 * POST /api/admin/suspensions/sellers
 * Body: { sellerId, reason }
 */
exports.suspendSeller = async (req, res) => {
  const { sellerId, reason } = req.body;
  const adminId = req.user.uid;

  if (!sellerId) return res.status(400).json({ error: 'sellerId é obrigatório' });
  if (!reason || reason.length < 5) {
    return res.status(400).json({ error: 'reason é obrigatório (min 5 caracteres)' });
  }

  try {
    const result = await suspensionService.suspendSeller(sellerId, reason, adminId);
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    const status = err.message.includes('não encontrado') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
};

/**
 * POST /api/admin/suspensions/sellers/:sellerId/reactivate
 * Body: { reason }
 */
exports.reactivateSeller = async (req, res) => {
  const { sellerId } = req.params;
  const { reason } = req.body;
  const adminId = req.user.uid;

  if (!reason || reason.length < 5) {
    return res.status(400).json({ error: 'reason é obrigatório (min 5 caracteres)' });
  }

  try {
    const result = await suspensionService.reactivateSeller(sellerId, reason, adminId);
    res.json({ success: true, ...result });
  } catch (err) {
    const status = err.message.includes('não encontrado') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
};

/**
 * GET /api/admin/suspensions/sellers
 */
exports.listSuspendedSellers = async (req, res) => {
  try {
    const sellers = await suspensionService.listSuspendedSellers();
    res.json({ data: sellers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Endpoint público: própria suspensão ─────────────────────────────────────

/**
 * GET /api/user/suspension
 * Retorna status de suspensão do próprio usuário.
 */
exports.getOwnSuspension = async (req, res) => {
  try {
    const { suspended, suspension } = await suspensionService.checkSuspension(req.user.uid);
    res.json({ suspended, suspension });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
