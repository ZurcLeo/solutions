/**
 * @fileoverview gamificationController — ElosCloud
 * Expõe os endpoints da API de gamificação.
 */

const { logger } = require('../logger');
const gamificationService = require('../services/gamificationService');

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
