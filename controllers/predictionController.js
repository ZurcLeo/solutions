'use strict';

// controllers/predictionController.js
// BOLAO-P2 — Controller do modulo Bolao de Previsoes
// Prefixo: /api/games/:gameId/prediction (sub-router via games.js)

const Joi                = require('joi');
const { logger }         = require('../logger');
const predictionService  = require('../services/predictionService');

const SERVICE = 'predictionController';

function logError(fn, err, extra = {}) {
  logger.error(`[${SERVICE}] ${fn}: ${err.message}`, {
    service: SERVICE, function: fn, error: err.message, ...extra,
  });
}

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function fail(res, message, status = 500) {
  return res.status(status).json({ success: false, message });
}

function resolveErrorStatus(err) {
  const msg = err.message || '';
  if (err.code === 'INSUFFICIENT_BALANCE' || msg.includes('Saldo insuficiente')) return 402;
  if (msg.includes('nao encontrad'))                  return 404;
  if (msg.includes('permissao') || msg.includes('Acesso negado')) return 403;
  if (msg.includes('nao e um bolao'))                 return 422;
  if (msg.includes('ja foi') || msg.includes('ja registrou') || msg.includes('ja contestado')) return 409;
  if (msg.includes('cancelado') || msg.includes('nao esta') || msg.includes('encerrado')) return 422;
  if (msg.includes('placeholder') || msg.includes('ativo'))  return 422;
  if (msg.includes('expirado'))                        return 422;
  if (msg.includes('deletar'))                         return 409;
  if (msg.includes('Nenhum'))                          return 422;
  return 500;
}

// ──────────────────────────────────────────────────────
// Joi Schemas
// ──────────────────────────────────────────────────────

const timePattern = /^\d{2}:\d{2}(:\d{2})?$/;

const createEventSchema = Joi.object({
  event_type:     Joi.string().valid('match', 'winner', 'custom').default('match'),
  team_home:      Joi.string().min(1).max(100).required(),
  team_away:      Joi.string().min(1).max(100).required(),
  team_home_flag: Joi.string().max(500).optional().allow(null, ''),
  team_away_flag: Joi.string().max(500).optional().allow(null, ''),
  event_date:     Joi.string().isoDate().required(),
  event_time:     Joi.string().pattern(timePattern).optional().allow(null),
  event_timezone: Joi.string().max(50).default('America/Sao_Paulo'),
  event_stage:    Joi.string().max(200).optional().allow(null, ''),
  brasilia_date:  Joi.string().isoDate().optional().allow(null),
  brasilia_time:  Joi.string().pattern(timePattern).optional().allow(null),
  venue:          Joi.string().max(200).optional().allow(null, ''),
  city:           Joi.string().max(100).optional().allow(null, ''),
  match_number:   Joi.number().integer().positive().optional().allow(null),
  source_match_home:  Joi.number().integer().optional().allow(null),
  source_type_home:   Joi.string().valid('winner', 'loser').optional().allow(null),
  source_match_away:  Joi.number().integer().optional().allow(null),
  source_type_away:   Joi.string().valid('winner', 'loser').optional().allow(null),
  is_active:      Joi.boolean().default(true),
  is_placeholder: Joi.boolean().default(false),
  points_exact_score: Joi.number().integer().min(0).default(10),
  points_winner:  Joi.number().integer().min(0).default(5),
  points_draw:    Joi.number().integer().min(0).default(3),
  eloscoin_base:  Joi.number().min(0).default(20),
  eloscoin_multiplier_per_scorer: Joi.number().min(0).default(1.0),
  display_order:  Joi.number().integer().min(0).default(0),
});

