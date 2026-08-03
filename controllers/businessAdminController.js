'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');
const Joi = require('joi');

const CTRL = 'businessAdminController';
const sb = () => getSupabaseClient();

// ── Sellers ──────────────────────────────────────────────────────────────────

exports.listSellers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const offset = (Math.max(1, +page) - 1) * +limit;

    let query = sb()
      .from('seller_profiles')
      .select('id, user_id, business_name, category, status, plan_slug, commission_rate, document, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + +limit - 1);

    if (search) {
      query = query.ilike('business_name', `%${search}%`);
    }

    const { data, count, error } = await query;
    if (error) throw error;

    // Enrich with classification: Bronze (IconChat), Prata (ElosCloud plan), Ouro (ambos)
    if (data?.length) {
      const userIds = data.map(s => s.user_id);

      // Check active IconChat addons
      const { data: activeAddons } = await sb()
        .from('seller_addons')
        .select('seller_user_id')
        .in('seller_user_id', userIds)
        .eq('addon_slug', 'iconchat')
        .in('status', ['active', 'pending_deactivation']);

      const hasIconChat = new Set((activeAddons || []).map(a => a.seller_user_id));

      // Check active subscriptions (ElosCloud plan)
      const { data: activeSubs } = await sb()
        .from('user_subscriptions')
        .select('user_id')
        .in('user_id', userIds)
        .eq('status', 'active');

      const hasPlan = new Set((activeSubs || []).map(s => s.user_id));

      data.forEach(s => {
        const icon = hasIconChat.has(s.user_id);
        const plan = hasPlan.has(s.user_id);
        if (icon && plan) s.classification = 'ouro';
        else if (plan) s.classification = 'prata';
        else if (icon) s.classification = 'bronze';
        else s.classification = null;
      });
    }

    res.json({ success: true, data, pagination: { page: +page, limit: +limit, total: count } });
  } catch (err) {
    logger.error(`[${CTRL}] listSellers: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getSellerDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: seller, error } = await sb()
      .from('seller_profiles')
      .select('id, user_id, business_name, category, status, plan_slug, commission_rate, created_at, business_type')
      .eq('id', id)
      .single();

    if (error || !seller) return res.status(404).json({ success: false, message: 'Seller não encontrado' });

    // Fetch active exemption
    const { data: exemption } = await sb()
      .from('seller_exemptions')
      .select('id, level, status, commission_cap_brl, commission_absorbed_brl, sponsor_user_id, expires_at')
      .eq('beneficiary_user_id', seller.user_id)
      .eq('status', 'active')
      .maybeSingle();

    // Fetch subscription
    const { data: subscription } = await sb()
      .from('user_subscriptions')
      .select('id, plan_slug, status, started_at, expires_at')
      .eq('user_id', seller.user_id)
      .eq('status', 'active')
      .maybeSingle();

    res.json({ success: true, data: { ...seller, exemption, subscription } });
  } catch (err) {
    logger.error(`[${CTRL}] getSellerDetail: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateCommission = async (req, res) => {
  try {
    const { id } = req.params;
    const schema = Joi.object({ commission_rate: Joi.number().min(0).max(0.10).required() });
    const { error: valErr, value } = schema.validate(req.body);
    if (valErr) return res.status(400).json({ success: false, message: valErr.message });

    const { error } = await sb()
      .from('seller_profiles')
      .update({ commission_rate: value.commission_rate })
      .eq('id', id);

    if (error) throw error;

    logger.info(`[${CTRL}] Admin ${req.user.uid} updated commission for seller ${id} to ${value.commission_rate}`);
    res.json({ success: true, message: 'Comissão atualizada' });
  } catch (err) {
    logger.error(`[${CTRL}] updateCommission: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.assignPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const schema = Joi.object({ plan_slug: Joi.string().required() });
    const { error: valErr, value } = schema.validate(req.body);
    if (valErr) return res.status(400).json({ success: false, message: valErr.message });

    // Verify plan exists
    const { data: plan } = await sb()
      .from('subscription_plans')
      .select('slug')
      .eq('slug', value.plan_slug)
      .single();

    if (!plan) return res.status(404).json({ success: false, message: 'Plano não encontrado' });

    const { error } = await sb()
      .from('seller_profiles')
      .update({ plan_slug: value.plan_slug })
      .eq('id', id);

    if (error) throw error;

    logger.info(`[${CTRL}] Admin ${req.user.uid} assigned plan ${value.plan_slug} to seller ${id}`);
    res.json({ success: true, message: 'Plano atribuído' });
  } catch (err) {
    logger.error(`[${CTRL}] assignPlan: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Plans ────────────────────────────────────────────────────────────────────

exports.listPlans = async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('subscription_plans')
      .select('*')
      .order('tier', { ascending: true });

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] listPlans: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.createPlan = async (req, res) => {
  try {
    const schema = Joi.object({
      slug: Joi.string().required(),
      name: Joi.string().required(),
      tier: Joi.number().integer().min(0).required(),
      monthly_price_brl: Joi.number().min(0).required(),
      commission_rate: Joi.number().min(0).max(0.15).required(),
      plan_type: Joi.string().valid('lojista', 'entregador').default('lojista'),
      is_active: Joi.boolean().default(true),
    });

    const { error: valErr, value } = schema.validate(req.body);
    if (valErr) return res.status(400).json({ success: false, message: valErr.message });

    const { data, error } = await sb()
      .from('subscription_plans')
      .insert(value)
      .select()
      .single();

    if (error) throw error;

    logger.info(`[${CTRL}] Admin ${req.user.uid} created plan ${value.slug}`);
    res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] createPlan: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updatePlan = async (req, res) => {
  try {
    const { slug } = req.params;
    const schema = Joi.object({
      name: Joi.string(),
      monthly_price_brl: Joi.number().min(0),
      commission_rate: Joi.number().min(0).max(0.15),
    }).min(1);

    const { error: valErr, value } = schema.validate(req.body);
    if (valErr) return res.status(400).json({ success: false, message: valErr.message });

    const { error } = await sb()
      .from('subscription_plans')
      .update(value)
      .eq('slug', slug);

    if (error) throw error;

    logger.info(`[${CTRL}] Admin ${req.user.uid} updated plan ${slug}`);
    res.json({ success: true, message: 'Plano atualizado' });
  } catch (err) {
    logger.error(`[${CTRL}] updatePlan: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.togglePlan = async (req, res) => {
  try {
    const { slug } = req.params;

    const { data: plan, error: fetchErr } = await sb()
      .from('subscription_plans')
      .select('is_active')
      .eq('slug', slug)
      .single();

    if (fetchErr || !plan) return res.status(404).json({ success: false, message: 'Plano não encontrado' });

    const { error } = await sb()
      .from('subscription_plans')
      .update({ is_active: !plan.is_active })
      .eq('slug', slug);

    if (error) throw error;

    logger.info(`[${CTRL}] Admin ${req.user.uid} toggled plan ${slug} to ${!plan.is_active}`);
    res.json({ success: true, data: { is_active: !plan.is_active } });
  } catch (err) {
    logger.error(`[${CTRL}] togglePlan: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Exemptions ───────────────────────────────────────────────────────────────

exports.listExemptions = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (Math.max(1, +page) - 1) * +limit;

    let query = sb()
      .from('seller_exemptions')
      .select('id, beneficiary_user_id, sponsor_user_id, level, status, commission_cap_brl, commission_absorbed_brl, created_at, expires_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + +limit - 1);

    if (status) query = query.eq('status', status);

    const { data, count, error } = await query;
    if (error) throw error;

    res.json({ success: true, data, pagination: { page: +page, limit: +limit, total: count } });
  } catch (err) {
    logger.error(`[${CTRL}] listExemptions: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.createExemption = async (req, res) => {
  try {
    const schema = Joi.object({
      beneficiary_user_id: Joi.string().required(),
      sponsor_user_id: Joi.string().required(),
      level: Joi.string().required(),
      beneficiary_type: Joi.string().valid('seller', 'deliverer').default('seller'),
      commission_cap_brl: Joi.number().min(0).default(null),
      duration_days: Joi.number().integer().min(1).default(null),
    });

    const { error: valErr, value } = schema.validate(req.body);
    if (valErr) return res.status(400).json({ success: false, message: valErr.message });

    const expiresAt = value.duration_days
      ? new Date(Date.now() + value.duration_days * 86400000).toISOString()
      : null;

    const { data, error } = await sb()
      .from('seller_exemptions')
      .insert({
        beneficiary_user_id: value.beneficiary_user_id,
        sponsor_user_id: value.sponsor_user_id,
        level: value.level,
        beneficiary_type: value.beneficiary_type,
        commission_cap_brl: value.commission_cap_brl,
        commission_absorbed_brl: 0,
        status: 'active',
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (error) throw error;

    logger.info(`[${CTRL}] Admin ${req.user.uid} created exemption for ${value.beneficiary_user_id}`);
    res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] createExemption: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.revokeExemption = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await sb()
      .from('seller_exemptions')
      .update({ status: 'revoked' })
      .eq('id', id)
      .eq('status', 'active');

    if (error) throw error;

    logger.info(`[${CTRL}] Admin ${req.user.uid} revoked exemption ${id}`);
    res.json({ success: true, message: 'Isenção revogada' });
  } catch (err) {
    logger.error(`[${CTRL}] revokeExemption: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Plugins (Add-ons) ────────────────────────────────────────────────────────

exports.listAddons = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, addon_slug } = req.query;
    const offset = (Math.max(1, +page) - 1) * +limit;

    let query = sb()
      .from('seller_addons')
      .select('id, seller_user_id, seller_id, addon_slug, monthly_price_brl, billing_cycle, status, activated_at, deactivates_at', { count: 'exact' })
      .order('activated_at', { ascending: false })
      .range(offset, offset + +limit - 1);

    if (status) query = query.eq('status', status);
    if (addon_slug) query = query.eq('addon_slug', addon_slug);

    const { data, count, error } = await query;
    if (error) throw error;

    // Enrich with seller business_name
    if (data?.length) {
      const sellerIds = [...new Set(data.map(a => a.seller_id))];
      const { data: sellers } = await sb()
        .from('seller_profiles')
        .select('id, business_name')
        .in('id', sellerIds);
      const sellerMap = Object.fromEntries((sellers || []).map(s => [s.id, s.business_name]));
      data.forEach(a => { a.business_name = sellerMap[a.seller_id] || '—'; });
    }

    res.json({ success: true, data, pagination: { page: +page, limit: +limit, total: count } });
  } catch (err) {
    logger.error(`[${CTRL}] listAddons: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.activateAddon = async (req, res) => {
  try {
    const schema = Joi.object({
      seller_id: Joi.string().required(),
      addon_slug: Joi.string().default('iconchat'),
      billing_cycle: Joi.string().valid('monthly', 'annual').default('monthly'),
      courtesy_days: Joi.number().integer().min(1).max(365).optional(),
    });
    const { error: valErr, value } = schema.validate(req.body);
    if (valErr) return res.status(400).json({ success: false, message: valErr.message });

    // Resolve seller_user_id
    const { data: seller } = await sb()
      .from('seller_profiles')
      .select('user_id')
      .eq('id', value.seller_id)
      .single();
    if (!seller) return res.status(404).json({ success: false, message: 'Seller não encontrado' });

    if (value.courtesy_days) {
      // Courtesy: insert directly with price 0 and auto-deactivation date
      const deactivatesAt = new Date(Date.now() + value.courtesy_days * 86400000).toISOString();
      const { data: addon, error } = await sb()
        .from('seller_addons')
        .upsert({
          seller_user_id: seller.user_id,
          seller_id: value.seller_id,
          addon_slug: value.addon_slug || 'iconchat',
          monthly_price_brl: 0,
          annual_price_brl: 0,
          billing_cycle: 'monthly',
          status: 'pending_deactivation',
          activated_at: new Date().toISOString(),
          deactivates_at: deactivatesAt,
        }, { onConflict: 'seller_user_id,addon_slug' })
        .select()
        .single();
      if (error) throw error;

      logger.info(`[${CTRL}] Admin ${req.user.uid} activated courtesy addon (${value.courtesy_days}d) for seller ${value.seller_id}`);
      return res.status(201).json({ success: true, data: addon });
    }

    const addonService = require('../services/addonService');
    const result = await addonService.activateAddon(seller.user_id, value.seller_id, value.billing_cycle);

    logger.info(`[${CTRL}] Admin ${req.user.uid} activated addon ${value.addon_slug} for seller ${value.seller_id}`);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    logger.error(`[${CTRL}] activateAddon: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateAddon = async (req, res) => {
  try {
    const { id } = req.params;
    const schema = Joi.object({
      billing_cycle: Joi.string().valid('monthly', 'annual'),
      extend_days: Joi.number().integer().min(1).max(365),
    }).min(1);

    const { error: valErr, value } = schema.validate(req.body);
    if (valErr) return res.status(400).json({ success: false, message: valErr.message });

    const updates = { updated_at: new Date().toISOString() };

    if (value.billing_cycle) {
      updates.billing_cycle = value.billing_cycle;
      updates.monthly_price_brl = value.billing_cycle === 'annual' ? 299.00 : 29.90;
      updates.annual_price_brl = 299.00;
    }

    if (value.extend_days) {
      // Extend: set deactivates_at from now + X days, price 0, status pending_deactivation (courtesy)
      updates.deactivates_at = new Date(Date.now() + value.extend_days * 86400000).toISOString();
      updates.monthly_price_brl = 0;
      updates.annual_price_brl = 0;
      updates.status = 'pending_deactivation';
    }

    const { error } = await sb()
      .from('seller_addons')
      .update(updates)
      .eq('id', id);

    if (error) throw error;

    logger.info(`[${CTRL}] Admin ${req.user.uid} updated addon ${id}`, value);
    res.json({ success: true, message: 'Plugin atualizado' });
  } catch (err) {
    logger.error(`[${CTRL}] updateAddon: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.deactivateAddon = async (req, res) => {
  try {
    const { id } = req.params;

    // Get the addon to find seller info
    const { data: addon } = await sb()
      .from('seller_addons')
      .select('seller_user_id, seller_id, status')
      .eq('id', id)
      .single();

    if (!addon) return res.status(404).json({ success: false, message: 'Add-on não encontrado' });
    if (addon.status === 'inactive') return res.status(400).json({ success: false, message: 'Add-on já está inativo' });

    const addonService = require('../services/addonService');
    await addonService.deactivateAddon(addon.seller_user_id, addon.seller_id);

    logger.info(`[${CTRL}] Admin ${req.user.uid} deactivated addon ${id}`);
    res.json({ success: true, message: 'Add-on desativado' });
  } catch (err) {
    logger.error(`[${CTRL}] deactivateAddon: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
};
