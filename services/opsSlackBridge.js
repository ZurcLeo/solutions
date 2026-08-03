'use strict';

/**
 * opsSlackBridge.js — OPS-004: Fire-and-forget Slack notifications.
 *
 * Posts to Slack webhook with Block Kit formatting.
 * Reads config from ops_notification_channels.
 */

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const TAG = 'opsSlackBridge';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase indisponivel');
  return client;
}

async function _getActiveWebhooks(eventType) {
  try {
    const { data } = await sb()
      .from('ops_notification_channels')
      .select('webhook_url, events')
      .eq('channel', 'slack')
      .eq('is_active', true);

    return (data || []).filter(ch =>
      ch.events.length === 0 || ch.events.includes(eventType)
    );
  } catch (err) {
    logger.warn(`[${TAG}] Failed to fetch Slack webhooks`, { error: err.message });
    return [];
  }
}

async function _postSlack(webhookUrl, blocks) {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    });
    if (!response.ok) {
      logger.warn(`[${TAG}] Slack POST failed`, { status: response.status });
    }
  } catch (err) {
    logger.warn(`[${TAG}] Slack POST error`, { error: err.message });
  }
}

async function notifyTaskMoved(task, fromStage, toStage) {
  const channels = await _getActiveWebhooks('task_moved');
  if (channels.length === 0) return;

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Task Movida — Pipeline Ops', emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Task:*\n${task.title}` },
        { type: 'mrkdwn', text: `*Prioridade:*\n${task.priority}` },
        { type: 'mrkdwn', text: `*De:*\n${fromStage?.label || '—'}` },
        { type: 'mrkdwn', text: `*Para:*\n${toStage?.label || '—'}` },
      ],
    },
  ];

  if (task.seller_profiles?.business_name) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Seller: *${task.seller_profiles.business_name}*` }],
    });
  }

  for (const ch of channels) {
    _postSlack(ch.webhook_url, blocks);
  }
}

async function notifyTaskCreated(task) {
  const channels = await _getActiveWebhooks('task_created');
  if (channels.length === 0) return;

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: 'Nova Task — Pipeline Ops', emoji: true } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Task:*\n${task.title}` },
        { type: 'mrkdwn', text: `*Prioridade:*\n${task.priority || 'medium'}` },
      ],
    },
  ];
  if (task.assignee?.full_name) {
    blocks[1].fields.push({ type: 'mrkdwn', text: `*Atribuida a:*\n${task.assignee.full_name}` });
  }
  if (task.seller_profiles?.business_name) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Seller: *${task.seller_profiles.business_name}*` }] });
  }
  for (const ch of channels) _postSlack(ch.webhook_url, blocks);
}

async function notifyTaskUpdated(task, changes) {
  const channels = await _getActiveWebhooks('task_updated');
  if (channels.length === 0) return;

  const changeLines = Object.entries(changes)
    .map(([k, { from, to }]) => `• *${k}:* ${from || '—'} → ${to}`)
    .join('\n');

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: 'Task Editada — Pipeline Ops', emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${task.title}*\n${changeLines}` } },
  ];
  if (task.seller_profiles?.business_name) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Seller: *${task.seller_profiles.business_name}*` }] });
  }
  for (const ch of channels) _postSlack(ch.webhook_url, blocks);
}

async function notifyTaskAssigned(task) {
  const channels = await _getActiveWebhooks('task_assigned');
  if (channels.length === 0) return;

  const assigneeName = task.assignee?.full_name || 'Ninguem (removida)';
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: 'Task Atribuida — Pipeline Ops', emoji: true } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Task:*\n${task.title}` },
        { type: 'mrkdwn', text: `*Atribuida a:*\n${assigneeName}` },
      ],
    },
  ];
  if (task.seller_profiles?.business_name) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Seller: *${task.seller_profiles.business_name}*` }] });
  }
  for (const ch of channels) _postSlack(ch.webhook_url, blocks);
}

async function notifyTaskCommented(taskId, comment, actorName) {
  const channels = await _getActiveWebhooks('task_commented');
  if (channels.length === 0) return;

  const preview = comment.length > 200 ? comment.slice(0, 200) + '...' : comment;
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: 'Novo Comentario — Pipeline Ops', emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${actorName || 'Alguem'}* comentou:\n>${preview}` } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `Task ID: \`${taskId}\`` }] },
  ];
  for (const ch of channels) _postSlack(ch.webhook_url, blocks);
}

async function notifyTaskArchived(task, unarchived) {
  const eventType = 'task_archived';
  const channels = await _getActiveWebhooks(eventType);
  if (channels.length === 0) return;

  const action = unarchived ? 'Desarquivada' : 'Arquivada';
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `Task ${action} — Pipeline Ops`, emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${task.title || task.id}*` } },
  ];
  for (const ch of channels) _postSlack(ch.webhook_url, blocks);
}

async function notifyAgendaTaskCreated(task) {
  const channels = await _getActiveWebhooks('agenda_task_created');
  if (channels.length === 0) return;

  const dateStr = task.scheduled_at
    ? new Date(task.scheduled_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : '—';

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: 'Nova Tarefa de Agenda — Ops', emoji: true } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Task:*\n${task.title}` },
        { type: 'mrkdwn', text: `*Agendada:*\n${dateStr}` },
        { type: 'mrkdwn', text: `*Tipo:*\n${task.task_type || 'agenda'}` },
        { type: 'mrkdwn', text: `*Prioridade:*\n${task.priority || 'medium'}` },
      ],
    },
  ];
  if (task.seller_profiles?.business_name) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Seller: *${task.seller_profiles.business_name}*` }] });
  }
  for (const ch of channels) _postSlack(ch.webhook_url, blocks);
}

async function notifyTaskRescheduled(task, oldDate, newDate) {
  const channels = await _getActiveWebhooks('task_rescheduled');
  if (channels.length === 0) return;

  const fmt = (d) => d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: 'Tarefa Reagendada — Ops', emoji: true } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Task:*\n${task.title}` },
        { type: 'mrkdwn', text: `*De:*\n${fmt(oldDate)}` },
        { type: 'mrkdwn', text: `*Para:*\n${fmt(newDate)}` },
      ],
    },
  ];
  if (task.seller_profiles?.business_name) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Seller: *${task.seller_profiles.business_name}*` }] });
  }
  for (const ch of channels) _postSlack(ch.webhook_url, blocks);
}

async function notifySubstageChanged(task, fromSubstage, toSubstage) {
  const channels = await _getActiveWebhooks('substage_changed');
  if (channels.length === 0) return;

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: 'Substágio Alterado — Ops', emoji: true } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Task:*\n${task.title}` },
        { type: 'mrkdwn', text: `*De:*\n${fromSubstage || 'Geral'}` },
        { type: 'mrkdwn', text: `*Para:*\n${toSubstage || 'Geral'}` },
      ],
    },
  ];
  for (const ch of channels) _postSlack(ch.webhook_url, blocks);
}

async function notifyAlert(alertType, data) {
  const channels = await _getActiveWebhooks(alertType);
  if (channels.length === 0) return;

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Alerta Ops: ${alertType}`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) },
    },
  ];

  for (const ch of channels) {
    _postSlack(ch.webhook_url, blocks);
  }
}

module.exports = {
  notifyTaskCreated,
  notifyTaskUpdated,
  notifyTaskMoved,
  notifyTaskAssigned,
  notifyTaskCommented,
  notifyTaskArchived,
  notifyAgendaTaskCreated,
  notifyTaskRescheduled,
  notifySubstageChanged,
  notifyAlert,
};
