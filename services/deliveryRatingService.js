/**
 * @fileoverview deliveryRatingService — Sistema de Avaliação Tripartite de Delivery
 *
 * Orquestra a avaliação pós-entrega entre as 3 partes:
 *   - Entregador avalia: loja + comprador
 *   - Loja avalia: entregador + comprador
 *   - Comprador avalia: entregador + loja
 *
 * A camada de validação é delegada à RPC `submit_delivery_rating` (SECURITY DEFINER),
 * que garante atomicidade e evita race conditions no banco.
 *
 * Efeitos pós-avaliação (fire-and-forget):
 *   - gamificationService.triggerEvent('delivery_rating_submitted', raterId)
 *   - gamificationService.triggerEvent('delivery_received_5star_rating', ratedId)  — score = 5
 *   - gamificationService.triggerEvent('delivery_rating_cycle_completed', raterId) — ciclo
 *   - socketManager.emitToUser(ratedId, 'delivery:rating_received', payload)
 *
 * [DELIVERY-RATING-001] Agente: marketplace-agent + game-agent
 * Data: 2026-06-10
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger }            = require('../logger');
const gamificationService   = require('./gamificationService');
const socketManager         = require('../config/socket/socketManager');

const SERVICE            = 'deliveryRatingService';
const RATING_WINDOW_DAYS = 7;   // janela de avaliação em dias (igual ao CHECK da RPC)

// ──────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

function log(fn, msg, extra = {}) {
  logger.info(msg, { service: SERVICE, function: fn, ...extra });
}

function logError(fn, err, extra = {}) {
  logger.error(`Erro em ${fn}: ${err.message}`, {
    service: SERVICE, function: fn, error: err.message, ...extra,
  });
}

// ──────────────────────────────────────────────────────
// Detecção de ciclo completo
// Cada parte deve emitir 2 avaliações (das outras 2 partes).
// ──────────────────────────────────────────────────────

async function _isCycleComplete(userId, requestId) {
  const { count } = await sb()
    .from('delivery_ratings')
    .select('id', { count: 'exact', head: true })
    .eq('delivery_request_id', requestId)
    .eq('rater_id', userId);
  return (count ?? 0) >= 2;
}

// ──────────────────────────────────────────────────────
// 1. submitRating — submete avaliação via operações diretas
// ──────────────────────────────────────────────────────

/**
 * Submete uma avaliação tripartite de entrega.
 * Validações feitas em application code (service role key não popula auth.uid()).
 *
 * @param {string}      userId    — ID do avaliador (rater)
 * @param {string}      requestId — ID do delivery_request
 * @param {string}      ratedId   — ID do usuário avaliado
 * @param {string}      ratedRole — 'deliverer' | 'seller' | 'buyer'
 * @param {number}      score     — 1 a 5
 * @param {string|null} comment   — texto livre, max 500 chars
 * @param {string[]|null} tags    — tags qualitativas opcionais
 * @param {boolean}     anonymous — true para ocultar identidade (LGPD)
 * @returns {Promise<{ ratingId: string, cycleCompleted: boolean }>}
 * @throws {Error} com mensagem em pt-BR
 */
