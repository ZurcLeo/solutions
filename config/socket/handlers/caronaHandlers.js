'use strict';

/**
 * caronaHandlers.js — ElosCloud Módulo de Carona Solidária
 *
 * Handlers Socket.IO para viagens de carona compartilhada.
 *
 * Modelo: pré-agendado (não on-demand). Reservas e notificações são emitidas
 * pelo caronaService.js via socketManager. Este handler gerencia:
 *   1. Room management: passageiro/motorista entra/sai da ride room
 *   2. Location tracking: motorista envia posição → broadcast para ride room
 *
 * Rooms:
 *   carona:ride:{rideId} — todos os participantes da viagem (motorista + passageiros)
 *
 * Eventos server→client emitidos pelo caronaService (não por este handler):
 *   carona:seat_booked, carona:seat_cancelled, carona:ride_departed,
 *   carona:ride_cancelled, carona:ride_updated, carona:passenger_boarded,
 *   carona:passenger_alighted, carona:rating_requested, carona:rating_received
 */

const { logger }        = require('../../../logger');
const socketManager     = require('../socketManager');
const { CARONA_EVENTS } = require('../socketEvents');

const SVC = 'caronaHandlers';

// ── Helpers ──────────────────────────────────────────────

function rideRoom(rideId) {
  return `carona:ride:${rideId}`;
}

function emitError(socket, context, message) {
  socket.emit(CARONA_EVENTS.ERROR, { context, message });
}

function parseCoords(data) {
  const lat = data?.lat != null ? Number(data.lat) : null;
  const lng = data?.lng != null ? Number(data.lng) : null;
  if (lat !== null && (isNaN(lat) || lat < -90 || lat > 90)) return null;
  if (lng !== null && (isNaN(lng) || lng < -180 || lng > 180)) return null;
  return { lat, lng };
}

// ── Registro principal ───────────────────────────────────

/**
 * Registra handlers de carona para um socket conectado.
 * @param {import('socket.io').Socket} socket
 * @param {string} userId
 */
function registerCaronaHandlers(socket, userId) {
  if (!socket || !userId) return;

  // Rastreia as ride rooms ativas deste socket
  const activeRideRooms = new Set();

  // ── join_ride_room ──────────────────────────────────────
  socket.on(CARONA_EVENTS.JOIN_RIDE_ROOM, (data) => {
    try {
      const { rideId } = data || {};
      if (!rideId) return emitError(socket, 'join_ride_room', 'rideId é obrigatório');

      const room = rideRoom(rideId);
      socket.join(room);
      socketManager.addUserToRoom(userId, room);
      activeRideRooms.add(room);

      socket.emit(CARONA_EVENTS.JOIN_RIDE_ROOM, {
        rideId, room, joined: true, timestamp: Date.now(),
      });

      logger.info(`[${SVC}] join_ride_room`, { userId, rideId, room });
    } catch (err) {
      logger.warn(`[${SVC}] join_ride_room error`, { userId, err: err.message });
      emitError(socket, 'join_ride_room', err.message);
    }
  });

  // ── leave_ride_room ─────────────────────────────────────
  socket.on(CARONA_EVENTS.LEAVE_RIDE_ROOM, (data) => {
    const { rideId } = data || {};
    if (!rideId) return;

    const room = rideRoom(rideId);
    socket.leave(room);
    socketManager.removeUserFromRoom(userId, room);
    activeRideRooms.delete(room);

    logger.info(`[${SVC}] leave_ride_room`, { userId, rideId });
  });

  // ── location_update ─────────────────────────────────────
  // Motorista envia posição → broadcast para todas as ride rooms ativas
  socket.on(CARONA_EVENTS.LOCATION_UPDATE, (data) => {
    try {
      const coords = parseCoords(data);
      if (!coords || coords.lat === null || coords.lng === null) {
        return emitError(socket, 'location_update', 'lat e lng são obrigatórios');
      }

      if (activeRideRooms.size === 0) {
        return; // Sem rooms ativas — ignora silenciosamente
      }

      const payload = {
        driverId: userId,
        lat: coords.lat,
        lng: coords.lng,
        timestamp: Date.now(),
      };

      // Broadcast para todas as ride rooms em que este motorista está
      for (const room of activeRideRooms) {
        socketManager.emitToRoom(room, CARONA_EVENTS.DRIVER_LOCATION, payload);
      }
    } catch (err) {
      logger.warn(`[${SVC}] location_update error`, { userId, err: err.message });
    }
  });

  // ── disconnect ──────────────────────────────────────────
  // Cleanup: remove de todas as ride rooms
  socket.on('disconnect', () => {
    for (const room of activeRideRooms) {
      socketManager.removeUserFromRoom(userId, room);
    }
    activeRideRooms.clear();
  });
}

module.exports = { registerCaronaHandlers };
