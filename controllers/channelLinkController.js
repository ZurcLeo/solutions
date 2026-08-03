/**
 * @fileoverview Channel Link Controller — handlers + Joi validation
 *
 * D1: lookup (HMAC channel)
 * D2: init (HMAC channel)
 * Preview: público (sem auth)
 * Confirm/Mine/Revoke: session (verifyToken)
 */

'use strict';

const Joi = require('joi');
const crypto = require('crypto');
const { logger } = require('../logger');
const channelLinkService = require('../services/channelLinkService');
const channelLinkCallbackService = require('../services/channelLinkCallbackService');

const CTRL = 'channelLinkController';
const E164_PATTERN = /^\+\d{10,15}$/;

// ── Joi Schemas ─────────────────────────────────────────────────────────────

const SCHEMAS = {
  init: Joi.object({
    phone: Joi.string().pattern(E164_PATTERN).required()
      .messages({ 'string.pattern.base': 'phone must be E.164 format (+DDI...)' }),
    conversationId: Joi.string().min(1).max(200).required(),
  }),
  confirm: Joi.object({
    token: Joi.string().min(1).required(),
  }),
  revokeByPhone: Joi.object({
    phone: Joi.string().pattern(E164_PATTERN).required()
      .messages({ 'string.pattern.base': 'phone must be E.164 format (+DDI...)' }),
    conversationId: Joi.string().min(1).max(200).required(),
  }),
};

// ── D1: Lookup by phone (HMAC channel) ──────────────────────────────────────

async function lookup(req, res) {
  try {
    const phone = decodeURIComponent(req.params.phone || '');
    const result = await channelLinkService.lookupByPhone('whatsapp', phone);
    return res.json({ success: true, data: result });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    logger.error(`[${CTRL}] lookup error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

// ── D2: Init link (HMAC channel) ────────────────────────────────────────────

async function init(req, res) {
  try {
    const { error: joiErr, value } = SCHEMAS.init.validate(req.body);
    if (joiErr) {
      return res.status(400).json({ error: joiErr.details[0].message });
    }

    const result = await channelLinkService.initLink(value.phone, value.conversationId);
    return res.json({ success: true, data: result });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    logger.error(`[${CTRL}] init error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

// ── Preview (público — sem auth) ────────────────────────────────────────────

async function preview(req, res) {
  try {
    const token = req.query.t;
    if (!token) {
      return res.status(400).json({ error: 'missing_token' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Sessão opcional: tenta extrair userId do header Authorization se presente
    let userId = null;
    if (req.user?.uid) {
      userId = req.user.uid;
    }

    const result = await channelLinkService.previewLink(tokenHash, userId);
    if (!result) {
      return res.status(410).json({ error: 'link_expired_or_invalid' });
    }

    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error(`[${CTRL}] preview error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

// ── Confirm (session required) ──────────────────────────────────────────────

async function confirm(req, res) {
  try {
    const { error: joiErr, value } = SCHEMAS.confirm.validate(req.body);
    if (joiErr) {
      return res.status(400).json({ error: joiErr.details[0].message });
    }

    const userId = req.user.uid;
    const tokenHash = crypto.createHash('sha256').update(value.token).digest('hex');

    const result = await channelLinkService.confirmLink(userId, tokenHash);

    // Buscar display name para o callback
    const { getSupabaseClient } = require('../config/supabase');
    const supabase = getSupabaseClient();
    const { data: user } = await supabase
      .from('users')
      .select('full_name')
      .eq('id', userId)
      .maybeSingle();

    // Fire-and-forget callback ao IconChat
    channelLinkCallbackService.notifyVerified({
      conversationId: result.conversationId,
      phone: result.phone,
      userId,
      displayName: user?.full_name?.split(' ')[0] || null,
    });

    return res.json({
      success: true,
      data: {
        linked: true,
        revokedCount: result.revokedCount,
      },
    });
  } catch (err) {
    if (err.statusCode === 410) {
      return res.status(410).json({ error: 'link_expired_or_invalid' });
    }
    logger.error(`[${CTRL}] confirm error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

// ── Get my link (session required) ──────────────────────────────────────────

async function getMyLink(req, res) {
  try {
    const userId = req.user.uid;
    const link = await channelLinkService.getUserLink(userId);
    return res.json({ success: true, data: link });
  } catch (err) {
    logger.error(`[${CTRL}] getMyLink error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

// ── Revoke (session required) ───────────────────────────────────────────────

async function revoke(req, res) {
  try {
    const userId = req.user.uid;
    const result = await channelLinkService.revokeByUser(userId);
    return res.json({ success: true, data: result });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: 'no_active_link' });
    }
    logger.error(`[${CTRL}] revoke error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

// ── D3: Revoke by phone (HMAC channel) ──────────────────────────────────────

async function revokeByPhone(req, res) {
  try {
    const { error: joiErr, value } = SCHEMAS.revokeByPhone.validate(req.body);
    if (joiErr) {
      return res.status(400).json({ error: joiErr.details[0].message });
    }

    const result = await channelLinkService.revokeByPhone(value.phone, value.conversationId);

    // Fire-and-forget callback ao IconChat
    channelLinkCallbackService.notifyRevoked({
      conversationId: result.conversationId,
      phone: value.phone,
      userId: result.userId,
    });

    return res.json({ success: true, data: { revoked: true } });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    if (err.statusCode === 404) {
      return res.status(404).json({ error: 'no_active_link' });
    }
    logger.error(`[${CTRL}] revokeByPhone error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

module.exports = {
  lookup,
  init,
  preview,
  confirm,
  getMyLink,
  revoke,
  revokeByPhone,
};
