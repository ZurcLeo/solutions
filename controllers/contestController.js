'use strict';

// controllers/contestController.js
// CONTEST-BACK-002 — Controller de Concursos Colaborativos
// Prefixo de rotas: /api/games (sub-rotas montadas em routes/games.js)

const Joi              = require('joi');
const { logger }       = require('../logger');
const contestService   = require('../services/contestService');

const SERVICE = 'contestController';

function logError(fn, err, extra = {}) {
  logger.error(`[${SERVICE}] ${fn}: ${err.message}`, {
    service: SERVICE, function: fn, error: err.message, ...extra,
  });
}

// ──────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function fail(res, message, status = 500) {
  return res.status(status).json({ success: false, message });
}

function resolveErrorStatus(err) {
  const msg = err.message || '';
  if (msg.includes('não encontrado') || msg.includes('não encontrada')) return 404;
  if (msg.includes('permissão') || msg.includes('autorizado') || msg.includes('Acesso negado')) return 403;
  if (msg.includes('não é um concurso')) return 422;
  if (msg.includes('cancelado')) return 410;
  if (msg.includes('já pertence') || msg.includes('já submeteu') || msg.includes('já é membro') || msg.includes('já foi') || msg.includes('Já existe')) return 409;
  if (msg.includes('lotado') || msg.includes('máximo')) return 422;
  if (msg.includes('expirou') || msg.includes('não está mais')) return 410;
  if (msg.includes('incompleto') || msg.includes('Perfil') || msg.includes('Gate')) return 422;
  if (msg.includes('Só é possível')) return 422;
  return 500;
}

// ──────────────────────────────────────────────────────
// Schemas de validação
// ──────────────────────────────────────────────────────

const createTeamSchema = Joi.object({
  team_name:   Joi.string().min(2).max(60).required(),
  max_members: Joi.number().integer().min(2).max(50).optional().default(5),
});

const createChallengeSchema = Joi.object({
  title:             Joi.string().min(3).max(200).required(),
  description:       Joi.string().max(1000).optional().allow('', null),
  challenge_type:    Joi.string().valid('individual', 'team', 'community').optional().default('individual'),
  points:            Joi.number().integer().min(1).max(1000).optional().default(10),
  deadline:          Joi.string().isoDate().optional().allow(null),
  verification_type: Joi.string().valid('self_report', 'photo_proof', 'admin_verify', 'automatic').optional().default('self_report'),
});

const submitProofSchema = Joi.object({
  proof_url:  Joi.string().max(2000).optional().allow('', null),
  proof_type: Joi.string().valid('text', 'photo', 'link').optional().default('text'),
  team_id:    Joi.string().uuid().optional().allow(null),
});

const reviewSubmissionSchema = Joi.object({
  approved:       Joi.boolean().required(),
  points_awarded: Joi.number().integer().min(0).max(1000).optional().allow(null),
});

// ──────────────────────────────────────────────────────
// Teams
// ──────────────────────────────────────────────────────

/**
 * POST /api/games/:gameId/teams
 * Cria um time em um concurso. O criador se torna capitão.
 */
