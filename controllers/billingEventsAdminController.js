'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');
const Joi = require('joi');

const CTRL = 'billingEventsAdminController';
const sb = () => getSupabaseClient();

// ── Billing mode labels (for frontend display) ──────────────────────────────
const BILLING_MODES = [
  'monthly_covered',
  'commission',
  'percentage_tier',
  'exemption_covered',
  'commission_payment',
];

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/eventos-de-cobranca
// Lista paginada de billing_events com filtros opcionais
// ══════════════════════════════════════════════════════════════════════════════
exports.listBillingEvents = async (req, res) => {
  try {
    const schema = Joi.object({
      userId:    Joi.string().trim().max(100).optional(),
      sellerId:  Joi.string().trim().max(100).optional(),
      type:      Joi.string().valid(...BILLING_MODES).optional(),
      page:      Joi.number().integer().min(1).default(1),
      limit:     Joi.number().integer().min(1).max(100).default(20),
      startDate: Joi.string().isoDate().optional(),
      endDate:   Joi.string().isoDate().optional(),
    });

    const { error: valErr, value } = schema.validate(req.query);
    if (valErr) return res.status(400).json({ success: false, message: valErr.message });

    const { userId, sellerId, type, page, limit, startDate, endDate } = value;
    const offset = (page - 1) * limit;

    let query = sb()
      .from('billing_events')
      .select(
        'id, seller_user_id, order_id, billing_mode, commission_rate, commission_brl, subscription_id, sale_date, subscribed_at_date, plan_slug, exemption_id, delivery_request_id, created_at',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Filtros
    if (userId) query = query.eq('seller_user_id', userId);
    if (sellerId) {
      // sellerId pode ser o ID do seller_profiles — resolver para user_id
      const { data: sellerProfile } = await sb()
        .from('seller_profiles')
        .select('user_id')
        .eq('id', sellerId)
        .maybeSingle();

      if (sellerProfile) {
        query = query.eq('seller_user_id', sellerProfile.user_id);
      } else {
        // Se não encontrou seller_profiles, tenta como user_id direto
        query = query.eq('seller_user_id', sellerId);
      }
    }
    if (type) query = query.eq('billing_mode', type);
    if (startDate) query = query.gte('created_at', `${startDate}T00:00:00.000Z`);
    if (endDate) query = query.lte('created_at', `${endDate}T23:59:59.999Z`);

    const { data, count, error } = await query;
    if (error) throw error;

    // Enrich: buscar business_name dos sellers envolvidos
    if (data?.length) {
      const sellerUserIds = [...new Set(data.map(e => e.seller_user_id))];
      const { data: sellers } = await sb()
        .from('seller_profiles')
        .select('user_id, business_name, id')
        .in('user_id', sellerUserIds);

      const sellerMap = {};
      (sellers || []).forEach(s => {
        sellerMap[s.user_id] = { business_name: s.business_name, seller_id: s.id };
      });

      // Enrich: buscar display_name dos users
      const { data: users } = await sb()
        .from('users')
        .select('id, display_name, email')
        .in('id', sellerUserIds);

      const userMap = {};
      (users || []).forEach(u => {
        userMap[u.id] = { display_name: u.display_name, email: u.email };
      });

      data.forEach(evt => {
        evt.seller_info = sellerMap[evt.seller_user_id] || null;
        evt.user_info = userMap[evt.seller_user_id] || null;
      });
    }

    res.json({
      success: true,
      data,
      pagination: { page, limit, total: count },
    });
  } catch (err) {
    logger.error(`[${CTRL}] listBillingEvents: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/eventos-de-cobranca/summary
// Contadores agrupados por billing_mode nos ultimos N dias
// ══════════════════════════════════════════════════════════════════════════════
exports.getBillingEventsSummary = async (req, res) => {
  try {
    const schema = Joi.object({
      days: Joi.number().integer().min(1).max(365).default(7),
    });

    const { error: valErr, value } = schema.validate(req.query);
    if (valErr) return res.status(400).json({ success: false, message: valErr.message });

    const { days } = value;
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceISO = since.toISOString();

    // Buscar todos billing_events no periodo
    const { data, error } = await sb()
      .from('billing_events')
      .select('billing_mode, commission_brl, created_at')
      .gte('created_at', sinceISO);

    if (error) throw error;

    // Agrupar por billing_mode
    const byMode = {};
    let totalEvents = 0;
    let totalCommission = 0;

    (data || []).forEach(evt => {
      const mode = evt.billing_mode || 'unknown';
      if (!byMode[mode]) byMode[mode] = { count: 0, total_brl: 0 };
      byMode[mode].count += 1;
      byMode[mode].total_brl += parseFloat(evt.commission_brl) || 0;
      totalEvents += 1;
      totalCommission += parseFloat(evt.commission_brl) || 0;
    });

    // Eventos por dia (para sparkline)
    const dailyCounts = {};
    (data || []).forEach(evt => {
      const day = evt.created_at.slice(0, 10);
      dailyCounts[day] = (dailyCounts[day] || 0) + 1;
    });

    res.json({
      success: true,
      data: {
        days,
        total_events: totalEvents,
        total_commission_brl: Math.round(totalCommission * 100) / 100,
        by_mode: byMode,
        daily_counts: dailyCounts,
      },
    });
  } catch (err) {
    logger.error(`[${CTRL}] getBillingEventsSummary: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
};
