/**
 * @fileoverview trustPassportController — ElosCloud
 * Endpoints da API do Passaporte de Confiança.
 *
 * GET  /api/trust/passport          — passaporte próprio (privado: score, progress, actions)
 * GET  /api/trust/passport/:userId  — passaporte de outro user (público: nível + validadores)
 * POST /api/trust/endorse           — criar endosso de confiança
 * POST /api/trust/recalculate       — recalcular passaporte (próprio ou admin→qualquer)
 * POST /api/trust/recalculate-all   — recalcular todos (admin only)
 * GET  /api/trust/levels            — catálogo de níveis (público)
 */

const Joi = require('joi');
const { logger } = require('../logger');
const trustPassportService = require('../services/trustPassportService');

const CTRL = 'trustPassportController';

function uid(req) {
  return req.user?.uid || req.user?.id;
}

// ── GET /api/trust/passport ──────────────────────────
// Retorna passaporte COMPLETO do próprio usuário (privado)
exports.getMyPassport = async (req, res) => {
  try {
    const passport = await trustPassportService.getPassport(uid(req));
    return res.status(200).json({ success: true, data: passport });
  } catch (err) {
    logger.error('getMyPassport falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/trust/passport/:userId ──────────────────
// Retorna passaporte PÚBLICO de outro usuário (nível + validadores, SEM score/progress)
exports.getPublicPassport = async (req, res) => {
  const { userId } = req.params;

  const schema = Joi.string().min(1).max(128).required();
  const { error } = schema.validate(userId);
  if (error) {
    return res.status(400).json({ success: false, message: 'userId inválido' });
  }

  try {
    const passport = await trustPassportService.getPublicPassport(userId);
    if (!passport) {
      return res.status(404).json({ success: false, message: 'Passaporte não encontrado' });
    }
    return res.status(200).json({ success: true, data: passport });
  } catch (err) {
    logger.error('getPublicPassport falhou', { service: CTRL, error: err.message, userId });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/trust/endorse ──────────────────────────
// Cria endosso de confiança (endorser = usuário autenticado)
const endorseSchema = Joi.object({
  endorsedUserId: Joi.string().min(1).max(128).required(),
});

exports.createEndorsement = async (req, res) => {
  const { error, value } = endorseSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ success: false, message: error.details[0].message });
  }

  const endorserId = uid(req);
  const { endorsedUserId } = value;

  if (endorserId === endorsedUserId) {
    return res.status(400).json({ success: false, message: 'Você não pode endossar a si mesmo' });
  }

  try {
    const result = await trustPassportService.createEndorsement(endorserId, endorsedUserId);
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    logger.error('createEndorsement falhou', { service: CTRL, error: err.message, endorserId, endorsedUserId });

    // Erros de negócio conhecidos → 4xx
    if (err.message.includes('nível mínimo')) {
      return res.status(403).json({ success: false, message: err.message });
    }
    if (err.message.includes('monthly_endorsement_limit')) {
      return res.status(429).json({ success: false, message: err.message });
    }
    if (err.message.includes('já existe') || err.message.includes('duplicate') || err.message.includes('already')) {
      return res.status(409).json({ success: false, message: err.message });
    }

    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/trust/recalculate ──────────────────────
// Recalcula passaporte. Usuário comum: próprio. Admin: qualquer.
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
    const passport = await trustPassportService.calculatePassport(targetUserId);
    return res.status(200).json({ success: true, data: passport });
  } catch (err) {
    logger.error('recalculate falhou', { service: CTRL, error: err.message, targetUserId });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/trust/recalculate-all ──────────────────
// Admin only: recalcula todos os passaportes (batch)
exports.recalculateAll = async (req, res) => {
  const isAdmin = req.user?.isAdmin ||
    req.user?.roles?.some(r =>
      (r.roleName === 'admin' || r.roleName === 'Admin') && r.validationStatus === 'validated'
    );

  if (!isAdmin) {
    return res.status(403).json({ success: false, message: 'Apenas administradores' });
  }

  try {
    const result = await trustPassportService.recalculateAll();
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error('recalculateAll falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/trust/levels ────────────────────────────
// Catálogo público de níveis de confiança
exports.getLevels = async (req, res) => {
  try {
    const { data, error } = await require('../config/supabase').getSupabaseClient()
      .from('trust_levels')
      .select('level, name, min_score, min_domains, perks')
      .order('level', { ascending: true });

    if (error) throw error;
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('getLevels falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};