async function submitRating(userId, requestId, ratedId, ratedRole, score, comment, tags, anonymous) {
  const fn = 'submitRating';
  log(fn, 'Submetendo avaliação', { userId, requestId, ratedId, ratedRole, score });

  // ── 1. Carrega o pedido + buyer_id ──────────────────
  const { data: reqData, error: reqErr } = await sb()
    .from('delivery_requests')
    .select('id, status, service_id, seller_id, delivered_at, order_id')
    .eq('id', requestId)
    .maybeSingle();

  if (reqErr || !reqData) {
    throw new Error('Pedido de entrega não encontrado.');
  }

  // ── 2. Verifica status ──────────────────────────────
  if (!['delivered', 'completed'].includes(reqData.status)) {
    throw new Error('Só é possível avaliar pedidos entregues ou concluídos.');
  }

  // ── 3. Verifica janela de 7 dias ────────────────────
  if (reqData.delivered_at) {
    const windowMs = RATING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() - new Date(reqData.delivered_at).getTime() > windowMs) {
      throw new Error('O prazo de avaliação (7 dias) expirou para este pedido.');
    }
  }

  // ── 4. Determina rater_role ─────────────────────────
  // Busca delivery_service e seller_profile do userId
  const [{ data: svcData }, { data: sellerData }, { data: orderData }] = await Promise.all([
    sb().from('delivery_services').select('id').eq('user_id', userId).maybeSingle(),
    sb().from('seller_profiles').select('id').eq('user_id', userId).maybeSingle(),
    sb().from('marketplace_orders').select('buyer_id').eq('id', reqData.order_id).maybeSingle(),
  ]);

  let raterRole;
  if (svcData?.id && svcData.id === reqData.service_id) {
    raterRole = 'deliverer';
  } else if (sellerData?.id && sellerData.id === reqData.seller_id) {
    raterRole = 'seller';
  } else if (orderData?.buyer_id === userId) {
    raterRole = 'buyer';
  } else {
    throw new Error('Você não é parte deste pedido de entrega.');
  }

  // ── 5. Validações de integridade ────────────────────
  if (userId === ratedId) {
    throw new Error('Não é permitido avaliar a si mesmo.');
  }
  if (raterRole === ratedRole) {
    throw new Error('Avaliador e avaliado devem ter papéis distintos (mesmo papel).');
  }

  // ── 6. Verifica duplo voto ──────────────────────────
  const { count: existingCount } = await sb()
    .from('delivery_ratings')
    .select('id', { count: 'exact', head: true })
    .eq('delivery_request_id', requestId)
    .eq('rater_id', userId)
    .eq('rated_id', ratedId);

  if ((existingCount ?? 0) > 0) {
    throw new Error('Você já avaliou esta pessoa para este pedido.');
  }

  // ── 7. Insere avaliação ─────────────────────────────
  const { data: inserted, error: insertErr } = await sb()
    .from('delivery_ratings')
    .insert({
      delivery_request_id: requestId,
      rater_id:    userId,
      rater_role:  raterRole,
      rated_id:    ratedId,
      rated_role:  ratedRole,
      score,
      comment:      comment   ?? null,
      tags:         tags      ?? null,
      is_anonymous: anonymous ?? false,
    })
    .select('id')
    .single();

  if (insertErr) {
    if (insertErr.code === '23505') { // unique_violation
      throw new Error('Você já avaliou esta pessoa para este pedido.');
    }
    logError(fn, insertErr, { userId, requestId });
    throw new Error(`Erro ao registrar avaliação: ${insertErr.message}`);
  }

  const ratingId = inserted.id;

  // ── 8. Recalcula média do entregador se avaliado ────
  if (ratedRole === 'deliverer') {
    try {
      await sb().rpc('_update_deliverer_avg_rating', { p_request_id: requestId });
    } catch (err) {
      logError(fn, err, { context: 'update_avg_rating', requestId });
    }
  }
  log(fn, 'Avaliação registrada', { userId, requestId, ratingId, ratedRole, score });

  // ── Efeitos assíncronos (fire-and-forget) ────────

  // 1. Gamificação do avaliador
  gamificationService.triggerEvent('delivery_rating_submitted', userId, {
    requestId, ratedId, ratedRole, score,
  }).catch(err =>
    logger.warn(`[${SERVICE}] ${fn}: falha ao disparar gamificação`, {
      event: 'delivery_rating_submitted', userId, error: err.message,
    })
  );

  // 2. Gamificação do avaliado se nota 5 estrelas como entregador
  if (score === 5 && ratedRole === 'deliverer') {
    gamificationService.triggerEvent('delivery_received_5star_rating', ratedId, {
      requestId, raterRole: 'auto',
    }).catch(err =>
      logger.warn(`[${SERVICE}] ${fn}: falha ao disparar gamificação 5star`, {
        event: 'delivery_received_5star_rating', ratedId, error: err.message,
      })
    );
  }

  // 2b. Trust Passport — avaliação de delivery (impacto baseado na nota)
  {
    const trustPassportService = require('./trustPassportService');
    const impact = score >= 4 ? 2 : score >= 3 ? 1 : -2;
    const isNeg = impact < 0;
    trustPassportService.recordEvent(ratedId, 'delivery', 'delivery_rating_received', impact, isNeg, {
      requestId, score, ratedRole,
    }).catch(err =>
      logger.warn(`[${SERVICE}] ${fn}: trust event falhou`, { event: 'delivery_rating_received', error: err.message })
    );
  }

  // 3. Notificação realtime para o avaliado
  _notifyRated(ratedId, { userId, requestId, ratedRole, score, comment, tags, anonymous });

  // 4. Detecta ciclo completo (avaliou as 2 outras partes)
  let cycleCompleted = false;
  try {
    cycleCompleted = await _isCycleComplete(userId, requestId);
    if (cycleCompleted) {
      log(fn, 'Ciclo completo detectado', { userId, requestId });
      gamificationService.triggerEvent('delivery_rating_cycle_completed', userId, {
        requestId,
      }).catch(err =>
        logger.warn(`[${SERVICE}] ${fn}: falha ao disparar ciclo completo`, {
          userId, requestId, error: err.message,
        })
      );
    }
  } catch (err) {
    logError(fn, err, { context: 'isCycleComplete', userId, requestId });
  }

  return { ratingId, cycleCompleted };
}

