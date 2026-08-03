'use strict';

/**
 * deliveryHandlers.js — ElosCloud Delivery Module (DELIVERY-005)
 *
 * Socket.IO handlers para o módulo de entrega hiper-local.
 *
 * Rooms utilizadas:
 *   delivery:user:{userId}    — personal room; entregadores recebem novos pedidos aqui
 *   delivery:order:{orderId}  — tracking room; comprador + vendedor + entregador
 *
 * Responsabilidades:
 *   - Gerenciar sessão de disponibilidade do entregador (go_online / go_offline / heartbeat)
 *   - Receber e retransmitir atualizações de posição do entregador
 *   - Orquestrar aceite/recusa de pedido (delegando a deliveryService — árbitro)
 *   - Confirmação de etapas da entrega com broadcast ao order room
 *   - Desconexão limpa: vai offline automaticamente se o socket cair com sessão ativa
 */

const { logger }           = require('../../../logger');
const socketManager        = require('../socketManager');
const { DELIVERY_EVENTS }  = require('../socketEvents');
const deliveryService      = require('../../../services/deliveryService');

const SVC = 'deliveryHandlers';

// ── Helpers ──────────────────────────────────────────────

function orderRoom(orderId) {
  return `delivery:order:${orderId}`;
}

function userRoom(userId) {
  return `delivery:user:${userId}`;
}

function emitError(socket, context, message) {
  socket.emit(DELIVERY_EVENTS.ERROR, { context, message });
}

function parseCoords(data) {
  const lat = data?.lat != null ? Number(data.lat) : null;
  const lng = data?.lng != null ? Number(data.lng) : null;
  if (lat !== null && (isNaN(lat) || lat < -90 || lat > 90))   return null;
  if (lng !== null && (isNaN(lng) || lng < -180 || lng > 180)) return null;
  return { lat, lng };
}

// ── Registro principal ────────────────────────────────────

/**
 * Registra todos os handlers de delivery para um socket conectado.
 *
 * @param {import('socket.io').Socket} socket
 * @param {string} userId
 */
