/**
 * @fileoverview Serviço de convites para jogos e concursos (JOGOS-BACK-005).
 *
 * Gerencia o ciclo de vida completo dos convites de jogos:
 *   - Convite por email (usuário externo ou cadastrado sem conta)
 *   - Convite por userId (usuário já cadastrado na plataforma)
 *   - Listagem de convites de um jogo
 *   - Busca de convite por token
 *   - Aceite/recusa de convite
 *   - Reenvio de convite
 *
 * @module services/gameInviteService
 * @requires crypto
 * @requires ../config/supabase
 * @requires ../logger
 * @requires ./emailService
 * @requires ./NotificationDispatcher
 * @requires ./gamificationService
 * @requires ../utils/errors
 */

'use strict';

const crypto               = require('crypto');
const { getSupabaseClient } = require('../config/supabase');
const { logger }           = require('../logger');
const emailService         = require('./emailService');
const NotificationDispatcher = require('./NotificationDispatcher');
const gamificationService  = require('./gamificationService');
const { HttpError }        = require('../utils/errors');
const { emitInviteReceived } = require('../config/socket/handlers/gameHandlers');

// ─────────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────────

const INVITE_EXPIRY_DAYS = 7;
const SERVICE = 'gameInviteService';

/** Status válidos de jogo que permitem novos convites */
const INVITABLE_GAME_STATUSES = ['open', 'draft'];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────────────

/** Retorna cliente Supabase ou lança erro se indisponível */
function sb() {
  const client = getSupabaseClient();
  if (!client) throw new HttpError('Supabase client indisponível', 503);
  return client;
}