// ──────────────────────────────────────────────────────
// Notificação realtime (silencia erros — não bloqueia)
// ──────────────────────────────────────────────────────

async function _notifyRated(ratedId, { userId, requestId, ratedRole, score, comment, tags, anonymous }) {
  try {
    // Recupera nome/avatar do avaliador (omitido se anônimo)
    let raterName   = null;
    let raterAvatar = null;

    if (!anonymous) {
      const { data: profile } = await sb()
        .from('users')
        .select('full_name, avatar_url')
        .eq('id', userId)
        .maybeSingle();

      raterName   = profile?.full_name  ?? null;
      raterAvatar = profile?.avatar_url ?? null;
    }

    socketManager.emitToUser(ratedId, 'delivery:rating_received', {
      requestId,
      score,
      raterName,
      raterAvatar,
      ratedRole,
      comment:     anonymous ? null : (comment ?? null),
      tags:        tags ?? [],
    });
  } catch {
    // Falha de notificação não é crítica
  }
}

// ──────────────────────────────────────────────────────
// 2. getRatingsForRequest — lista avaliações do pedido
// ──────────────────────────────────────────────────────

/**
 * Retorna todas as avaliações de um pedido de entrega.
 * Acesso restrito às partes do pedido (verificação em application code).
 *
 * @param {string} userId    — ID do solicitante (para verificar acesso)
 * @param {string} requestId — ID do delivery_request
 * @returns {Promise<Array>}
 */
