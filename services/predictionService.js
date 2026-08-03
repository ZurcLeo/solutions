'use strict';

/**
 * @fileoverview predictionService — ElosCloud Bolao de Previsoes (BOLAO-P2)
 *
 * Gerencia o ciclo completo do bolao de previsoes:
 *   owner cria eventos (partidas) → participantes registram palpites →
 *   owner confirma resultado real → apuracao calcula pontos/ElosCoins →
 *   ranking disponivel
 *
 * Lei do Time (gamification triggers):
 *   - prediction_entry_submitted → usuario ao submeter palpite
 *   - prediction_exact_score    → acertou placar exato
 *   - prediction_bonus_earned   → ganhou ElosCoins por acerto
 *   - bolao_won                 → 1o lugar no ranking final
 */

const { getSupabaseClient } = require('../config/supabase');
const { createClient }      = require('@supabase/supabase-js');
const { logger }            = require('../logger');
const gamificationService   = require('./gamificationService');
const { _requireOwner, _requireAccess } = require('./gamesService');

const SERVICE = 'predictionService';

// ──────────────────────────────────────────────────────
// Helpers internos
// ──────────────────────────────────────────────────────

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponivel');
  return client;
}

/** Supabase com service_role para bypass de RLS (apuracao de entries) */
function sbService() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY nao configurados.');
  return createClient(url, key, { auth: { persistSession: false } });
}

function log(fn, msg, extra = {}) {
  logger.info(msg, { service: SERVICE, function: fn, ...extra });
}

function logErr(fn, err, extra = {}) {
  logger.error(`Erro em ${fn}: ${err.message}`, {
    service: SERVICE, function: fn, error: err.message, stack: err.stack, ...extra,
  });
}

/**
 * Verifica que userId e owner do jogo E que game_type === 'BOLAO'.
 */
async function _requireBolaoOwner(supabase, gameId, userId) {
  const game = await _requireOwner(supabase, gameId, userId);
  if (game.game_type !== 'BOLAO') {
    throw new Error('Este jogo nao e um bolao (game_type != BOLAO)');
  }
  return game;
}

/**
 * Verifica que userId e owner ou participante confirmado E que game_type === 'BOLAO'.
 */
async function _requireBolaoAccess(supabase, gameId, userId) {
  const game = await _requireAccess(supabase, gameId, userId);
  if (game.game_type !== 'BOLAO') {
    throw new Error('Este jogo nao e um bolao (game_type != BOLAO)');
  }
  return game;
}

/** Fire-and-forget gamification trigger */
function _triggerEvent(event, userId) {
  setImmediate(async () => {
    try {
      await gamificationService.triggerEvent(event, userId);
    } catch (err) {
      logger.warn(`[${SERVICE}] Falha no trigger ${event}`, { error: err.message });
    }
  });
}

// ──────────────────────────────────────────────────────
// 1. createEvent
// ──────────────────────────────────────────────────────

/**
 * Cria um evento de previsao (partida) no bolao.
 * @param {string} gameId
 * @param {string} userId - owner do jogo
 * @param {object} data   - campos do prediction_events
 */
async function createEvent(gameId, userId, data) {
  const fn = 'createEvent';
  const supabase = sb();

  const game = await _requireBolaoOwner(supabase, gameId, userId);
  if (game.status === 'cancelled') {
    throw new Error('Jogo cancelado, nao e possivel adicionar eventos');
  }

  const { data: event, error } = await supabase
    .from('prediction_events')
    .insert({
      game_id:       gameId,
      event_type:    data.event_type || 'match',
      team_home:     data.team_home,
      team_home_flag: data.team_home_flag || null,
      team_away:     data.team_away,
      team_away_flag: data.team_away_flag || null,
      event_date:    data.event_date,
      event_time:    data.event_time || null,
      event_timezone: data.event_timezone || 'America/Sao_Paulo',
      event_stage:   data.event_stage || null,
      brasilia_date: data.brasilia_date || null,
      brasilia_time: data.brasilia_time || null,
      venue:         data.venue || null,
      city:          data.city || null,
      match_number:  data.match_number || null,
      source_match_home: data.source_match_home || null,
      source_type_home:  data.source_type_home || null,
      source_match_away: data.source_match_away || null,
      source_type_away:  data.source_type_away || null,
      is_active:     data.is_active !== undefined ? data.is_active : true,
      is_placeholder: data.is_placeholder || false,
      points_exact_score: data.points_exact_score ?? 10,
      points_winner:  data.points_winner ?? 5,
      points_draw:    data.points_draw ?? 3,
      eloscoin_base:  data.eloscoin_base ?? 20,
      eloscoin_multiplier_per_scorer: data.eloscoin_multiplier_per_scorer ?? 1.0,
      display_order:  data.display_order ?? 0,
    })
    .select()
    .single();

  if (error) {
    logErr(fn, error, { gameId });
    throw new Error(`Erro ao criar evento: ${error.message}`);
  }

  log(fn, `Evento criado: ${event.id}`, { gameId, matchNumber: event.match_number });
  return event;
}

// ──────────────────────────────────────────────────────
// 2. listEvents
// ──────────────────────────────────────────────────────

/**
 * Lista eventos de um bolao.
 * @param {string} gameId
 * @param {string} userId
 * @param {object} [opts]
 * @param {boolean} [opts.include_inactive=false]
 * @param {boolean} [opts.only_pending=false]
 */
