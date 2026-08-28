/**
 * @fileoverview recallController — Controllers para Motor de Recall
 * [RECALL-004] Joi validation + delegacao para recallService
 */

'use strict';

const Joi = require('joi');
const recallService = require('../services/recallService');
const { logger } = require('../logger');

const CTRL = 'recallController';

// ──────────────────────────────────────────────────────
// Schemas
// ──────────────────────────────────────────────────────

const createRuleSchema = Joi.object({
  rule_name: Joi.string().max(200).required(),
  trigger_type: Joi.string().valid(
    'days_since_last_order',
    'days_since_last_booking',
    'days_since_completed_booking',
    'custom'
  ).required(),
  interval_days: Joi.number().integer().min(1).max(365).required(),
  product_category: Joi.string().max(100).allow('', null),
  message_template: Joi.string().max(1000).required(),
  channel_preference: Joi.array().items(
    Joi.string().valid('in_app', 'email', 'push')
  ).min(1).default(['in_app', 'email', 'push']),
  max_sends: Joi.number().integer().min(1).max(20).default(3),
});

const updateRuleSchema = Joi.object({
  rule_name: Joi.string().max(200),
  trigger_type: Joi.string().valid(
    'days_since_last_order',
    'days_since_last_booking',
    'days_since_completed_booking',
    'custom'
  ),
  interval_days: Joi.number().integer().min(1).max(365),
  product_category: Joi.string().max(100).allow('', null),
  message_template: Joi.string().max(1000),
  channel_preference: Joi.array().items(
    Joi.string().valid('in_app', 'email', 'push')
  ).min(1),
  is_active: Joi.boolean(),
  max_sends: Joi.number().integer().min(1).max(20),
}).min(1);

const statsQuerySchema = Joi.object({
  from: Joi.string().isoDate().allow('', null),
  to: Joi.string().isoDate().allow('', null),
});

const logQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const optoutSchema = Joi.object({
  seller_id: Joi.string().allow(null),
});

// ──────────────────────────────────────────────────────
// Handlers — Regras
// ──────────────────────────────────────────────────────

async function listRules(req, res) {
  try {
    const sellerId = req.sellerContext?.sellerId;
    if (!sellerId) return res.status(403).json({ success: false, message: 'Seller context nao encontrado' });

    const data = await recallService.getActiveRules(sellerId);
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] listRules: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createRule(req, res) {
  try {
    const sellerId = req.sellerContext?.sellerId;
    if (!sellerId) return res.status(403).json({ success: false, message: 'Seller context nao encontrado' });

    const { error: valErr, value } = createRuleSchema.validate(req.body);
    if (valErr) return res.status(400).json({ success: false, message: valErr.details[0].message });

    const data = await recallService.createRule(sellerId, value);
    res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] createRule: ${err.message}`);
    const status = err.message.includes('Limite') ? 409 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
}

async function updateRule(req, res) {
  try {
    const sellerId = req.sellerContext?.sellerId;
    if (!sellerId) return res.status(403).json({ success: false, message: 'Seller context nao encontrado' });

    const { error: valErr, value } = updateRuleSchema.validate(req.body);
    if (valErr) return res.status(400).json({ success: false, message: valErr.details[0].message });

    const data = await recallService.updateRule(req.params.id, sellerId, value);
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] updateRule: ${err.message}`);
    const status = err.message.includes('nao encontrada') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
}

