'use strict';

/**
 * gameHandlers.js — ElosCloud Games Module (JOGOS-BACK-007)
 *
 * Socket.IO handlers para o módulo de jogos.
 *
 * Rooms utilizadas:
 *   game:{gameId}   — room do jogo; participantes e owner recebem eventos em tempo real
 *   user:{userId}   — room pessoal; usada para convites recebidos (user já entra na conexão,
 *                     via socketManager que mapeia userId→sockets — na prática usamos emitToUser)
 *
 * Responsabilidades:
 *   - Gerenciar entrada e saída da room de um jogo (game:join / game:leave)
 *   - Verificar que o usuário é owner ou participante confirmado antes do join
 *   - Expor funções de emit reutilizáveis para os services do domínio de jogos
 */

const { logger }         = require('../../../logger');
const socketManager      = require('../socketManager');
const { GAME_EVENTS }    = require('../socketEvents');
const { getSupabaseClient } = require('../../../config/supabase');

const SVC = 'gameHandlers';

// ── Helpers ──────────────────────────────────────────────

/**
 * Retorna o nome canônico da room de um jogo.
 * @param {string} gameId
 * @returns {string}
 */
function gameRoom(gameId) {
  return `game:${gameId}`;
}

/**
 * Emite um erro de domínio ao socket do cliente.
 * @param {import('socket.io').Socket} socket
 * @param {string} context  — contexto da operação (ex: 'join')
 * @param {string} message  — mensagem de erro legível
 */
function emitError(socket, context, message) {
  socket.emit(GAME_EVENTS.ERROR, { context, message });
}

/**
 * Verifica se userId é owner ou participante confirmado do jogo.
 * Lança erro se não tiver acesso.
 *
 * @param {string} gameId
 * @param {string} userId
 * @returns {Promise<void>}
 */
async function _checkGameAccess(gameId, userId) {
  const sb = getSupabaseClient();

  const { data: game, error: gameErr } = await sb
    .from('games')
    .select('id, owner_id')
    .eq('id', gameId)
    .maybeSingle();

  if (gameErr) throw new Error(`Erro ao verificar jogo: ${gameErr.message}`);
  if (!game)   throw new Error('Jogo não encontrado');
  if (game.owner_id === userId) return; // owner tem acesso livre

  const { data: part, error: partErr } = await sb
    .from('game_participants')
    .select('id')
    .eq('game_id', gameId)
    .eq('user_id', userId)
    .eq('status', 'confirmed')
    .maybeSingle();

  if (partErr) throw new Error(`Erro ao verificar participação: ${partErr.message}`);
  if (!part)   throw new Error('Acesso negado: você não é owner nem participante confirmado deste jogo');
}

// ── Registro principal ────────────────────────────────────

/**
 * Registra todos os handlers de jogos para um socket conectado.
 *
 * @param {import('socket.io').Socket} socket
 * @param {string} userId
 */
function registerGameHandlers(socket, userId) {
  if (!socket || !userId) return;

  // ── game:join ──────────────────────────────────────────
  // Payload: { gameId }
  // Verifica que userId é owner ou participante confirmado antes de fazer join.
  socket.on(GAME_EVENTS.JOIN, async (data) => {
    try {
      const { gameId } = data || {};
      if (!gameId) {
        return emitError(socket, 'join', 'gameId é obrigatório');
      }

      // Segurança: valida acesso antes de entrar na room
      await _checkGameAccess(gameId, userId);

      const room = gameRoom(gameId);
      socket.join(room);
      socketManager.addUserToRoom(userId, room);

      socket.emit(GAME_EVENTS.JOIN_SUCCESS, { gameId, room, timestamp: Date.now() });

      logger.info(`[${SVC}] game:join`, { userId, gameId, room });
    } catch (err) {
      logger.warn(`[${SVC}] game:join error`, { userId, err: err.message });
      socket.emit(GAME_EVENTS.JOIN_ERROR, {
        message: err.message.includes('Acesso') ? 'access_denied' : err.message,
      });
    }
  });

  // ── game:leave ─────────────────────────────────────────
  // Payload: { gameId }
  socket.on(GAME_EVENTS.LEAVE, (data) => {
    const { gameId } = data || {};
    if (!gameId) return;

    const room = gameRoom(gameId);
    socket.leave(room);
    socketManager.removeUserFromRoom(userId, room);

    logger.info(`[${SVC}] game:leave`, { userId, gameId });
  });
}