async function createTeam(req, res) {
  try {
    const { error, value } = createTeamSchema.validate(req.body, { abortEarly: false });
    if (error) return fail(res, error.details[0].message, 400);

    const userId = req.user.uid;
    const { gameId } = req.params;
    const team = await contestService.createTeam(gameId, userId, value.team_name, value.max_members);
    return ok(res, team, 201);
  } catch (err) {
    logError('createTeam', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * POST /api/games/teams/:teamId/join
 * Entra em um time existente.
 */
async function joinTeam(req, res) {
  try {
    const userId = req.user.uid;
    const { teamId } = req.params;
    const member = await contestService.joinTeam(teamId, userId);
    return ok(res, member, 201);
  } catch (err) {
    logError('joinTeam', err, { teamId: req.params.teamId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * DELETE /api/games/teams/:teamId/leave
 * Sai de um time.
 */
async function leaveTeam(req, res) {
  try {
    const userId = req.user.uid;
    const { teamId } = req.params;
    const result = await contestService.leaveTeam(teamId, userId);
    return ok(res, result);
  } catch (err) {
    logError('leaveTeam', err, { teamId: req.params.teamId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * GET /api/games/:gameId/teams
 * Lista times do concurso.
 */
async function listTeams(req, res) {
  try {
    const userId = req.user.uid;
    const { gameId } = req.params;
    const teams = await contestService.listTeams(gameId, userId);
    return ok(res, teams);
  } catch (err) {
    logError('listTeams', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * GET /api/games/teams/:teamId
 * Detalhes de um time.
 */
async function getTeamDetails(req, res) {
  try {
    const userId = req.user.uid;
    const { teamId } = req.params;
    const team = await contestService.getTeamDetails(teamId, userId);
    return ok(res, team);
  } catch (err) {
    logError('getTeamDetails', err, { teamId: req.params.teamId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

// ──────────────────────────────────────────────────────
// Challenges
// ──────────────────────────────────────────────────────

/**
 * POST /api/games/:gameId/challenges
 * Cria um desafio no concurso (owner/admin).
 */
async function createChallenge(req, res) {
  try {
    const { error, value } = createChallengeSchema.validate(req.body, { abortEarly: false });
    if (error) return fail(res, error.details[0].message, 400);

    const userId = req.user.uid;
    const { gameId } = req.params;
    const challenge = await contestService.createChallenge(gameId, userId, value);
    return ok(res, challenge, 201);
  } catch (err) {
    logError('createChallenge', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * GET /api/games/:gameId/challenges
 * Lista desafios do concurso.
 */
async function getContestChallenges(req, res) {
  try {
    const userId = req.user.uid;
    const { gameId } = req.params;
    const challenges = await contestService.getContestChallenges(gameId, userId);
    return ok(res, challenges);
  } catch (err) {
    logError('getContestChallenges', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

// ──────────────────────────────────────────────────────
// Submissions
// ──────────────────────────────────────────────────────

/**
 * POST /api/games/challenges/:challengeId/submit
 * Submete prova de conclusão.
 */
async function submitProof(req, res) {
  try {
    const { error, value } = submitProofSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) return fail(res, error.details[0].message, 400);

    const userId = req.user.uid;
    const { challengeId } = req.params;
    const submission = await contestService.submitProof(challengeId, userId, {
      proofUrl:  value.proof_url,
      proofType: value.proof_type,
      teamId:    value.team_id,
    });
    return ok(res, submission, 201);
  } catch (err) {
    logError('submitProof', err, { challengeId: req.params.challengeId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * PATCH /api/games/submissions/:submissionId/review
 * Revisa uma submissão (owner/admin).
 */
async function reviewSubmission(req, res) {
  try {
    const { error, value } = reviewSubmissionSchema.validate(req.body, { abortEarly: false });
    if (error) return fail(res, error.details[0].message, 400);

    const userId = req.user.uid;
    const { submissionId } = req.params;
    const result = await contestService.reviewSubmission(submissionId, userId, {
      approved:       value.approved,
      pointsAwarded:  value.points_awarded,
    });
    return ok(res, result);
  } catch (err) {
    logError('reviewSubmission', err, { submissionId: req.params.submissionId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * GET /api/games/:gameId/submissions/pending
 * Lista submissões pendentes de revisão (owner).
 */
async function getPendingSubmissions(req, res) {
  try {
    const userId = req.user.uid;
    const { gameId } = req.params;
    const submissions = await contestService.getPendingSubmissions(gameId, userId);
    return ok(res, submissions);
  } catch (err) {
    logError('getPendingSubmissions', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

// ──────────────────────────────────────────────────────
// Leaderboard
// ──────────────────────────────────────────────────────

/**
 * GET /api/games/:gameId/leaderboard
 * Ranking individual e/ou por times.
 */
async function getLeaderboard(req, res) {
  try {
    const userId = req.user.uid;
    const { gameId } = req.params;
    const { type } = req.query; // 'user' | 'team' | undefined (ambos)
    const leaderboard = await contestService.getLeaderboard(gameId, userId, type || null);
    return ok(res, leaderboard);
  } catch (err) {
    logError('getLeaderboard', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * POST /api/games/:gameId/leaderboard/refresh
 * Força recálculo do leaderboard (owner).
 */
async function refreshLeaderboard(req, res) {
  try {
    const userId = req.user.uid;
    const { gameId } = req.params;
    const result = await contestService.refreshLeaderboard(gameId, userId);
    return ok(res, result);
  } catch (err) {
    logError('refreshLeaderboard', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

module.exports = {
  // Teams
  createTeam,
  joinTeam,
  leaveTeam,
  listTeams,
  getTeamDetails,
  // Challenges
  createChallenge,
  getContestChallenges,
  // Submissions
  submitProof,
  reviewSubmission,
  getPendingSubmissions,
  // Leaderboard
  getLeaderboard,
  refreshLeaderboard,
};
