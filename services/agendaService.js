'use strict';

/**
 * agendaService.js — AGENDA-003: User/Seller-facing agenda service.
 *
 * Separated from opsTaskService because auth context is different:
 * - Admin uses requireAdmin
 * - Seller uses requireSellerTeamAccess
 * - User uses requireAuth
 */

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const TAG = 'agendaService';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase indisponivel');
  return client;
}

// ── Socket emit strategy ────────────────────────────────────────────────────

function _emitToAffected(req, event, task) {
  try {
    if (!req?.io) return;
    // Always notify admin room
    req.io.to('ops-admin').emit(event, task);
    // Notify seller room
    if (task.seller_id) req.io.to(`agenda:seller:${task.seller_id}`).emit(event, task);
    // Notify assignee room
    if (task.assignee_id) req.io.to(`agenda:user:${task.assignee_id}`).emit(event, task);
  } catch (err) {
    logger.warn(`[${TAG}] Socket emit failed`, { event, error: err.message });
  }
}

// ── Activity log (fire-and-forget) ──────────────────────────────────────────

async function _logActivity(taskId, actorId, action, fromValue, toValue, comment) {
  const { error } = await sb()
    .from('ops_activity_log')
    .insert({
      task_id: taskId,
      actor_id: actorId,
      action,
      from_value: fromValue || null,
      to_value: toValue || null,
      comment: comment || null,
    });
  if (error) {
    logger.warn(`[${TAG}] _logActivity failed`, { taskId, action, error: error.message });
  }
}

// ── User-facing ─────────────────────────────────────────────────────────────

async function getMyAgendaTasks(userId, { from, to } = {}) {
  let query = sb()
    .from('ops_tasks')
    .select('*, seller_profiles(id, business_name)')
    .eq('assignee_id', userId)
    .neq('task_type', 'pipeline')
    .eq('is_archived', false)
    .order('scheduled_at', { ascending: true });

  if (from) query = query.gte('scheduled_at', from);
  if (to) query = query.lte('scheduled_at', to);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function getMyUnifiedTimeline(userId, from, to) {
  let query = sb()
    .from('unified_timeline_events')
    .select('*')
    .eq('assignee_id', userId)
    .order('scheduled_at', { ascending: true });

  if (from) query = query.gte('scheduled_at', from);
  if (to) query = query.lte('scheduled_at', to);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// ── Seller-facing ───────────────────────────────────────────────────────────

async function getSellerAgendaTasks(sellerId, { from, to } = {}) {
  let query = sb()
    .from('ops_tasks')
    .select('*, assignee:users!ops_tasks_assignee_id_fkey(id, full_name, avatar_url)')
    .eq('seller_id', sellerId)
    .in('task_type', ['agenda', 'seller_internal', 'milestone'])
    .eq('is_archived', false)
    .order('scheduled_at', { ascending: true });

  if (from) query = query.gte('scheduled_at', from);
  if (to) query = query.lte('scheduled_at', to);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function createSellerInternalTask(sellerId, data, actorId, req) {
  const payload = {
    title: data.title,
    description: data.description || null,
    seller_id: sellerId,
    assignee_id: data.assignee_id || null,
    priority: data.priority || 'medium',
    due_date: data.due_date || null,
    tags: data.tags || [],
    created_by: actorId,
    task_type: 'seller_internal',
    scheduled_at: data.scheduled_at,
    scheduled_end: data.scheduled_end || null,
    duration_minutes: data.duration_minutes || null,
    document_refs: data.document_refs || [],
  };

  const { data: task, error } = await sb()
    .from('ops_tasks')
    .insert(payload)
    .select('*, assignee:users!ops_tasks_assignee_id_fkey(id, full_name, avatar_url)')
    .single();
  if (error) throw error;

  await _logActivity(task.id, actorId, 'scheduled', null, null, null);
  _emitToAffected(req, 'agenda:task_created', task);

  logger.info(`[${TAG}] seller_internal task created`, { id: task.id, seller: sellerId });
  return task;
}

async function updateSellerInternalTask(sellerId, taskId, updates, actorId, req) {
  // Verify task belongs to seller and is seller_internal
  const { data: current, error: fetchErr } = await sb()
    .from('ops_tasks')
    .select('*')
    .eq('id', taskId)
    .eq('seller_id', sellerId)
    .eq('task_type', 'seller_internal')
    .single();
  if (fetchErr || !current) {
    const err = new Error('Task nao encontrada ou sem permissao');
    err.statusCode = 404;
    throw err;
  }

  const allowed = ['title', 'description', 'priority', 'due_date', 'tags',
    'scheduled_at', 'scheduled_end', 'duration_minutes', 'assignee_id'];
  const patch = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) patch[key] = updates[key];
  }
  if (Object.keys(patch).length === 0) return current;

  const { data: updated, error } = await sb()
    .from('ops_tasks')
    .update(patch)
    .eq('id', taskId)
    .select('*, assignee:users!ops_tasks_assignee_id_fkey(id, full_name, avatar_url)')
    .single();
  if (error) throw error;

  if (updates.scheduled_at && updates.scheduled_at !== current.scheduled_at) {
    await _logActivity(taskId, actorId, 'rescheduled', current.scheduled_at, updates.scheduled_at, null);
  }

  _emitToAffected(req, 'agenda:task_updated', updated);
  return updated;
}

async function getUnifiedSellerTimeline(sellerId, from, to) {
  let query = sb()
    .from('unified_timeline_events')
    .select('*')
    .eq('seller_id', sellerId)
    .order('scheduled_at', { ascending: true });

  if (from) query = query.gte('scheduled_at', from);
  if (to) query = query.lte('scheduled_at', to);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

module.exports = {
  // User
  getMyAgendaTasks,
  getMyUnifiedTimeline,
  // Seller
  getSellerAgendaTasks,
  createSellerInternalTask,
  updateSellerInternalTask,
  getUnifiedSellerTimeline,
};