async function listEvents(gameId, userId, opts = {}) {
  const fn = 'listEvents';
  const supabase = sb();

  await _requireBolaoAccess(supabase, gameId, userId);

  let query = supabase
    .from('prediction_events')
    .select('*')
    .eq('game_id', gameId)
    .order('display_order', { ascending: true })
    .order('event_date', { ascending: true });

  if (!opts.include_inactive) {
    query = query.eq('is_active', true);
  }

  if (opts.only_pending) {
    query = query.is('result_confirmed_at', null);
  }

  const { data, error } = await query;
  if (error) {
    logErr(fn, error, { gameId });
    throw new Error(`Erro ao listar eventos: ${error.message}`);
  }

  return data || [];
}

// ──────────────────────────────────────────────────────
// 3. updateEvent
// ──────────────────────────────────────────────────────

/** Campos permitidos para update */
const UPDATABLE_EVENT_FIELDS = [
  'team_home', 'team_away', 'team_home_flag', 'team_away_flag',
  'event_date', 'event_time', 'event_timezone', 'event_stage',
  'brasilia_date', 'brasilia_time', 'venue', 'city', 'match_number',
  'is_active', 'is_placeholder',
  'points_exact_score', 'points_winner', 'points_draw',
  'eloscoin_base', 'eloscoin_multiplier_per_scorer',
  'display_order',
  'source_match_home', 'source_type_home',
  'source_match_away', 'source_type_away',
];

/**
 * Atualiza um evento do bolao.
 */
async function updateEvent(gameId, eventId, userId, data) {
  const fn = 'updateEvent';
  const supabase = sb();

  await _requireBolaoOwner(supabase, gameId, userId);

  // Buscar evento
  const { data: existing, error: fetchErr } = await supabase
    .from('prediction_events')
    .select('id, game_id, result_confirmed_at')
    .eq('id', eventId)
    .eq('game_id', gameId)
    .maybeSingle();

  if (fetchErr) throw new Error(`Erro ao buscar evento: ${fetchErr.message}`);
  if (!existing) throw new Error('Evento nao encontrado');
  if (existing.result_confirmed_at) {
    throw new Error('Resultado ja confirmado, nao e possivel editar este evento');
  }

  // Filtrar apenas campos permitidos
  const updates = {};
  for (const key of UPDATABLE_EVENT_FIELDS) {
    if (data[key] !== undefined) updates[key] = data[key];
  }

  if (Object.keys(updates).length === 0) {
    throw new Error('Nenhum campo valido para atualizar');
  }

  const { data: updated, error } = await supabase
    .from('prediction_events')
    .update(updates)
    .eq('id', eventId)
    .eq('game_id', gameId)
    .select()
    .single();

  if (error) {
    logErr(fn, error, { gameId, eventId });
    throw new Error(`Erro ao atualizar evento: ${error.message}`);
  }

  log(fn, `Evento atualizado: ${eventId}`, { gameId });
  return updated;
}

// ──────────────────────────────────────────────────────
// 4. deleteEvent
// ──────────────────────────────────────────────────────

/**
 * Deleta um evento (apenas se nao houver palpites registrados).
 */
async function deleteEvent(gameId, eventId, userId) {
  const fn = 'deleteEvent';
  const supabase = sb();

  await _requireBolaoOwner(supabase, gameId, userId);

  // Verificar se existem palpites
  const { count, error: countErr } = await supabase
    .from('prediction_entries')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId);

  if (countErr) throw new Error(`Erro ao verificar palpites: ${countErr.message}`);
  if (count > 0) {
    throw new Error('Nao e possivel deletar evento com palpites registrados');
  }

  const { error } = await supabase
    .from('prediction_events')
    .delete()
    .eq('id', eventId)
    .eq('game_id', gameId);

  if (error) {
    logErr(fn, error, { gameId, eventId });
    throw new Error(`Erro ao deletar evento: ${error.message}`);
  }

  log(fn, `Evento deletado: ${eventId}`, { gameId });
  return { deleted: true };
}

// ──────────────────────────────────────────────────────
// 5. confirmResult
// ──────────────────────────────────────────────────────

/**
 * Confirma o resultado real de um evento (partida).
 */
async function confirmResult(gameId, eventId, userId, result) {
  const fn = 'confirmResult';
  const supabase = sb();

  await _requireBolaoOwner(supabase, gameId, userId);

  // Buscar evento
  const { data: existing, error: fetchErr } = await supabase
    .from('prediction_events')
    .select('id, game_id, result_confirmed_at')
    .eq('id', eventId)
    .eq('game_id', gameId)
    .maybeSingle();

  if (fetchErr) throw new Error(`Erro ao buscar evento: ${fetchErr.message}`);
  if (!existing) throw new Error('Evento nao encontrado');
  if (existing.result_confirmed_at) {
    throw new Error('Resultado ja foi confirmado para este evento');
  }

  const { data: updated, error } = await supabase
    .from('prediction_events')
    .update({
      result_home_score:   result.result_home_score,
      result_away_score:   result.result_away_score,
      result_scorers:      result.result_scorers || [],
      result_confirmed_at: new Date().toISOString(),
      result_confirmed_by: userId,
    })
    .eq('id', eventId)
    .eq('game_id', gameId)
    .select()
    .single();

  if (error) {
    logErr(fn, error, { gameId, eventId });
    throw new Error(`Erro ao confirmar resultado: ${error.message}`);
  }

  log(fn, `Resultado confirmado: ${eventId} (${result.result_home_score}x${result.result_away_score})`, { gameId });

  // P3: Resolver bracket downstream (propagar vencedor/perdedor)
  if (updated.match_number) {
    setImmediate(async () => {
      try {
        await _resolveBracketDownstream(supabase, gameId, updated);
      } catch (err) {
        logger.warn(`[${SERVICE}] Falha ao resolver bracket downstream`, {
          error: err.message, matchNumber: updated.match_number,
        });
      }
    });
  }

  return updated;
}