async function getRatingsForRequest(userId, requestId) {
  const fn = 'getRatingsForRequest';
  log(fn, 'Buscando avaliações', { userId, requestId });

  // ── Verificar que o userId é parte do pedido ────────
  const { data: reqData } = await sb()
    .from('delivery_requests')
    .select('id, service_id, seller_id, order_id')
    .eq('id', requestId)
    .maybeSingle();

  if (!reqData) throw new Error('Pedido de entrega não encontrado.');

  const [{ data: svcData }, { data: sellerData }, { data: orderData }] = await Promise.all([
    sb().from('delivery_services').select('id').eq('user_id', userId).maybeSingle(),
    sb().from('seller_profiles').select('id').eq('user_id', userId).maybeSingle(),
    sb().from('marketplace_orders').select('buyer_id').eq('id', reqData.order_id).maybeSingle(),
  ]);

  const isDeliverer = svcData?.id && svcData.id === reqData.service_id;
  const isSeller    = sellerData?.id && sellerData.id === reqData.seller_id;
  const isBuyer     = orderData?.buyer_id === userId;

  if (!isDeliverer && !isSeller && !isBuyer) {
    throw new Error('Você não é parte deste pedido de entrega.');
  }

  // ── Buscar avaliações com dados do avaliador ────────
  const { data, error } = await sb()
    .from('delivery_ratings')
    .select(`
      id, delivery_request_id,
      rater_id, rater_role, rated_id, rated_role,
      score, comment, tags, is_anonymous, created_at,
      users!rater_id ( display_name, photo_url )
    `)
    .eq('delivery_request_id', requestId)
    .order('created_at', { ascending: true });

  if (error) {
    logError(fn, error, { userId, requestId });
    throw new Error(`Erro ao buscar avaliações: ${error.message}`);
  }

  // Aplicar anonimato: ocultar nome/avatar se is_anonymous
  return (data || []).map(r => ({
    id:                   r.id,
    delivery_request_id:  r.delivery_request_id,
    rater_id:             r.rater_id,
    rater_name:           r.is_anonymous ? null : (r.users?.display_name ?? null),
    rater_avatar:         r.is_anonymous ? null : (r.users?.photo_url ?? null),
    rater_role:           r.rater_role,
    rated_id:             r.rated_id,
    rated_role:           r.rated_role,
    score:                r.score,
    comment:              r.is_anonymous ? null : r.comment,
    tags:                 r.tags,
    is_anonymous:         r.is_anonymous,
    created_at:           r.created_at,
  }));
}

// ──────────────────────────────────────────────────────
// 3. getPendingRatingsForUser — avaliações pendentes
// ──────────────────────────────────────────────────────

/**
 * Retorna quais avaliações o usuário ainda deve emitir para
 * pedidos entregues nos últimos RATING_WINDOW_DAYS dias.
 *
 * @param {string} userId
 * @returns {Promise<Array<{ requestId, orderId, pendingRatings }>>}
 */
