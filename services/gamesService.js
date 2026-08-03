'use strict';

// services/gamesService.js
// JOGOS-BACK-001 — Serviço central do módulo de Jogos
// Tabelas: games, game_participants, caixinha_members

const { logger }             = require('../logger');
const { getSupabaseClient }  = require('../config/supabase');
const { emitParticipantJoined } = require('../config/socket/handlers/gameHandlers');

const SERVICE = 'gamesService';

function log(method, msg, extra = {}) {
  logger.info(`[${SERVICE}] ${method}: ${msg}`, { service: SERVICE, method, ...extra });
}

function logErr(method, err, extra = {}) {
  logger.error(`[${SERVICE}] ${method}: ${err.message}`, {
    service: SERVICE, method, error: err.message, stack: err.stack, ...extra,
  });
}

// ── Gates de prontidão ─────────────────────────────────────────────────────

/**
 * Valida os gates de prontidão do usuário via RPC get_user_readiness.
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {string} userId
 * @param {string[]} required  — ex: ['PROFILE_COMPLETE', 'ADDRESS_COMPLETE', 'KYC_VERIFIED']
 */
async function _checkReadinessGates(sb, userId, required) {
  const { data: gates, error } = await sb.rpc('get_user_readiness', { p_user_id: userId });
  if (error) throw new Error(`Erro ao verificar prontidão do perfil: ${error.message}`);

  // get_user_readiness retorna JSONB: { PROFILE_COMPLETE: bool, ADDRESS_COMPLETE: bool, ... }
  const gateMap = gates || {};
  const missing = required.filter(g => !gateMap[g]);
  if (missing.length > 0) {
    throw new Error(`Perfil incompleto. Gates necessários: ${missing.join(', ')}`);
  }
}

// ── Helpers internos ──────────────────────────────────────────────────────

/**
 * Verifica se userId é owner do jogo. Retorna o jogo ou lança erro.
 */