// ── Funções de emit reutilizáveis (chamadas pelos services) ──────────────────

/**
 * Emite game:item_claimed para a room do jogo.
 * Chamado por selectionListService.claimItem após claim bem-sucedido.
 *
 * @param {string} gameId
 * @param {{ itemId: string, label: string, claimedBy: { userId: string, displayName: string } }} itemData
 */
function emitItemClaimed(gameId, itemData) {
  if (!gameId || !itemData) return;

  const room = gameRoom(gameId);
  const sent = socketManager.emitToRoom(room, GAME_EVENTS.ITEM_CLAIMED, {
    itemId:    itemData.itemId,
    label:     itemData.label,
    claimedBy: {
      userId:      itemData.claimedBy?.userId,
      displayName: itemData.claimedBy?.displayName,
    },
  });

  logger.info(`[${SVC}] emitItemClaimed`, { gameId, room, itemId: itemData.itemId, sent });
}

/**
 * Emite game:item_released para a room do jogo.
 * Chamado por selectionListService.unclaimItem após remoção de claim.
 *
 * @param {string} gameId
 * @param {string} itemId
 * @param {string} label
 */
function emitItemReleased(gameId, itemId, label) {
  if (!gameId || !itemId) return;

  const room = gameRoom(gameId);
  const sent = socketManager.emitToRoom(room, GAME_EVENTS.ITEM_RELEASED, { itemId, label });

  logger.info(`[${SVC}] emitItemReleased`, { gameId, room, itemId, sent });
}

/**
 * Emite game:draw_done para a room do jogo.
 * Chamado por secretFriendService.drawPairs após sorteio bem-sucedido.
 *
 * @param {string} gameId
 * @param {string} gameType    — ex: 'SECRET_FRIEND'
 * @param {string} resultHash  — SHA-256 do resultado para auditabilidade
 */
function emitDrawDone(gameId, gameType, resultHash) {
  if (!gameId) return;

  const room    = gameRoom(gameId);
  const drawnAt = new Date().toISOString();
  const sent    = socketManager.emitToRoom(room, GAME_EVENTS.DRAW_DONE, {
    gameId,
    gameType,
    resultHash,
    drawnAt,
  });

  logger.info(`[${SVC}] emitDrawDone`, { gameId, room, gameType, sent });
}

/**
 * Emite game:participant_joined para a room do jogo.
 * Chamado por gamesService.addParticipant (ou gameInviteService.respondInvite) ao confirmar participante.
 *
 * @param {string} gameId
 * @param {string} userId
 * @param {string} displayName
 */
function emitParticipantJoined(gameId, userId, displayName) {
  if (!gameId || !userId) return;

  const room     = gameRoom(gameId);
  const joinedAt = new Date().toISOString();
  const sent     = socketManager.emitToRoom(room, GAME_EVENTS.PARTICIPANT_JOINED, {
    userId,
    displayName: displayName || null,
    joinedAt,
  });

  logger.info(`[${SVC}] emitParticipantJoined`, { gameId, room, userId, sent });
}

/**
 * Emite game:invite_received direto para o usuário alvo (não para a room do jogo).
 * Chamado por gameInviteService.inviteByUserId.
 *
 * @param {string} targetUserId  — usuário que recebe o convite
 * @param {string} gameId
 * @param {string} gameTitle
 * @param {string} gameType
 * @param {string} invitedBy     — userId de quem convidou
 */
function emitInviteReceived(targetUserId, gameId, gameTitle, gameType, invitedBy) {
  if (!targetUserId || !gameId) return;

  const sent = socketManager.emitToUser(targetUserId, GAME_EVENTS.INVITE_RECEIVED, {
    gameId,
    gameTitle,
    gameType,
    invitedBy,
  });

  logger.info(`[${SVC}] emitInviteReceived`, { targetUserId, gameId, gameType, sent });
}

// ── Exports ───────────────────────────────────────────────

module.exports = {
  registerGameHandlers,
  // Emitters para uso pelos services do domínio de jogos
  emitItemClaimed,
  emitItemReleased,
  emitDrawDone,
  emitParticipantJoined,
  emitInviteReceived,
};
