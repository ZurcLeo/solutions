'use strict';

// services/secretFriendService.js
// JOGOS-BACK-004 — Amigo Oculto / Amigo Secreto
// Tabelas: game_participants, secret_friend_pairs, game_results

const { createHash }        = require('crypto');
const { logger }            = require('../logger');
const { getSupabaseClient } = require('../config/supabase');
const { _requireOwner }     = require('./gamesService');
const { closeGame }         = require('./gamesService');
const { emitDrawDone }      = require('../config/socket/handlers/gameHandlers');

const SERVICE = 'secretFriendService';

function log(method, msg, extra = {}) {
  logger.info(`[${SERVICE}] ${method}: ${msg}`, { service: SERVICE, method, ...extra });
}

function logErr(method, err, extra = {}) {
  logger.error(`[${SERVICE}] ${method}: ${err.message}`, {
    service: SERVICE, method, error: err.message, stack: err.stack, ...extra,
  });
}

// ── Algoritmo de Sorteio ──────────────────────────────────────────────────

/**
 * Sattolo Cycle — gera derangement de ciclo único.
 * Garante: ninguém tira a si mesmo; todos pertencem a um único loop.
 * Reimplementado localmente para evitar dependência circular com rifaService.
 *
 * @param {string[]} participantes — lista de user IDs (mín. 2)
 * @returns {{ giver: string, receiver: string }[]}
 */
function sattoloCycle(participantes) {
  if (participantes.length < 2) {
    throw new Error('Amigo Oculto requer pelo menos 2 participantes');
  }
  const arr = [...participantes];
  // Diferença do Fisher-Yates: j ∈ [0, i-1] (não inclui i → derangement garantido)
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return participantes.map((giver, i) => ({ giver, receiver: arr[i] }));
}

// ── Funções públicas ──────────────────────────────────────────────────────

/**
 * Realiza o sorteio de pares do Amigo Oculto.
 * Requer: userId é owner, game_type = SECRET_FRIEND, status = 'open'.
 * Mínimo 2 participantes confirmados.
 * Insere pares em secret_friend_pairs via service_role.
 * Gera result_hash SHA-256 e insere em game_results.
 * Fecha o jogo e dispara gamification para cada participante.
 */
const drawPairs = async (gameId, userId) => {
  try {
    log('drawPairs', 'Sorteando pares', { gameId, userId });

    const sb = getSupabaseClient();

    // Verifica que userId é owner e que o jogo é SECRET_FRIEND em status 'open'
    const game = await _requireOwner(sb, gameId, userId);

    if (game.game_type !== 'SECRET_FRIEND') {
      throw new Error('Esta operação é exclusiva para jogos do tipo SECRET_FRIEND');
    }
    if (game.status !== 'open') {
      throw new Error(`Sorteio requer status 'open'. Status atual: '${game.status}'`);
    }

    // Obtém participantes confirmados
    const { data: participants, error: partErr } = await sb
      .from('game_participants')
      .select('user_id')
      .eq('game_id', gameId)
      .eq('status', 'confirmed');

    if (partErr) throw partErr;

    const userIds = (participants || []).map(p => p.user_id);
    if (userIds.length < 2) {
      throw new Error(`São necessários pelo menos 2 participantes confirmados. Atual: ${userIds.length}`);
    }

    // Executa o algoritmo Sattolo
    const pares = sattoloCycle(userIds);

    // Gera hash do resultado para auditabilidade
    const timestamp = new Date().toISOString();
    const resultadoHash = createHash('sha256')
      .update(JSON.stringify({ gameId, pares, timestamp }))
      .digest('hex');

    // Insere pares em secret_friend_pairs
    const rows = pares.map(({ giver, receiver }) => ({
      game_id:     gameId,
      giver_id:    giver,
      receiver_id: receiver,
    }));

    const { error: insertErr } = await sb
      .from('secret_friend_pairs')
      .insert(rows);

    if (insertErr) {
      if (insertErr.code === '23505') {
        throw new Error('Os pares deste jogo já foram sorteados');
      }
      throw insertErr;
    }

    // Registra resultado em game_results
    const { error: resultErr } = await sb
      .from('game_results')
      .insert({
        game_id:     gameId,
        result_data: { total: userIds.length, hash: resultadoHash },
        result_hash: resultadoHash,
        algorithm:   'sattolo-cycle',
        drawn_at:    timestamp,
      });

    if (resultErr) throw resultErr;

    // Fecha o jogo
    await closeGame(gameId, userId);

    // Gamification + notificação: fire-and-forget para cada participante
    setImmediate(async () => {
      try {
        const gamificationService = require('./gamificationService');
        for (const uid of userIds) {
          await gamificationService.triggerEvent('secret_friend_draw', uid);
        }
      } catch (err) {
        logger.warn(`[${SERVICE}] Falha no trigger secret_friend_draw`, { error: err.message });
      }
    });

    // Realtime: notifica todos na room do jogo que o sorteio foi concluído
    setImmediate(() => {
      try {
        emitDrawDone(gameId, 'SECRET_FRIEND', resultadoHash);
      } catch (err) {
        logger.warn(`[${SERVICE}] Falha ao emitir game:draw_done`, { error: err.message });
      }
    });

    log('drawPairs', 'Pares sorteados com sucesso', { gameId, total: userIds.length, resultadoHash });
    return { total: userIds.length, resultadoHash };
  } catch (err) {
    logErr('drawPairs', err, { gameId, userId });
    throw err;
  }
};

/**
 * Revela o par do usuário (a quem ele deve presentear).
 * Requer: jogo existe, game_type = SECRET_FRIEND, status = 'closed'.
 * Marca revealed_at na primeira consulta.
 */
