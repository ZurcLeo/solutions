'use strict';

/**
 * opsController.js — OPS-006: HTTP handlers for Operations Panel.
 *
 * Stages, Tasks, Metrics, Notification channels — all admin-only.
 */

const Joi = require('joi');
const { logger } = require('../logger');
const opsTaskService = require('../services/opsTaskService');
const opsMetricsService = require('../services/opsMetricsService');

const agentPresenceService = require('../services/agentPresenceService');

const CTRL = 'opsController';

// ── Joi Schemas ─────────────────────────────────────────────────────────────

const SCHEMAS = {
  createStage: Joi.object({
    slug: Joi.string().required().max(50).pattern(/^[a-z0-9_]+$/),
    label: Joi.string().required().max(100),
    sort_order: Joi.number().integer().min(0).default(0),
    color: Joi.string().max(10).default('#6B7280'),
    is_terminal: Joi.boolean().default(false),
  }),
  updateStage: Joi.object({
    label: Joi.string().max(100),
    sort_order: Joi.number().integer().min(0),
    color: Joi.string().max(10),
    is_terminal: Joi.boolean(),
  }).min(1),
  createTask: Joi.object({
    title: Joi.string().required().max(200),
    description: Joi.string().allow('', null).max(5000),
    stage_id: Joi.string().allow(null),
    seller_id: Joi.string().allow(null),
    assignee_id: Joi.string().allow(null),
    priority: Joi.string().valid('low', 'medium', 'high', 'urgent').default('medium'),
    due_date: Joi.date().iso().allow(null),
    tags: Joi.array().items(Joi.string().max(50)).max(20).default([]),
    sort_order: Joi.number().integer().min(0).default(0),
    // Agenda fields
    task_type: Joi.string().valid('pipeline', 'agenda', 'milestone', 'seller_internal').default('pipeline'),
    substage_id: Joi.string().allow(null),
    scheduled_at: Joi.date().iso().allow(null),
    scheduled_end: Joi.date().iso().allow(null),
    duration_minutes: Joi.number().integer().min(1).max(480).allow(null),
    document_refs: Joi.array().items(Joi.object({
      name: Joi.string().required().max(200),
      storage_path: Joi.string().required().max(500),
      mime_type: Joi.string().max(100),
      size: Joi.number().integer().min(0),
    })).default([]),
  }),
  updateTask: Joi.object({
    title: Joi.string().max(200),
    description: Joi.string().allow('', null).max(5000),
    priority: Joi.string().valid('low', 'medium', 'high', 'urgent'),
    due_date: Joi.date().iso().allow(null),
    tags: Joi.array().items(Joi.string().max(50)).max(20),
    sort_order: Joi.number().integer().min(0),
    seller_id: Joi.string().allow(null),
    // Agenda fields
    scheduled_at: Joi.date().iso().allow(null),
    scheduled_end: Joi.date().iso().allow(null),
    duration_minutes: Joi.number().integer().min(1).max(480).allow(null),
    substage_id: Joi.string().allow(null),
  }).min(1),
  moveTask: Joi.object({
    stage_id: Joi.string().required(),
    sort_order: Joi.number().integer().min(0),
  }),
  assignTask: Joi.object({
    assignee_id: Joi.string().allow(null).required(),
  }),
  addComment: Joi.object({
    comment: Joi.string().required().max(5000),
  }),
  createNotifChannel: Joi.object({
    channel: Joi.string().valid('slack', 'notion').required(),
    webhook_url: Joi.string().uri().required(),
    events: Joi.array().items(Joi.string().max(50)).default([]),
  }),
  addTaskLink: Joi.object({
    link_type: Joi.string().valid('support_ticket', 'order', 'delivery_request').required(),
    link_id: Joi.string().required(),
    link_meta: Joi.object().default({}),
  }),
  // Substages
  createSubstage: Joi.object({
    slug: Joi.string().required().max(50).pattern(/^[a-z0-9_]+$/),
    label: Joi.string().required().max(100),
    color: Joi.string().max(10).default('#6B7280'),
    sort_order: Joi.number().integer().min(0).default(0),
  }),
  updateSubstage: Joi.object({
    label: Joi.string().max(100),
    color: Joi.string().max(10),
    sort_order: Joi.number().integer().min(0),
  }).min(1),
  // Agenda
  rescheduleTask: Joi.object({
    scheduled_at: Joi.date().iso().required(),
    scheduled_end: Joi.date().iso().allow(null),
  }),
  moveSubstage: Joi.object({
    substage_id: Joi.string().allow(null).required(),
  }),
  attachDocument: Joi.object({
    name: Joi.string().required().max(200),
    storage_path: Joi.string().required().max(500),
    mime_type: Joi.string().max(100).default('application/octet-stream'),
    size: Joi.number().integer().min(0).default(0),
  }),
};