function registerDeliveryHandlers(socket, userId) {
  if (!socket || !userId) return;

  // Flag local para saber se este socket iniciou uma sessão de delivery.
  // Usada para ir offline automaticamente no disconnect.
  let isDeliverySessionActive = false;

  // Privacy gate: fase atual da entrega ativa deste entregador.
  // Posição só é retransmitida ao comprador quando deliveryPhase === 'in_transit_to_dest'.
  // Setado em JOIN_ORDER_ROOM (reconnect) e CONFIRM_STEP. Limpo em delivered/disconnect.
  let deliveryPhase = null;

  // Garantia: entrar na room pessoal de delivery (fã-out de novos pedidos)
  const personalRoom = userRoom(userId);
  socket.join(personalRoom);
  socketManager.addUserToRoom(userId, personalRoom);

  // ── go_online ─────────────────────────────────────────
  // Payload: { lat, lng }
  socket.on(DELIVERY_EVENTS.GO_ONLINE, async (data) => {
    try {
      const coords = parseCoords(data);
      if (coords === null) {
        return emitError(socket, 'go_online', 'Coordenadas inválidas');
      }

      const result = await deliveryService.goOnline(userId, coords);
      isDeliverySessionActive = true;

      socket.emit(DELIVERY_EVENTS.SESSION_CONFIRMED, {
        sessionId: result.sessionId,
        expiresAt: result.expiresAt,
        lat:       coords.lat,
        lng:       coords.lng,
      });

      logger.info(`[${SVC}] go_online`, { userId, lat: coords.lat, lng: coords.lng });
    } catch (err) {
      logger.warn(`[${SVC}] go_online error`, { userId, err: err.message });
      emitError(socket, 'go_online', err.message);
    }
  });

  // ── go_offline ────────────────────────────────────────
  // Payload: (vazio)
  socket.on(DELIVERY_EVENTS.GO_OFFLINE, async () => {
    try {
      await deliveryService.goOffline(userId);
      isDeliverySessionActive = false;

      socket.emit(DELIVERY_EVENTS.SESSION_ENDED, { timestamp: Date.now() });

      logger.info(`[${SVC}] go_offline`, { userId });
    } catch (err) {
      logger.warn(`[${SVC}] go_offline error`, { userId, err: err.message });
      emitError(socket, 'go_offline', err.message);
    }
  });

  // ── location_update ───────────────────────────────────
  // Payload: { lat, lng }
  // Atualiza a sessão ativa E retransmite posição para todos os order rooms
  // que o entregador esteja participando neste momento.
  socket.on(DELIVERY_EVENTS.LOCATION_UPDATE, async (data) => {
    try {
      const coords = parseCoords(data);
      if (!coords || coords.lat === null || coords.lng === null) {
        return emitError(socket, 'location_update', 'lat e lng são obrigatórios');
      }

      await deliveryService.updateLocation(userId, coords);

      // Privacy gate: só retransmitir posição ao comprador quando em in_transit_to_dest.
      // Nos demais estados o entregador ainda envia GPS (segurança/sessão), mas não é
      // exposto ao comprador — protege localização da loja e evita ansiedade.
      if (deliveryPhase !== 'in_transit_to_dest') {
        logger.info(`[${SVC}] location_update (gated)`, { userId, deliveryPhase });
        return;
      }

      // Broadcast de posição para order rooms ativas do entregador
      const rooms = socketManager.getUserRooms(userId);
      const activeOrderRooms = rooms.filter(r => r.startsWith('delivery:order:'));
      activeOrderRooms.forEach(room => {
        socketManager.emitToRoom(room, DELIVERY_EVENTS.DELIVERER_LOCATION, {
          delivererId: userId,
          lat: coords.lat,
          lng: coords.lng,
          timestamp: Date.now(),
        });
      });

      logger.info(`[${SVC}] location_update`, {
        userId, lat: coords.lat, lng: coords.lng, orderRooms: activeOrderRooms.length,
      });
    } catch (err) {
      logger.warn(`[${SVC}] location_update error`, { userId, err: err.message });
      // Silencioso — não bloquear UI por falha de heartbeat de posição
    }
  });

  // ── heartbeat ─────────────────────────────────────────
  // Payload: { lat?, lng? }  — posição opcional para atualizar junto
  socket.on(DELIVERY_EVENTS.HEARTBEAT, async (data) => {
    try {
      const coords = parseCoords(data || {});
      await deliveryService.heartbeat(userId, coords || {});
      // Sem resposta ao cliente — silent keepalive
    } catch (err) {
      logger.warn(`[${SVC}] heartbeat error`, { userId, err: err.message });
    }
  });

  // ── accept_request ────────────────────────────────────
  // Payload: { requestId }
  // deliveryService é o árbitro via PostgreSQL optimistic lock:
  //   UPDATE delivery_requests SET status='matched' WHERE status='open'
  // Apenas um vence; os demais recebem erro 'já foi aceito'.
  socket.on(DELIVERY_EVENTS.ACCEPT_REQUEST, async (data) => {
    try {
      const { requestId } = data || {};
      if (!requestId) return emitError(socket, 'accept_request', 'requestId é obrigatório');

      const result = await deliveryService.acceptDeliveryRequest(userId, requestId);

      // Entregador entra na order room para rastreio
      const room = orderRoom(requestId);
      socket.join(room);
      socketManager.addUserToRoom(userId, room);

      // Confirma ao entregador
      socket.emit(DELIVERY_EVENTS.REQUEST_ACCEPTED, {
        requestId,
        order: result,
        timestamp: Date.now(),
      });

      // Notifica vendedor e comprador na order room
      socketManager.emitToRoom(room, DELIVERY_EVENTS.STATUS_UPDATE, {
        requestId,
        status:      'matched',
        delivererId: userId,
        timestamp:   Date.now(),
      });

      logger.info(`[${SVC}] accept_request`, { userId, requestId });
    } catch (err) {
      logger.warn(`[${SVC}] accept_request error`, { userId, err: err.message });
      // Distinguir "já aceito" (corrida perdida) de erro genérico
      const alreadyTaken = err.message.includes('já foi aceito');
      emitError(socket, 'accept_request', alreadyTaken ? 'already_taken' : err.message);
    }
  });

  // ── decline_request ───────────────────────────────────
  // Payload: { requestId }
  socket.on(DELIVERY_EVENTS.DECLINE_REQUEST, async (data) => {
    try {
      const { requestId } = data || {};
      if (!requestId) return emitError(socket, 'decline_request', 'requestId é obrigatório');

      await deliveryService.declineDeliveryRequest(userId, requestId);

      socket.emit(DELIVERY_EVENTS.REQUEST_DECLINED, { requestId, timestamp: Date.now() });

      logger.info(`[${SVC}] decline_request`, { userId, requestId });
    } catch (err) {
      logger.warn(`[${SVC}] decline_request error`, { userId, err: err.message });
      emitError(socket, 'decline_request', err.message);
    }
  });

  // ── confirm_step ──────────────────────────────────────
  // Payload: { requestId, step }
  // Steps válidos: picked_up | on_the_way | delivered
  socket.on(DELIVERY_EVENTS.CONFIRM_STEP, async (data) => {
    try {
      const { requestId, step } = data || {};
      if (!requestId) return emitError(socket, 'confirm_step', 'requestId é obrigatório');
      if (!step)      return emitError(socket, 'confirm_step', 'step é obrigatório');

      const result = await deliveryService.confirmStep(userId, requestId, step);

      // Atualizar privacy gate: ativar broadcast de posição ao comprador
      if (step === 'in_transit_to_dest') deliveryPhase = 'in_transit_to_dest';

      // Confirma ao entregador
      socket.emit(DELIVERY_EVENTS.STEP_CONFIRMED, {
        requestId, step, result, timestamp: Date.now(),
      });

      // Broadcast do novo status para toda a order room (vendedor + comprador)
      const room = orderRoom(requestId);
      socketManager.emitToRoom(room, DELIVERY_EVENTS.STATUS_UPDATE, {
        requestId,
        status:    result.status,
        step,
        timestamp: Date.now(),
      });

      // Se chegou a 'delivered', encerrar sessão ativa do entregador (opcional —
      // o serviço já gerencia, mas sinalizamos ao frontend)
      if (result.status === 'delivered') {
        deliveryPhase = null;
        socket.emit(DELIVERY_EVENTS.SESSION_ENDED, {
          reason:    'delivery_completed',
          requestId,
          timestamp: Date.now(),
        });
        isDeliverySessionActive = false;
      }

      logger.info(`[${SVC}] confirm_step`, { userId, requestId, step, newStatus: result.status });
    } catch (err) {
      logger.warn(`[${SVC}] confirm_step error`, { userId, err: err.message });
      emitError(socket, 'confirm_step', err.message);
    }
  });

  // ── join_order_room ───────────────────────────────────
  // Payload: { orderId }
  // Qualquer parte legítima (entregador, vendedor, comprador) pode entrar.
  // O deliveryService verifica se o userId é parte do pedido.
  socket.on(DELIVERY_EVENTS.JOIN_ORDER_ROOM, async (data) => {
    try {
      const { orderId } = data || {};
      if (!orderId) return emitError(socket, 'join_order_room', 'orderId é obrigatório');

      // Verifica acesso (lança erro se userId não for parte do pedido)
      const reqData = await deliveryService.getDeliveryRequest(userId, orderId);

      // Restaurar privacy gate no reconnect: se a entrega já está em in_transit_to_dest,
      // setar deliveryPhase ANTES de qualquer LOCATION_UPDATE que possa chegar logo depois.
      if (reqData.status === 'in_transit_to_dest') {
        deliveryPhase = 'in_transit_to_dest';
      }

      const room = orderRoom(orderId);
      socket.join(room);
      socketManager.addUserToRoom(userId, room);

      socket.emit(DELIVERY_EVENTS.JOINED_ORDER_ROOM, { orderId, room, timestamp: Date.now() });

      logger.info(`[${SVC}] join_order_room`, { userId, orderId, room });
    } catch (err) {
      logger.warn(`[${SVC}] join_order_room error`, { userId, err: err.message });
      emitError(socket, 'join_order_room', err.message.includes('Acesso') ? 'access_denied' : err.message);
    }
  });

  // ── leave_order_room ──────────────────────────────────
  // Payload: { orderId }
  socket.on(DELIVERY_EVENTS.LEAVE_ORDER_ROOM, (data) => {
    const { orderId } = data || {};
    if (!orderId) return;

    const room = orderRoom(orderId);
    socket.leave(room);
    socketManager.removeUserFromRoom(userId, room);

    logger.info(`[${SVC}] leave_order_room`, { userId, orderId });
  });

  // ── freight_adjustment_approve ────────────────────────
  // Payload: { adjustmentId }
  // Cliente aprova frete maior após re-leilão (delta > 0).
  socket.on(DELIVERY_EVENTS.FREIGHT_ADJUSTMENT_APPROVE, async (data) => {
    try {
      const { adjustmentId } = data || {};
      if (!adjustmentId) {
        return emitError(socket, 'freight_adjustment_approve', 'adjustmentId é obrigatório');
      }

      const result = await deliveryService.approveFreightAdjustment(userId, adjustmentId);

      socket.emit(DELIVERY_EVENTS.FREIGHT_ADJUSTMENT_RESULT, {
        adjustmentId,
        status:        'approved',
        newFreightBrl: result.new_freight_brl,
        deltaBrl:      result.delta_brl,
        timestamp:     Date.now(),
      });

      logger.info(`[${SVC}] freight_adjustment_approve`, { userId, adjustmentId });
    } catch (err) {
      logger.warn(`[${SVC}] freight_adjustment_approve error`, { userId, err: err.message });
      emitError(socket, 'freight_adjustment_approve', err.message);
    }
  });

  // ── freight_adjustment_reject ─────────────────────────
  // Payload: { adjustmentId }
  // Cliente recusa frete maior; pedido vai para hold_manual.
  socket.on(DELIVERY_EVENTS.FREIGHT_ADJUSTMENT_REJECT, async (data) => {
    try {
      const { adjustmentId } = data || {};
      if (!adjustmentId) {
        return emitError(socket, 'freight_adjustment_reject', 'adjustmentId é obrigatório');
      }

      await deliveryService.rejectFreightAdjustment(userId, adjustmentId);

      socket.emit(DELIVERY_EVENTS.FREIGHT_ADJUSTMENT_RESULT, {
        adjustmentId,
        status:    'rejected',
        timestamp: Date.now(),
      });

      logger.info(`[${SVC}] freight_adjustment_reject`, { userId, adjustmentId });
    } catch (err) {
      logger.warn(`[${SVC}] freight_adjustment_reject error`, { userId, err: err.message });
      emitError(socket, 'freight_adjustment_reject', err.message);
    }
  });

  // ── disconnect: grace period ou cleanup ───────────────
  // Se o socket cair enquanto a sessão de delivery está ativa:
  //   - Com pedido ativo (matched/accepted/in_transit_to_pickup):
  //       inicia grace period de 2min; entregador pode reconectar.
  //   - Sem pedido ativo: vai offline normalmente.
  socket.on('disconnect', async () => {
    deliveryPhase = null;
    if (!isDeliverySessionActive) return;

    try {
      // handleDelivererDisconnect decide internamente: grace ou goOffline
      await deliveryService.handleDelivererDisconnect(userId);
      logger.info(`[${SVC}] disconnect handled`, { userId });
    } catch (err) {
      logger.warn(`[${SVC}] disconnect handler failed`, { userId, err: err.message });
      // Fallback: força offline para não deixar sessão fantasma
      try { await deliveryService.goOffline(userId); } catch (_) { /* silencia */ }
    }
  });
}

module.exports = { registerDeliveryHandlers };