const revealMyPair = async (gameId, userId) => {
  try {
    log('revealMyPair', 'Revelando par', { gameId, userId });

    const sb = getSupabaseClient();

    // Verifica que o jogo existe e tem o tipo/status corretos
    const { data: game, error: gameErr } = await sb
      .from('games')
      .select('id, game_type, status')
      .eq('id', gameId)
      .maybeSingle();

    if (gameErr) throw gameErr;
    if (!game) throw new Error('Jogo não encontrado');
    if (game.game_type !== 'SECRET_FRIEND') {
      throw new Error('Esta operação é exclusiva para jogos do tipo SECRET_FRIEND');
    }
    if (game.status !== 'closed') {
      throw new Error('Os pares ainda não foram sorteados ou o jogo não está finalizado');
    }

    // Busca o par deste usuário
    const { data: pair, error: pairErr } = await sb
      .from('secret_friend_pairs')
      .select('id, receiver_id, revealed_at')
      .eq('game_id', gameId)
      .eq('giver_id', userId)
      .maybeSingle();

    if (pairErr) throw pairErr;
    if (!pair) throw new Error('Você não está participando deste sorteio');

    const isFirstReveal = !pair.revealed_at;

    // Marca revealed_at na primeira consulta
    if (isFirstReveal) {
      const { error: updateErr } = await sb
        .from('secret_friend_pairs')
        .update({ revealed_at: new Date().toISOString() })
        .eq('id', pair.id);

      if (updateErr) throw updateErr;
    }

    log('revealMyPair', 'Par revelado', { gameId, userId, isFirstReveal });
    return {
      receiverId:    pair.receiver_id,
      revealedAt:    pair.revealed_at || new Date().toISOString(),
      isFirstReveal,
    };
  } catch (err) {
    logErr('revealMyPair', err, { gameId, userId });
    throw err;
  }
};

/**
 * Propõe um valor de presente (gift_value_mode = 'suggested').
 * Requer: userId é participante confirmado, game_type = SECRET_FRIEND, gift_value_mode = 'suggested'.
 */
const proposeGiftValue = async (gameId, userId, proposedValue) => {
  try {
    log('proposeGiftValue', 'Propondo valor de presente', { gameId, userId, proposedValue });

    const sb = getSupabaseClient();

    // Verifica jogo
    const { data: game, error: gameErr } = await sb
      .from('games')
      .select('id, game_type, gift_value_mode')
      .eq('id', gameId)
      .maybeSingle();

    if (gameErr) throw gameErr;
    if (!game) throw new Error('Jogo não encontrado');
    if (game.game_type !== 'SECRET_FRIEND') {
      throw new Error('Esta operação é exclusiva para jogos do tipo SECRET_FRIEND');
    }
    if (game.gift_value_mode !== 'suggested') {
      throw new Error(`Propostas de valor só são aceitas no modo 'suggested'. Modo atual: '${game.gift_value_mode}'`);
    }

    // Verifica que userId é participante confirmado
    const { data: part, error: partErr } = await sb
      .from('game_participants')
      .select('id')
      .eq('game_id', gameId)
      .eq('user_id', userId)
      .eq('status', 'confirmed')
      .maybeSingle();

    if (partErr) throw partErr;
    if (!part) throw new Error('Você precisa ser participante confirmado para propor um valor');

    // Atualiza proposta (reseta aceitação anterior)
    const { data: updated, error: updateErr } = await sb
      .from('game_participants')
      .update({
        gift_value_proposal: proposedValue,
        gift_value_accepted: null,
      })
      .eq('game_id', gameId)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateErr) throw updateErr;

    log('proposeGiftValue', 'Proposta registrada', { gameId, userId, proposedValue });
    return updated;
  } catch (err) {
    logErr('proposeGiftValue', err, { gameId, userId });
    throw err;
  }
};

/**
 * Responde à proposta de valor de presente de um participante.
 * Requer: ownerUserId é owner do jogo.
 * Se rejeitada e gift_value_mode = 'fixed': remove participante (status = 'declined').
 */
const respondGiftProposal = async (gameId, targetUserId, ownerUserId, accepted) => {
  try {
    log('respondGiftProposal', 'Respondendo proposta', { gameId, targetUserId, ownerUserId, accepted });

    const sb = getSupabaseClient();

    // Verifica que ownerUserId é owner do jogo
    const game = await _requireOwner(sb, gameId, ownerUserId);

    const now = new Date().toISOString();

    // Atualiza resposta do owner
    const updatePayload = {
      gift_value_accepted: accepted,
      responded_at:        now,
    };

    // Se rejeitada e modo fixo: declinar participante
    if (!accepted && game.gift_value_mode === 'fixed') {
      updatePayload.status = 'declined';
    }

    const { data: updated, error: updateErr } = await sb
      .from('game_participants')
      .update(updatePayload)
      .eq('game_id', gameId)
      .eq('user_id', targetUserId)
      .select()
      .single();

    if (updateErr) throw updateErr;
    if (!updated) throw new Error('Participante não encontrado neste jogo');

    log('respondGiftProposal', 'Proposta respondida', { gameId, targetUserId, accepted });
    return updated;
  } catch (err) {
    logErr('respondGiftProposal', err, { gameId, targetUserId, ownerUserId });
    throw err;
  }
};

module.exports = {
  drawPairs,
  revealMyPair,
  proposeGiftValue,
  respondGiftProposal,
  // Exporta sattoloCycle para uso em testes ou outros services
  sattoloCycle,
};