// ── Stages ──────────────────────────────────────────────────────────────────

async function listStages(req, res) {
  try {
    const data = await opsTaskService.listStages();
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] listStages error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function createStage(req, res) {
  try {
    const { error: joiErr, value } = SCHEMAS.createStage.validate(req.body);
    if (joiErr) return res.status(400).json({ error: joiErr.details[0].message });

    const data = await opsTaskService.createStage(value);
    return res.status(201).json({ success: true, data });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'slug_already_exists' });
    logger.error(`[${CTRL}] createStage error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function updateStage(req, res) {
  try {
    const { error: joiErr, value } = SCHEMAS.updateStage.validate(req.body);
    if (joiErr) return res.status(400).json({ error: joiErr.details[0].message });

    const data = await opsTaskService.updateStage(req.params.id, value);
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] updateStage error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function deleteStage(req, res) {
  try {
    await opsTaskService.deleteStage(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    if (err.statusCode === 409) return res.status(409).json({ error: err.message });
    logger.error(`[${CTRL}] deleteStage error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

// ── Tasks ───────────────────────────────────────────────────────────────────

async function listTasks(req, res) {
  try {
    const filters = {
      stage_id: req.query.stage_id,
      assignee_id: req.query.assignee_id,
      seller_id: req.query.seller_id,
      priority: req.query.priority,
      search: req.query.search,
      archived: req.query.archived === 'true',
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 200,
    };
    const data = await opsTaskService.listTasks(filters);
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] listTasks error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function getTask(req, res) {
  try {
    const data = await opsTaskService.getTask(req.params.id);
    return res.json({ success: true, data });
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: err.message });
    logger.error(`[${CTRL}] getTask error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function createTask(req, res) {
  try {
    const { error: joiErr, value } = SCHEMAS.createTask.validate(req.body);
    if (joiErr) return res.status(400).json({ error: joiErr.details[0].message });

    const data = await opsTaskService.createTask(value, req.user.uid, req);
    return res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] createTask error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function updateTask(req, res) {
  try {
    const { error: joiErr, value } = SCHEMAS.updateTask.validate(req.body);
    if (joiErr) return res.status(400).json({ error: joiErr.details[0].message });

    const data = await opsTaskService.updateTask(req.params.id, value, req.user.uid, req);
    return res.json({ success: true, data });
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: err.message });
    logger.error(`[${CTRL}] updateTask error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function moveTask(req, res) {
  try {
    const { error: joiErr, value } = SCHEMAS.moveTask.validate(req.body);
    if (joiErr) return res.status(400).json({ error: joiErr.details[0].message });

    const data = await opsTaskService.moveTask(
      req.params.id, value.stage_id, value.sort_order, req.user.uid, req
    );
    return res.json({ success: true, data });
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: err.message });
    logger.error(`[${CTRL}] moveTask error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function assignTask(req, res) {
  try {
    const { error: joiErr, value } = SCHEMAS.assignTask.validate(req.body);
    if (joiErr) return res.status(400).json({ error: joiErr.details[0].message });

    const data = await opsTaskService.assignTask(req.params.id, value.assignee_id, req.user.uid, req);
    return res.json({ success: true, data });
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: err.message });
    logger.error(`[${CTRL}] assignTask error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function addComment(req, res) {
  try {
    const { error: joiErr, value } = SCHEMAS.addComment.validate(req.body);
    if (joiErr) return res.status(400).json({ error: joiErr.details[0].message });

    const data = await opsTaskService.addComment(req.params.id, value.comment, req.user.uid, req);
    return res.json({ success: true, data });
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: err.message });
    logger.error(`[${CTRL}] addComment error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function archiveTask(req, res) {
  try {
    const data = await opsTaskService.archiveTask(req.params.id, req.user.uid, req);
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] archiveTask error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function unarchiveTask(req, res) {
  try {
    const data = await opsTaskService.unarchiveTask(req.params.id, req.user.uid, req);
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] unarchiveTask error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function getActivityLog(req, res) {
  try {
    const pagination = {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 50,
    };
    const data = await opsTaskService.getActivityLog(req.params.id, pagination);
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] getActivityLog error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

// ── Metrics ─────────────────────────────────────────────────────────────────

async function getLiveMetrics(req, res) {
  try {
    const data = await opsMetricsService.computeLiveMetrics();
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] getLiveMetrics error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function getMetricsHistory(req, res) {
  try {
    const days = parseInt(req.query.days) || 30;
    const data = await opsMetricsService.getSnapshotHistory(days);
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] getMetricsHistory error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function getSellerMetrics(req, res) {
  try {
    const data = await opsMetricsService.getSellerMetrics(req.params.sellerId);
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] getSellerMetrics error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

// ── Notification Channels ───────────────────────────────────────────────────

async function listNotifChannels(req, res) {
  try {
    const { getSupabaseClient } = require('../config/supabase');
    const { data, error } = await getSupabaseClient()
      .from('ops_notification_channels')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] listNotifChannels error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function createNotifChannel(req, res) {
  try {
    const { error: joiErr, value } = SCHEMAS.createNotifChannel.validate(req.body);
    if (joiErr) return res.status(400).json({ error: joiErr.details[0].message });

    const { getSupabaseClient } = require('../config/supabase');
    const { data, error } = await getSupabaseClient()
      .from('ops_notification_channels')
      .insert({ ...value, created_by: req.user.uid })
      .select()
      .single();
    if (error) throw error;
    return res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] createNotifChannel error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function toggleNotifChannel(req, res) {
  try {
    const { getSupabaseClient } = require('../config/supabase');
    const client = getSupabaseClient();

    // Get current state
    const { data: current, error: fetchErr } = await client
      .from('ops_notification_channels')
      .select('is_active')
      .eq('id', req.params.id)
      .single();
    if (fetchErr) throw fetchErr;

    const { data, error } = await client
      .from('ops_notification_channels')
      .update({ is_active: !current.is_active })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] toggleNotifChannel error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

// ── Test notification channel ────────────────────────────────────────────────

async function testNotifChannel(req, res) {
  try {
    const { getSupabaseClient } = require('../config/supabase');
    const client = getSupabaseClient();

    const { data: ch, error } = await client
      .from('ops_notification_channels')
      .select('webhook_url, channel')
      .eq('id', req.params.id)
      .single();
    if (error || !ch) return res.status(404).json({ error: 'channel_not_found' });

    const payload = ch.channel === 'slack'
      ? {
          blocks: [
            { type: 'header', text: { type: 'plain_text', text: 'Teste ElosCloud Ops', emoji: true } },
            { type: 'section', text: { type: 'mrkdwn', text: 'Webhook configurado com sucesso! :white_check_mark:' } },
            { type: 'context', elements: [{ type: 'mrkdwn', text: `Enviado em ${new Date().toISOString()}` }] },
          ],
        }
      : { text: 'Teste ElosCloud Ops — webhook configurado com sucesso!' };

    const resp = await fetch(ch.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      logger.warn(`[${CTRL}] testNotifChannel failed`, { status: resp.status });
      return res.status(502).json({ error: 'webhook_delivery_failed', status: resp.status });
    }

    return res.json({ success: true });
  } catch (err) {
    logger.error(`[${CTRL}] testNotifChannel error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

// ── Agent Presence (REST fallback) ──────────────────────────────────────────

async function getAgentPresence(req, res) {
  try {
    const agents = agentPresenceService.getOnlineAgents();
    return res.json({ success: true, data: agents });
  } catch (err) {
    logger.error(`[${CTRL}] getAgentPresence error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

// ── Task Links ─────────────────────────────────────────────────────────────

async function addTaskLink(req, res) {
  try {
    const { error: joiErr, value } = SCHEMAS.addTaskLink.validate(req.body);
    if (joiErr) return res.status(400).json({ error: joiErr.details[0].message });

    const data = await opsTaskService.addTaskLink(
      req.params.id, value.link_type, value.link_id, value.link_meta, req.user.uid
    );
    return res.status(201).json({ success: true, data });
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: err.message });
    if (err.statusCode === 409) return res.status(409).json({ error: err.message });
    logger.error(`[${CTRL}] addTaskLink error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function getTaskLinks(req, res) {
  try {
    const data = await opsTaskService.getTaskLinks(req.params.id);
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] getTaskLinks error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function removeTaskLink(req, res) {
  try {
    const data = await opsTaskService.removeTaskLink(req.params.id, req.params.linkId, req.user.uid);
    return res.json({ success: true, data });
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: err.message });
    logger.error(`[${CTRL}] removeTaskLink error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function searchTickets(req, res) {
  try {
    const data = await opsTaskService.searchSupportTickets({
      search: req.query.search,
      sellerId: req.query.seller_id,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 15,
    });
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] searchTickets error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

// ── Substages ──────────────────────────────────────────────────────────────

async function listSubstages(req, res) {
  try {
    const data = await opsTaskService.listSubstages(req.params.stageId);
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] listSubstages error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function createSubstage(req, res) {
  try {
    const { error: joiErr, value } = SCHEMAS.createSubstage.validate(req.body);
    if (joiErr) return res.status(400).json({ error: joiErr.details[0].message });

    const data = await opsTaskService.createSubstage(req.params.stageId, value);
    return res.status(201).json({ success: true, data });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'substage_slug_already_exists' });
    logger.error(`[${CTRL}] createSubstage error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function updateSubstage(req, res) {
  try {
    const { error: joiErr, value } = SCHEMAS.updateSubstage.validate(req.body);
    if (joiErr) return res.status(400).json({ error: joiErr.details[0].message });

    const data = await opsTaskService.updateSubstage(req.params.id, value);
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] updateSubstage error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function deleteSubstage(req, res) {
  try {
    await opsTaskService.deleteSubstage(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    if (err.statusCode === 409) return res.status(409).json({ error: err.message });
    logger.error(`[${CTRL}] deleteSubstage error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

// ── Agenda ─────────────────────────────────────────────────────────────────

async function listAgendaTasks(req, res) {
  try {
    const filters = {
      seller_id: req.query.seller_id,
      assignee_id: req.query.assignee_id,
      task_type: req.query.task_type,
      from: req.query.from,
      to: req.query.to,
    };
    const data = await opsTaskService.listAgendaTasks(filters);
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] listAgendaTasks error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function rescheduleTask(req, res) {
  try {
    const { error: joiErr, value } = SCHEMAS.rescheduleTask.validate(req.body);
    if (joiErr) return res.status(400).json({ error: joiErr.details[0].message });

    const data = await opsTaskService.rescheduleTask(
      req.params.id, value.scheduled_at, value.scheduled_end, req.user.uid, req
    );
    return res.json({ success: true, data });
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: err.message });
    logger.error(`[${CTRL}] rescheduleTask error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function attachDocumentHandler(req, res) {
  try {
    const { error: joiErr, value } = SCHEMAS.attachDocument.validate(req.body);
    if (joiErr) return res.status(400).json({ error: joiErr.details[0].message });

    const docRef = { ...value, uploaded_at: new Date().toISOString() };
    const data = await opsTaskService.attachDocument(req.params.id, docRef, req.user.uid);
    return res.status(201).json({ success: true, data });
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: err.message });
    logger.error(`[${CTRL}] attachDocument error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function removeDocumentHandler(req, res) {
  try {
    const index = parseInt(req.params.index);
    if (isNaN(index) || index < 0) return res.status(400).json({ error: 'indice_invalido' });

    const data = await opsTaskService.removeDocument(req.params.id, index, req.user.uid);
    return res.json({ success: true, data });
  } catch (err) {
    if (err.statusCode === 400) return res.status(400).json({ error: err.message });
    if (err.statusCode === 404) return res.status(404).json({ error: err.message });
    logger.error(`[${CTRL}] removeDocument error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function moveSubstageHandler(req, res) {
  try {
    const { error: joiErr, value } = SCHEMAS.moveSubstage.validate(req.body);
    if (joiErr) return res.status(400).json({ error: joiErr.details[0].message });

    const data = await opsTaskService.moveSubstage(req.params.id, value.substage_id, req.user.uid, req);
    return res.json({ success: true, data });
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: err.message });
    logger.error(`[${CTRL}] moveSubstage error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function getUnifiedTimeline(req, res) {
  try {
    const filters = {
      seller_id: req.query.seller_id,
      from: req.query.from,
      to: req.query.to,
    };
    const data = await opsTaskService.getUnifiedTimeline(filters);
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] getUnifiedTimeline error`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

module.exports = {
  // Stages
  listStages,
  createStage,
  updateStage,
  deleteStage,
  // Substages
  listSubstages,
  createSubstage,
  updateSubstage,
  deleteSubstage,
  // Tasks
  listTasks,
  getTask,
  createTask,
  updateTask,
  moveTask,
  assignTask,
  addComment,
  archiveTask,
  unarchiveTask,
  getActivityLog,
  // Task links
  addTaskLink,
  getTaskLinks,
  removeTaskLink,
  searchTickets,
  // Agenda
  listAgendaTasks,
  rescheduleTask,
  attachDocument: attachDocumentHandler,
  removeDocument: removeDocumentHandler,
  moveSubstage: moveSubstageHandler,
  getUnifiedTimeline,
  // Metrics
  getLiveMetrics,
  getMetricsHistory,
  getSellerMetrics,
  // Notification channels
  listNotifChannels,
  createNotifChannel,
  toggleNotifChannel,
  testNotifChannel,
  // Agent presence
  getAgentPresence,
};