// ──────────────────────────────────────────────────────
// 6. submitEntry
// ──────────────────────────────────────────────────────

/**
 * Registra um palpite (prediction_entry) — imutavel apos submissao.
 */
async function submitEntry(gameId, userId, data) {
  const fn = 'submitEntry';
  const supabase = sb();

  const game = await _requireBolaoAccess(supabase, gameId, userId);
  if (game.status !== 'open') {
    throw new Error('Jogo nao esta aberto para palpites');
  }

  // Verificar evento
  const { data: event, error: eventErr } = await supabase
    .from('prediction_events')
    .select('id, game_id, is_active, is_placeholder, result_confirmed_at')
    .eq('id', data.event_id)
    .eq('game_id', gameId)
    .maybeSingle();

  if (eventErr) throw new Error(`Erro ao buscar evento: ${eventErr.message}`);
  if (!event) throw new Error('Evento nao encontrado neste bolao');
  if (!event.is_active) throw new Error('Evento nao esta ativo para palpites');
  if (event.is_placeholder) throw new Error('Evento e placeholder (times ainda nao definidos)');
  if (event.result_confirmed_at) throw new Error('Resultado ja confirmado, prazo de palpite encerrado');

  // Cobrar ElosCoins se entry_cost definido
  const entryCost = game.entry_cost || 0;
  if (entryCost > 0) {
    try {
      await gamificationService.spendCoins(userId, entryCost, 'prediction_entry', null, {
        game_id: gameId,
        event_id: data.event_id,
      });
    } catch (spendErr) {
      if (spendErr.code === 'P0001' || (spendErr.message && spendErr.message.includes('Saldo insuficiente'))) {
        const err = new Error('Saldo insuficiente de ElosCoins para registrar palpite');
        err.code = 'INSUFFICIENT_BALANCE';
        throw err;
      }
      throw spendErr;
    }
  }

  const { data: entry, error } = await supabase
    .from('prediction_entries')
    .insert({
      event_id:            data.event_id,
      user_id:             userId,
      game_id:             gameId,
      predicted_home_score: data.predicted_home_score,
      predicted_away_score: data.predicted_away_score,
      predicted_scorers:   data.predicted_scorers || [],
      cost_paid:           entryCost,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') { // unique violation
      throw new Error('Voce ja registrou palpite para este evento');
    }
    logErr(fn, error, { gameId, eventId: data.event_id });
    throw new Error(`Erro ao registrar palpite: ${error.message}`);
  }

  // Gamificacao — Lei do Time
  _triggerEvent('prediction_entry_submitted', userId);

  log(fn, `Palpite registrado: ${entry.id}`, { gameId, eventId: data.event_id, userId });
  return entry;
}

// ──────────────────────────────────────────────────────
// 7. getMyEntries
// ──────────────────────────────────────────────────────

/**
 * Retorna os palpites do usuario neste bolao, enriquecidos com dados do evento.
 */
async function getMyEntries(gameId, userId) {
  const fn = 'getMyEntries';
  const supabase = sb();

  await _requireBolaoAccess(supabase, gameId, userId);

  const { data, error } = await supabase
    .from('prediction_entries')
    .select(`
      *,
      event:prediction_events(
        id, team_home, team_away, team_home_flag, team_away_flag,
        event_date, brasilia_time, event_stage, venue,
        result_home_score, result_away_score, result_confirmed_at,
        points_exact_score, points_winner, points_draw
      )
    `)
    .eq('game_id', gameId)
    .eq('user_id', userId)
    .order('submitted_at', { ascending: true });

  if (error) {
    logErr(fn, error, { gameId, userId });
    throw new Error(`Erro ao buscar palpites: ${error.message}`);
  }

  return data || [];
}

// ──────────────────────────────────────────────────────
// 7b. getEventEntries — palpites publicos por evento
// ──────────────────────────────────────────────────────

/**
 * Retorna todos os palpites de um evento, enriquecidos com dados do usuario.
 * Visivel apenas apos apuracao (result_confirmed_at IS NOT NULL).
 */