const updateEventSchema = Joi.object({
  event_type:     Joi.string().valid('match', 'winner', 'custom').optional(),
  team_home:      Joi.string().min(1).max(100).optional(),
  team_away:      Joi.string().min(1).max(100).optional(),
  team_home_flag: Joi.string().max(500).optional().allow(null, ''),
  team_away_flag: Joi.string().max(500).optional().allow(null, ''),
  event_date:     Joi.string().isoDate().optional(),
  event_time:     Joi.string().pattern(timePattern).optional().allow(null),
  event_timezone: Joi.string().max(50).optional(),
  event_stage:    Joi.string().max(200).optional().allow(null, ''),
  brasilia_date:  Joi.string().isoDate().optional().allow(null),
  brasilia_time:  Joi.string().pattern(timePattern).optional().allow(null),
  venue:          Joi.string().max(200).optional().allow(null, ''),
  city:           Joi.string().max(100).optional().allow(null, ''),
  match_number:   Joi.number().integer().positive().optional().allow(null),
  source_match_home:  Joi.number().integer().optional().allow(null),
  source_type_home:   Joi.string().valid('winner', 'loser').optional().allow(null),
  source_match_away:  Joi.number().integer().optional().allow(null),
  source_type_away:   Joi.string().valid('winner', 'loser').optional().allow(null),
  is_active:      Joi.boolean().optional(),
  is_placeholder: Joi.boolean().optional(),
  points_exact_score: Joi.number().integer().min(0).optional(),
  points_winner:  Joi.number().integer().min(0).optional(),
  points_draw:    Joi.number().integer().min(0).optional(),
  eloscoin_base:  Joi.number().min(0).optional(),
  eloscoin_multiplier_per_scorer: Joi.number().min(0).optional(),
  display_order:  Joi.number().integer().min(0).optional(),
}).min(1);

const confirmResultSchema = Joi.object({
  result_home_score: Joi.number().integer().min(0).required(),
  result_away_score: Joi.number().integer().min(0).required(),
  result_scorers:    Joi.array().items(Joi.object({
    name:   Joi.string().min(1).required(),
    team:   Joi.string().valid('home', 'away').required(),
    minute: Joi.number().integer().min(0).optional(),
  })).default([]),
});

const submitEntrySchema = Joi.object({
  event_id:            Joi.string().min(1).required(),
  predicted_home_score: Joi.number().integer().min(0).required(),
  predicted_away_score: Joi.number().integer().min(0).required(),
  predicted_scorers:    Joi.array().items(Joi.object({
    name: Joi.string().min(1).required(),
    team: Joi.string().valid('home', 'away').required(),
  })).default([]),
});

const contestSchema = Joi.object({
  reason: Joi.string().min(5).max(500).required(),
});

const apurateSchema = Joi.object({
  event_id:          Joi.string().optional(),
  force_recalculate: Joi.boolean().default(false),
});

// P3 — Batch + Seed
const batchCreateEventsSchema = Joi.object({
  events: Joi.array().items(createEventSchema).min(1).max(200).required(),
});

// ──────────────────────────────────────────────────────
// Handlers
// ──────────────────────────────────────────────────────

