/**
 * @fileoverview waitlistController — Endpoints da lista de espera
 *
 * POST   /api/waitlist              — cadastro público na waitlist
 * POST   /api/waitlist/check        — envio de contatos para matching
 * GET    /api/waitlist/status       — status por email
 * GET    /api/waitlist/matches      — notificações de matching (auth)
 * POST   /api/waitlist/matches/:id/accept  — B aceita convidar A (auth)
 * POST   /api/waitlist/matches/:id/dismiss — B rejeita (auth)
 * GET    /api/waitlist/matching     — status atual de matching (auth)
 * PATCH  /api/waitlist/matching     — opt-in/out de matching (auth)
 */

const Joi = require('joi');
const { logger } = require('../logger');
const waitlistService = require('../services/waitlistService');

const CTRL = 'waitlistController';

function uid(req) {
  return req.user?.uid || req.user?.id;
}

// ──────────────────────────────────────────────────────
// Schemas
// ──────────────────────────────────────────────────────

const addToWaitlistSchema = Joi.object({
  nome: Joi.string().trim().min(2).max(100).required(),
  email: Joi.string().email().required(),
  phone: Joi.string().trim().min(8).max(20).optional().allow(null, ''),
  referral_source: Joi.string().trim().max(50).optional().allow(null, ''),
});

const checkContactsSchema = Joi.object({
  waitlist_id: Joi.string().required(),
  phones: Joi.array().items(Joi.string().trim().min(8).max(20)).min(1).max(1000).required(),
});

const statusSchema = Joi.object({
  email: Joi.string().email().required(),
});

const matchingPreferenceSchema = Joi.object({
  public_matching: Joi.boolean().required(),
});

// ──────────────────────────────────────────────────────
// POST /api/waitlist — Cadastro público
// ──────────────────────────────────────────────────────

exports.addToWaitlist = async (req, res) => {
  const { error, value } = addToWaitlistSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ success: false, message: error.details[0].message });
  }

  try {
    const record = await waitlistService.addToWaitlist(value);
    return res.status(201).json({
      success: true,
      data: {
        id: record.id,
        status: record.status,
      },
    });

  } catch (err) {
    logger.error('addToWaitlist falhou', { service: CTRL, error: err.message });
    const status = err.message.includes('já está na lista') ? 409 : 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// POST /api/waitlist/check — Envio de contatos
// ──────────────────────────────────────────────────────

exports.checkContacts = async (req, res) => {
  const { error, value } = checkContactsSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ success: false, message: error.details[0].message });
  }

  try {
    const result = await waitlistService.checkContacts(value.waitlist_id, value.phones);

    // Resposta genérica — não revela se houve match ou não
    // A nunca sabe se B está cadastrado
    return res.status(200).json({
      success: true,
      message: 'Verificamos seus contatos. Se alguém que você conhece estiver na plataforma, avisaremos essa pessoa.',
    });

  } catch (err) {
    logger.error('checkContacts falhou', { service: CTRL, error: err.message });
    const status = err.message.includes('Máximo') ? 400 : 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// GET /api/waitlist/status?email= — Status por email
// ──────────────────────────────────────────────────────

exports.getStatus = async (req, res) => {
  const { error, value } = statusSchema.validate(req.query);
  if (error) {
    return res.status(400).json({ success: false, message: error.details[0].message });
  }

  try {
    const status = await waitlistService.getWaitlistStatus(value.email);
    if (!status) {
      return res.status(404).json({ success: false, message: 'Email não encontrado na lista de espera' });
    }

    return res.status(200).json({
      success: true,
      data: {
        status: status.status,
        created_at: status.created_at,
      },
    });

  } catch (err) {
    logger.error('getStatus falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// GET /api/waitlist/matches — Notificações de matching (auth)
// ──────────────────────────────────────────────────────

exports.getMatches = async (req, res) => {
  try {
    const notifications = await waitlistService.getMatchNotifications(uid(req));
    return res.status(200).json({ success: true, data: notifications });

  } catch (err) {
    logger.error('getMatches falhou', { service: CTRL, error: err.message, userId: uid(req) });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// POST /api/waitlist/matches/:id/accept — B aceita convidar A
// ──────────────────────────────────────────────────────

exports.acceptMatch = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await waitlistService.acceptMatchInvite(uid(req), id);

    return res.status(200).json({
      success: true,
      data: result,
      message: 'Convite será enviado para o email cadastrado.',
    });

  } catch (err) {
    logger.error('acceptMatch falhou', { service: CTRL, error: err.message, userId: uid(req) });
    const status = err.message.includes('não encontrada') ? 404 : 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// POST /api/waitlist/matches/:id/dismiss — B rejeita
// ──────────────────────────────────────────────────────

exports.dismissMatch = async (req, res) => {
  const { id } = req.params;

  try {
    await waitlistService.dismissMatchNotification(uid(req), id);
    return res.status(200).json({ success: true, message: 'Notificação descartada.' });

  } catch (err) {
    logger.error('dismissMatch falhou', { service: CTRL, error: err.message, userId: uid(req) });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// GET /api/waitlist/matching — Status atual de matching
// ──────────────────────────────────────────────────────

exports.getMatchingPreference = async (req, res) => {
  try {
    const result = await waitlistService.getMatchingPreference(uid(req));
    return res.status(200).json({ success: true, data: result });

  } catch (err) {
    logger.error('getMatchingPreference falhou', { service: CTRL, error: err.message, userId: uid(req) });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// PATCH /api/waitlist/matching — Opt-in/out de matching
// ──────────────────────────────────────────────────────

exports.updateMatchingPreference = async (req, res) => {
  const { error, value } = matchingPreferenceSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ success: false, message: error.details[0].message });
  }

  try {
    const result = await waitlistService.updateMatchingPreference(uid(req), value.public_matching);
    return res.status(200).json({ success: true, data: result });

  } catch (err) {
    logger.error('updateMatchingPreference falhou', { service: CTRL, error: err.message, userId: uid(req) });
    return res.status(500).json({ success: false, message: err.message });
  }
};