async function getEventEntries(gameId, eventId, userId) {
  const fn = 'getEventEntries';
  const supabase = sb();

  await _requireBolaoAccess(supabase, gameId, userId);

  // Verificar se evento existe e esta apurado
  const { data: event, error: eventErr } = await supabase
    .from('prediction_events')
    .select('id, result_confirmed_at')
    .eq('id', eventId)
    .eq('game_id', gameId)
    .maybeSingle();

  if (eventErr) throw new Error(`Erro ao buscar evento: ${eventErr.message}`);
  if (!event) throw new Error('Evento nao encontrado neste bolao');
  if (!event.result_confirmed_at) {
    throw new Error('Palpites ficam visiveis apenas apos confirmacao do resultado');
  }

  const { data: entries, error } = await supabase
    .from('prediction_entries')
    .select('id, user_id, predicted_home_score, predicted_away_score, points_earned, is_exact_score, cost_paid')
    .eq('game_id', gameId)
    .eq('event_id', eventId)
    .order('points_earned', { ascending: false });

  if (error) {
    logErr(fn, error, { gameId, eventId });
    throw new Error(`Erro ao buscar palpites do evento: ${error.message}`);
  }

  if (!entries || entries.length === 0) return [];

  // Enriquecer com dados do usuario
  const userIds = [...new Set(entries.map(e => e.user_id))];
  const { data: users } = await supabase
    .from('users')
    .select('id, full_name, avatar_url')
    .in('id', userIds);

  const usersMap = {};
  for (const u of (users || [])) {
    usersMap[u.id] = u;
  }

  return entries.map(e => ({
    ...e,
    user: usersMap[e.user_id]
      ? { display_name: usersMap[e.user_id].full_name, photo_url: usersMap[e.user_id].avatar_url }
      : { display_name: 'Usuario', photo_url: null },
  }));
}

// ──────────────────────────────────────────────────────
// 8. getRanking
// ──────────────────────────────────────────────────────

/**
 * Retorna o ranking do bolao (agregacao de pontos por usuario).
 */
async function getRanking(gameId, userId) {
  const fn = 'getRanking';
  const supabase = sb();

  await _requireBolaoAccess(supabase, gameId, userId);

  // Buscar todas as entries apuradas deste jogo
  const { data: entries, error } = await supabase
    .from('prediction_entries')
    .select('user_id, points_earned, eloscoin_bonus, is_exact_score')
    .eq('game_id', gameId)
    .not('apurated_at', 'is', null);

  if (error) {
    logErr(fn, error, { gameId });
    throw new Error(`Erro ao buscar entradas para ranking: ${error.message}`);
  }

  if (!entries || entries.length === 0) {
    return { leaderboard: [], total_participants: 0 };
  }

  // Agregar por usuario
  const userMap = {};
  for (const e of entries) {
    if (!userMap[e.user_id]) {
      userMap[e.user_id] = {
        user_id: e.user_id,
        total_points: 0,
        total_eloscoins: 0,
        exact_scores: 0,
        correct_predictions: 0,
        total_entries: 0,
      };
    }
    const u = userMap[e.user_id];
    u.total_points += e.points_earned || 0;
    u.total_eloscoins += parseFloat(e.eloscoin_bonus) || 0;
    if (e.is_exact_score) u.exact_scores++;
    if (e.points_earned > 0) u.correct_predictions++;
    u.total_entries++;
  }

  // Ordenar por pontos DESC, exact_scores DESC
  const leaderboard = Object.values(userMap)
    .sort((a, b) => b.total_points - a.total_points || b.exact_scores - a.exact_scores);

  // Enriquecer com dados do usuario
  const userIds = leaderboard.map(u => u.user_id);
  const { data: users } = await supabase
    .from('users')
    .select('id, full_name, avatar_url')
    .in('id', userIds);

  const usersMap = {};
  for (const u of (users || [])) {
    usersMap[u.id] = u;
  }

  const ranked = leaderboard.map((item, idx) => ({
    rank: idx + 1,
    ...item,
    user: usersMap[item.user_id]
      ? { display_name: usersMap[item.user_id].full_name, photo_url: usersMap[item.user_id].avatar_url }
      : { display_name: 'Usuario', photo_url: null },
  }));

  return {
    leaderboard: ranked,
    total_participants: ranked.length,
  };
}

// ──────────────────────────────────────────────────────
// 9. contestResult
// ──────────────────────────────────────────────────────

/**
 * Contesta o resultado de um evento (janela de 24h apos confirmacao).
 */
async function contestResult(gameId, eventId, userId, data) {
  const fn = 'contestResult';
  const supabase = sb();

  await _requireBolaoAccess(supabase, gameId, userId);

  // Buscar evento
  const { data: event, error: fetchErr } = await supabase
    .from('prediction_events')
    .select('id, game_id, result_confirmed_at, contest_status')
    .eq('id', eventId)
    .eq('game_id', gameId)
    .maybeSingle();

  if (fetchErr) throw new Error(`Erro ao buscar evento: ${fetchErr.message}`);
  if (!event) throw new Error('Evento nao encontrado');
  if (!event.result_confirmed_at) throw new Error('Resultado ainda nao foi confirmado');
  if (event.contest_status !== 'none') throw new Error('Evento ja foi contestado');

  // Janela de 24h
  const confirmedAt = new Date(event.result_confirmed_at);
  const now = new Date();
  const diffMs = now.getTime() - confirmedAt.getTime();
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  if (diffMs > TWENTY_FOUR_HOURS) {
    throw new Error('Prazo de contestacao expirado (24h apos confirmacao)');
  }

  const { data: updated, error } = await supabase
    .from('prediction_events')
    .update({
      contested_at:   now.toISOString(),
      contested_by:   userId,
      contest_status: 'open',
    })
    .eq('id', eventId)
    .eq('game_id', gameId)
    .select()
    .single();

  if (error) {
    logErr(fn, error, { gameId, eventId });
    throw new Error(`Erro ao contestar resultado: ${error.message}`);
  }

  log(fn, `Resultado contestado: ${eventId}`, { gameId, userId, reason: data.reason });
  return updated;
}

