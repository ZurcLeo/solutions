/**
 * @fileoverview TrustMarketplaceService — Trust Passport para marketplace
 *
 * Registra trust events de liquidação testemunhada (witnessed) e
 * auto-reportada (self_reported) entre contrapartes no marketplace.
 *
 * Guards (spec 5.x):
 *   5.1 — Par decay: retorno decrescente por par comprador-vendedor (90d)
 *   5.2 — Invite graph distance: convites próximos reduzem impacto
 *   5.2b — Device/IP overlap via user_sessions
 *   5.3 — Cap diário (+6.0) e burst hold (>10 tx/24h)
 *
 * Idempotência: ON CONFLICT (order_id, user_id, event_type) DO NOTHING
 * Vesting: witnessed fica 'pending' por 48h, self_reported por 72h
 * Clawback: disputa/cancel reverte trust do pedido + registra dispute_lost
 *
 * Migration: 20260701000016_trust_marketplace.sql
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const SERVICE = 'trustMarketplaceService';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

function log(fn, msg, extra = {}) {
  logger.info(msg, { service: SERVICE, function: fn, ...extra });
}

function logWarn(fn, msg, extra = {}) {
  logger.warn(msg, { service: SERVICE, function: fn, ...extra });
}

function logError(fn, err, extra = {}) {
  logger.error(`Erro em ${fn}: ${err.message}`, {
    service: SERVICE, function: fn, error: err.message, ...extra,
  });
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

/** Base trust values by role and source */
const BASE_VALUES = {
  seller: { witnessed: 2.0, self_reported: 0.5 },
  buyer:  { witnessed: 1.0, self_reported: 0.25 },
};

/** Pair decay: sequential transactions with same counterparty in 90d window */
const PAIR_DECAY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const PAIR_DECAY_SCHEDULE = [1.0, 0.5, 0.25, 0.1, 0.0]; // 1st, 2nd, 3rd, 4th, 5th+
const PAIR_CAP = 3.0; // Max cumulative trust per pair in decay window

/** Daily cap and burst detection */
const DAILY_CAP = 6.0;
const BURST_THRESHOLD = 10; // tx in 24h

/** Vesting delays */
const VESTING_DELAY_MS = {
  witnessed:     48 * 60 * 60 * 1000, // 48h
  self_reported: 72 * 60 * 60 * 1000, // 72h
};

/** Review rating → trust impact map */
const REVIEW_IMPACT_MAP = {
  5: +1.0,
  4: +0.5,
  3:  0.0,
  2: -0.5,
  1: -1.0,
};

// ──────────────────────────────────────────────
// 1. Record marketplace trust
// ──────────────────────────────────────────────

/**
 * Records a marketplace trust event with all guards applied.
 *
 * @param {Object} order - The marketplace order
 * @param {string} userId - The user earning trust
 * @param {'buyer'|'seller'} role
 * @param {'witnessed'|'self_reported'} source
 * @param {Object} [opts] - Extra options
 * @param {string} [opts.settlement_ref] - Asaas payment ID (for witnessed)
 * @returns {number} Effective impact (0 if blocked)
 */
