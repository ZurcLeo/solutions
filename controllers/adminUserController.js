'use strict';

/**
 * @fileoverview Admin User Controller
 * Busca e detalhe de usuários para o painel admin.
 */

const Joi = require('joi');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const TAG = 'AdminUserController';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

const USER_SEARCH_COLS = 'id, full_name, username, email, telefone, avatar_url, kyc_status, tipo_de_conta, is_suspended, visibility_multiplier, created_at, trust_passports(trust_level)';

// ── Search Users ────────────────────────────────────────────

/**
 * GET /api/admin/users/search?q=term&page=1&limit=20
 * Busca admin com campos expandidos. Query com ilike em full_name, username, email + match exato em id.
 */
exports.searchUsers = async (req, res) => {
  const schema = Joi.object({
    q: Joi.string().min(2).max(200).required(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(20),
  });

  const { error, value } = schema.validate(req.query);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const { q, page, limit } = value;
  const offset = (page - 1) * limit;
  const term = q.trim();

  try {
    // Check if term looks like an exact ID (UUID or Firebase UID — alphanumeric 20-36 chars, no spaces)
    const isExactId = /^[A-Za-z0-9_-]{20,36}$/.test(term) && !term.includes(' ');

    let query;
    if (isExactId) {
      // Try exact ID match first, falling back to ILIKE
      const likeTerm = `%${term}%`;
      query = sb()
        .from('users')
        .select(USER_SEARCH_COLS, { count: 'exact' })
        .or(`id.eq.${term},full_name.ilike.${likeTerm},username.ilike.${likeTerm},email.ilike.${likeTerm}`);
    } else {
      const likeTerm = `%${term}%`;
      query = sb()
        .from('users')
        .select(USER_SEARCH_COLS, { count: 'exact' })
        .or(`full_name.ilike.${likeTerm},username.ilike.${likeTerm},email.ilike.${likeTerm}`);
    }

    const { data, error: dbErr, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (dbErr) throw dbErr;

    // Flatten trust_passports FK join → trust_level
    const normalized = (data || []).map(({ trust_passports, ...rest }) => ({
      ...rest,
      trust_level: trust_passports?.trust_level ?? null,
    }));

    logger.info(`[${TAG}] Admin ${req.user.uid} searched users q="${term}" — ${count} results`);

    res.json({
      success: true,
      data: normalized,
      pagination: { page, limit, total: count || 0 },
    });
  } catch (err) {
    logger.error(`[${TAG}] searchUsers error`, { error: err.message });
    res.status(500).json({ error: err.message });
  }
};

// ── User Detail ─────────────────────────────────────────────

/**
 * GET /api/admin/users/:userId/detail
 * Agregado: user, seller_profiles, suspensão ativa, contadores de comunicação 24h,
 * billing (subscriptions, addons, plano ativo).
 */
exports.getUserDetail = async (req, res) => {
  const { userId } = req.params;

  if (!userId) return res.status(400).json({ error: 'userId é obrigatório' });

  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      userRes, sellersRes, suspensionRes,
      notifCountRes, emailCountRes, otpCountRes,
      activeOrdersRes, activeCaixinhasRes, sellerProfilesRes, pendingLoansRes,
      // ADM-S01: Billing
      subscriptionsRes, addonsRes, plansRes,
    ] = await Promise.all([
      sb().from('users').select('*').eq('id', userId).maybeSingle(),
      sb().from('seller_profiles').select('id, business_name, business_type, is_active, is_suspended, created_at, plan_slug, commission_rate').eq('user_id', userId),
      sb().from('user_suspensions').select('id, reason, status, duration_days, expires_at, created_at').eq('user_id', userId).eq('status', 'active').maybeSingle(),
      sb().from('notification_jobs').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', since24h),
      sb().from('email_logs').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', since24h),
      sb().from('security_tickets').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', since24h),
      // Impact preview counts (ADM-006)
      sb().from('marketplace_orders').select('id', { count: 'exact', head: true }).eq('buyer_id', userId).in('status', ['pending', 'awaiting_payment', 'paid', 'preparing', 'ready', 'in_transit']).is('deleted_at', null),
      sb().from('caixinha_members').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'active'),
      sb().from('seller_profiles').select('id', { count: 'exact', head: true }).eq('user_id', userId).neq('status', 'deleted'),
      sb().from('loans').select('id', { count: 'exact', head: true }).eq('borrower_id', userId).in('status', ['active', 'approved', 'pending']),
      // ADM-S01: Billing queries — user_subscriptions has user_id, seller_addons has seller_user_id
      sb().from('user_subscriptions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(5),
      sb().from('seller_addons').select('*').eq('seller_user_id', userId).order('created_at', { ascending: false }),
      sb().from('subscription_plans').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
    ]);

    if (userRes.error) throw userRes.error;
    if (!userRes.data) return res.status(404).json({ error: 'Usuário não encontrado' });

    // ── ADM-S01: Build billing object ──────────────────────────
    const plans = plansRes.data || [];
    const plansBySlug = {};
    for (const p of plans) plansBySlug[p.slug] = p;

    const subscriptions = (subscriptionsRes.data || []).map((sub) => ({
      ...sub,
      plan_detail: sub.plan_slug ? plansBySlug[sub.plan_slug] || null : null,
    }));

    const activeSub = subscriptions.find((s) => s.status === 'active') || null;

    const billing = {
      subscriptions,
      addons: addonsRes.data || [],
      activePlan: activeSub
        ? {
            subscription_id: activeSub.id,
            plan_slug: activeSub.plan_slug,
            plan_name: activeSub.plan_detail?.name || activeSub.plan_slug || activeSub.plan,
            billing_mode: activeSub.billing_mode,
            billing_cycle: activeSub.billing_cycle,
            status: activeSub.status,
            monthly_price_brl: activeSub.plan_detail?.monthly_price_brl ?? null,
            annual_price_brl: activeSub.plan_detail?.annual_price_brl ?? null,
            commission_rate: activeSub.plan_detail?.commission_rate ?? null,
            current_period_start: activeSub.current_period_start,
            current_period_end: activeSub.current_period_end,
            subscribed_at: activeSub.subscribed_at,
            tier: activeSub.plan_detail?.tier ?? activeSub.tier_at_creation,
          }
        : null,
    };

    logger.info(`[${TAG}] Admin ${req.user.uid} viewed user detail ${userId}`);

    res.json({
      success: true,
      user: userRes.data,
      sellerProfiles: sellersRes.data || [],
      activeSuspension: suspensionRes.data || null,
      comms24h: {
        notifications: notifCountRes.count || 0,
        emails: emailCountRes.count || 0,
        otps: otpCountRes.count || 0,
      },
      impact: {
        activeOrders: activeOrdersRes.count || 0,
        activeCaixinhas: activeCaixinhasRes.count || 0,
        sellerProfiles: sellerProfilesRes.count || 0,
        pendingLoans: pendingLoansRes.count || 0,
      },
      billing,
    });
  } catch (err) {
    logger.error(`[${TAG}] getUserDetail error`, { error: err.message, userId });
    res.status(500).json({ error: err.message });
  }
};
