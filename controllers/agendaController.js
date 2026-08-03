'use strict';

/**
 * agendaController.js — AGENDA-003: HTTP handlers for user/seller agenda.
 */

const Joi = require('joi');
const { logger } = require('../logger');
const agendaService = require('../services/agendaService');

const CTRL = 'agendaController';

const SCHEMAS = {
  dateRange: Joi.object({
    from: Joi.date().iso(),
    to: Joi.date().iso(),
  }),
  createSellerTask: Joi.object({
    title: Joi.string().required().max(200),
    description: Joi.string().allow('', null).max(5000),
    assignee_id: Joi.string().allow(null),
    priority: Joi.string().valid('low', 'medium', 'high', 'urgent').default('medium'),
    due_date: Joi.date().iso().allow(null),
    tags: Joi.array().items(Joi.string().max(50)).max(20).default([]),
    scheduled_at: Joi.date().iso().required(),
    scheduled_end: Joi.date().iso().allow(null),
    duration_minutes: Joi.number().integer().min(1).max(480).allow(null),
    document_refs: Joi.array().items(Joi.object({
      name: Joi.string().required().max(200),
      storage_path: Joi.string().required().max(500),
      mime_type: Joi.string().max(100),
      size: Joi.number().integer().min(0),
    })).default([]),
  }),
  updateSellerTask: Joi.object({
    title: Joi.string().max(200),
    description: Joi.string().allow('', null).max(5000),
    assignee_id: Joi.string().allow(null),
    priority: Joi.string().valid('low', 'medium', 'high', 'urgent'),
    due_date: Joi.date().iso().allow(null),
    tags: Joi.array().items(Joi.string().max(50)).max(20),
    scheduled_at: Joi.date().iso(),
    scheduled_end: Joi.date().iso().allow(null),
    duration_minutes: Joi.number().integer().min(1).max(480).allow(null),
  }).min(1),
};

// ── User endpoints ──────────────────────────────────────────────────────────

async function getMyTasks(req, res) {
  try {
    const data = await agendaService.getMyAgendaTasks(req.user.uid, {
      from: req.query.from,
      to: req.query.to,
    });
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] getMyTasks error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function getMyTimeline(req, res) {
  try {
    const data = await agendaService.getMyUnifiedTimeline(
      req.user.uid, req.query.from, req.query.to
    );
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] getMyTimeline error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

// ── Seller endpoints ────────────────────────────────────────────────────────

async function getSellerTasks(req, res) {
  try {
    const sellerId = req.sellerContext.sellerId;
    const data = await agendaService.getSellerAgendaTasks(sellerId, {
      from: req.query.from,
      to: req.query.to,
    });
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] getSellerTasks error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function createSellerTask(req, res) {
  try {
    const { error: joiErr, value } = SCHEMAS.createSellerTask.validate(req.body);
    if (joiErr) return res.status(400).json({ error: joiErr.details[0].message });

    const sellerId = req.sellerContext.sellerId;
    const data = await agendaService.createSellerInternalTask(sellerId, value, req.user.uid, req);
    return res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] createSellerTask error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function updateSellerTask(req, res) {
  try {
    const { error: joiErr, value } = SCHEMAS.updateSellerTask.validate(req.body);
    if (joiErr) return res.status(400).json({ error: joiErr.details[0].message });

    const sellerId = req.sellerContext.sellerId;
    const data = await agendaService.updateSellerInternalTask(sellerId, req.params.id, value, req.user.uid, req);
    return res.json({ success: true, data });
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: err.message });
    logger.error(`[${CTRL}] updateSellerTask error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function getSellerTimeline(req, res) {
  try {
    const sellerId = req.sellerContext.sellerId;
    const data = await agendaService.getUnifiedSellerTimeline(
      sellerId, req.query.from, req.query.to
    );
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] getSellerTimeline error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

module.exports = {
  getMyTasks,
  getMyTimeline,
  getSellerTasks,
  createSellerTask,
  updateSellerTask,
  getSellerTimeline,
};