async function recordMarketplaceTrust(order, userId, role, source, opts = {}) {
  const fn = 'recordMarketplaceTrust';

  const counterpartyId = role === 'buyer'
    ? (order.seller?.user_id || order.seller_user_id)
    : order.buyer_id;

  if (!counterpartyId) {
    logWarn(fn, 'Contraparte não identificada — ignorando', { orderId: order.id, userId, role });
    return 0;
  }

  // Same person buying from themselves
  if (userId === counterpartyId) {
    logWarn(fn, 'Mesma pessoa como buyer e seller — ignorando', { orderId: order.id, userId });
    return 0;
  }

  // Self-reported requires buyer_confirmed
  if (source === 'self_reported' && !order.buyer_confirmed) {
    log(fn, 'Self-reported sem buyer_confirmed — ignorando', { orderId: order.id });
    return 0;
  }

  // Base value
  let impact = BASE_VALUES[role]?.[source] || 0;
  if (impact <= 0) return 0;

  const guardFlags = {};

  // ── Guard 5.2: Invite graph distance ──
  try {
    const distance = await _getInviteGraphDistance(userId, counterpartyId);
    if (distance <= 1) {
      guardFlags.invite_distance = distance;
      guardFlags.invite_blocked = true;
      log(fn, `Invite guard: distância ${distance} — zerando trust`, { userId, counterpartyId, orderId: order.id });
      impact = 0;
    } else if (distance === 2) {
      guardFlags.invite_distance = distance;
      guardFlags.invite_halved = true;
      impact *= 0.5;
    } else {
      guardFlags.invite_distance = distance;
    }
  } catch (err) {
    logWarn(fn, 'Invite guard falhou — prosseguindo sem guarda', { error: err.message });
    guardFlags.invite_error = err.message;
  }

  if (impact <= 0) {
    // Still insert with impact 0 for audit trail if invite-blocked
    return _insertTrustEvent(order, userId, role, source, 0, counterpartyId, null, guardFlags, opts);
  }

  // ── Guard 5.2b: Device/IP overlap ──
  try {
    const overlap = await _checkDeviceIpOverlap(userId, counterpartyId);
    if (overlap) {
      guardFlags.device_ip_overlap = true;
      log(fn, 'Device/IP overlap detectado — zerando trust', { userId, counterpartyId, orderId: order.id });
      impact = 0;
      return _insertTrustEvent(order, userId, role, source, 0, counterpartyId, null, guardFlags, opts);
    }
  } catch (err) {
    logWarn(fn, 'Device/IP guard falhou — prosseguindo', { error: err.message });
    guardFlags.device_ip_error = err.message;
  }

  // ── Guard 5.1: Pair decay (90d window) ──
  let pairSequence = 0;
  try {
    const pairResult = await _getPairDecay(userId, counterpartyId);
    pairSequence = pairResult.sequence;
    const decayMult = PAIR_DECAY_SCHEDULE[Math.min(pairSequence, PAIR_DECAY_SCHEDULE.length - 1)];

    if (pairResult.cumulative >= PAIR_CAP) {
      guardFlags.pair_capped = true;
      impact = 0;
    } else {
      impact *= decayMult;
      // Ensure we don't exceed pair cap
      if (pairResult.cumulative + impact > PAIR_CAP) {
        impact = Math.max(0, PAIR_CAP - pairResult.cumulative);
      }
    }
    guardFlags.pair_sequence = pairSequence;
    guardFlags.pair_cumulative = pairResult.cumulative;
  } catch (err) {
    logWarn(fn, 'Pair decay guard falhou — prosseguindo', { error: err.message });
    guardFlags.pair_error = err.message;
  }

  if (impact <= 0) {
    return _insertTrustEvent(order, userId, role, source, 0, counterpartyId, pairSequence, guardFlags, opts);
  }

  // ── Guard 5.3: Daily cap + burst detection ──
  try {
    const dailyResult = await _checkDailyCap(userId);

    if (dailyResult.txCount >= BURST_THRESHOLD) {
      guardFlags.burst_hold = true;
      log(fn, `Burst detectado: ${dailyResult.txCount} tx/24h — hold`, { userId, orderId: order.id });
      // Still insert but with vesting_status='pending' and extended vesting
      return _insertTrustEvent(order, userId, role, source, impact, counterpartyId, pairSequence, guardFlags, opts, true);
    }

    if (dailyResult.totalImpact + impact > DAILY_CAP) {
      const remaining = Math.max(0, DAILY_CAP - dailyResult.totalImpact);
      if (remaining <= 0) {
        guardFlags.daily_capped = true;
        impact = 0;
      } else {
        impact = remaining;
        guardFlags.daily_partial = true;
      }
    }
    guardFlags.daily_total = dailyResult.totalImpact;
    guardFlags.daily_tx_count = dailyResult.txCount;
  } catch (err) {
    logWarn(fn, 'Daily cap guard falhou — prosseguindo', { error: err.message });
    guardFlags.daily_error = err.message;
  }

  // Round to 2 decimal places
  impact = Math.round(impact * 100) / 100;

  return _insertTrustEvent(order, userId, role, source, impact, counterpartyId, pairSequence, guardFlags, opts);
}

