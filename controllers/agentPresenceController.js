'use strict';

/**
 * agentPresenceController.js — OPS-005: Agent presence endpoint handler.
 *
 * Receives presence events from IconChat via HMAC-authenticated POST.
 */

const Joi = require('joi');
const { logger } = require('../logger');
const agentPresenceService = require('../services/agentPresenceService');

const CTRL = 'agentPresenceController';

const SCHEMA = Joi.object({
  event_id: Joi.string().required(),
  event_type: Joi.string().valid('agent.status_changed').required(),
  timestamp: Joi.string().isoDate().required(),
  data: Joi.object({
    agent_id: Joi.string().required(),
    agent_name: Joi.string().required(),
    agent_avatar_url: Joi.string().uri().allow(null, ''),
    status: Joi.string().valid('online', 'busy', 'away', 'offline').required(),
    available_capacity: Joi.number().integer().min(0).allow(null),
    active_conversations: Joi.number().integer().min(0).allow(null),
    channels: Joi.array().items(Joi.string()).default([]),
  }).required(),
});

async function handlePresenceEvent(req, res) {
  try {
    const { error: joiErr, value } = SCHEMA.validate(req.body);
    if (joiErr) {
      return res.status(422).json({ error: joiErr.details[0].message });
    }

    agentPresenceService.updateAgentPresence(value.data);

    return res.json({ ok: true });
  } catch (err) {
    logger.error(`[${CTRL}] handlePresenceEvent error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

module.exports = { handlePresenceEvent };