async function _requireOwner(sb, gameId, userId) {
  const { data, error } = await sb
    .from('games')
    .select('*')
    .eq('id', gameId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Jogo não encontrado');
  if (data.owner_id !== userId) throw new Error('Você não tem permissão para esta ação');
  return data;
}

/**
 * Verifica se userId é owner ou participante confirmado. Retorna o jogo ou lança erro.
 */
async function _requireAccess(sb, gameId, userId) {
  const { data: game, error: gameErr } = await sb
    .from('games')
    .select('*')
    .eq('id', gameId)
    .maybeSingle();

  if (gameErr) throw gameErr;
  if (!game) throw new Error('Jogo não encontrado');
  if (game.owner_id === userId) return game;

  const { data: part, error: partErr } = await sb
    .from('game_participants')
    .select('id')
    .eq('game_id', gameId)
    .eq('user_id', userId)
    .eq('status', 'confirmed')
    .maybeSingle();

  if (partErr) throw partErr;
  if (!part) throw new Error('Acesso negado: você não é owner nem participante confirmado');
  return game;
}

// ── Funções públicas ──────────────────────────────────────────────────────

/**
 * Cria um novo jogo.
 * Gates: PROFILE_COMPLETE, ADDRESS_COMPLETE, KYC_VERIFIED
 * Para RAFFLE: também PAYMENT_READY
 */
const createGame = async (userId, data) => {
  try {
    log('createGame', 'Criando jogo', { userId, game_type: data.game_type });

    const sb = getSupabaseClient();

    const requiredGates = ['PROFILE_COMPLETE', 'ADDRESS_COMPLETE', 'KYC_VERIFIED'];
    if (data.game_type === 'RAFFLE') {
      requiredGates.push('PAYMENT_READY');
    }
    await _checkReadinessGates(sb, userId, requiredGates);

    // Se caixinha_id fornecido, valida que userId é admin da caixinha
    if (data.caixinha_id) {
      const { data: membership, error: memberErr } = await sb
        .from('caixinha_members')
        .select('role')
        .eq('caixinha_id', data.caixinha_id)
        .eq('user_id', userId)
        .eq('role', 'admin')
        .eq('status', 'ativo')
        .eq('active', true)
        .maybeSingle();

      if (memberErr) throw memberErr;
      if (!membership) {
        throw new Error('Você não tem permissão de admin nesta caixinha');
      }
    }

    const insertPayload = {
      owner_id:             userId,
      game_type:            data.game_type,
      title:                data.title,
      description:          data.description || null,
      config:               data.config || {},
      caixinha_id:          data.caixinha_id || null,
      ticket_price:         data.ticket_price || null,
      ticket_count:         data.ticket_count || null,
      prize_description:    data.prize_description || null,
      suggested_gift_value: data.suggested_gift_value || null,
      gift_value_mode:      data.gift_value_mode || 'suggested',
      registration_deadline: data.registration_deadline || null,
      draw_at:              data.draw_at || null,
      entry_cost:           data.entry_cost || null,
    };

    const { data: game, error } = await sb
      .from('games')
      .insert(insertPayload)
      .select()
      .single();

    if (error) throw error;

    // Adiciona o criador como participante se solicitado
    if (data.owner_participates) {
      try {
        await addParticipant(game.id, userId, userId, 'confirmed');
        log('createGame', 'Criador adicionado como participante', { gameId: game.id, userId });
      } catch (partErr) {
        logger.warn(`[${SERVICE}] Falha ao adicionar owner como participante`, {
          gameId: game.id, error: partErr.message,
        });
      }
    }

    // Gamification: fire-and-forget
    setImmediate(async () => {
      try {
        const gamificationService = require('./gamificationService');
        await gamificationService.triggerEvent('game_created', userId);
      } catch (err) {
        logger.warn(`[${SERVICE}] Falha no trigger game_created`, { error: err.message });
      }
    });

    log('createGame', 'Jogo criado com sucesso', { gameId: game.id, userId });
    return game;
  } catch (err) {
    logErr('createGame', err, { userId });
    throw err;
  }
};

/**
 * Busca jogo por ID. Requer que userId seja owner ou participante confirmado.
 * Retorna jogo + participantes + itens específicos por tipo.
 */
const getGame = async (gameId, userId) => {
  try {
    log('getGame', 'Buscando jogo', { gameId, userId });

    const sb = getSupabaseClient();
    const game = await _requireAccess(sb, gameId, userId);

    // Participantes
    const { data: participants, error: partErr } = await sb
      .from('game_participants')
      .select('*')
      .eq('game_id', gameId)
      .order('joined_at', { ascending: true });

    if (partErr) throw partErr;

    // Enriquecer participantes com dados da tabela users
    let enrichedParticipants = participants || [];
    if (enrichedParticipants.length > 0) {
      const userIds = [...new Set(enrichedParticipants.map(p => p.user_id))];
      const { data: users } = await sb
        .from('users')
        .select('id, full_name, username, avatar_url')
        .in('id', userIds);

      const userMap = {};
      for (const u of (users || [])) userMap[u.id] = u;

      enrichedParticipants = enrichedParticipants.map(p => ({
        ...p,
        display_name: userMap[p.user_id]?.full_name || userMap[p.user_id]?.username || null,
        photo_url:    userMap[p.user_id]?.avatar_url || null,
        username:     userMap[p.user_id]?.username   || null,
      }));
    }

    let typeSpecificData = {};

    if (game.game_type === 'SELECTION_LIST') {
      const { data: items, error: itemsErr } = await sb
        .from('selection_list_items')
        .select('*')
        .eq('game_id', gameId)
        .order('display_order', { ascending: true });
      if (itemsErr) throw itemsErr;
      typeSpecificData.items = items || [];
    }

    if (game.game_type === 'SECRET_FRIEND') {
      const { data: results, error: resultsErr } = await sb
        .from('game_results')
        .select('*')
        .eq('game_id', gameId)
        .order('drawn_at', { ascending: false })
        .limit(1);
      if (resultsErr) throw resultsErr;
      typeSpecificData.result = results?.[0] || null;
    }

    if (game.game_type === 'RAFFLE') {
      const { data: tickets, error: ticketsErr } = await sb
        .from('raffle_tickets')
        .select('id, ticket_number, owner_id, payment_status, reserved_at, purchased_at')
        .eq('game_id', gameId)
        .order('ticket_number', { ascending: true });
      if (ticketsErr) throw ticketsErr;
      typeSpecificData.tickets = tickets || [];
    }

    return { ...game, participants: enrichedParticipants, ...typeSpecificData };
  } catch (err) {
    logErr('getGame', err, { gameId, userId });
    throw err;
  }
};

/**
 * Lista jogos criados por userId + jogos em que é participante confirmado.
 */
const listMyGames = async (userId) => {
  try {
    log('listMyGames', 'Listando jogos do usuário', { userId });

    const sb = getSupabaseClient();

    // Jogos criados pelo usuário
    const { data: owned, error: ownedErr } = await sb
      .from('games')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false });

    if (ownedErr) throw ownedErr;

    // Jogos em que é participante confirmado (excluindo os que ele criou)
    const { data: participations, error: partErr } = await sb
      .from('game_participants')
      .select('game_id')
      .eq('user_id', userId)
      .eq('status', 'confirmed');

    if (partErr) throw partErr;

    const ownedIds = new Set((owned || []).map(g => g.id));
    const participantGameIds = (participations || [])
      .map(p => p.game_id)
      .filter(id => !ownedIds.has(id));

    let participantGames = [];
    if (participantGameIds.length > 0) {
      const { data: pgames, error: pgErr } = await sb
        .from('games')
        .select('*')
        .in('id', participantGameIds)
        .order('created_at', { ascending: false });
      if (pgErr) throw pgErr;
      participantGames = pgames || [];
    }

    // Mesclar: owned primeiro, depois participações
    const allGames = [
      ...(owned || []).map(g => ({ ...g, _role: 'owner' })),
      ...participantGames.map(g => ({ ...g, _role: 'participant' })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Agregar participant_count para cada jogo
    if (allGames.length > 0) {
      const gameIds = allGames.map(g => g.id);
      const { data: counts, error: countErr } = await sb
        .from('game_participants')
        .select('game_id')
        .in('game_id', gameIds)
        .eq('status', 'confirmed');

      if (!countErr && counts) {
        const countMap = {};
        for (const row of counts) {
          countMap[row.game_id] = (countMap[row.game_id] || 0) + 1;
        }
        for (const g of allGames) {
          g.participant_count = countMap[g.id] || 0;
        }
      }
    }

    return allGames;
  } catch (err) {
    logErr('listMyGames', err, { userId });
    throw err;
  }
};

/**
 * Atualiza campos editáveis do jogo. Requer owner e status draft/open.
 */
const updateGame = async (gameId, userId, data) => {
  try {
    log('updateGame', 'Atualizando jogo', { gameId, userId });

    const sb = getSupabaseClient();
    const game = await _requireOwner(sb, gameId, userId);

    if (!['draft', 'open'].includes(game.status)) {
      throw new Error(`Não é possível editar jogo com status '${game.status}'`);
    }

    // Não permite mudar game_type
    const allowed = [
      'title', 'description', 'config',
      'ticket_price', 'ticket_count', 'prize_description',
      'suggested_gift_value', 'gift_value_mode',
      'registration_deadline', 'draw_at',
    ];

    const updatePayload = {};
    for (const key of allowed) {
      if (key in data) updatePayload[key] = data[key];
    }

    if (Object.keys(updatePayload).length === 0) {
      throw new Error('Nenhum campo editável fornecido');
    }

    const { data: updated, error } = await sb
      .from('games')
      .update(updatePayload)
      .eq('id', gameId)
      .select()
      .single();

    if (error) throw error;

    log('updateGame', 'Jogo atualizado', { gameId });
    return updated;
  } catch (err) {
    logErr('updateGame', err, { gameId, userId });
    throw err;
  }
};

/**
 * Cancela o jogo. Requer owner e status não fechado/cancelado.
 */
const cancelGame = async (gameId, userId) => {
  try {
    log('cancelGame', 'Cancelando jogo', { gameId, userId });

    const sb = getSupabaseClient();
    const game = await _requireOwner(sb, gameId, userId);

    if (['closed', 'cancelled'].includes(game.status)) {
      throw new Error(`Não é possível cancelar jogo com status '${game.status}'`);
    }

    const { data: updated, error } = await sb
      .from('games')
      .update({ status: 'cancelled' })
      .eq('id', gameId)
      .select()
      .single();

    if (error) throw error;

    log('cancelGame', 'Jogo cancelado', { gameId });
    return updated;
  } catch (err) {
    logErr('cancelGame', err, { gameId, userId });
    throw err;
  }
};

/**
 * Abre o jogo (draft → open). Requer owner e status draft.
 */
const openGame = async (gameId, userId) => {
  try {
    log('openGame', 'Abrindo jogo', { gameId, userId });

    const sb = getSupabaseClient();
    const game = await _requireOwner(sb, gameId, userId);

    if (game.status !== 'draft') {
      throw new Error(`Não é possível abrir jogo com status '${game.status}'. Jogo deve estar em 'draft'`);
    }

    const { data: updated, error } = await sb
      .from('games')
      .update({ status: 'open' })
      .eq('id', gameId)
      .select()
      .single();

    if (error) throw error;

    // Inicialização automática de bilhetes para rifas
    if (game.game_type === 'RAFFLE') {
      try {
        const raffleGamesService = require('./raffleGamesService');
        await raffleGamesService.initializeTickets(gameId, userId);
        log('openGame', 'Bilhetes da rifa inicializados automaticamente', { gameId });
      } catch (raffleErr) {
        // idempotente: se já inicializado, ignora o erro
        if (!raffleErr.message?.includes('already')) {
          logger.warn(`[${SERVICE}] openGame: falha ao inicializar bilhetes`, {
            gameId, error: raffleErr.message,
          });
        }
      }
    }

    log('openGame', 'Jogo aberto', { gameId });
    return updated;
  } catch (err) {
    logErr('openGame', err, { gameId, userId });
    throw err;
  }
};

/**
 * Fecha o jogo (open → closed). Requer owner e status open.
 * Dispara gamification game_host_completed.
 */
const closeGame = async (gameId, userId) => {
  try {
    log('closeGame', 'Fechando jogo', { gameId, userId });

    const sb = getSupabaseClient();
    const game = await _requireOwner(sb, gameId, userId);

    if (game.status !== 'open') {
      throw new Error(`Não é possível fechar jogo com status '${game.status}'. Jogo deve estar em 'open'`);
    }

    const { data: updated, error } = await sb
      .from('games')
      .update({ status: 'closed' })
      .eq('id', gameId)
      .select()
      .single();

    if (error) throw error;

    // Gamification: fire-and-forget
    setImmediate(async () => {
      try {
        const gamificationService = require('./gamificationService');
        await gamificationService.triggerEvent('game_host_completed', userId);
      } catch (err) {
        logger.warn(`[${SERVICE}] Falha no trigger game_host_completed`, { error: err.message });
      }
    });

    log('closeGame', 'Jogo fechado', { gameId });
    return updated;
  } catch (err) {
    logErr('closeGame', err, { gameId, userId });
    throw err;
  }
};

/**
 * Associa uma caixinha ao jogo.
 * Requer: userId é owner do jogo E admin/owner da caixinha.
 */
const associateCaixinha = async (gameId, userId, caixinhaId) => {
  try {
    log('associateCaixinha', 'Associando caixinha ao jogo', { gameId, userId, caixinhaId });

    const sb = getSupabaseClient();

    // Verifica que userId é owner do jogo
    await _requireOwner(sb, gameId, userId);

    // Verifica que userId é admin da caixinha
    const { data: membership, error: memberErr } = await sb
      .from('caixinha_members')
      .select('role')
      .eq('caixinha_id', caixinhaId)
      .eq('user_id', userId)
      .eq('role', 'admin')
      .eq('status', 'ativo')
      .eq('active', true)
      .maybeSingle();

    if (memberErr) throw memberErr;
    if (!membership) {
      throw new Error('Você não tem permissão de admin nesta caixinha');
    }

    const { data: updated, error } = await sb
      .from('games')
      .update({ caixinha_id: caixinhaId })
      .eq('id', gameId)
      .select()
      .single();

    if (error) throw error;

    log('associateCaixinha', 'Caixinha associada', { gameId, caixinhaId });
    return updated;
  } catch (err) {
    logErr('associateCaixinha', err, { gameId, userId, caixinhaId });
    throw err;
  }
};

/**
 * Convida participantes para o jogo.
 * - { targetUserId } → add direto como confirmed (amigo registrado)
 * - { email } → envia e-mail com link do jogo (participante pendente)
 * Requer que inviterId seja owner do jogo.
 */
const inviteParticipant = async (gameId, inviterId, { targetUserId, email }) => {
  try {
    log('inviteParticipant', 'Convidando participante', { gameId, inviterId, targetUserId, email });

    const sb = getSupabaseClient();

    // Valida: apenas o owner pode convidar
    await _requireOwner(sb, gameId, inviterId);

    if (targetUserId) {
      // Amigo registrado → adiciona como PENDING (aguarda aceite em /convites)
      const { data: existing } = await sb
        .from('game_participants')
        .select('id, status')
        .eq('game_id', gameId)
        .eq('user_id', targetUserId)
        .maybeSingle();

      if (existing) {
        // Enriquecer com dados do usuário para o frontend
        let participantInfo = { user_id: targetUserId };
        try {
          const { data: user } = await sb
            .from('users')
            .select('full_name, username, avatar_url')
            .eq('id', targetUserId)
            .maybeSingle();
          if (user) {
            participantInfo.display_name = user.full_name || user.username || null;
            participantInfo.photo_url    = user.avatar_url || null;
            participantInfo.username     = user.username   || null;
          }
        } catch (userErr) {
          logger.warn(`[${SERVICE}] inviteParticipant: falha ao buscar dados do user`, { error: userErr.message });
        }
        return { alreadyParticipant: true, status: existing.status, participant: participantInfo };
      }

      const result = await addParticipant(gameId, inviterId, targetUserId, 'pending');

      // Notificação ao convidado (fire-and-forget)
      setImmediate(async () => {
        try {
          const { data: game } = await sb
            .from('games')
            .select('title, game_type')
            .eq('id', gameId)
            .maybeSingle();
          const NotificationDispatcher = require('./NotificationDispatcher');
          await NotificationDispatcher.dispatch('game_invite', targetUserId, {
            gameId,
            gameTitle:  game?.title || 'Jogo',
            gameType:   game?.game_type || 'game',
            invitedBy:  inviterId,
          });
        } catch (notifErr) {
          logger.warn(`[${SERVICE}] inviteParticipant: falha ao enviar notificação`, { error: notifErr.message });
        }
      });

      // Gamification: trigger convite enviado (fire-and-forget)
      setImmediate(async () => {
        try {
          const gamificationService = require('./gamificationService');
          await gamificationService.triggerEvent('invite_sent', inviterId);
        } catch {}
      });

      return { participant: result, invited: true };
    }

    if (email) {
      // Convite por e-mail: insere como pending com token
      const token = require('crypto').randomBytes(20).toString('hex');

      const { data, error } = await sb
        .from('game_participants')
        .upsert(
          {
            game_id:      gameId,
            user_id:      null,   // não registrado ainda
            invite_email: email,
            invite_token: token,
            invited_by:   inviterId,
            status:       'pending',
          },
          { onConflict: 'game_id,invite_email', ignoreDuplicates: false }
        )
        .select()
        .single();

      if (error) throw error;

      // Envia e-mail (fire-and-forget)
      setImmediate(async () => {
        try {
          const emailService = require('./emailService');
          const joinUrl = `${process.env.FRONTEND_URL || 'https://eloscloud.com'}/jogos/${gameId}/join?token=${token}`;
          await emailService.sendEmail({
            to: email,
            subject: 'Você foi convidado para um jogo no ElosCloud!',
            templateType: 'game_invite',
            data: { gameId, joinUrl, token },
          });
        } catch (emailErr) {
          logger.warn(`[${SERVICE}] Falha ao enviar e-mail de convite`, { email, error: emailErr.message });
        }
      });

      log('inviteParticipant', 'Convite por e-mail enviado', { gameId, email });
      return { emailInvited: true, email };
    }

    throw new Error('Forneça targetUserId ou email para convidar');
  } catch (err) {
    logErr('inviteParticipant', err, { gameId, inviterId, targetUserId, email });
    throw err;
  }
};

/**
 * Adiciona um participante ao jogo via service_role (bypassa RLS).
 * Usado internamente pelo invite service ao aceitar convite.
 */
const addParticipant = async (gameId, userId, targetUserId, status = 'confirmed') => {
  try {
    log('addParticipant', 'Adicionando participante', { gameId, targetUserId, status });

    const sb = getSupabaseClient();

    const { data, error } = await sb
      .from('game_participants')
      .upsert(
        { game_id: gameId, user_id: targetUserId, status },
        { onConflict: 'game_id,user_id', ignoreDuplicates: false }
      )
      .select()
      .single();

    if (error) throw error;

    // Enriquecer resposta com dados do usuário
    let enrichedData = { ...data };
    try {
      const { data: user } = await sb
        .from('users')
        .select('full_name, username, avatar_url')
        .eq('id', targetUserId)
        .maybeSingle();

      if (user) {
        enrichedData.display_name = user.full_name || user.username || null;
        enrichedData.photo_url    = user.avatar_url || null;
        enrichedData.username     = user.username   || null;
      }
    } catch (userErr) {
      logger.warn(`[${SERVICE}] addParticipant: falha ao buscar dados do user`, { error: userErr.message });
    }

    // Realtime: notifica todos na room do jogo sobre novo participante confirmado
    if (status === 'confirmed') {
      setImmediate(() => {
        try {
          emitParticipantJoined(gameId, targetUserId, enrichedData.display_name || null);
        } catch (err) {
          logger.warn(`[${SERVICE}] Falha ao emitir game:participant_joined`, { error: err.message });
        }
      });
    }

    log('addParticipant', 'Participante adicionado', { gameId, targetUserId });
    return enrichedData;
  } catch (err) {
    logErr('addParticipant', err, { gameId, targetUserId });
    throw err;
  }
};

/**
 * Aceita ou recusa convite de participação em jogo.
 * O próprio convidado responde (user_id = userId, status = 'pending').
 */
const respondToParticipation = async (gameId, userId, accept) => {
  try {
    log('respondToParticipation', `Respondendo convite de jogo`, { gameId, userId, accept });
    const sb = getSupabaseClient();

    const { data: participant, error: fetchErr } = await sb
      .from('game_participants')
      .select('id, status, game_id')
      .eq('game_id', gameId)
      .eq('user_id', userId)
      .maybeSingle();

    if (fetchErr || !participant) throw new Error('Convite não encontrado');
    if (participant.status !== 'pending') throw new Error('Convite já foi respondido');

    const newStatus = accept ? 'confirmed' : 'declined';

    const { data, error } = await sb
      .from('game_participants')
      .update({ status: newStatus, responded_at: new Date().toISOString() })
      .eq('id', participant.id)
      .select()
      .single();

    if (error) throw error;

    if (accept) {
      // Emitir evento de participante confirmado
      setImmediate(() => {
        try { emitParticipantJoined(gameId, userId, null); } catch {}
      });
      // Gamificação
      setImmediate(async () => {
        try {
          const gamificationService = require('./gamificationService');
          await gamificationService.triggerEvent('game_joined', userId, { gameId });
        } catch {}
      });
    }

    log('respondToParticipation', `Convite ${newStatus}`, { gameId, userId });
    return { accepted: accept, gameId };
  } catch (err) {
    logErr('respondToParticipation', err, { gameId, userId });
    throw err;
  }
};

/**
 * Lista convites pendentes de jogos recebidos pelo usuário.
 */
const getMyPendingGameInvites = async (userId) => {
  try {
    log('getMyPendingGameInvites', 'Listando convites pendentes', { userId });
    const sb = getSupabaseClient();

    const { data, error } = await sb
      .from('game_participants')
      .select(`
        id, game_id, user_id, status, joined_at,
        games (
          id, title, game_type, status, owner_id
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('joined_at', { ascending: false });

    if (error) throw error;

    const invites = data || [];
    if (invites.length === 0) return [];

    // Enriquecer com dados do remetente (owner do jogo = quem convidou)
    const senderIds = [...new Set(invites.map(i => i.games?.owner_id).filter(Boolean))];
    if (senderIds.length > 0) {
      const { data: senders } = await sb
        .from('users')
        .select('id, full_name, username, avatar_url')
        .in('id', senderIds);

      const senderMap = (senders || []).reduce((m, s) => { m[s.id] = s; return m; }, {});
      return invites.map(invite => ({
        ...invite,
        sender: senderMap[invite.games?.owner_id] || null,
      }));
    }

    return invites;
  } catch (err) {
    logErr('getMyPendingGameInvites', err, { userId });
    throw err;
  }
};

/**
 * Lista participantes do jogo. Requer que userId seja owner ou participante confirmado.
 */
const getParticipants = async (gameId, userId) => {
  try {
    log('getParticipants', 'Listando participantes', { gameId, userId });

    const sb = getSupabaseClient();

    // Verifica acesso
    await _requireAccess(sb, gameId, userId);

    const { data, error } = await sb
      .from('game_participants')
      .select('*')
      .eq('game_id', gameId)
      .order('joined_at', { ascending: true });

    if (error) throw error;

    return data || [];
  } catch (err) {
    logErr('getParticipants', err, { gameId, userId });
    throw err;
  }
};

/**
 * Participante sai voluntariamente do jogo.
 * - Bloqueado se tiver itens selecionados (SELECTION_LIST).
 * - Owner não pode sair do próprio jogo.
 */
const leaveGame = async (gameId, userId) => {
  try {
    log('leaveGame', 'Saindo do jogo', { gameId, userId });

    const sb = getSupabaseClient();

    const { data: game, error: gameErr } = await sb
      .from('games')
      .select('owner_id, game_type')
      .eq('id', gameId)
      .maybeSingle();

    if (gameErr) throw gameErr;
    if (!game) throw new Error('Jogo não encontrado');
    if (game.owner_id === userId) throw new Error('O criador não pode sair do próprio jogo');

    // Para SELECTION_LIST: bloqueia se tiver item selecionado
    if (game.game_type === 'SELECTION_LIST') {
      const { data: claimed } = await sb
        .from('selection_list_items')
        .select('id, label')
        .eq('game_id', gameId)
        .eq('claimed_by', userId)
        .limit(1);

      if (claimed && claimed.length > 0) {
        throw new Error(`Você selecionou o item "${claimed[0].label}". Libere-o antes de sair.`);
      }
    }

    const { error } = await sb
      .from('game_participants')
      .delete()
      .eq('game_id', gameId)
      .eq('user_id', userId);

    if (error) throw error;

    log('leaveGame', 'Participante saiu do jogo', { gameId, userId });
    return { left: true };
  } catch (err) {
    logErr('leaveGame', err, { gameId, userId });
    throw err;
  }
};

/**
 * Owner remove um participante do jogo.
 * - Auto-libera itens que o participante tenha selecionado.
 * - Retorna lista de itens liberados para atualização do frontend.
 */
const removeParticipant = async (gameId, ownerId, targetUserId) => {
  try {
    log('removeParticipant', 'Removendo participante', { gameId, ownerId, targetUserId });

    const sb = getSupabaseClient();

    await _requireOwner(sb, gameId, ownerId);

    if (ownerId === targetUserId) {
      throw new Error('O criador não pode ser removido do próprio jogo');
    }

    // Libera itens que o participante tenha selecionado
    const { data: releasedItems, error: unclaimErr } = await sb
      .from('selection_list_items')
      .update({ claimed_by: null, claimed_at: null })
      .eq('game_id', gameId)
      .eq('claimed_by', targetUserId)
      .select('id, label');

    if (unclaimErr) throw unclaimErr;

    // Remove da tabela de participantes
    const { error } = await sb
      .from('game_participants')
      .delete()
      .eq('game_id', gameId)
      .eq('user_id', targetUserId);

    if (error) throw error;

    // Realtime: notifica sala sobre itens liberados (fire-and-forget)
    if (releasedItems && releasedItems.length > 0) {
      setImmediate(() => {
        try {
          const { emitItemReleased } = require('../config/socket/handlers/gameHandlers');
          for (const item of releasedItems) {
            emitItemReleased(gameId, item.id, item.label);
          }
        } catch (err) {
          logger.warn(`[${SERVICE}] Falha ao emitir game:item_released`, { error: err.message });
        }
      });
    }

    log('removeParticipant', 'Participante removido', { gameId, targetUserId, releasedCount: releasedItems?.length });
    return { removed: true, releasedItems: releasedItems || [] };
  } catch (err) {
    logErr('removeParticipant', err, { gameId, ownerId, targetUserId });
    throw err;
  }
};

/**
 * Deleta permanentemente o jogo. Requer owner.
 * Bloqueado se houver movimentação financeira (raffle tickets pagos/reservados).
 * CASCADE remove participantes, itens, bilhetes, pares e resultados.
 */
const deleteGame = async (gameId, userId) => {
  try {
    log('deleteGame', 'Deletando jogo permanentemente', { gameId, userId });

    const sb = getSupabaseClient();
    const game = await _requireOwner(sb, gameId, userId);

    // Verifica movimentação financeira: bilhetes de rifa com pagamento
    if (game.game_type === 'RAFFLE') {
      const { data: paidTickets, error: tickErr } = await sb
        .from('raffle_tickets')
        .select('id')
        .eq('game_id', gameId)
        .in('payment_status', ['reserved', 'paid'])
        .limit(1);

      if (tickErr) throw tickErr;
      if (paidTickets && paidTickets.length > 0) {
        throw new Error('Não é possível deletar: existem bilhetes reservados ou pagos. Cancele o jogo em vez de deletar.');
      }
    }

    // Hard delete — CASCADE cuida das tabelas filhas
    const { error } = await sb
      .from('games')
      .delete()
      .eq('id', gameId);

    if (error) throw error;

    log('deleteGame', 'Jogo deletado permanentemente', { gameId });
    return { deleted: true, id: gameId };
  } catch (err) {
    logErr('deleteGame', err, { gameId, userId });
    throw err;
  }
};

/**
 * Convida todos os membros ativos de uma caixinha vinculada ao jogo.
 * Requer: userId é owner do jogo E jogo tem caixinha_id.
 * Pula membros que já são participantes do jogo e o próprio owner.
 * Retorna: { invited, skipped, errors }
 */
const inviteCaixinhaMembers = async (gameId, userId) => {
  try {
    log('inviteCaixinhaMembers', 'Convidando membros da caixinha', { gameId, userId });

    const sb = getSupabaseClient();
    const game = await _requireOwner(sb, gameId, userId);

    if (!game.caixinha_id) {
      throw new Error('Este jogo não está vinculado a nenhuma caixinha');
    }

    // Busca membros ativos da caixinha
    const { data: members, error: membersErr } = await sb
      .from('caixinha_members')
      .select('user_id')
      .eq('caixinha_id', game.caixinha_id)
      .eq('status', 'ativo')
      .eq('active', true);

    if (membersErr) throw membersErr;
    if (!members || members.length === 0) {
      return { invited: 0, skipped: 0, errors: [] };
    }

    // Busca participantes atuais do jogo
    const { data: existingParts } = await sb
      .from('game_participants')
      .select('user_id')
      .eq('game_id', gameId);

    const existingIds = new Set((existingParts || []).map(p => p.user_id));

    // Filtra: exclui owner + já participantes
    const toInvite = members
      .map(m => m.user_id)
      .filter(uid => uid !== userId && !existingIds.has(uid));

    if (toInvite.length === 0) {
      return { invited: 0, skipped: members.length - 1, errors: [] };
    }

    const results = { invited: 0, skipped: existingIds.size, errors: [] };

    for (const targetUserId of toInvite) {
      try {
        await addParticipant(gameId, userId, targetUserId, 'pending');
        results.invited++;
      } catch (err) {
        results.errors.push({ userId: targetUserId, error: err.message });
      }
    }

    // Notificações em batch (fire-and-forget)
    if (results.invited > 0) {
      setImmediate(async () => {
        try {
          const NotificationDispatcher = require('./NotificationDispatcher');
          for (const targetUserId of toInvite) {
            await NotificationDispatcher.dispatch('game_invite', targetUserId, {
              gameId,
              gameTitle:  game.title || 'Jogo',
              gameType:   game.game_type || 'game',
              invitedBy:  userId,
            }).catch(() => {});
          }
        } catch {}
      });

      // Gamification: fire-and-forget
      setImmediate(async () => {
        try {
          const gamificationService = require('./gamificationService');
          await gamificationService.triggerEvent('invite_sent', userId);
        } catch {}
      });
    }

    log('inviteCaixinhaMembers', 'Convites em lote enviados', {
      gameId, invited: results.invited, skipped: results.skipped,
    });
    return results;
  } catch (err) {
    logErr('inviteCaixinhaMembers', err, { gameId, userId });
    throw err;
  }
};

module.exports = {
  createGame,
  getGame,
  listMyGames,
  updateGame,
  cancelGame,
  openGame,
  closeGame,
  associateCaixinha,
  inviteParticipant,
  inviteCaixinhaMembers,
  addParticipant,
  getParticipants,
  getMyPendingGameInvites,
  respondToParticipation,
  leaveGame,
  removeParticipant,
  deleteGame,
  // Exporta helpers internos para uso por outros services do módulo
  _requireOwner,
  _requireAccess,
};