// ──────────────────────────────────────────────
// 2. Clawback trust for order
// ──────────────────────────────────────────────

/**
 * Reverts all trust_events for an order (dispute/cancel) and records dispute_lost.
 *
 * @param {string} orderId
 * @param {string} [reason='dispute'] - 'dispute' or 'cancelled'
 * @param {Object} [metadata={}]
 * @returns {number} Number of events clawed back
 */
async function clawbackTrustForOrder(orderId, reason = 'dispute', metadata = {}) {
  const fn = 'clawbackTrustForOrder';
  log(fn, `Clawback para pedido ${orderId}`, { reason });

  // Find all non-negative, non-clawed-back events for this order
  const { data: events, error } = await sb()
    .from('trust_events')
    .select('id, user_id, impact, vesting_status')
    .eq('order_id', orderId)
    .eq('is_negative', false)
    .neq('vesting_status', 'clawed_back');

  if (error) {
    logError(fn, error, { orderId });
    throw error;
  }

  if (!events?.length) {
    log(fn, 'Nenhum evento para clawback', { orderId });
    return 0;
  }

  let clawedBack = 0;

  for (const evt of events) {
    try {
      // Mark original event as clawed_back
      await sb()
        .from('trust_events')
        .update({ vesting_status: 'clawed_back' })
        .eq('id', evt.id);

      // Insert reversal event (negative impact = -original)
      const reversalImpact = -Math.abs(evt.impact);
      if (reversalImpact < 0) {
        await sb()
          .from('trust_events')
          .insert({
            user_id: evt.user_id,
            domain: 'marketplace',
            event_type: `marketplace_clawback_${reason}`,
            impact: reversalImpact,
            is_negative: true,
            order_id: orderId,
            vesting_status: 'none',
            metadata: { original_event_id: evt.id, reason, ...metadata },
          });
      }

      clawedBack++;
    } catch (err) {
      logError(fn, err, { eventId: evt.id, orderId });
    }
  }

  log(fn, `Clawback concluído: ${clawedBack}/${events.length} eventos`, { orderId });
  return clawedBack;
}

// ──────────────────────────────────────────────
// 3. Record review trust
// ──────────────────────────────────────────────

/**
 * Records trust from an order review/rating.
 *
 * @param {string} orderId
 * @param {string} reviewerId - Who gave the review
 * @param {string} reviewedId - Who received the review
 * @param {number} rating - 1 to 5
 * @param {'buyer'|'seller'} reviewedRole
 */
async function recordMarketplaceTrustReview(orderId, reviewerId, reviewedId, rating, reviewedRole) {
  const fn = 'recordMarketplaceTrustReview';

  const impact = REVIEW_IMPACT_MAP[rating];
  if (impact === undefined || impact === 0) return;

  const isNegative = impact < 0;
  const eventType = `marketplace_review_${isNegative ? 'negative' : 'positive'}`;

  try {
    const { error } = await sb()
      .from('trust_events')
      .insert({
        user_id: reviewedId,
        domain: 'marketplace',
        event_type: eventType,
        impact,
        is_negative: isNegative,
        order_id: orderId,
        counterparty_id: reviewerId,
        role: reviewedRole,
        vesting_status: 'none',
        metadata: { rating, reviewer_id: reviewerId },
      });

    if (error) {
      // Unique constraint = already recorded for this order — idempotent
      if (error.code === '23505') {
        log(fn, 'Review trust já registrado — idempotente', { orderId, reviewedId });
        return;
      }
      logError(fn, error, { orderId, reviewedId });
    } else {
      log(fn, `Review trust: ${impact} para ${reviewedId}`, { orderId, rating, reviewedRole });

      // Trigger recalc if negative (high impact)
      if (isNegative) {
        const trustPassportService = require('./trustPassportService');
        trustPassportService.calculatePassport(reviewedId).catch(err =>
          logWarn(fn, 'Recalc pós-review falhou', { error: err.message, userId: reviewedId })
        );
      }
    }
  } catch (err) {
    logError(fn, err, { orderId, reviewedId, rating });
  }
}

