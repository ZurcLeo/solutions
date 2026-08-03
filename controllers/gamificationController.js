/**
 * @fileoverview gamificationController — ElosCloud
 * Expõe os endpoints da API de gamificação.
 */

const Joi = require('joi');
const { logger } = require('../logger');
const gamificationService = require('../services/gamificationService');

// ── Schemas de validação [ELOC-001] ─────────────────
const spendSchema = Joi.object({
  amount:       Joi.number().integer().min(1).required(),
  source:       Joi.string().valid('spend', 'boost_purchase', 'tip').required(),
  targetUserId: Joi.string().optional(),
  metadata:     Joi.object().optional(),
});

const boostSchema = Joi.object({
  contentType:   Joi.string().valid('post', 'profile').required(),
  contentId:     Joi.string().required(),
  durationHours: Joi.number().integer().min(1).max(168).required(),
  cost:          Joi.number().integer().min(1).required(),
});

const tipSchema = Joi.object({
  receiverId: Joi.string().required(),
  amount:     Joi.number().integer().min(50).max(10000).required(),
});

const CTRL = 'gamificationController';

function uid(req) {
  return req.user?.uid || req.user?.id;
}

// GET /api/gamification/me
exports.getMe = async (req, res) => {
  try {
    const result = await gamificationService.getUserGamification(uid(req));
    return res.status(200).json(result);
  } catch (err) {
    logger.error('getMe falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/gamification/tasks
exports.getTasks = async (req, res) => {
  try {
    const result = await gamificationService.getAllTasksWithProgress(uid(req));
    return res.status(200).json(result);
  } catch (err) {
    logger.error('getTasks falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/gamification/task/complete
// body: { taskSlug: string }
exports.completeTask = async (req, res) => {
  const { taskSlug } = req.body;
  if (!taskSlug) {
    return res.status(400).json({ success: false, message: 'taskSlug obrigatório' });
  }

  try {
    const result = await gamificationService.completeTask(uid(req), taskSlug);
    return res.status(200).json(result);
  } catch (err) {
    logger.error('completeTask falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/gamification/task/progress
// body: { taskSlug: string, amount?: number }
exports.incrementProgress = async (req, res) => {
  const { taskSlug, amount = 1 } = req.body;
  if (!taskSlug) {
    return res.status(400).json({ success: false, message: 'taskSlug obrigatório' });
  }

  try {
    const result = await gamificationService.incrementTaskProgress(uid(req), taskSlug, amount);
    return res.status(200).json(result);
  } catch (err) {
    logger.error('incrementProgress falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/gamification/streak
exports.updateStreak = async (req, res) => {
  try {
    const result = await gamificationService.updateDailyStreak(uid(req));
    return res.status(200).json(result);
  } catch (err) {
    logger.error('updateStreak falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/gamification/selo/pin
// body: { userSeloId: string, isPinned: boolean }
exports.togglePin = async (req, res) => {
  const { userSeloId, isPinned } = req.body;
  if (!userSeloId || isPinned === undefined) {
    return res.status(400).json({ success: false, message: 'userSeloId e isPinned obrigatórios' });
  }

  try {
    const result = await gamificationService.toggleSeloPin(uid(req), userSeloId, isPinned);
    return res.status(200).json(result);
  } catch (err) {
    logger.error('togglePin falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/gamification/selo/celebrate
// body: { userSeloIds: string[] }
exports.celebrateSelos = async (req, res) => {
  const { userSeloIds } = req.body;
  if (!Array.isArray(userSeloIds) || userSeloIds.length === 0) {
    return res.status(400).json({ success: false, message: 'userSeloIds (array) obrigatório' });
  }

  try {
    const result = await gamificationService.markSelosCelebrated(uid(req), userSeloIds);
    return res.status(200).json(result);
  } catch (err) {
    logger.error('celebrateSelos falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/gamification/leaderboard?limit=20
exports.getLeaderboard = async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  try {
    const result = await gamificationService.getLeaderboard(limit);
    return res.status(200).json(result);
  } catch (err) {
    logger.error('getLeaderboard falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/gamification/catalog/levels
exports.getLevels = async (req, res) => {
  try {
    const result = await gamificationService.getLevels();
    return res.status(200).json(result);
  } catch (err) {
    logger.error('getLevels falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/gamification/catalog/selos
exports.getSelos = async (req, res) => {
  try {
    const result = await gamificationService.getAllSelos();
    return res.status(200).json(result);
  } catch (err) {
    logger.error('getSelos falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/gamification/event  (uso interno — outros serviços chamam aqui)
// body: { event: string, metadata?: object }
exports.triggerEvent = async (req, res) => {
  const { event, metadata } = req.body;
  if (!event) {
    return res.status(400).json({ success: false, message: 'event obrigatório' });
  }

  try {
    const results = await gamificationService.triggerEvent(event, uid(req), metadata || {});
    return res.status(200).json({ success: true, results });
  } catch (err) {
    logger.error('triggerEvent falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── [ELOC-001] Endpoints de Economia EloCoin ─────────

// POST /api/gamification/spend
// body: { amount, source, targetUserId?, metadata? }
exports.spendCoins = async (req, res) => {
  const { error, value } = spendSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ success: false, message: error.details[0].message });
  }

  const { amount, source, targetUserId, metadata } = value;

  try {
    const result = await gamificationService.spendCoins(
      uid(req), amount, source, targetUserId || null, metadata || {},
    );
    return res.status(200).json(result);
  } catch (err) {
    logger.error('spendCoins falhou', { service: CTRL, error: err.message });
    // Saldo insuficiente → 422 Unprocessable Entity
    const status = err.message.includes('Saldo insuficiente') ? 422 : 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

// POST /api/gamification/boost-content
// body: { contentType, contentId, durationHours, cost }
exports.boostContent = async (req, res) => {
  const { error, value } = boostSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ success: false, message: error.details[0].message });
  }

  const { contentType, contentId, durationHours, cost } = value;

  try {
    const result = await gamificationService.boostContent(
      uid(req), contentType, contentId, durationHours, cost,
    );
    return res.status(200).json(result);
  } catch (err) {
    logger.error('boostContent falhou', { service: CTRL, error: err.message });
    const status = err.message.includes('Saldo insuficiente') ? 422 : 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

// POST /api/gamification/tip
// body: { receiverId, amount }
exports.tipUser = async (req, res) => {
  const { error, value } = tipSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ success: false, message: error.details[0].message });
  }

  const { receiverId, amount } = value;

  if (receiverId === uid(req)) {
    return res.status(400).json({ success: false, message: 'Você não pode enviar gorjeta para si mesmo' });
  }

  try {
    const result = await gamificationService.tipUser(uid(req), receiverId, amount);
    return res.status(200).json(result);
  } catch (err) {
    logger.error('tipUser falhou', { service: CTRL, error: err.message });
    const status = err.message.includes('Saldo insuficiente') ? 422 : 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

// POST /api/gamification/recalculate
// Reconcilia user_tasks com dados reais das tabelas de origem.
// Usuário comum: recalcula o próprio progresso.
// Admin: pode passar { userId } no body para recalcular qualquer usuário.
exports.recalculate = async (req, res) => {
  const { userId: bodyUserId } = req.body || {};

  const isAdmin = req.user?.isAdmin ||
    req.user?.roles?.some(r =>
      (r.roleName === 'admin' || r.roleName === 'Admin') && r.validationStatus === 'validated'
    );

  if (bodyUserId && bodyUserId !== uid(req) && !isAdmin) {
    return res.status(403).json({ success: false, message: 'Sem permissão para recalcular outro usuário' });
  }

  const targetUserId = (bodyUserId && isAdmin) ? bodyUserId : uid(req);

  try {
    const result = await gamificationService.recalculateProgress(targetUserId);
    return res.status(200).json(result);
  } catch (err) {
    logger.error('recalculate falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/gamification/boost  (admin/platform)
// body: { userId, postId?, boostType, boostFactor?, reason?, expiresAt? }
exports.grantBoost = async (req, res) => {
  const { userId, postId, boostType, boostFactor, reason, expiresAt } = req.body;
  if (!userId || !boostType) {
    return res.status(400).json({ success: false, message: 'userId e boostType obrigatórios' });
  }

  try {
    const result = await gamificationService.grantContentBoost(userId, postId, boostType, {
      boostFactor, reason, expiresAt, grantedBy: uid(req),
    });
    return res.status(200).json(result);
  } catch (err) {
    logger.error('grantBoost falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};
