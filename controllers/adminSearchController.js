'use strict';

/**
 * @fileoverview Admin Unified Search Controller (ADM-002b)
 * Single endpoint that queries users, sellers, orders, and tickets in parallel.
 */

const Joi = require('joi');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const TAG = 'AdminSearchController';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponivel');
  return client;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Unified Search ──────────────────────────────────────────────

/**
 * GET /api/admin/search?q=term&limit=5
 * Busca cross-domain: users, sellers, orders, tickets.
 */
exports.unifiedSearch = async (req, res) => {
  const schema = Joi.object({
    q: Joi.string().min(3).max(200).required(),
    limit: Joi.number().integer().min(1).max(20).default(5),
  });

  const { error, value } = schema.validate(req.query);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const { q, limit } = value;
  const term = q.trim();
  const isUuid = UUID_RE.test(term);
  const likeTerm = `%${term}%`;

  // Run 4 queries in parallel — each catches errors individually
  const [usersResult, sellersResult, ordersResult, ticketsResult] = await Promise.all([
    // 1. Users
    (async () => {
      try {
        let query;
        if (isUuid) {
          query = sb()
            .from('users')
            .select('id, full_name, email, avatar_url, is_suspended')
            .eq('id', term);
        } else {
          query = sb()
            .from('users')
            .select('id, full_name, email, avatar_url, is_suspended')
            .or(`full_name.ilike.${likeTerm},email.ilike.${likeTerm},username.ilike.${likeTerm}`);
        }
        const { data, error: dbErr } = await query.limit(limit);
        if (dbErr) throw dbErr;
        return data || [];
      } catch (err) {
        logger.warn(`[${TAG}] users search failed`, { error: err.message });
        return [];
      }
    })(),

    // 2. Sellers
    (async () => {
      try {
        let query;
        if (isUuid) {
          query = sb()
            .from('seller_profiles')
            .select('id, business_name, trading_name, username, status, category')
            .eq('id', term)
            .neq('status', 'deleted');
        } else {
          query = sb()
            .from('seller_profiles')
            .select('id, business_name, trading_name, username, status, category')
            .neq('status', 'deleted')
            .or(`business_name.ilike.${likeTerm},trading_name.ilike.${likeTerm},username.ilike.${likeTerm}`);
        }
        const { data, error: dbErr } = await query.limit(limit);
        if (dbErr) throw dbErr;
        return data || [];
      } catch (err) {
        logger.warn(`[${TAG}] sellers search failed`, { error: err.message });
        return [];
      }
    })(),

    // 3. Orders (UUID exact match only)
    (async () => {
      try {
        if (!isUuid) return [];
        const { data, error: dbErr } = await sb()
          .from('marketplace_orders')
          .select('id, status, total_amount, created_at, buyer_id, seller_id')
          .eq('id', term)
          .limit(limit);
        if (dbErr) throw dbErr;
        return data || [];
      } catch (err) {
        logger.warn(`[${TAG}] orders search failed`, { error: err.message });
        return [];
      }
    })(),

    // 4. Tickets
    (async () => {
      try {
        let query;
        if (isUuid) {
          query = sb()
            .from('support_tickets')
            .select('id, subject, status, priority, created_at, user_id')
            .eq('id', term);
        } else {
          query = sb()
            .from('support_tickets')
            .select('id, subject, status, priority, created_at, user_id')
            .ilike('subject', likeTerm);
        }
        const { data, error: dbErr } = await query.limit(limit);
        if (dbErr) throw dbErr;
        return data || [];
      } catch (err) {
        logger.warn(`[${TAG}] tickets search failed`, { error: err.message });
        return [];
      }
    })(),
  ]);

  logger.info(`[${TAG}] Admin ${req.user.uid} unified search q="${term}" — u:${usersResult.length} s:${sellersResult.length} o:${ordersResult.length} t:${ticketsResult.length}`);

  res.json({
    users: usersResult,
    sellers: sellersResult,
    orders: ordersResult,
    tickets: ticketsResult,
    query: term,
  });
};