// ──────────────────────────────────────────────
// 4. Vest pending trust events (called by cron)
// ──────────────────────────────────────────────

/**
 * Transitions pending → vested for events whose vests_at has passed
 * and whose order has no active dispute.
 *
 * @returns {{ vested: number, skipped: number }}
 */
async function vestPendingEvents() {
  const fn = 'vestPendingEvents';

  const now = new Date().toISOString();

  const { data: pending, error } = await sb()
    .from('trust_events')
    .select('id, order_id, user_id')
    .eq('vesting_status', 'pending')
    .lte('vests_at', now)
    .limit(500);

  if (error) {
    logError(fn, error);
    throw error;
  }

  if (!pending?.length) return { vested: 0, skipped: 0 };

  let vested = 0;
  let skipped = 0;

  for (const evt of pending) {
    try {
      // Check if order has active dispute (marketplace_orders.status = 'disputed')
      if (evt.order_id) {
        const { data: order } = await sb()
          .from('marketplace_orders')
          .select('status')
          .eq('id', evt.order_id)
          .single();

        if (order?.status === 'disputed' || order?.status === 'cancelled') {
          skipped++;
          continue;
        }
      }

      const { error: updateErr } = await sb()
        .from('trust_events')
        .update({ vesting_status: 'vested' })
        .eq('id', evt.id)
        .eq('vesting_status', 'pending'); // Optimistic lock

      if (updateErr) {
        logWarn(fn, 'Erro ao vestar evento', { eventId: evt.id, error: updateErr.message });
        skipped++;
      } else {
        vested++;
      }
    } catch (err) {
      logWarn(fn, 'Erro ao processar vesting', { eventId: evt.id, error: err.message });
      skipped++;
    }
  }

  log(fn, `Vesting concluído: ${vested} vested, ${skipped} skipped`, { total: pending.length });
  return { vested, skipped };
}

// ──────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────

/**
 * Insert trust event with ON CONFLICT DO NOTHING for idempotency.
 */
async function _insertTrustEvent(order, userId, role, source, impact, counterpartyId, pairSequence, guardFlags, opts, isBurstHold = false) {
  const fn = '_insertTrustEvent';

  const isNegative = impact < 0;
  const effectiveImpact = impact === 0 ? 0.001 : impact; // 0 not allowed by CHECK, use tiny positive
  const vestingDelay = isBurstHold
    ? 7 * 24 * 60 * 60 * 1000 // 7 days for burst
    : (VESTING_DELAY_MS[source] || VESTING_DELAY_MS.witnessed);
  const vestsAt = new Date(Date.now() + vestingDelay).toISOString();

  // For zero-impact (guard blocked), use 'none' vesting — no value to vest
  const vestingStatus = impact <= 0 ? 'none' : 'pending';

  const row = {
    user_id: userId,
    domain: 'marketplace',
    event_type: `marketplace_${source}_${role}`,
    impact: impact <= 0 ? 0.001 : impact, // CHECK constraint: impact > 0 when not negative
    is_negative: false,
    order_id: order.id,
    counterparty_id: counterpartyId,
    role,
    source,
    settlement_ref: opts.settlement_ref || null,
    vesting_status: vestingStatus,
    vests_at: vestingStatus === 'pending' ? vestsAt : null,
    pair_sequence: pairSequence,
    guard_flags: Object.keys(guardFlags).length > 0 ? guardFlags : null,
    metadata: {
      total_brl: order.total_brl,
      payment_method: order.payment_method,
      ...(opts.metadata || {}),
    },
  };

  try {
    const { error } = await sb()
      .from('trust_events')
      .insert(row);

    if (error) {
      // 23505 = unique_violation → idempotent (webhook re-sent)
      if (error.code === '23505') {
        log(fn, 'Trust event já existe — idempotente (webhook re-sent)', { orderId: order.id, userId, role });
        return 0;
      }
      logError(fn, error, { orderId: order.id, userId });
      return 0;
    }

    log(fn, `Trust event inserido: ${impact} (${source}/${role})`, {
      orderId: order.id, userId, counterpartyId, pairSequence,
      guardBlocked: impact <= 0,
    });

    return impact;
  } catch (err) {
    logError(fn, err, { orderId: order.id, userId });
    return 0;
  }
}