// ──────────────────────────────────────────────────────
// 10. apurate
// ──────────────────────────────────────────────────────

/**
 * Determina vencedor a partir dos placares.
 * @returns {'home'|'away'|'draw'}
 */
function _determineWinner(homeScore, awayScore) {
  if (homeScore > awayScore) return 'home';
  if (awayScore > homeScore) return 'away';
  return 'draw';
}

/**
 * Compara artilheiros previstos com reais (case-insensitive pelo nome).
 * @returns {number} quantidade de acertos
 */
function _countCorrectScorers(predicted, actual) {
  if (!predicted || !actual || predicted.length === 0 || actual.length === 0) return 0;

  const actualNames = actual.map(s => (s.name || s.player || '').toLowerCase().trim());
  let correct = 0;

  for (const p of predicted) {
    const pName = (p.name || p.player || '').toLowerCase().trim();
    if (pName && actualNames.includes(pName)) correct++;
  }

  return correct;
}

/**
 * Apura os palpites de eventos ja confirmados.
 * Usa sbService() para bypass de RLS (entries sao imutaveis via client).
 *
 * @param {string} gameId
 * @param {string} userId - owner
 * @param {object} [opts]
 * @param {string} [opts.event_id]          - apurar apenas este evento
 * @param {boolean} [opts.force_recalculate] - recalcular mesmo se ja apurado
 */
async function apurate(gameId, userId, opts = {}) {
  const fn = 'apurate';
  const supabase = sb();

  await _requireBolaoOwner(supabase, gameId, userId);

  // Buscar eventos confirmados
  let eventsQuery = supabase
    .from('prediction_events')
    .select('*')
    .eq('game_id', gameId)
    .not('result_confirmed_at', 'is', null);

  if (opts.event_id) {
    eventsQuery = eventsQuery.eq('id', opts.event_id);
  }

  const { data: events, error: eventsErr } = await eventsQuery;
  if (eventsErr) throw new Error(`Erro ao buscar eventos: ${eventsErr.message}`);
  if (!events || events.length === 0) {
    throw new Error('Nenhum evento confirmado para apurar');
  }

  const svc = sbService();
  let totalApurated = 0;
  const eventIds = events.map(e => e.id);

  // Buscar entries pendentes de apuracao
  let entriesQuery = svc
    .from('prediction_entries')
    .select('*')
    .in('event_id', eventIds);

  if (!opts.force_recalculate) {
    entriesQuery = entriesQuery.is('apurated_at', null);
  }

  const { data: entries, error: entriesErr } = await entriesQuery;
  if (entriesErr) throw new Error(`Erro ao buscar palpites: ${entriesErr.message}`);
  if (!entries || entries.length === 0) {
    log(fn, 'Nenhum palpite pendente de apuracao', { gameId });
    return { apurated: 0, events_processed: events.length };
  }

  // Mapear eventos por id para acesso rapido
  const eventMap = {};
  for (const e of events) eventMap[e.id] = e;

  // Apurar cada entry
  for (const entry of entries) {
    const event = eventMap[entry.event_id];
    if (!event) continue;

    let pointsEarned = 0;
    let isExactScore = false;

    const predictedWinner = _determineWinner(entry.predicted_home_score, entry.predicted_away_score);
    const actualWinner = _determineWinner(event.result_home_score, event.result_away_score);

    // Layer 1: Placar exato OU vencedor/empate
    if (entry.predicted_home_score === event.result_home_score &&
        entry.predicted_away_score === event.result_away_score) {
      pointsEarned = event.points_exact_score;
      isExactScore = true;
    } else if (predictedWinner === actualWinner) {
      pointsEarned = actualWinner === 'draw' ? event.points_draw : event.points_winner;
    }

    // Layer 2: ElosCoins base
    let eloscoinBonus = 0;
    if (isExactScore) {
      eloscoinBonus = parseFloat(event.eloscoin_base) * 2;
    } else if (pointsEarned > 0) {
      eloscoinBonus = parseFloat(event.eloscoin_base);
    }

    // Layer 3: Artilheiros
    const scorersCorrect = _countCorrectScorers(
      entry.predicted_scorers,
      event.result_scorers,
    );
    if (scorersCorrect > 0) {
      eloscoinBonus += parseFloat(event.eloscoin_base) *
        parseFloat(event.eloscoin_multiplier_per_scorer) * scorersCorrect;
    }

    // Atualizar entry via service_role (bypass RLS)
    const { error: updateErr } = await svc
      .from('prediction_entries')
      .update({
        points_earned:  pointsEarned,
        eloscoin_bonus: eloscoinBonus,
        scorers_correct: scorersCorrect,
        is_exact_score: isExactScore,
        apurated_at:    new Date().toISOString(),
      })
      .eq('id', entry.id);

    if (updateErr) {
      logErr(fn, updateErr, { entryId: entry.id });
      continue; // nao bloqueia as outras entries
    }

    totalApurated++;

    // Gamificacao — Lei do Time
    if (isExactScore) {
      _triggerEvent('prediction_exact_score', entry.user_id);
    }
    if (eloscoinBonus > 0) {
      _triggerEvent('prediction_bonus_earned', entry.user_id);
    }
  }

  log(fn, `Apuracao concluida: ${totalApurated} palpites, ${events.length} eventos`, { gameId });

  return {
    apurated: totalApurated,
    events_processed: events.length,
  };
}

