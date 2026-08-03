/**
 * @fileoverview governanceController — ElosCloud [GOV-001]
 * Expõe os endpoints da API de governança comunitária EloCoins DAO.
 */

const Joi = require('joi');
const { logger } = require('../logger');
const governanceService = require('../services/governanceService');

const CTRL = 'governanceController';

function uid(req) {
  return req.user?.uid || req.user?.id;
}

// ── Schemas de validação ────────────────────────────────

const createProposalSchema = Joi.object({
  title:       Joi.string().min(5).max(200).required(),
  description: Joi.string().min(20).max(5000).required(),
  type:        Joi.string().valid('policy_change', 'fund_allocation', 'burn_event', 'community_initiative').required(),
  votingDays:  Joi.number().integer().min(1).max(30).default(7),
  quorum:      Joi.number().integer().min(2).max(1000).default(10),
});

const castVoteSchema = Joi.object({
  vote:   Joi.string().valid('for', 'against', 'abstain').required(),
  reason: Joi.string().max(1000).optional().allow('', null),
});

const listProposalsSchema = Joi.object({
  status: Joi.string().valid('draft', 'open', 'voting', 'approved', 'rejected', 'executed', 'cancelled').optional(),
  page:   Joi.number().integer().min(1).default(1),
  limit:  Joi.number().integer().min(1).max(50).default(10),
});

// ── Handlers ────────────────────────────────────────────

// POST /api/governance/proposals
exports.createProposal = async (req, res) => {
  try {
    const { error: valErr, value } = createProposalSchema.validate(req.body);
    if (valErr) {
      return res.status(400).json({ success: false, message: valErr.details[0].message });
    }

    const result = await governanceService.createProposal(uid(req), value);
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    logger.error('createProposal falhou', { service: CTRL, error: err.message });
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message, code: err.code });
  }
};

// GET /api/governance/proposals
exports.listProposals = async (req, res) => {
  try {
    const { error: valErr, value } = listProposalsSchema.validate(req.query);
    if (valErr) {
      return res.status(400).json({ success: false, message: valErr.details[0].message });
    }

    const result = await governanceService.listProposals(value);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error('listProposals falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/governance/proposals/:id
exports.getProposal = async (req, res) => {
  try {
    const result = await governanceService.getProposal(req.params.id);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error('getProposal falhou', { service: CTRL, error: err.message });
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

// PATCH /api/governance/proposals/:id/open
exports.openProposal = async (req, res) => {
  try {
    const result = await governanceService.openProposal(req.params.id, uid(req));
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error('openProposal falhou', { service: CTRL, error: err.message });
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

// POST /api/governance/proposals/:id/vote
exports.castVote = async (req, res) => {
  try {
    const { error: valErr, value } = castVoteSchema.validate(req.body);
    if (valErr) {
      return res.status(400).json({ success: false, message: valErr.details[0].message });
    }

    const result = await governanceService.castVote(
      req.params.id,
      uid(req),
      value.vote,
      value.reason
    );
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error('castVote falhou', { service: CTRL, error: err.message });
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message, code: err.code });
  }
};

// POST /api/governance/proposals/:id/tally
exports.tallyVotes = async (req, res) => {
  try {
    const result = await governanceService.tallyVotes(req.params.id);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error('tallyVotes falhou', { service: CTRL, error: err.message });
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

// POST /api/governance/proposals/:id/execute
exports.executeProposal = async (req, res) => {
  try {
    const result = await governanceService.executeProposal(req.params.id, uid(req));
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error('executeProposal falhou', { service: CTRL, error: err.message });
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

// GET /api/governance/treasury
exports.getTreasuryStats = async (req, res) => {
  try {
    const result = await governanceService.getTreasuryStats();
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error('getTreasuryStats falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};