async function getPendingRatingsForUser(userId) {
  const fn = 'getPendingRatingsForUser';
  log(fn, 'Buscando avaliações pendentes', { userId });

  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - RATING_WINDOW_DAYS);
  const since = windowStart.toISOString();

  // Busca service_id e seller_id do usuário para identificar seu papel
  const [{ data: svcData }, { data: sellerData }] = await Promise.all([
    sb().from('delivery_services').select('id').eq('user_id', userId).maybeSingle(),
    sb().from('seller_profiles').select('id').eq('user_id', userId).maybeSingle(),
  ]);

  const myServiceId = svcData?.id ?? null;
  const mySellerId  = sellerData?.id ?? null;

  // Pedidos nas últimas 7 dias em status entregue/concluído
  const orFilters = [`order_id.eq.${userId}`]; // placeholder — ver abaixo

  // Query por pedidos onde é entregador
  const asDelivererQ = myServiceId
    ? sb()
        .from('delivery_requests')
        .select('id, order_id, seller_id, service_id')
        .eq('service_id', myServiceId)
        .in('status', ['delivered', 'completed'])
        .gte('delivered_at', since)
    : Promise.resolve({ data: [] });

  // Query por pedidos onde é vendedor
  const asSellerQ = mySellerId
    ? sb()
        .from('delivery_requests')
        .select('id, order_id, seller_id, service_id')
        .eq('seller_id', mySellerId)
        .in('status', ['delivered', 'completed'])
        .gte('delivered_at', since)
    : Promise.resolve({ data: [] });

  // Query por pedidos onde é comprador
  const asBuyerQ = sb()
    .from('marketplace_orders')
    .select('id, delivery_request_id')
    .eq('buyer_id', userId)
    .not('delivery_request_id', 'is', null);

  const [
    { data: asDeliverer = [] },
    { data: asSeller    = [] },
    { data: asBuyer     = [] },
  ] = await Promise.all([asDelivererQ, asSellerQ, asBuyerQ]);

  // Consolida pedidos únicos com o papel do usuário
  const requestMap = new Map();
  for (const r of (asDeliverer || [])) {
    if (!requestMap.has(r.id))
      requestMap.set(r.id, { requestId: r.id, orderId: r.order_id, myRole: 'deliverer' });
  }
  for (const r of (asSeller || [])) {
    if (!requestMap.has(r.id))
      requestMap.set(r.id, { requestId: r.id, orderId: r.order_id, myRole: 'seller' });
  }
  for (const o of (asBuyer || [])) {
    if (o.delivery_request_id && !requestMap.has(o.delivery_request_id))
      requestMap.set(o.delivery_request_id, {
        requestId: o.delivery_request_id, orderId: o.id, myRole: 'buyer',
      });
  }

  if (requestMap.size === 0) return [];

  const requestIds = Array.from(requestMap.keys());

  // Avaliações já enviadas pelo usuário
  const { data: submitted = [] } = await sb()
    .from('delivery_ratings')
    .select('delivery_request_id, rated_id, rated_role')
    .eq('rater_id', userId)
    .in('delivery_request_id', requestIds);

  const alreadyRated = new Set(
    (submitted || []).map(r => `${r.delivery_request_id}:${r.rated_id}`)
  );

  // Detalhes dos pedidos (partes envolvidas)
  const { data: details = [] } = await sb()
    .from('delivery_requests')
    .select(`
      id, order_id, seller_id, service_id,
      delivery_services!service_id ( user_id ),
      seller_profiles!seller_id    ( user_id, display_name ),
      marketplace_orders!order_id  ( buyer_id, users!buyer_id ( display_name ) )
    `)
    .in('id', requestIds);

  const result = [];

  for (const [requestId, meta] of requestMap.entries()) {
    const d = (details || []).find(x => x.id === requestId);
    if (!d) continue;

    const delivererId = d.delivery_services?.user_id;
    const sellerId    = d.seller_profiles?.user_id;
    const buyerId     = d.marketplace_orders?.buyer_id;

    // Quem o usuário deve avaliar
    const toRate = [];
    if (meta.myRole === 'deliverer') {
      if (sellerId)    toRate.push({ ratedId: sellerId,    ratedRole: 'seller',    ratedName: d.seller_profiles?.display_name ?? 'Vendedor' });
      if (buyerId)     toRate.push({ ratedId: buyerId,     ratedRole: 'buyer',     ratedName: d.marketplace_orders?.users?.display_name ?? 'Comprador' });
    } else if (meta.myRole === 'seller') {
      if (delivererId) toRate.push({ ratedId: delivererId, ratedRole: 'deliverer', ratedName: 'Entregador' });
      if (buyerId)     toRate.push({ ratedId: buyerId,     ratedRole: 'buyer',     ratedName: d.marketplace_orders?.users?.display_name ?? 'Comprador' });
    } else if (meta.myRole === 'buyer') {
      if (delivererId) toRate.push({ ratedId: delivererId, ratedRole: 'deliverer', ratedName: 'Entregador' });
      if (sellerId)    toRate.push({ ratedId: sellerId,    ratedRole: 'seller',    ratedName: d.seller_profiles?.display_name ?? 'Vendedor' });
    }

    const pending = toRate.filter(p => !alreadyRated.has(`${requestId}:${p.ratedId}`));
    if (pending.length > 0) {
      result.push({ requestId: meta.requestId, orderId: meta.orderId, pendingRatings: pending });
    }
  }

  log(fn, `${result.length} pedido(s) com avaliações pendentes`, { userId });
  return result;
}

// ──────────────────────────────────────────────────────
// 4. getUserRatingSummary — média de avaliações recebidas
// ──────────────────────────────────────────────────────

/**
 * Retorna a média de avaliações recebidas por role.
 *
 * @param {string} userId
 * @returns {Promise<{ deliverer, seller, buyer }}>}
 */