// ══════════════════════════════════════════════════════
// P3 — Funcionalidades Avancadas
// ══════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────
// 11. batchCreateEvents
// ──────────────────────────────────────────────────────

/**
 * Insere multiplos eventos de uma vez (owner-only).
 * @param {string} gameId
 * @param {string} userId
 * @param {Array<object>} events - array de objetos com campos do prediction_events
 * @returns {{ inserted: number }}
 */
async function batchCreateEvents(gameId, userId, events) {
  const fn = 'batchCreateEvents';
  const supabase = sb();

  const game = await _requireBolaoOwner(supabase, gameId, userId);
  if (game.status === 'cancelled') {
    throw new Error('Jogo cancelado, nao e possivel adicionar eventos');
  }

  if (!events || events.length === 0) {
    throw new Error('Nenhum evento fornecido');
  }

  const rows = events.map((e, idx) => ({
    game_id:       gameId,
    event_type:    e.event_type || 'match',
    team_home:     e.team_home,
    team_home_flag: e.team_home_flag || null,
    team_away:     e.team_away,
    team_away_flag: e.team_away_flag || null,
    event_date:    e.event_date,
    event_time:    e.event_time || null,
    event_timezone: e.event_timezone || 'America/Sao_Paulo',
    event_stage:   e.event_stage || null,
    brasilia_date: e.brasilia_date || null,
    brasilia_time: e.brasilia_time || null,
    venue:         e.venue || null,
    city:          e.city || null,
    match_number:  e.match_number || null,
    source_match_home: e.source_match_home || null,
    source_type_home:  e.source_type_home || null,
    source_match_away: e.source_match_away || null,
    source_type_away:  e.source_type_away || null,
    is_active:     e.is_active !== undefined ? e.is_active : true,
    is_placeholder: e.is_placeholder || false,
    points_exact_score: e.points_exact_score ?? 10,
    points_winner:  e.points_winner ?? 5,
    points_draw:    e.points_draw ?? 3,
    eloscoin_base:  e.eloscoin_base ?? 20,
    eloscoin_multiplier_per_scorer: e.eloscoin_multiplier_per_scorer ?? 1.0,
    display_order:  e.display_order ?? idx,
    result_home_score:   e.result_home_score ?? null,
    result_away_score:   e.result_away_score ?? null,
    result_confirmed_at: e.result_confirmed_at || null,
  }));

  const { data, error } = await supabase
    .from('prediction_events')
    .insert(rows)
    .select('id, match_number');

  if (error) {
    logErr(fn, error, { gameId, count: rows.length });
    throw new Error(`Erro ao inserir eventos em batch: ${error.message}`);
  }

  log(fn, `${(data || []).length} eventos inseridos em batch`, { gameId });
  return { inserted: (data || []).length };
}

// ──────────────────────────────────────────────────────
// 12. seedCopa2026
// ──────────────────────────────────────────────────────

/**
 * UTC offsets para timezones das sedes da Copa 2026 (junho-julho, horario de verao).
 * Mexico aboliu DST em 2022 — Mexico City/Monterrey ficam UTC-6 o ano todo.
 */
const SUMMER_UTC_OFFSETS = {
  'America/Mexico_City': -6,
  'America/Monterrey':   -6,
  'America/Vancouver':   -7,
  'America/Los_Angeles': -7,
  'America/New_York':    -4,
  'America/Toronto':     -4,
  'America/Chicago':     -5,
  'America/Denver':      -6,
};
const BRT_OFFSET = -3;

/** Scoring tiers by stage keyword */
function _getScoringTier(stage) {
  if (!stage) return { pts_exact: 10, pts_winner: 5, pts_draw: 3, elobase: 20 };
  const s = stage.toLowerCase();
  if (s.includes('grupo'))        return { pts_exact: 10, pts_winner: 5, pts_draw: 3, elobase: 20 };
  if (s.includes('oitavas') || s.includes('3'))
                                  return { pts_exact: 15, pts_winner: 7, pts_draw: 0, elobase: 30 };
  if (s.includes('quartas'))      return { pts_exact: 20, pts_winner: 10, pts_draw: 0, elobase: 40 };
  if (s.includes('semi'))         return { pts_exact: 25, pts_winner: 12, pts_draw: 0, elobase: 50 };
  if (s.includes('final') && !s.includes('semi') && !s.includes('3'))
                                  return { pts_exact: 50, pts_winner: 25, pts_draw: 0, elobase: 100 };
  return { pts_exact: 15, pts_winner: 7, pts_draw: 0, elobase: 30 }; // fallback knockout
}

/**
 * Bracket mapping: source_match references for knockout matches.
 * Key = match_number, value = { source_match_home, source_type_home, source_match_away, source_type_away }
 */
