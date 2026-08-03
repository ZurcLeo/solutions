'use strict';

/**
 * opsTaskService.js — OPS-002: Kanban pipeline task management.
 *
 * CRUD para stages e tasks, activity log, real-time Socket.IO emit.
 */

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const TAG = 'opsTaskService';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase indisponivel');
  return client;
}

// ── Internal helper ─────────────────────────────────────────────────────────

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

function _emitSocket(req, event, payload) {
  try {
    if (req?.io) {
      req.io.to('ops-admin').emit(event, payload);
    }
  } catch (err) {
    logger.warn(`[${TAG}] Socket emit failed`, { event, error: err.message });
  }
}

function _emitAgenda(req, event, task) {
  try {
    if (!req?.io) return;
    if (task.seller_id) req.io.to(`agenda:seller:${task.seller_id}`).emit(event, task);
    if (task.assignee_id) req.io.to(`agenda:user:${task.assignee_id}`).emit(event, task);
  } catch (err) {
    logger.warn(`[${TAG}] Agenda emit failed`, { event, error: err.message });
  }
}

// ── Stages ──────────────────────────────────────────────────────────────────

async function listStages() {
  const { data, error } = await sb()
    .from('ops_pipeline_stages')
    .select('*')
    .is('parent_stage_id', null)
    .order('sort_order', { ascending: true });
  if (error) throw error;

  // Fetch substages and nest them
  const { data: subs, error: subsErr } = await sb()
    .from('ops_pipeline_stages')
    .select('*')
    .not('parent_stage_id', 'is', null)
    .order('sort_order', { ascending: true });
  if (subsErr) throw subsErr;

  const subsByParent = {};
  for (const sub of subs || []) {
    if (!subsByParent[sub.parent_stage_id]) subsByParent[sub.parent_stage_id] = [];
    subsByParent[sub.parent_stage_id].push(sub);
  }

  return (data || []).map(stage => ({
    ...stage,
    substages: subsByParent[stage.id] || [],
  }));
}

