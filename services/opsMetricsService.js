'use strict';

/**
 * opsMetricsService.js — OPS-003: Business metrics aggregation.
 *
 * Live metrics, daily snapshots (cron), seller health score.
 */

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const TAG = 'opsMetricsService';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase indisponivel');
  return client;
}

// ── Live Metrics ────────────────────────────────────────────────────────────

async function computeLiveMetrics(periodDays = 30) {
  const since = new Date();
  since.setDate(since.getDate() - periodDays);
  const sinceISO = since.toISOString();
  const today = new Date().toISOString().split('T')[0];
  const todayStart = `${today}T00:00:00.000Z`;

  const results = {};

  // GMV — sum of completed orders
  try {
    const { data } = await sb()
      .from('marketplace_orders')
      .select('total_brl')
      .eq('status', 'completed')
      .gte('created_at', sinceISO);
    results.gmv_brl = (data || []).reduce((sum, r) => sum + (parseFloat(r.total_brl) || 0), 0);
  } catch (_) { results.gmv_brl = 0; }

  // MRR — active subscriptions
  try {
    const { data } = await sb()
      .from('user_subscriptions')
      .select('subscription_plans(monthly_price_brl)')
      .eq('status', 'active');
    results.mrr_brl = (data || []).reduce((sum, r) => {
      const price = parseFloat(r.subscription_plans?.monthly_price_brl) || 0;
      return sum + price;
    }, 0);

    // Add active add-ons
    const { data: addons } = await sb()
      .from('seller_addons')
      .select('monthly_price_brl')
      .eq('status', 'active');
    results.mrr_brl += (addons || []).reduce((sum, a) => sum + (parseFloat(a.monthly_price_brl) || 0), 0);
  } catch (_) { results.mrr_brl = 0; }

  // Commission
  try {
    const { data } = await sb()
      .from('billing_events')
      .select('commission_brl')
      .gte('created_at', sinceISO);
    results.commission_brl = (data || []).reduce((sum, r) => sum + (parseFloat(r.commission_brl) || 0), 0);
  } catch (_) { results.commission_brl = 0; }

  // Sellers
  try {
    const { count: active } = await sb()
      .from('seller_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active');
    results.active_sellers = active || 0;

    const { count: total } = await sb()
      .from('seller_profiles')
      .select('id', { count: 'exact', head: true });
    results.total_sellers = total || 0;

    const { count: newToday } = await sb()
      .from('seller_profiles')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', todayStart);
    results.new_sellers_today = newToday || 0;
  } catch (_) {
    results.active_sellers = 0;
    results.total_sellers = 0;
    results.new_sellers_today = 0;
  }

  // Users
  try {
    const { count: totalUsers } = await sb()
      .from('users')
      .select('id', { count: 'exact', head: true });
    results.total_users = totalUsers || 0;

    const { count: newUsers } = await sb()
      .from('users')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', todayStart);
    results.new_users_today = newUsers || 0;
  } catch (_) {
    results.total_users = 0;
    results.new_users_today = 0;
  }

  // Support tickets
  try {
    const { count: open } = await sb()
      .from('support_tickets')
      .select('id', { count: 'exact', head: true })
      .in('status', ['open', 'in_progress']);
    results.open_tickets = open || 0;

    const { count: breached } = await sb()
      .from('support_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('sla_breached', true)
      .in('status', ['open', 'in_progress']);
    results.sla_breached = breached || 0;
  } catch (_) {
    results.open_tickets = 0;
    results.sla_breached = 0;
  }

  // CSAT
  try {
    const { data } = await sb()
      .from('support_tickets')
      .select('csat_score')
      .not('csat_score', 'is', null)
      .eq('status', 'resolved')
      .gte('updated_at', sinceISO);
    if (data && data.length > 0) {
      const sum = data.reduce((s, r) => s + (r.csat_score || 0), 0);
      results.avg_csat = parseFloat((sum / data.length).toFixed(1));
    } else {
      results.avg_csat = null;
    }
  } catch (_) { results.avg_csat = null; }

  // Churn rate (30d)
  try {
    const { count: cancelled } = await sb()
      .from('user_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'cancelled')
      .gte('updated_at', sinceISO);
    const { count: totalSubs } = await sb()
      .from('user_subscriptions')
      .select('id', { count: 'exact', head: true })
      .in('status', ['active', 'cancelled']);
    results.churn_rate = totalSubs > 0
      ? parseFloat(((cancelled / totalSubs) * 100).toFixed(2))
      : 0;
  } catch (_) { results.churn_rate = 0; }

  // Kanban tasks
  try {
    const { count: pending } = await sb()
      .from('ops_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('is_archived', false);
    results.tasks_pending = pending || 0;

    const { count: overdue } = await sb()
      .from('ops_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('is_archived', false)
      .lt('due_date', today);
    results.tasks_overdue = overdue || 0;
  } catch (_) {
    results.tasks_pending = 0;
    results.tasks_overdue = 0;
  }

  return results;
}

// ── Health Score ─────────────────────────────────────────────────────────────

async function computeHealthScore(sellerId) {
  let score = 50; // baseline

  try {
    // Order volume (last 30d) — up to +20
    const since30 = new Date();
    since30.setDate(since30.getDate() - 30);
    const { count: orderCount } = await sb()
      .from('marketplace_orders')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', sellerId)
      .eq('status', 'completed')
      .gte('created_at', since30.toISOString());
    score += Math.min(20, (orderCount || 0) * 2);

    // Revenue trend — check if recent GMV > 0
    const { data: orders } = await sb()
      .from('marketplace_orders')
      .select('total_brl')
      .eq('seller_id', sellerId)
      .eq('status', 'completed')
      .gte('created_at', since30.toISOString());
    const recentGMV = (orders || []).reduce((s, o) => s + (parseFloat(o.total_brl) || 0), 0);
    if (recentGMV > 0) score += 10;

    // Open tickets (inverse) — -5 per open ticket, max -15
    const { count: tickets } = await sb()
      .from('support_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', sellerId)
      .in('status', ['open', 'in_progress']);
    score -= Math.min(15, (tickets || 0) * 5);

    // Active integrations — +5 each, max +10
    const { count: integrations } = await sb()
      .from('seller_external_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', sellerId)
      .eq('status', 'active');
    score += Math.min(10, (integrations || 0) * 5);

    // Subscription tier — +5 for paid plan
    const { data: seller } = await sb()
      .from('seller_profiles')
      .select('plan_slug')
      .eq('id', sellerId)
      .single();
    if (seller?.plan_slug && seller.plan_slug !== 'free') score += 5;

  } catch (err) {
    logger.warn(`[${TAG}] computeHealthScore error`, { sellerId, error: err.message });
  }

  return Math.max(0, Math.min(100, score));
}

// ── Daily Snapshot ──────────────────────────────────────────────────────────

async function snapshotDaily() {
  const today = new Date().toISOString().split('T')[0];
  const metrics = await computeLiveMetrics(30);

  const { data, error } = await sb()
    .from('ops_metrics_snapshots')
    .upsert({
      snapshot_date: today,
      ...metrics,
    }, { onConflict: 'snapshot_date' })
    .select()
    .single();

  if (error) {
    logger.error(`[${TAG}] snapshotDaily failed`, { error: error.message });
    throw error;
  }

  logger.info(`[${TAG}] Daily snapshot saved`, { date: today });
  return data;
}

// ── History ─────────────────────────────────────────────────────────────────

async function getSnapshotHistory(days = 30) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await sb()
    .from('ops_metrics_snapshots')
    .select('*')
    .gte('snapshot_date', since.toISOString().split('T')[0])
    .order('snapshot_date', { ascending: true });
  if (error) throw error;
  return data;
}

// ── Seller Metrics ──────────────────────────────────────────────────────────

async function getSellerMetrics(sellerId) {
  const healthScore = await computeHealthScore(sellerId);

  // LTV — total GMV all time
  let ltv = 0;
  let totalOrders = 0;
  let gmv30d = 0;
  try {
    const { data: allOrders } = await sb()
      .from('marketplace_orders')
      .select('total_brl, created_at')
      .eq('seller_id', sellerId)
      .eq('status', 'completed');

    totalOrders = (allOrders || []).length;
    ltv = (allOrders || []).reduce((s, o) => s + (parseFloat(o.total_brl) || 0), 0);

    const since30 = new Date();
    since30.setDate(since30.getDate() - 30);
    gmv30d = (allOrders || [])
      .filter(o => new Date(o.created_at) >= since30)
      .reduce((s, o) => s + (parseFloat(o.total_brl) || 0), 0);
  } catch (_) { /* fallback 0 */ }

  // Seller info
  let seller = null;
  try {
    const { data } = await sb()
      .from('seller_profiles')
      .select('id, business_name, plan_slug, status, created_at')
      .eq('id', sellerId)
      .single();
    seller = data;
  } catch (_) { /* ok */ }

  // Integrations
  let integrations = [];
  try {
    const { data } = await sb()
      .from('seller_external_accounts')
      .select('platform, status')
      .eq('seller_id', sellerId);
    integrations = data || [];
  } catch (_) { /* ok */ }

  // Related tasks
  let tasks = [];
  try {
    const { data } = await sb()
      .from('ops_tasks')
      .select('id, title, stage_id, priority, due_date, is_archived')
      .eq('seller_id', sellerId)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
      .limit(10);
    tasks = data || [];
  } catch (_) { /* ok */ }

  return {
    seller,
    health_score: healthScore,
    ltv,
    total_orders: totalOrders,
    gmv_30d: gmv30d,
    integrations,
    tasks,
  };
}

module.exports = {
  computeLiveMetrics,
  computeHealthScore,
  snapshotDaily,
  getSnapshotHistory,
  getSellerMetrics,
};