async function deleteRule(req, res) {
  try {
    const sellerId = req.sellerContext?.sellerId;
    if (!sellerId) return res.status(403).json({ success: false, message: 'Seller context nao encontrado' });

    const data = await recallService.deleteRule(req.params.id, sellerId);
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] deleteRule: ${err.message}`);
    const status = err.message.includes('nao encontrada') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
}

// ──────────────────────────────────────────────────────
// Handlers — Defaults
// ──────────────────────────────────────────────────────

async function getDefaults(req, res) {
  try {
    const sellerId = req.sellerContext?.sellerId;
    if (!sellerId) return res.status(403).json({ success: false, message: 'Seller context nao encontrado' });

    // Buscar subtipo do seller
    const { getSupabaseClient } = require('../config/supabase');
    const supabase = getSupabaseClient();
    const { data: seller } = await supabase
      .from('seller_profiles')
      .select('seller_subtype')
      .eq('id', sellerId)
      .single();

    const subtype = seller?.seller_subtype || '_default';
    const template = recallService.getDefaultTemplates(subtype);

    res.json({ success: true, data: template, subtype });
  } catch (err) {
    logger.error(`[${CTRL}] getDefaults: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ──────────────────────────────────────────────────────
// Handlers — Stats / Log
// ──────────────────────────────────────────────────────

async function getDetailedStatsHandler(req, res) {
  try {
    const sellerId = req.sellerContext?.sellerId;
    if (!sellerId) return res.status(403).json({ success: false, message: 'Seller context nao encontrado' });

    const { error: valErr, value } = statsQuerySchema.validate(req.query);
    if (valErr) return res.status(400).json({ success: false, message: valErr.details[0].message });

    const data = await recallService.getDetailedStats(sellerId, { from: value.from, to: value.to });
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] getDetailedStats: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getStats(req, res) {
  try {
    const sellerId = req.sellerContext?.sellerId;
    if (!sellerId) return res.status(403).json({ success: false, message: 'Seller context nao encontrado' });

    const { error: valErr, value } = statsQuerySchema.validate(req.query);
    if (valErr) return res.status(400).json({ success: false, message: valErr.details[0].message });

    const data = await recallService.getRecallStats(sellerId, { from: value.from, to: value.to });
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] getStats: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getLog(req, res) {
  try {
    const sellerId = req.sellerContext?.sellerId;
    if (!sellerId) return res.status(403).json({ success: false, message: 'Seller context nao encontrado' });

    const { error: valErr, value } = logQuerySchema.validate(req.query);
    if (valErr) return res.status(400).json({ success: false, message: valErr.details[0].message });

    const data = await recallService.getRecallLog(sellerId, { page: value.page, limit: value.limit });
    res.json({ success: true, ...data });
  } catch (err) {
    logger.error(`[${CTRL}] getLog: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ──────────────────────────────────────────────────────
// Handlers — Opt-out (cliente autenticado)
// ──────────────────────────────────────────────────────

async function optout(req, res) {
  try {
    const userId = req.user?.uid;
    if (!userId) return res.status(401).json({ success: false, message: 'Autenticacao necessaria' });

    const { error: valErr, value } = optoutSchema.validate(req.body);
    if (valErr) return res.status(400).json({ success: false, message: valErr.details[0].message });

    const data = await recallService.optOut(userId, value.seller_id || null);
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] optout: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ──────────────────────────────────────────────────────
// Handlers — Public opt-out via token (LGPD) [RECALL-007]
// ──────────────────────────────────────────────────────

async function publicOptout(req, res) {
  try {
    const token = req.query.token;
    if (!token) return res.status(400).json({ success: false, message: 'Token ausente' });

    const payload = recallService.verifyOptoutToken(token);
    if (!payload) return res.status(400).json({ success: false, message: 'Token invalido ou expirado' });

    await recallService.optOut(payload.userId, payload.sellerId || null);

    // Tentar buscar nome do seller para feedback
    let sellerName = null;
    if (payload.sellerId) {
      try {
        const { getSupabaseClient } = require('../config/supabase');
        const supabase = getSupabaseClient();
        const { data: seller } = await supabase
          .from('seller_profiles')
          .select('trading_name, business_name')
          .eq('id', payload.sellerId)
          .single();
        sellerName = seller?.trading_name || seller?.business_name || null;
      } catch {
        // ignore
      }
    }

    res.json({ success: true, data: { sellerName } });
  } catch (err) {
    logger.error(`[${CTRL}] publicOptout: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  listRules,
  createRule,
  updateRule,
  deleteRule,
  getDefaults,
  getDetailedStats: getDetailedStatsHandler,
  getStats,
  getLog,
  optout,
  publicOptout,
};