async function getUserRatingSummary(userId) {
  const fn = 'getUserRatingSummary';

  const { data, error } = await sb()
    .from('delivery_ratings')
    .select('rated_role, score')
    .eq('rated_id', userId);

  if (error) {
    logError(fn, error, { userId });
    throw new Error(`Erro ao buscar resumo: ${error.message}`);
  }

  const summary = {
    deliverer: { average: null, count: 0 },
    seller:    { average: null, count: 0 },
    buyer:     { average: null, count: 0 },
  };

  const grouped = { deliverer: [], seller: [], buyer: [] };
  for (const r of (data || [])) {
    if (grouped[r.rated_role]) grouped[r.rated_role].push(r.score);
  }
  for (const role of Object.keys(grouped)) {
    const scores = grouped[role];
    if (scores.length > 0) {
      summary[role] = {
        average: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100,
        count:   scores.length,
      };
    }
  }

  return summary;
}

// ──────────────────────────────────────────────────────
// 5. getUserRatingHistory — histórico de avaliações enviadas e recebidas
// ──────────────────────────────────────────────────────

/**
 * Retorna o histórico de avaliações do usuário (enviadas + recebidas)
 * nos últimos 90 dias, paginado.
 *
 * @param {string} userId
 * @param {{ limit?: number, offset?: number }} opts
 * @returns {Promise<{ sent: Array, received: Array }>}
 */
async function getUserRatingHistory(userId, { limit = 50, offset = 0 } = {}) {
  const fn = 'getUserRatingHistory';
  log(fn, 'Buscando histórico de avaliações', { userId, limit, offset });

  const since = new Date();
  since.setDate(since.getDate() - 90);
  const sinceISO = since.toISOString();

  // Busca enviadas e recebidas em paralelo
  const [sentRes, receivedRes] = await Promise.all([
    sb()
      .from('delivery_ratings')
      .select(`
        id, delivery_request_id, rated_id, rated_role,
        score, comment, tags, is_anonymous, created_at,
        users!rated_id ( display_name, photo_url )
      `)
      .eq('rater_id', userId)
      .gte('created_at', sinceISO)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1),

    sb()
      .from('delivery_ratings')
      .select(`
        id, delivery_request_id, rater_id, rater_role,
        score, comment, tags, is_anonymous, created_at,
        users!rater_id ( display_name, photo_url )
      `)
      .eq('rated_id', userId)
      .gte('created_at', sinceISO)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1),
  ]);

  if (sentRes.error) {
    logError(fn, sentRes.error, { userId, direction: 'sent' });
    throw new Error(`Erro ao buscar avaliações enviadas: ${sentRes.error.message}`);
  }
  if (receivedRes.error) {
    logError(fn, receivedRes.error, { userId, direction: 'received' });
    throw new Error(`Erro ao buscar avaliações recebidas: ${receivedRes.error.message}`);
  }

  const sent = (sentRes.data || []).map(r => ({
    id:          r.id,
    requestId:   r.delivery_request_id,
    ratedId:     r.rated_id,
    ratedRole:   r.rated_role,
    ratedName:   r.users?.display_name ?? null,
    ratedAvatar: r.users?.photo_url ?? null,
    score:       r.score,
    comment:     r.comment,
    tags:        r.tags,
    createdAt:   r.created_at,
  }));

  const received = (receivedRes.data || []).map(r => ({
    id:          r.id,
    requestId:   r.delivery_request_id,
    raterId:     r.rater_id,
    raterRole:   r.rater_role,
    raterName:   r.is_anonymous ? null : (r.users?.display_name ?? null),
    raterAvatar: r.is_anonymous ? null : (r.users?.photo_url ?? null),
    score:       r.score,
    comment:     r.is_anonymous ? null : r.comment,
    tags:        r.tags,
    isAnonymous: r.is_anonymous,
    createdAt:   r.created_at,
  }));

  log(fn, `Histórico: ${sent.length} enviadas, ${received.length} recebidas`, { userId });
  return { sent, received };
}

// ──────────────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────────────

module.exports = {
  submitRating,
  getRatingsForRequest,
  getPendingRatingsForUser,
  getUserRatingSummary,
  getUserRatingHistory,
};
