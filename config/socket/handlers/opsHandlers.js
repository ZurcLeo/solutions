'use strict';

/**
 * opsHandlers.js — OPS Socket.IO handlers for admin Operations panel.
 *
 * Registered only for users with admin role.
 * Manages ops-admin room and agent presence requests.
 */

const { logger } = require('../../../logger');
const socketManager = require('../socketManager');
const agentPresenceService = require('../../../services/agentPresenceService');

const SVC = 'opsHandlers';

/**
 * Register ops-related Socket.IO handlers.
 * Called from socketConfig.js only for admin users.
 *
 * @param {import('socket.io').Socket} socket
 * @param {string} userId
 */
function registerOpsHandlers(socket, userId) {
  // Join ops-admin room for real-time task/presence updates
  socket.join('ops-admin');
  socketManager.addUserToRoom(userId, 'ops-admin');

  logger.info(`[${SVC}] Admin joined ops-admin room`, { userId, socketId: socket.id });

  // Handle request for current agent presence snapshot
  socket.on('ops:request_agent_presence', () => {
    try {
      const agents = agentPresenceService.getOnlineAgents();
      socket.emit('ops:agent_presence_update', agents);
    } catch (err) {
      logger.warn(`[${SVC}] request_agent_presence error`, { userId, error: err.message });
    }
  });
}

module.exports = { registerOpsHandlers };
