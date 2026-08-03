'use strict';

/**
 * agentPresenceService.js — OPS-005: In-memory agent presence tracker.
 *
 * Ephemeral state — no DB persistence. Stale detection via 90s heartbeat window.
 * IconChat sends POST /api/icon/agent-presence with HMAC, this service tracks state.
 */

const { logger } = require('../logger');
const socketManager = require('../config/socket/socketManager');

const TAG = 'agentPresenceService';

/** @type {Map<string, AgentPresence>} */
const _agents = new Map();

/** Stale threshold: 90 seconds */
const STALE_THRESHOLD_MS = 90 * 1000;

/** Purge interval: 30 seconds */
const PURGE_INTERVAL_MS = 30 * 1000;

let _purgeTimer = null;

/**
 * @typedef {Object} AgentPresence
 * @property {string} agent_id
 * @property {string} agent_name
 * @property {string|null} agent_avatar_url
 * @property {'online'|'busy'|'away'|'offline'} status
 * @property {number|null} available_capacity
 * @property {number|null} active_conversations
 * @property {string[]} channels
 * @property {number} last_heartbeat - Unix ms
 */

function updateAgentPresence(data) {
  const agentId = data.agent_id;
  const now = Date.now();

  if (data.status === 'offline') {
    _agents.delete(agentId);
    logger.info(`[${TAG}] Agent went offline`, { agentId });
    _broadcastPresence();
    return;
  }

  _agents.set(agentId, {
    agent_id: agentId,
    agent_name: data.agent_name,
    agent_avatar_url: data.agent_avatar_url || null,
    status: data.status,
    available_capacity: data.available_capacity ?? null,
    active_conversations: data.active_conversations ?? null,
    channels: data.channels || [],
    last_heartbeat: now,
  });

  _broadcastPresence();
}

function getOnlineAgents() {
  const now = Date.now();
  const result = [];
  for (const agent of _agents.values()) {
    if (now - agent.last_heartbeat < STALE_THRESHOLD_MS) {
      result.push(agent);
    }
  }
  return result;
}

function purgeStaleAgents() {
  const now = Date.now();
  let purged = 0;
  for (const [agentId, agent] of _agents.entries()) {
    if (now - agent.last_heartbeat >= STALE_THRESHOLD_MS) {
      _agents.delete(agentId);
      purged++;
      logger.info(`[${TAG}] Purged stale agent`, { agentId, lastSeen: agent.last_heartbeat });
    }
  }
  if (purged > 0) {
    _broadcastPresence();
  }
}

function _broadcastPresence() {
  try {
    socketManager.emitToRoom('ops-admin', 'ops:agent_presence_update', getOnlineAgents());
  } catch (_) { /* no-op if io not ready */ }
}

function startPurgeTimer() {
  if (_purgeTimer) return;
  _purgeTimer = setInterval(purgeStaleAgents, PURGE_INTERVAL_MS);
  logger.info(`[${TAG}] Stale agent purge timer started (${PURGE_INTERVAL_MS / 1000}s interval)`);
}

function stopPurgeTimer() {
  if (_purgeTimer) {
    clearInterval(_purgeTimer);
    _purgeTimer = null;
  }
}

// Auto-start purge timer
startPurgeTimer();

module.exports = {
  updateAgentPresence,
  getOnlineAgents,
  purgeStaleAgents,
  startPurgeTimer,
  stopPurgeTimer,
};