async function createStage(payload) {
  const { data, error } = await sb()
    .from('ops_pipeline_stages')
    .insert({
      slug: payload.slug,
      label: payload.label,
      sort_order: payload.sort_order ?? 0,
      color: payload.color ?? '#6B7280',
      is_terminal: payload.is_terminal ?? false,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateStage(id, updates) {
  const { data, error } = await sb()
    .from('ops_pipeline_stages')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteStage(id) {
  // Check if stage has tasks
  const { count } = await sb()
    .from('ops_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('stage_id', id);
  if (count > 0) {
    const err = new Error('Nao e possivel excluir stage com tasks vinculadas');
    err.statusCode = 409;
    throw err;
  }
  const { error } = await sb()
    .from('ops_pipeline_stages')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ── Substages ───────────────────────────────────────────────────────────────

async function listSubstages(stageId) {
  const { data, error } = await sb()
    .from('ops_pipeline_stages')
    .select('*')
    .eq('parent_stage_id', stageId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data;
}

async function createSubstage(stageId, payload) {
  const { data, error } = await sb()
    .from('ops_pipeline_stages')
    .insert({
      slug: payload.slug,
      label: payload.label,
      color: payload.color ?? '#6B7280',
      sort_order: payload.sort_order ?? 0,
      parent_stage_id: stageId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateSubstage(id, updates) {
  const allowed = ['label', 'color', 'sort_order'];
  const patch = {};
  for (const k of allowed) if (updates[k] !== undefined) patch[k] = updates[k];
  if (Object.keys(patch).length === 0) return null;

  const { data, error } = await sb()
    .from('ops_pipeline_stages')
    .update(patch)
    .eq('id', id)
    .not('parent_stage_id', 'is', null) // safety: only substages
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteSubstage(id) {
  // Check no tasks reference this substage
  const { count } = await sb()
    .from('ops_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('substage_id', id);
  if (count > 0) {
    const err = new Error('Nao e possivel excluir substágio com tasks vinculadas');
    err.statusCode = 409;
    throw err;
  }
  const { error } = await sb()
    .from('ops_pipeline_stages')
    .delete()
    .eq('id', id)
    .not('parent_stage_id', 'is', null); // safety
  if (error) throw error;
}

// ── Tasks ───────────────────────────────────────────────────────────────────

async function listTasks(filters = {}) {
  let query = sb()
    .from('ops_tasks')
    .select('*, seller_profiles(id, business_name), assignee:users!ops_tasks_assignee_id_fkey(id, full_name, avatar_url), ops_task_links(id)')
    .order('sort_order', { ascending: true });

  if (filters.stage_id) query = query.eq('stage_id', filters.stage_id);
  if (filters.assignee_id) query = query.eq('assignee_id', filters.assignee_id);
  if (filters.seller_id) query = query.eq('seller_id', filters.seller_id);
  if (filters.priority) query = query.eq('priority', filters.priority);
  if (filters.search) query = query.ilike('title', `%${filters.search}%`);

  // Default: exclude archived unless explicitly requested
  if (filters.archived === true) {
    query = query.eq('is_archived', true);
  } else {
    query = query.eq('is_archived', false);
  }

  // Pagination
  const page = Math.max(1, filters.page || 1);
  const limit = Math.min(100, filters.limit || 200);
  const from = (page - 1) * limit;
  query = query.range(from, from + limit - 1);

  const { data, error } = await query;
  if (error) throw error;

  // Map links to links_count for card display
  return (data || []).map(task => ({
    ...task,
    links_count: task.ops_task_links?.length || 0,
    ops_task_links: undefined,
  }));
}

async function getTask(id) {
  const { data, error } = await sb()
    .from('ops_tasks')
    .select('*, seller_profiles(id, business_name), assignee:users!ops_tasks_assignee_id_fkey(id, full_name, avatar_url), ops_task_links(*)')
    .eq('id', id)
    .single();
  if (error) {
    if (error.code === 'PGRST116') {
      const e = new Error('Task nao encontrada');
      e.statusCode = 404;
      throw e;
    }
    throw error;
  }
  // Rename for clarity
  data.links = data.ops_task_links || [];
  delete data.ops_task_links;
  return data;
}

async function createTask(data, actorId, req) {
  const payload = {
    title: data.title,
    description: data.description || null,
    stage_id: data.stage_id || null,
    seller_id: data.seller_id || null,
    assignee_id: data.assignee_id || null,
    priority: data.priority || 'medium',
    due_date: data.due_date || null,
    tags: data.tags || [],
    sort_order: data.sort_order ?? 0,
    created_by: actorId,
    // Agenda fields
    task_type: data.task_type || 'pipeline',
    substage_id: data.substage_id || null,
    scheduled_at: data.scheduled_at || null,
    scheduled_end: data.scheduled_end || null,
    duration_minutes: data.duration_minutes || null,
    document_refs: data.document_refs || [],
  };

  const { data: task, error } = await sb()
    .from('ops_tasks')
    .insert(payload)
    .select('*, seller_profiles(id, business_name), assignee:users!ops_tasks_assignee_id_fkey(id, full_name, avatar_url)')
    .single();
  if (error) throw error;

  const action = payload.scheduled_at ? 'scheduled' : 'created';
  await _logActivity(task.id, actorId, action, null, null, null);
  _emitSocket(req, 'ops:task_created', task);
  _emitAgenda(req, 'agenda:task_created', task);

  try { require('./opsSlackBridge').notifyTaskCreated(task); } catch (_) { /* optional */ }

  logger.info(`[${TAG}] task created`, { id: task.id, type: task.task_type, stage: task.stage_id });
  return task;
}

async function updateTask(id, updates, actorId, req) {
  // Fetch current for diff
  const current = await getTask(id);

  const allowed = ['title', 'description', 'priority', 'due_date', 'tags', 'sort_order', 'seller_id',
    'scheduled_at', 'scheduled_end', 'duration_minutes', 'substage_id'];
  const patch = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) patch[key] = updates[key];
  }

  if (Object.keys(patch).length === 0) return current;

  const { data: updated, error } = await sb()
    .from('ops_tasks')
    .update(patch)
    .eq('id', id)
    .select('*, seller_profiles(id, business_name), assignee:users!ops_tasks_assignee_id_fkey(id, full_name, avatar_url)')
    .single();
  if (error) throw error;

  // Log specific changes
  if (updates.priority && updates.priority !== current.priority) {
    await _logActivity(id, actorId, 'priority_changed', current.priority, updates.priority, null);
  }
  if (updates.due_date !== undefined && updates.due_date !== current.due_date) {
    const action = current.due_date ? 'due_date_changed' : 'due_date_set';
    await _logActivity(id, actorId, action, current.due_date, updates.due_date, null);
  }
  if (updates.title && updates.title !== current.title) {
    await _logActivity(id, actorId, 'edited', current.title, updates.title, null);
  }
  if (updates.substage_id !== undefined && updates.substage_id !== current.substage_id) {
    await _logActivity(id, actorId, 'substage_changed', current.substage_id, updates.substage_id, null);
  }

  _emitSocket(req, 'ops:task_updated', updated);
  _emitAgenda(req, 'agenda:task_updated', updated);

  // Slack notification with diff (fire-and-forget)
  try {
    const changes = {};
    if (updates.title && updates.title !== current.title) changes.title = { from: current.title, to: updates.title };
    if (updates.priority && updates.priority !== current.priority) changes.priority = { from: current.priority, to: updates.priority };
    if (updates.due_date !== undefined && updates.due_date !== current.due_date) changes.due_date = { from: current.due_date, to: updates.due_date };
    if (Object.keys(changes).length > 0) require('./opsSlackBridge').notifyTaskUpdated(updated, changes);
  } catch (_) { /* optional */ }

  return updated;
}

async function moveTask(id, stageId, sortOrder, actorId, req) {
  const current = await getTask(id);

  const { data: updated, error } = await sb()
    .from('ops_tasks')
    .update({ stage_id: stageId, sort_order: sortOrder ?? current.sort_order })
    .eq('id', id)
    .select('*, seller_profiles(id, business_name), assignee:users!ops_tasks_assignee_id_fkey(id, full_name, avatar_url)')
    .single();
  if (error) throw error;

  // Resolve stage labels for activity log
  const stages = await listStages();
  const fromStage = stages.find(s => s.id === current.stage_id);
  const toStage = stages.find(s => s.id === stageId);

  // Reset substage when moving between stages
  if (current.stage_id !== stageId && updated.substage_id) {
    await sb().from('ops_tasks').update({ substage_id: null }).eq('id', id);
    updated.substage_id = null;
  }

  await _logActivity(id, actorId, 'moved', fromStage?.label || current.stage_id, toStage?.label || stageId, null);
  _emitSocket(req, 'ops:task_moved', { task: updated, from_stage: fromStage, to_stage: toStage });
  _emitAgenda(req, 'agenda:task_updated', updated);

  // Slack notification (fire-and-forget)
  try {
    const opsSlackBridge = require('./opsSlackBridge');
    opsSlackBridge.notifyTaskMoved(updated, fromStage, toStage);
  } catch (_) { /* slack bridge optional */ }

  return updated;
}

async function assignTask(id, assigneeId, actorId, req) {
  const current = await getTask(id);

  const { data: updated, error } = await sb()
    .from('ops_tasks')
    .update({ assignee_id: assigneeId || null })
    .eq('id', id)
    .select('*, seller_profiles(id, business_name), assignee:users!ops_tasks_assignee_id_fkey(id, full_name, avatar_url)')
    .single();
  if (error) throw error;

  await _logActivity(id, actorId, 'assigned', current.assignee_id, assigneeId, null);
  _emitSocket(req, 'ops:task_assigned', updated);
  _emitAgenda(req, 'agenda:task_assigned', updated);

  try { require('./opsSlackBridge').notifyTaskAssigned(updated); } catch (_) { /* optional */ }

  return updated;
}

async function addComment(id, comment, actorId, req) {
  await getTask(id); // ensure exists
  await _logActivity(id, actorId, 'commented', null, null, comment);

  const { data: entry, error } = await sb()
    .from('ops_activity_log')
    .select('*, actor:users!ops_activity_log_actor_id_fkey(id, full_name, avatar_url)')
    .eq('task_id', id)
    .eq('action', 'commented')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  _emitSocket(req, 'ops:task_commented', { task_id: id, activity: entry || { comment, actor_id: actorId } });

  try {
    const actorName = entry?.actor?.full_name || null;
    require('./opsSlackBridge').notifyTaskCommented(id, comment, actorName);
  } catch (_) { /* optional */ }

  return entry;
}

async function archiveTask(id, actorId, req) {
  const { data, error } = await sb()
    .from('ops_tasks')
    .update({ is_archived: true })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;

  await _logActivity(id, actorId, 'archived', null, null, null);
  _emitSocket(req, 'ops:task_archived', data);

  try { require('./opsSlackBridge').notifyTaskArchived(data, false); } catch (_) { /* optional */ }

  return data;
}

async function unarchiveTask(id, actorId, req) {
  const { data, error } = await sb()
    .from('ops_tasks')
    .update({ is_archived: false })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;

  await _logActivity(id, actorId, 'unarchived', null, null, null);
  _emitSocket(req, 'ops:task_archived', { ...data, unarchived: true });

  try { require('./opsSlackBridge').notifyTaskArchived(data, true); } catch (_) { /* optional */ }

  return data;
}

async function getActivityLog(taskId, pagination = {}) {
  const page = Math.max(1, pagination.page || 1);
  const limit = Math.min(100, pagination.limit || 50);
  const from = (page - 1) * limit;

  const { data, error } = await sb()
    .from('ops_activity_log')
    .select('*, actor:users!ops_activity_log_actor_id_fkey(id, full_name, avatar_url)')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);
  if (error) throw error;
  return data;
}

// ── Dashboard helpers ───────────────────────────────────────────────────────

async function getPendingTaskCounts() {
  const stages = await listStages();
  const counts = {};

  for (const stage of stages) {
    const { count, error } = await sb()
      .from('ops_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('stage_id', stage.id)
      .eq('is_archived', false);
    counts[stage.slug] = error ? 0 : count;
  }
  return counts;
}

async function getOverdueTasks() {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await sb()
    .from('ops_tasks')
    .select('*, seller_profiles(id, business_name), assignee:users!ops_tasks_assignee_id_fkey(id, full_name, avatar_url)')
    .lt('due_date', today)
    .eq('is_archived', false)
    .order('due_date', { ascending: true });
  if (error) throw error;
  return data;
}

// ── Task Links ──────────────────────────────────────────────────────────────

async function addTaskLink(taskId, linkType, linkId, linkMeta, actorId) {
  await getTask(taskId); // ensure exists
  const { data, error } = await sb()
    .from('ops_task_links')
    .insert({
      task_id: taskId,
      link_type: linkType,
      link_id: linkId,
      link_meta: linkMeta || {},
      created_by: actorId,
    })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') {
      const e = new Error('Link ja existe para esta task');
      e.statusCode = 409;
      throw e;
    }
    throw error;
  }
  await _logActivity(taskId, actorId, 'link_added', null, `${linkType}:${linkId}`, null);
  return data;
}

async function removeTaskLink(taskId, linkId, actorId) {
  const { data, error } = await sb()
    .from('ops_task_links')
    .delete()
    .eq('id', linkId)
    .eq('task_id', taskId)
    .select()
    .single();
  if (error) {
    if (error.code === 'PGRST116') {
      const e = new Error('Link nao encontrado');
      e.statusCode = 404;
      throw e;
    }
    throw error;
  }
  await _logActivity(taskId, actorId, 'link_removed', `${data.link_type}:${data.link_id}`, null, null);
  return data;
}

async function getTaskLinks(taskId) {
  const { data, error } = await sb()
    .from('ops_task_links')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function searchSupportTickets({ search, sellerId, page, limit }) {
  const pg = Math.max(1, page || 1);
  const lim = Math.min(50, limit || 15);
  const from = (pg - 1) * lim;

  let query = sb()
    .from('support_tickets')
    .select('id, subject, status, priority, category, user_id, created_at')
    .order('created_at', { ascending: false })
    .range(from, from + lim - 1);

  if (search) {
    query = query.or(`subject.ilike.%${search}%,id.ilike.%${search}%`);
  }

  if (sellerId) {
    // Get user_ids linked to this seller (owner)
    const { data: sellerData } = await sb()
      .from('seller_profiles')
      .select('user_id')
      .eq('id', sellerId)
      .single();
    if (sellerData?.user_id) {
      query = query.eq('user_id', sellerData.user_id);
    }
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// ── Agenda-specific functions ────────────────────────────────────────────────

async function listAgendaTasks(filters = {}) {
  let query = sb()
    .from('ops_tasks')
    .select('*, seller_profiles(id, business_name), assignee:users!ops_tasks_assignee_id_fkey(id, full_name, avatar_url)')
    .in('task_type', ['agenda', 'milestone', 'seller_internal'])
    .eq('is_archived', false)
    .order('scheduled_at', { ascending: true });

  if (filters.seller_id) query = query.eq('seller_id', filters.seller_id);
  if (filters.assignee_id) query = query.eq('assignee_id', filters.assignee_id);
  if (filters.task_type) query = query.eq('task_type', filters.task_type);
  if (filters.from) query = query.gte('scheduled_at', filters.from);
  if (filters.to) query = query.lte('scheduled_at', filters.to);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function rescheduleTask(id, scheduledAt, scheduledEnd, actorId, req) {
  const current = await getTask(id);

  const patch = { scheduled_at: scheduledAt };
  if (scheduledEnd !== undefined) patch.scheduled_end = scheduledEnd;

  const { data: updated, error } = await sb()
    .from('ops_tasks')
    .update(patch)
    .eq('id', id)
    .select('*, seller_profiles(id, business_name), assignee:users!ops_tasks_assignee_id_fkey(id, full_name, avatar_url)')
    .single();
  if (error) throw error;

  await _logActivity(id, actorId, 'rescheduled', current.scheduled_at, scheduledAt, null);
  _emitSocket(req, 'ops:task_updated', updated);
  _emitAgenda(req, 'agenda:task_rescheduled', updated);

  try {
    require('./opsSlackBridge').notifyTaskRescheduled(updated, current.scheduled_at, scheduledAt);
  } catch (_) { /* optional */ }

  return updated;
}

async function moveSubstage(taskId, substageId, actorId, req) {
  const current = await getTask(taskId);

  const { data: updated, error } = await sb()
    .from('ops_tasks')
    .update({ substage_id: substageId || null })
    .eq('id', taskId)
    .select('*, seller_profiles(id, business_name), assignee:users!ops_tasks_assignee_id_fkey(id, full_name, avatar_url)')
    .single();
  if (error) throw error;

  await _logActivity(taskId, actorId, 'substage_changed', current.substage_id, substageId, null);
  _emitSocket(req, 'ops:task_updated', updated);
  _emitAgenda(req, 'agenda:task_updated', updated);

  try {
    require('./opsSlackBridge').notifySubstageChanged(updated, current.substage_id, substageId);
  } catch (_) { /* optional */ }

  return updated;
}

async function attachDocument(taskId, docRef, actorId) {
  const current = await getTask(taskId);
  const refs = [...(current.document_refs || []), docRef];

  const { data, error } = await sb()
    .from('ops_tasks')
    .update({ document_refs: refs })
    .eq('id', taskId)
    .select()
    .single();
  if (error) throw error;

  await _logActivity(taskId, actorId, 'document_attached', null, docRef.name, null);
  return data;
}

async function removeDocument(taskId, index, actorId) {
  const current = await getTask(taskId);
  const refs = [...(current.document_refs || [])];
  if (index < 0 || index >= refs.length) {
    const err = new Error('Indice de documento invalido');
    err.statusCode = 400;
    throw err;
  }
  const removed = refs.splice(index, 1)[0];

  const { data, error } = await sb()
    .from('ops_tasks')
    .update({ document_refs: refs })
    .eq('id', taskId)
    .select()
    .single();
  if (error) throw error;

  await _logActivity(taskId, actorId, 'document_removed', removed.name, null, null);
  return data;
}

async function getUnifiedTimeline(filters = {}) {
  let query = sb()
    .from('unified_timeline_events')
    .select('*')
    .order('scheduled_at', { ascending: true });

  if (filters.seller_id) query = query.eq('seller_id', filters.seller_id);
  if (filters.assignee_id) query = query.eq('assignee_id', filters.assignee_id);
  if (filters.from) query = query.gte('scheduled_at', filters.from);
  if (filters.to) query = query.lte('scheduled_at', filters.to);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

module.exports = {
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
  getPendingTaskCounts,
  getOverdueTasks,
  // Task links
  addTaskLink,
  removeTaskLink,
  getTaskLinks,
  searchSupportTickets,
  // Agenda
  listAgendaTasks,
  rescheduleTask,
  moveSubstage,
  attachDocument,
  removeDocument,
  getUnifiedTimeline,
};