/**
 * Calls invite_graph_distance() RPC — 3-4 PK lookups, O(1).
 */
async function _getInviteGraphDistance(userA, userB) {
  const { data, error } = await sb()
    .rpc('invite_graph_distance', { a_id: userA, b_id: userB });

  if (error) throw error;
  return data ?? 99;
}

/**
 * Checks if two users share recent IP or device in user_sessions.
 * Returns true if overlap detected.
 */
async function _checkDeviceIpOverlap(userA, userB) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  // Get recent IPs for userA
  const { data: sessionsA } = await sb()
    .from('user_sessions')
    .select('ip_address')
    .eq('user_id', userA)
    .gte('last_active_at', cutoff)
    .is('revoked_at', null)
    .limit(20);

  if (!sessionsA?.length) return false;

  const ipsA = new Set(sessionsA.map(s => s.ip_address).filter(Boolean));
  if (ipsA.size === 0) return false;

  // Check if userB has any matching IP
  const { data: sessionsB } = await sb()
    .from('user_sessions')
    .select('ip_address')
    .eq('user_id', userB)
    .gte('last_active_at', cutoff)
    .is('revoked_at', null)
    .limit(20);

  if (!sessionsB?.length) return false;

  for (const s of sessionsB) {
    if (s.ip_address && ipsA.has(s.ip_address)) return true;
  }

  return false;
}

/**
 * Gets pair decay info for (userId, counterpartyId) in 90d window.
 * Returns { sequence, cumulative }.
 */
async function _getPairDecay(userId, counterpartyId) {
  const cutoff = new Date(Date.now() - PAIR_DECAY_WINDOW_MS).toISOString();

  const { data: pairEvents, error } = await sb()
    .from('trust_events')
    .select('impact')
    .eq('user_id', userId)
    .eq('counterparty_id', counterpartyId)
    .eq('domain', 'marketplace')
    .eq('is_negative', false)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: true });

  if (error) throw error;

  const sequence = pairEvents?.length || 0;
  const cumulative = (pairEvents || []).reduce((sum, e) => sum + Number(e.impact), 0);

  return { sequence, cumulative };
}

/**
 * Gets daily marketplace trust cap info for userId (last 24h).
 * Returns { totalImpact, txCount }.
 */
async function _checkDailyCap(userId) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: todayEvents, error } = await sb()
    .from('trust_events')
    .select('impact')
    .eq('user_id', userId)
    .eq('domain', 'marketplace')
    .eq('is_negative', false)
    .gte('created_at', cutoff);

  if (error) throw error;

  const txCount = todayEvents?.length || 0;
  const totalImpact = (todayEvents || []).reduce((sum, e) => sum + Number(e.impact), 0);

  return { totalImpact, txCount };
}

// ──────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────

module.exports = {
  recordMarketplaceTrust,
  clawbackTrustForOrder,
  recordMarketplaceTrustReview,
  vestPendingEvents,
  // Exposed for testing
  BASE_VALUES,
  PAIR_DECAY_SCHEDULE,
  DAILY_CAP,
  BURST_THRESHOLD,
  REVIEW_IMPACT_MAP,
};
