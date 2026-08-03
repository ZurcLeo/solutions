'use strict';

/**
 * agendaHandlers.js — AGENDA-004: Socket.IO handlers for agenda rooms.
 *
 * All authenticated users join agenda:user:{userId}.
 * Seller team members also join agenda:seller:{sellerId} for each active seller.
 */

const { logger } = require('../../../logger');
const socketManager = require('../socketManager');
const { getSupabaseClient } = require('../../../config/supabase');

const SVC = 'agendaHandlers';

/**
 * Register agenda-related Socket.IO rooms.
 * Called for ALL authenticated users.
 *
 * @param {import('socket.io').Socket} socket
 * @param {string} userId
 */
function registerAgendaHandlers(socket, userId) {
  // Every user joins their personal agenda room
  socket.join(`agenda:user:${userId}`);
  socketManager.addUserToRoom(userId, `agenda:user:${userId}`);

  // Join seller rooms for each seller the user is a team member of
  _joinSellerRooms(socket, userId).catch(err => {
    logger.warn(`[${SVC}] Failed to join seller agenda rooms`, { userId, error: err.message });
  });
}

async function _joinSellerRooms(socket, userId) {
  try {
    const client = getSupabaseClient();
    if (!client) return;

    const { data, error } = await client
      .rpc('get_seller_ids_for_user', { p_user_id: userId });

    if (error) {
      logger.warn(`[${SVC}] get_seller_ids_for_user RPC failed`, { userId, error: error.message });
      return;
    }

    const sellerIds = data || [];
    for (const sellerId of sellerIds) {
      socket.join(`agenda:seller:${sellerId}`);
      socketManager.addUserToRoom(userId, `agenda:seller:${sellerId}`);
    }

    if (sellerIds.length > 0) {
      logger.info(`[${SVC}] User joined ${sellerIds.length} seller agenda rooms`, { userId });
    }
  } catch (err) {
    logger.warn(`[${SVC}] _joinSellerRooms error`, { userId, error: err.message });
  }
}

module.exports = { registerAgendaHandlers };