/** Geração de token único de 64 chars hex (32 bytes aleatórios) */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Calcula a data de expiração (agora + N dias) */
function expiresAt(days = INVITE_EXPIRY_DAYS) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/** Formata uma data ISO para string legível em pt-BR */
function formatDate(iso) {
  if (!iso) return 'em breve';
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

/** Logger estruturado com contexto de serviço */
function log(fn, msg, extra = {}) {
  logger.info(msg, { service: SERVICE, function: fn, ...extra });
}
function logWarn(fn, msg, extra = {}) {
  logger.warn(msg, { service: SERVICE, function: fn, ...extra });
}
function logError(fn, err, extra = {}) {
  logger.error(`${fn}: ${err.message}`, { service: SERVICE, function: fn, error: err.message, ...extra });
}

// ─────────────────────────────────────────────────────────────────────────────
// Verificação de jogo (reutilizada em várias funções)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Busca e valida jogo: deve existir, pertencer a userId e ter status invitável.
 * @param {string} gameId
 * @param {string} ownerId - userId que deve ser owner do jogo
 * @returns {Promise<Object>} Registro do jogo
 */
async function _fetchAndValidateGame(gameId, ownerId) {
  const { data: game, error } = await sb()
    .from('games')
    .select('id, title, game_type, status, owner_id')
    .eq('id', gameId)
    .maybeSingle();

  if (error) throw new HttpError(`Erro ao buscar jogo: ${error.message}`, 500);
  if (!game)  throw new HttpError('Jogo não encontrado', 404);
  if (game.owner_id !== ownerId) {
    throw new HttpError('Apenas o criador do jogo pode enviar convites', 403);
  }
  if (!INVITABLE_GAME_STATUSES.includes(game.status)) {
    throw new HttpError(
      `Jogo com status "${game.status}" não aceita novos convites. Status permitidos: ${INVITABLE_GAME_STATUSES.join(', ')}`,
      409,
    );
  }
  return game;
}

// ─────────────────────────────────────────────────────────────────────────────
// Verificação de conexão (amizade) entre usuários
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifica se dois usuários são conexões ativas (amigos).
 *
 * Consulta a tabela `user_connections` de forma bidirecional:
 *   (user_id=A AND connected_user_id=B) OR (user_id=B AND connected_user_id=A)
 *   com status = 'active'
 *
 * Esta verificação NÃO é crítica de segurança (o convite pode ser enviado mesmo
 * que a query falhe), mas é uma boa prática para evitar spam entre desconhecidos.
 *
 * @param {string} userId        - Quem está convidando
 * @param {string} targetUserId  - Quem está sendo convidado
 * @returns {Promise<boolean>} true se forem conexões ativas, false caso contrário ou em caso de erro
 */
async function _areFriends(userId, targetUserId) {
  try {
    const { count, error } = await sb()
      .from('user_connections')
      .select('id', { count: 'exact', head: true })
      .or(
        `and(user_id.eq.${userId},connected_user_id.eq.${targetUserId}),` +
        `and(user_id.eq.${targetUserId},connected_user_id.eq.${userId})`,
      )
      .eq('status', 'active');

    if (error) {
      logWarn('_areFriends', 'Falha ao verificar conexão — prosseguindo sem bloqueio', {
        userId, targetUserId, error: error.message,
      });
      return false;
    }

    return (count || 0) > 0;
  } catch (err) {
    logWarn('_areFriends', 'Exceção ao verificar conexão — prosseguindo sem bloqueio', {
      userId, targetUserId, error: err.message,
    });
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Envio de email de convite (reutilizado em inviteByEmail e resendInvite)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Envia o email de convite usando o template game_invite.
 * @param {Object} params
 * @param {string} params.to
 * @param {Object} params.game
 * @param {string} params.inviteToken
 * @param {string} params.inviteId
 * @param {string} params.expiresAtIso
 * @param {string} [params.creatorName]
 * @param {string} [params.recipientName]
 */
async function _sendInviteEmail({ to, game, inviteToken, inviteId, expiresAtIso, creatorName, recipientName }) {
  const frontendUrl = process.env.FRONTEND_URL || 'https://eloscloud.com';
  const inviteLink  = `${frontendUrl}/jogos/convite/${inviteToken}`;

  await emailService.sendEmail({
    to,
    subject:      `Você foi convidado para ${game.title}`,
    templateType: 'game_invite',
    data: {
      gameTitle:     game.title,
      gameType:      game.game_type,
      creatorName:   creatorName || 'Um usuário ElosCloud',
      inviteLink,
      expiresAt:     formatDate(expiresAtIso),
      recipientName: recipientName || 'Convidado',
    },
    reference:     inviteId,
    referenceType: 'game_invite',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────────────

const gameInviteService = {

  // ───────────────────────────────────────────────────────────────────────────
  // inviteByEmail
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Convida uma pessoa por endereço de email.
   *
   * Fluxo:
   *  1. Valida que invitedBy é owner do jogo em status permitido.
   *  2. Insere registro em game_invites (invitee_email preenchido).
   *  3. Envia email via emailService com template game_invite.
   *
   * @param {string} gameId    - UUID do jogo
   * @param {string} invitedBy - TEXT userId do criador (Firebase UID)
   * @param {string} email     - Email do convidado
   * @returns {Promise<Object>} Registro do invite criado
   */
  async inviteByEmail(gameId, invitedBy, email) {
    log('inviteByEmail', 'Iniciando convite por email', { gameId, invitedBy, email });

    const game  = await _fetchAndValidateGame(gameId, invitedBy);
    const token = generateToken();
    const exp   = expiresAt();

    const { data: invite, error } = await sb()
      .from('game_invites')
      .insert({
        game_id:         gameId,
        invited_by:      invitedBy,
        invitee_email:   email,
        invitee_user_id: null,
        status:          'pending',
        token,
        expires_at:      exp,
      })
      .select()
      .single();

    if (error) {
      logError('inviteByEmail', error, { gameId, email });
      throw new HttpError(`Erro ao criar convite: ${error.message}`, 500);
    }

    // Busca nome do criador (fire-and-forget se falhar)
    let creatorName;
    try {
      const { data: creator } = await sb()
        .from('users')
        .select('display_name, name')
        .eq('id', invitedBy)
        .maybeSingle();
      creatorName = creator?.display_name || creator?.name || undefined;
    } catch (_) { /* não crítico */ }

    // Envio do email (fire-and-forget — não bloqueia retorno)
    _sendInviteEmail({
      to:          email,
      game,
      inviteToken: token,
      inviteId:    invite.id,
      expiresAtIso: exp,
      creatorName,
    }).catch((err) => {
      logWarn('inviteByEmail', 'Falha ao enviar email de convite', {
        inviteId: invite.id, error: err.message,
      });
    });

    log('inviteByEmail', 'Convite por email criado com sucesso', { inviteId: invite.id, gameId, email });
    return invite;
  },

  // ───────────────────────────────────────────────────────────────────────────
  // inviteByUserId
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Convida um usuário cadastrado pelo seu userId.
   *
   * Fluxo:
   *  1. Valida que invitedBy é owner do jogo em status permitido.
   *  2. Avisa (sem bloquear) se targetUserId não é conexão ativa de invitedBy.
   *  3. Verifica que targetUserId não está já em game_participants para este jogo.
   *  4. Insere registro em game_invites (invitee_user_id preenchido).
   *  5. Envia notificação in-app via NotificationDispatcher.
   *
   * @param {string} gameId        - UUID do jogo
   * @param {string} invitedBy     - TEXT userId do criador
   * @param {string} targetUserId  - TEXT userId do convidado
   * @returns {Promise<Object>} Registro do invite criado
   */
  async inviteByUserId(gameId, invitedBy, targetUserId) {
    log('inviteByUserId', 'Iniciando convite por userId', { gameId, invitedBy, targetUserId });

    const game = await _fetchAndValidateGame(gameId, invitedBy);

    // Verificação de conexão (não crítica de segurança — aviso em log se não forem amigos)
    const isFriend = await _areFriends(invitedBy, targetUserId);
    if (!isFriend) {
      logWarn('inviteByUserId', 'Convidado não é conexão ativa do criador — convite enviado mesmo assim', {
        gameId, invitedBy, targetUserId,
      });
    }

    // Verifica se já é participante
    const { count: participantCount, error: partErr } = await sb()
      .from('game_participants')
      .select('id', { count: 'exact', head: true })
      .eq('game_id', gameId)
      .eq('user_id', targetUserId);

    if (partErr) {
      logWarn('inviteByUserId', 'Falha ao verificar participantes — prosseguindo', {
        error: partErr.message,
      });
    } else if ((participantCount || 0) > 0) {
      throw new HttpError('Este usuário já é participante do jogo', 409);
    }

    const token = generateToken();
    const exp   = expiresAt();

    const { data: invite, error } = await sb()
      .from('game_invites')
      .insert({
        game_id:         gameId,
        invited_by:      invitedBy,
        invitee_email:   null,
        invitee_user_id: targetUserId,
        status:          'pending',
        token,
        expires_at:      exp,
      })
      .select()
      .single();

    if (error) {
      logError('inviteByUserId', error, { gameId, targetUserId });
      throw new HttpError(`Erro ao criar convite: ${error.message}`, 500);
    }

    // Notificação in-app via NotificationDispatcher (fire-and-forget)
    NotificationDispatcher.dispatch({
      userId:     targetUserId,
      type:       'game_invite_received',
      importance: 'high',
      data: {
        gameId,
        gameTitle:   game.title,
        gameType:    game.game_type,
        invitedBy,
        inviteId:    invite.id,
        inviteToken: token,
      },
      metadata: { triggeredBy: 'gameInviteService.inviteByUserId' },
      dedupKey: `game_invite_${invite.id}`,
    }).catch((err) => {
      logWarn('inviteByUserId', 'Falha ao despachar notificação in-app', {
        inviteId: invite.id, error: err.message,
      });
    });

    // Realtime: emite game:invite_received direto para o socket do convidado (se online)
    try {
      emitInviteReceived(targetUserId, gameId, game.title, game.game_type, invitedBy);
    } catch (err) {
      logWarn('inviteByUserId', 'Falha ao emitir game:invite_received via socket', {
        inviteId: invite.id, error: err.message,
      });
    }

    log('inviteByUserId', 'Convite por userId criado com sucesso', {
      inviteId: invite.id, gameId, targetUserId,
    });
    return invite;
  },

  // ───────────────────────────────────────────────────────────────────────────
  // listInvites
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Lista todos os convites de um jogo. Apenas o owner pode listar.
   *
   * @param {string} gameId  - UUID do jogo
   * @param {string} userId  - Quem está solicitando (deve ser owner)
   * @returns {Promise<Array>} Lista de invites ordenados por created_at DESC
   */
  async listInvites(gameId, userId) {
    log('listInvites', 'Listando convites do jogo', { gameId, userId });

    // Verifica ownership (sem verificar status — permite listar em qualquer status)
    const { data: game, error: gameErr } = await sb()
      .from('games')
      .select('id, owner_id')
      .eq('id', gameId)
      .maybeSingle();

    if (gameErr) throw new HttpError(`Erro ao buscar jogo: ${gameErr.message}`, 500);
    if (!game)   throw new HttpError('Jogo não encontrado', 404);
    if (game.owner_id !== userId) {
      throw new HttpError('Apenas o criador do jogo pode listar convites', 403);
    }

    const { data: invites, error } = await sb()
      .from('game_invites')
      .select('*')
      .eq('game_id', gameId)
      .order('created_at', { ascending: false });

    if (error) {
      logError('listInvites', error, { gameId });
      throw new HttpError(`Erro ao listar convites: ${error.message}`, 500);
    }

    return invites || [];
  },

  // ───────────────────────────────────────────────────────────────────────────
  // getInviteByToken
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Busca um invite pelo token e valida que não está expirado.
   * Retorna o invite enriquecido com dados do jogo (title, game_type, owner_id).
   *
   * @param {string} token - Token hexadecimal de 64 chars
   * @returns {Promise<Object>} Invite + dados do jogo
   */
  async getInviteByToken(token) {
    log('getInviteByToken', 'Buscando invite por token');

    const { data: invite, error } = await sb()
      .from('game_invites')
      .select(`
        *,
        games (
          title,
          game_type,
          owner_id
        )
      `)
      .eq('token', token)
      .maybeSingle();

    if (error) {
      logError('getInviteByToken', error);
      throw new HttpError(`Erro ao buscar convite: ${error.message}`, 500);
    }
    if (!invite) throw new HttpError('Convite não encontrado ou token inválido', 404);

    // Verifica expiração
    if (new Date(invite.expires_at) < new Date()) {
      throw new HttpError('Este convite expirou', 410);
    }

    return invite;
  },

  // ───────────────────────────────────────────────────────────────────────────
  // respondInvite
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Aceita ou recusa um convite.
   *
   * Fluxo:
   *  1. Busca invite pelo token (valida expiração).
   *  2. Verifica que status é 'pending'.
   *  3. Se invitee_user_id: verifica que userId === invitee_user_id.
   *  4. Se invitee_email: qualquer autenticado com o token pode responder
   *     (ex: novo usuário que acabou de se cadastrar).
   *  5. Atualiza status para 'accepted' ou 'declined'.
   *  6. Se aceito: adiciona como participante via gamesService.addParticipant
   *     e dispara evento de gamificação 'game_joined'.
   *
   * @param {string}  token  - Token do convite
   * @param {string}  userId - TEXT userId do respondente
   * @param {boolean} accept - true para aceitar, false para recusar
   * @returns {Promise<{ accepted: boolean, gameId: string }>}
   */
  async respondInvite(token, userId, accept) {
    log('respondInvite', 'Respondendo convite', { accept });

    const invite = await gameInviteService.getInviteByToken(token);

    if (invite.status !== 'pending') {
      throw new HttpError(
        `Este convite já foi ${invite.status === 'accepted' ? 'aceito' : 'recusado/cancelado'}`,
        409,
      );
    }

    // Valida identidade apenas quando o convite foi enviado para um userId específico
    if (invite.invitee_user_id && invite.invitee_user_id !== userId) {
      throw new HttpError('Este convite foi enviado para outro usuário', 403);
    }

    const newStatus = accept ? 'accepted' : 'declined';

    const { error: updateErr } = await sb()
      .from('game_invites')
      .update({ status: newStatus })
      .eq('id', invite.id);

    if (updateErr) {
      logError('respondInvite', updateErr, { inviteId: invite.id });
      throw new HttpError(`Erro ao atualizar convite: ${updateErr.message}`, 500);
    }

    const gameId = invite.game_id;

    if (accept) {
      // Adiciona usuário como participante do jogo
      try {
        const gamesService = require('./gamesService');
        await gamesService.addParticipant(gameId, userId, userId, 'confirmed');
      } catch (err) {
        // Se gamesService ainda não existir ou falhar, loga e não bloqueia
        logWarn('respondInvite', 'gamesService.addParticipant falhou ou serviço indisponível', {
          gameId, userId, error: err.message,
        });
      }

      // Gamificação: game_joined (fire-and-forget)
      gamificationService.triggerEvent('game_joined', userId, { gameId }).catch((err) => {
        logWarn('respondInvite', 'Falha ao disparar evento de gamificação game_joined', {
          userId, error: err.message,
        });
      });
    }

    log('respondInvite', `Convite ${newStatus}`, { inviteId: invite.id, gameId, userId });
    return { accepted: accept, gameId };
  },

  // ───────────────────────────────────────────────────────────────────────────
  // resendInvite
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Reenvia um convite pendente e estende o prazo por mais 7 dias.
   *
   * Fluxo:
   *  1. Busca o invite pelo id e verifica ownership via jogo.
   *  2. Verifica que status ainda é 'pending'.
   *  3. Atualiza expires_at para NOW() + 7 dias.
   *  4. Reenvia email (se invitee_email) ou notificação in-app (se invitee_user_id).
   *
   * @param {string} inviteId - UUID do invite
   * @param {string} userId   - TEXT userId do solicitante (deve ser owner do jogo)
   * @returns {Promise<Object>} Invite atualizado
   */
  async resendInvite(inviteId, userId) {
    log('resendInvite', 'Reenviando convite', { inviteId, userId });

    // Busca invite com dados do jogo
    const { data: invite, error: fetchErr } = await sb()
      .from('game_invites')
      .select(`
        *,
        games (
          id,
          title,
          game_type,
          owner_id
        )
      `)
      .eq('id', inviteId)
      .maybeSingle();

    if (fetchErr) {
      logError('resendInvite', fetchErr, { inviteId });
      throw new HttpError(`Erro ao buscar convite: ${fetchErr.message}`, 500);
    }
    if (!invite) throw new HttpError('Convite não encontrado', 404);

    const game = invite.games;

    // Verifica ownership
    if (game.owner_id !== userId) {
      throw new HttpError('Apenas o criador do jogo pode reenviar convites', 403);
    }

    // Verifica que ainda está pendente
    if (invite.status !== 'pending') {
      throw new HttpError(
        `Não é possível reenviar um convite com status "${invite.status}"`,
        409,
      );
    }

    // Estende prazo
    const newExpiry = expiresAt();
    const { data: updated, error: updateErr } = await sb()
      .from('game_invites')
      .update({ expires_at: newExpiry })
      .eq('id', inviteId)
      .select()
      .single();

    if (updateErr) {
      logError('resendInvite', updateErr, { inviteId });
      throw new HttpError(`Erro ao atualizar convite: ${updateErr.message}`, 500);
    }

    // Busca nome do criador (fire-and-forget se falhar)
    let creatorName;
    try {
      const { data: creator } = await sb()
        .from('users')
        .select('display_name, name')
        .eq('id', userId)
        .maybeSingle();
      creatorName = creator?.display_name || creator?.name || undefined;
    } catch (_) { /* não crítico */ }

    if (invite.invitee_email) {
      // Reenvio por email
      _sendInviteEmail({
        to:           invite.invitee_email,
        game,
        inviteToken:  invite.token,
        inviteId:     invite.id,
        expiresAtIso: newExpiry,
        creatorName,
      }).catch((err) => {
        logWarn('resendInvite', 'Falha ao reenviar email de convite', {
          inviteId, error: err.message,
        });
      });
    } else if (invite.invitee_user_id) {
      // Reenvio como notificação in-app
      NotificationDispatcher.dispatch({
        userId:     invite.invitee_user_id,
        type:       'game_invite_received',
        importance: 'high',
        data: {
          gameId:    game.id,
          gameTitle: game.title,
          gameType:  game.game_type,
          invitedBy: userId,
          inviteId:  invite.id,
          inviteToken: invite.token,
          resent:    true,
        },
        metadata: { triggeredBy: 'gameInviteService.resendInvite' },
        // dedupKey diferente do original para garantir despacho
        dedupKey: `game_invite_resend_${invite.id}_${Date.now()}`,
      }).catch((err) => {
        logWarn('resendInvite', 'Falha ao despachar notificação de reenvio', {
          inviteId, error: err.message,
        });
      });
    }

    log('resendInvite', 'Convite reenviado com sucesso', { inviteId, newExpiry });
    return updated;
  },

  // ───────────────────────────────────────────────────────────────────────────
  // getReceivedInvites
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Lista convites de jogos pendentes recebidos pelo usuário.
   * Retorna convites com dados do jogo e do remetente.
   *
   * @param {string} userId - TEXT userId do destinatário
   * @returns {Promise<Object[]>} Lista de convites pendentes
   */
  async getReceivedInvites(userId) {
    log('getReceivedInvites', 'Listando convites recebidos', { userId });

    const { data, error } = await sb()
      .from('game_invites')
      .select(`
        *,
        games (
          id,
          title,
          game_type,
          owner_id,
          status
        )
      `)
      .eq('invitee_user_id', userId)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      logError('getReceivedInvites', error, { userId });
      throw new HttpError(`Erro ao listar convites recebidos: ${error.message}`, 500);
    }

    // Enriquecer com dados do remetente
    const invites = data || [];
    if (invites.length === 0) return [];

    const senderIds = [...new Set(invites.map(i => i.invited_by))];
    const { data: senders } = await sb()
      .from('users')
      .select('id, full_name, username, avatar_url')
      .in('id', senderIds);

    const senderMap = (senders || []).reduce((m, s) => { m[s.id] = s; return m; }, {});

    return invites.map(invite => ({
      ...invite,
      sender: senderMap[invite.invited_by] || null,
    }));
  },
};

module.exports = gameInviteService;