const COPA2026_BRACKET = {
  // Quartas de Final
  89:  { smh: 73, sth: 'winner', sma: 75, sta: 'winner' },
  90:  { smh: 74, sth: 'winner', sma: 77, sta: 'winner' },
  91:  { smh: 76, sth: 'winner', sma: 78, sta: 'winner' },
  92:  { smh: 79, sth: 'winner', sma: 80, sta: 'winner' },
  93:  { smh: 83, sth: 'winner', sma: 84, sta: 'winner' },
  94:  { smh: 81, sth: 'winner', sma: 82, sta: 'winner' },
  95:  { smh: 86, sth: 'winner', sma: 88, sta: 'winner' },
  96:  { smh: 85, sth: 'winner', sma: 87, sta: 'winner' },
  // Semifinais
  97:  { smh: 89, sth: 'winner', sma: 90, sta: 'winner' },
  98:  { smh: 93, sth: 'winner', sma: 94, sta: 'winner' },
  99:  { smh: 91, sth: 'winner', sma: 92, sta: 'winner' },
  100: { smh: 95, sth: 'winner', sma: 96, sta: 'winner' },
  // Disputa do 3o Lugar
  101: { smh: 97, sth: 'winner', sma: 98, sta: 'winner' },
  102: { smh: 99, sth: 'winner', sma: 100, sta: 'winner' },
  103: { smh: 101, sth: 'loser',  sma: 102, sta: 'loser' },
  // Final
  104: { smh: 101, sth: 'winner', sma: 102, sta: 'winner' },
};

/**
 * Converte horario local do venue para Brasilia (BRT).
 * @returns {{ brasilia_time: string, brasilia_date: string }}
 */
function _toBrasilia(date, time, timezone) {
  if (!time || !timezone) return { brasilia_time: null, brasilia_date: null };

  const venueOffset = SUMMER_UTC_OFFSETS[timezone];
  if (venueOffset === undefined) return { brasilia_time: null, brasilia_date: null };

  const [hours, minutes] = time.split(':').map(Number);
  const diffHours = BRT_OFFSET - venueOffset; // negativo = BRT esta adiante

  let brtHours = hours + diffHours; // BRT = local + (BRT_offset - venue_offset)
  let brtDate = date;

  // Overflow de dia
  if (brtHours >= 24) {
    brtHours -= 24;
    // Incrementar data
    const d = new Date(date + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    brtDate = d.toISOString().split('T')[0];
  } else if (brtHours < 0) {
    brtHours += 24;
    const d = new Date(date + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    brtDate = d.toISOString().split('T')[0];
  }

  const brasilia_time = `${String(brtHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return { brasilia_time, brasilia_date: brtDate };
}

/**
 * Carrega os 104 jogos da Copa 2026 do JSON e insere como eventos do bolao.
 * @param {string} gameId - UUID do jogo (game_type = 'BOLAO')
 * @param {string} userId - owner do jogo
 */
async function seedCopa2026(gameId, userId) {
  const fn = 'seedCopa2026';
  const fs = require('fs');
  const path = require('path');

  const supabase = sb();
  const game = await _requireBolaoOwner(supabase, gameId, userId);

  // Verificar se ja tem eventos (evitar seed duplicado)
  const { count } = await supabase
    .from('prediction_events')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', gameId);

  if (count > 0) {
    throw new Error(`Bolao ja possui ${count} eventos. Limpe os eventos antes de re-seed.`);
  }

  // Ler JSON
  const jsonPath = path.resolve(__dirname, '../../../data/copa2026_matches.json');
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Arquivo de dados nao encontrado: ${jsonPath}`);
  }

  const matches = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  log(fn, `Lidos ${matches.length} jogos do JSON`, { gameId });

  const FLAG_BASE = 'https://flagcdn.com/w80';

  const rows = matches.map((m) => {
    const { brasilia_time, brasilia_date } = _toBrasilia(m.date, m.time, m.timezone);
    const scoring = _getScoringTier(m.stage);
    const bracket = COPA2026_BRACKET[m.match_number] || {};
    const isKnockout = m.match_number >= 73;
    const hasResult = m.result_home !== null && m.result_away !== null;
    const isPlaceholder = isKnockout && m.team_home_iso2 === null;

    return {
      game_id:       gameId,
      event_type:    'match',
      team_home:     m.team_home,
      team_home_flag: m.team_home_iso2 ? `${FLAG_BASE}/${m.team_home_iso2}.png` : null,
      team_away:     m.team_away,
      team_away_flag: m.team_away_iso2 ? `${FLAG_BASE}/${m.team_away_iso2}.png` : null,
      event_date:    m.date,
      event_time:    m.time,
      event_timezone: m.timezone,
      event_stage:   m.stage,
      brasilia_date,
      brasilia_time,
      venue:         m.venue,
      city:          m.city,
      match_number:  m.match_number,
      source_match_home: bracket.smh || null,
      source_type_home:  bracket.sth || null,
      source_match_away: bracket.sma || null,
      source_type_away:  bracket.sta || null,
      is_active:     !isPlaceholder,
      is_placeholder: isPlaceholder,
      result_home_score:   hasResult ? m.result_home : null,
      result_away_score:   hasResult ? m.result_away : null,
      result_confirmed_at: hasResult ? new Date().toISOString() : null,
      points_exact_score:  scoring.pts_exact,
      points_winner:       scoring.pts_winner,
      points_draw:         scoring.pts_draw,
      eloscoin_base:       scoring.elobase,
      eloscoin_multiplier_per_scorer: 1.0,
      display_order:       m.match_number,
    };
  });

  const { data, error } = await supabase
    .from('prediction_events')
    .insert(rows)
    .select('id, match_number');

  if (error) {
    logErr(fn, error, { gameId });
    throw new Error(`Erro ao inserir seed Copa 2026: ${error.message}`);
  }

  const inserted = (data || []).length;
  const withResult = rows.filter(r => r.result_home_score !== null).length;
  const placeholders = rows.filter(r => r.is_placeholder).length;

  log(fn, `Seed Copa 2026 concluido: ${inserted} eventos (${withResult} encerrados, ${placeholders} placeholders)`, { gameId });

  return {
    inserted,
    with_result: withResult,
    placeholders,
    active_pending: inserted - withResult - placeholders,
  };
}