async function createEvent(req, res) {
  try {
    const { error, value } = createEventSchema.validate(req.body);
    if (error) return fail(res, error.details[0].message, 400);

    const result = await predictionService.createEvent(req.params.gameId, req.user.uid, value);
    return ok(res, result, 201);
  } catch (err) {
    logError('createEvent', err, { gameId: req.params.gameId });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

async function listEvents(req, res) {
  try {
    const opts = {
      include_inactive: req.query.include_inactive === 'true',
      only_pending:     req.query.only_pending === 'true',
    };
    const result = await predictionService.listEvents(req.params.gameId, req.user.uid, opts);
    return ok(res, result);
  } catch (err) {
    logError('listEvents', err, { gameId: req.params.gameId });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

async function updateEvent(req, res) {
  try {
    const { error, value } = updateEventSchema.validate(req.body);
    if (error) return fail(res, error.details[0].message, 400);

    const result = await predictionService.updateEvent(
      req.params.gameId, req.params.eventId, req.user.uid, value
    );
    return ok(res, result);
  } catch (err) {
    logError('updateEvent', err, { gameId: req.params.gameId, eventId: req.params.eventId });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

async function deleteEvent(req, res) {
  try {
    const result = await predictionService.deleteEvent(
      req.params.gameId, req.params.eventId, req.user.uid
    );
    return ok(res, result);
  } catch (err) {
    logError('deleteEvent', err, { gameId: req.params.gameId, eventId: req.params.eventId });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

async function confirmResult(req, res) {
  try {
    const { error, value } = confirmResultSchema.validate(req.body);
    if (error) return fail(res, error.details[0].message, 400);

    const result = await predictionService.confirmResult(
      req.params.gameId, req.params.eventId, req.user.uid, value
    );
    return ok(res, result);
  } catch (err) {
    logError('confirmResult', err, { gameId: req.params.gameId, eventId: req.params.eventId });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

async function submitEntry(req, res) {
  try {
    const { error, value } = submitEntrySchema.validate(req.body);
    if (error) return fail(res, error.details[0].message, 400);

    const result = await predictionService.submitEntry(req.params.gameId, req.user.uid, value);
    return ok(res, result, 201);
  } catch (err) {
    logError('submitEntry', err, { gameId: req.params.gameId });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

async function getMyEntries(req, res) {
  try {
    const result = await predictionService.getMyEntries(req.params.gameId, req.user.uid);
    return ok(res, result);
  } catch (err) {
    logError('getMyEntries', err, { gameId: req.params.gameId });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

async function getEventEntries(req, res) {
  try {
    const result = await predictionService.getEventEntries(
      req.params.gameId, req.params.eventId, req.user.uid
    );
    return ok(res, result);
  } catch (err) {
    logError('getEventEntries', err, { gameId: req.params.gameId, eventId: req.params.eventId });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

async function getRanking(req, res) {
  try {
    const result = await predictionService.getRanking(req.params.gameId, req.user.uid);
    return ok(res, result);
  } catch (err) {
    logError('getRanking', err, { gameId: req.params.gameId });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

async function contestResultHandler(req, res) {
  try {
    const { error, value } = contestSchema.validate(req.body);
    if (error) return fail(res, error.details[0].message, 400);

    const result = await predictionService.contestResult(
      req.params.gameId, req.params.eventId, req.user.uid, value
    );
    return ok(res, result);
  } catch (err) {
    logError('contestResult', err, { gameId: req.params.gameId, eventId: req.params.eventId });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

async function apurateHandler(req, res) {
  try {
    const { error, value } = apurateSchema.validate(req.body || {});
    if (error) return fail(res, error.details[0].message, 400);

    const result = await predictionService.apurate(req.params.gameId, req.user.uid, value);
    return ok(res, result);
  } catch (err) {
    logError('apurate', err, { gameId: req.params.gameId });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

// ──────────────────────────────────────────────────────
// P3 — Batch + Seed
// ──────────────────────────────────────────────────────

async function batchCreateEventsHandler(req, res) {
  try {
    const { error, value } = batchCreateEventsSchema.validate(req.body);
    if (error) return fail(res, error.details[0].message, 400);

    const result = await predictionService.batchCreateEvents(
      req.params.gameId, req.user.uid, value.events
    );
    return ok(res, result, 201);
  } catch (err) {
    logError('batchCreateEvents', err, { gameId: req.params.gameId });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

async function seedCopa2026Handler(req, res) {
  try {
    const result = await predictionService.seedCopa2026(
      req.params.gameId, req.user.uid
    );
    return ok(res, result, 201);
  } catch (err) {
    logError('seedCopa2026', err, { gameId: req.params.gameId });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

// ──────────────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────────────

module.exports = {
  createEvent,
  listEvents,
  updateEvent,
  deleteEvent,
  confirmResult,
  submitEntry,
  getMyEntries,
  getEventEntries,
  getRanking,
  contestResult: contestResultHandler,
  apurate:       apurateHandler,
  // P3
  batchCreateEvents: batchCreateEventsHandler,
  seedCopa2026:      seedCopa2026Handler,
};
