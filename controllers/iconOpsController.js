'use strict';

/**
 * iconOpsController.js — Endpoints OPS para o IconChat.
 *
 * Expõe dados do painel de operações (métricas, pipeline tasks, activity log)
 * para o agente IA do IconChat atuar como assistente de CS completo.
 *
 * Endpoints seller-scoped (verifyIconApiHmac):
 *   B-OPS-1  GET /sellers/:sellerId/ops/metrics       — health score + GMV + LTV + integrations
 *   B-OPS-2  GET /sellers/:sellerId/ops/tasks          — pipeline tasks do seller (stage, assignee, priority)
 *   B-OPS-3  GET /sellers/:sellerId/ops/tasks/:taskId/activity — timeline de atividade
 *
 * Endpoint channel-scoped (verifyIconChannelHmac):
 *   B-OPS-4  GET /ops/metrics/live                     — métricas plataforma (GMV, MRR, CSAT, churn)
 */

const { logger } = require('../logger');
const opsMetricsService = require('../services/opsMetricsService');
const opsTaskService = require('../services/opsTaskService');

const TAG = 'iconOpsController';

// ── B-OPS-1: Seller Metrics ─────────────────────────────────────────────────

exports.getSellerMetrics = async (req, res) => {
  try {
    const { sellerId } = req.params;
    if (!sellerId) {
      return res.status(400).json({ success: false, error: 'seller_id_required' });
    }

    const metrics = await opsMetricsService.getSellerMetrics(sellerId);

    res.set('Cache-Control', 'private, max-age=120');
    return res.json({ success: true, data: metrics });
  } catch (err) {
    logger.error(`[${TAG}] getSellerMetrics error`, { error: err.message, sellerId: req.params?.sellerId });
    return res.status(500).json({ success: false, error: 'internal_error' });
  }
};

// ── B-OPS-2: Seller Pipeline Tasks ──────────────────────────────────────────

exports.getSellerTasks = async (req, res) => {
  try {
    const { sellerId } = req.params;
    if (!sellerId) {
      return res.status(400).json({ success: false, error: 'seller_id_required' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, parseInt(req.query.limit, 10) || 20);
    const priority = req.query.priority || undefined;

    const tasks = await opsTaskService.listTasks({
      seller_id: sellerId,
      priority,
      page,
      limit,
    });

    // Enrich with stage info for each task
    const stages = await opsTaskService.listStages();
    const stageMap = {};
    for (const stage of stages) {
      stageMap[stage.id] = { slug: stage.slug, label: stage.label, color: stage.color, is_terminal: stage.is_terminal };
      for (const sub of stage.substages || []) {
        stageMap[sub.id] = { slug: sub.slug, label: sub.label, color: sub.color, parent: stage.slug };
      }
    }

    const enriched = tasks.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      due_date: task.due_date,
      is_overdue: task.due_date ? new Date(task.due_date) < new Date() : false,
      task_type: task.task_type,
      stage: stageMap[task.stage_id] || null,
      substage: task.substage_id ? (stageMap[task.substage_id] || null) : null,
      assignee: task.assignee ? {
        id: task.assignee.id,
        name: task.assignee.full_name,
        avatar_url: task.assignee.avatar_url,
      } : null,
      tags: task.tags || [],
      links_count: task.links_count || 0,
      created_at: task.created_at,
    }));

    res.set('Cache-Control', 'private, max-age=60');
    return res.json({ success: true, data: enriched, pagination: { page, limit } });
  } catch (err) {
    logger.error(`[${TAG}] getSellerTasks error`, { error: err.message, sellerId: req.params?.sellerId });
    return res.status(500).json({ success: false, error: 'internal_error' });
  }
};

// ── B-OPS-3: Task Activity Log ──────────────────────────────────────────────

exports.getTaskActivity = async (req, res) => {
  try {
    const { sellerId, taskId } = req.params;
    if (!sellerId || !taskId) {
      return res.status(400).json({ success: false, error: 'seller_id_and_task_id_required' });
    }

    // Verify task belongs to this seller (security: can't access other seller's tasks)
    const task = await opsTaskService.getTask(taskId);
    if (task.seller_id !== sellerId) {
      return res.status(403).json({ success: false, error: 'task_not_owned_by_seller' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, parseInt(req.query.limit, 10) || 20);

    const activity = await opsTaskService.getActivityLog(taskId, { page, limit });

    const mapped = (activity || []).map(entry => ({
      id: entry.id,
      action: entry.action,
      from_value: entry.from_value,
      to_value: entry.to_value,
      comment: entry.comment,
      actor: entry.actor ? {
        id: entry.actor.id,
        name: entry.actor.full_name,
        avatar_url: entry.actor.avatar_url,
      } : null,
      created_at: entry.created_at,
    }));

    res.set('Cache-Control', 'private, max-age=30');
    return res.json({ success: true, data: mapped, pagination: { page, limit } });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ success: false, error: 'task_not_found' });
    }
    logger.error(`[${TAG}] getTaskActivity error`, { error: err.message, taskId: req.params?.taskId });
    return res.status(500).json({ success: false, error: 'internal_error' });
  }
};

// ── B-OPS-4: Live Platform Metrics (channel-scoped) ─────────────────────────

exports.getLiveMetrics = async (req, res) => {
  try {
    const days = Math.min(90, parseInt(req.query.days, 10) || 30);
    const metrics = await opsMetricsService.computeLiveMetrics(days);

    res.set('Cache-Control', 'private, max-age=300');
    return res.json({ success: true, data: metrics });
  } catch (err) {
    logger.error(`[${TAG}] getLiveMetrics error`, { error: err.message });
    return res.status(500).json({ success: false, error: 'internal_error' });
  }
};