// ──────────────────────────────────────────────────────
// 13. Bracket Resolution (interno)
// ──────────────────────────────────────────────────────

/**
 * Apos confirmar resultado de um evento knockout, propaga vencedor/perdedor
 * para eventos downstream que referenciam este match_number.
 *
 * Ex: Se match 73 terminou Brasil 2x1 Argentina:
 *   - Evento com source_match_home=73 e source_type_home='winner' → team_home='Brasil'
 *   - Evento com source_match_away=73 e source_type_away='winner' → team_away='Brasil'
 *   - Evento com source_type='loser' → team='Argentina'
 *
 * Se ambos os times de um evento downstream estao resolvidos, ativa o evento.
 */
async function _resolveBracketDownstream(supabase, gameId, confirmedEvent) {
  const fn = '_resolveBracketDownstream';
  const matchNum = confirmedEvent.match_number;
  if (!matchNum) return;

  const homeScore = confirmedEvent.result_home_score;
  const awayScore = confirmedEvent.result_away_score;
  const winnerTeam  = homeScore > awayScore ? confirmedEvent.team_home : confirmedEvent.team_away;
  const winnerFlag  = homeScore > awayScore ? confirmedEvent.team_home_flag : confirmedEvent.team_away_flag;
  const loserTeam   = homeScore > awayScore ? confirmedEvent.team_away : confirmedEvent.team_home;
  const loserFlag   = homeScore > awayScore ? confirmedEvent.team_away_flag : confirmedEvent.team_home_flag;

  // Empate em knockout: nao resolve automaticamente (precisa penaltis — owner decide manualmente)
  if (homeScore === awayScore) {
    log(fn, `Empate em knockout (match ${matchNum}), bracket nao resolvido automaticamente`, { gameId });
    return;
  }

  // Buscar eventos downstream que referenciam este match_number
  const { data: downstream, error } = await supabase
    .from('prediction_events')
    .select('id, match_number, source_match_home, source_type_home, source_match_away, source_type_away, team_home, team_away, team_home_flag, team_away_flag')
    .eq('game_id', gameId)
    .or(`source_match_home.eq.${matchNum},source_match_away.eq.${matchNum}`);

  if (error || !downstream || downstream.length === 0) return;

  for (const ds of downstream) {
    const updates = {};

    // Resolver home team
    if (ds.source_match_home === matchNum) {
      const sourceTeam = ds.source_type_home === 'winner' ? winnerTeam : loserTeam;
      const sourceFlag = ds.source_type_home === 'winner' ? winnerFlag : loserFlag;
      updates.team_home = sourceTeam;
      updates.team_home_flag = sourceFlag;
    }

    // Resolver away team
    if (ds.source_match_away === matchNum) {
      const sourceTeam = ds.source_type_away === 'winner' ? winnerTeam : loserTeam;
      const sourceFlag = ds.source_type_away === 'winner' ? winnerFlag : loserFlag;
      updates.team_away = sourceTeam;
      updates.team_away_flag = sourceFlag;
    }

    if (Object.keys(updates).length === 0) continue;

    // Verificar se ambos os times estao resolvidos apos este update
    const resolvedHome = updates.team_home || ds.team_home;
    const resolvedAway = updates.team_away || ds.team_away;
    const bothResolved = resolvedHome && resolvedAway &&
      !resolvedHome.match(/^[12][A-L]$/) && !resolvedHome.match(/^[VP]\d+$/) &&
      !resolvedHome.match(/^3[A-Z]+$/) &&
      !resolvedAway.match(/^[12][A-L]$/) && !resolvedAway.match(/^[VP]\d+$/) &&
      !resolvedAway.match(/^3[A-Z]+$/);

    if (bothResolved) {
      updates.is_placeholder = false;
      updates.is_active = true;
    }

    const { error: updateErr } = await supabase
      .from('prediction_events')
      .update(updates)
      .eq('id', ds.id);

    if (updateErr) {
      logErr(fn, updateErr, { downstreamId: ds.id, matchNumber: ds.match_number });
    } else {
      log(fn, `Bracket resolvido: match ${ds.match_number} (${updates.team_home || ds.team_home} vs ${updates.team_away || ds.team_away})`, { gameId });
    }
  }
}

// ──────────────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────────────

module.exports = {
  createEvent,
  listEvents,
  updateEvent,
  deleteEvent,
  confirmResult,
  submitEntry,
  getMyEntries,
  getEventEntries,
  getRanking,
  contestResult,
  apurate,
  // P3
  batchCreateEvents,
  seedCopa2026,
};
