// services/emailDeliveryService.js
// GAP 1: Processa webhooks de delivery do Resend, gerencia reputação de destinatários

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const SVC = 'emailDeliveryService';

// Mapa de event_type do Resend → status do email_logs
const EVENT_TO_STATUS = {
  'email.sent':             'sent',
  'email.delivered':        'delivered',
  'email.delivery_delayed': 'delivery_delayed',
  'email.bounced':          'bounced',
  'email.complained':       'complained',
};

// Ordem de progressão de status (forward-only, exceto bounced/complained que sempre sobrescrevem)
const STATUS_RANK = {
  pending:          0,
  sent:             1,
  delivered:        2,
  delivery_delayed: 1, // mesmo nível de sent
  canceled:         99,
  error:            99,
  resent:           99,
};

// Thresholds para auto-suppress
const HARD_BOUNCE_THRESHOLD = 3;
const COMPLAINT_THRESHOLD   = 2;

/**
 * Processa um evento de delivery do Resend.
 * 1. Registra em email_delivery_events
 * 2. Atualiza email_logs.status (forward-only)
 * 3. Atualiza reputação do destinatário
 */
async function processEvent(eventType, eventData) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    logger.error('Supabase not available for delivery event processing', { service: SVC });
    return;
  }

  const messageId = eventData.email_id || eventData.id;
  const recipient = _extractRecipient(eventData);

  if (!messageId) {
    logger.warn('Delivery event sem message_id, ignorado', { service: SVC, eventType });
    return;
  }

  // 1. Buscar email_log correspondente
  const { data: emailLog } = await supabase
    .from('email_logs')
    .select('id, status')
    .eq('message_id', messageId)
    .maybeSingle();

  // 2. Inserir evento na tabela de delivery events
  const eventRecord = {
    email_log_id:  emailLog?.id || null,
    message_id:    messageId,
    event_type:    eventType,
    recipient:     recipient || 'unknown',
    bounce_type:   eventData.bounce?.type || null,
    bounce_reason: eventData.bounce?.message || eventData.bounce?.description || null,
    raw_payload:   eventData,
  };

  const { error: insertErr } = await supabase
    .from('email_delivery_events')
    .insert(eventRecord);

  if (insertErr) {
    logger.error('Falha ao inserir delivery event', { service: SVC, error: insertErr.message, eventType, messageId });
  }

  // 3. Atualizar status do email_logs (forward-only)
  const newStatus = EVENT_TO_STATUS[eventType];
  if (emailLog?.id && newStatus) {
    const currentRank = STATUS_RANK[emailLog.status] ?? -1;
    const newRank     = STATUS_RANK[newStatus] ?? -1;

    // bounced/complained sempre sobrescrevem; demais só se rank maior
    const shouldUpdate = ['bounced', 'complained'].includes(newStatus) || newRank > currentRank;

    if (shouldUpdate) {
      const { error: updateErr } = await supabase
        .from('email_logs')
        .update({ status: newStatus })
        .eq('id', emailLog.id);

      if (updateErr) {
        logger.warn('Falha ao atualizar email_logs status', { service: SVC, emailLogId: emailLog.id, newStatus, error: updateErr.message });
      } else {
        logger.info('Email status atualizado via delivery webhook', { service: SVC, emailLogId: emailLog.id, oldStatus: emailLog.status, newStatus });
      }
    }
  }

  // 4. Atualizar reputação do destinatário
  if (recipient && (eventType === 'email.bounced' || eventType === 'email.complained')) {
    await _updateReputation(supabase, recipient, eventType, eventData);
  }
}

/**
 * Verifica se o destinatário está suprimido (não deve receber emails).
 */
async function isRecipientSuppressed(recipient) {
  if (!recipient) return false;

  const supabase = getSupabaseClient();
  if (!supabase) return false;

  try {
    const { data } = await supabase
      .from('email_recipient_reputation')
      .select('is_suppressed')
      .eq('recipient', recipient.toLowerCase())
      .maybeSingle();

    return data?.is_suppressed === true;
  } catch (err) {
    logger.warn('Erro ao verificar suppression', { service: SVC, recipient, error: err.message });
    return false;
  }
}

/**
 * Retorna estatísticas de delivery para dashboard admin.
 */
async function getDeliveryStats({ days = 30 } = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase not available');

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: events, error } = await supabase
    .from('email_delivery_events')
    .select('event_type')
    .gte('created_at', since);

  if (error) throw error;

  const counts = { sent: 0, delivered: 0, bounced: 0, complained: 0, delayed: 0, opened: 0, clicked: 0 };
  for (const e of (events || [])) {
    switch (e.event_type) {
      case 'email.sent':             counts.sent++;      break;
      case 'email.delivered':        counts.delivered++;  break;
      case 'email.bounced':          counts.bounced++;    break;
      case 'email.complained':       counts.complained++; break;
      case 'email.delivery_delayed': counts.delayed++;    break;
      case 'email.opened':           counts.opened++;     break;
      case 'email.clicked':          counts.clicked++;    break;
    }
  }

  const total = counts.sent || 1;
  return {
    ...counts,
    total: counts.sent,
    deliveryRate: Math.round((counts.delivered / total) * 100 * 100) / 100,
    bounceRate:   Math.round((counts.bounced / total) * 100 * 100) / 100,
    days,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _extractRecipient(eventData) {
  if (eventData.to && Array.isArray(eventData.to)) return eventData.to[0]?.toLowerCase();
  if (typeof eventData.to === 'string') return eventData.to.toLowerCase();
  if (eventData.email) return eventData.email.toLowerCase();
  return null;
}

async function _updateReputation(supabase, recipient, eventType, eventData) {
  const normalized = recipient.toLowerCase();
  const now = new Date().toISOString();

  // Buscar registro atual
  const { data: current } = await supabase
    .from('email_recipient_reputation')
    .select('*')
    .eq('recipient', normalized)
    .maybeSingle();

  const bounceCount    = (current?.bounce_count || 0) + (eventType === 'email.bounced' ? 1 : 0);
  const complaintCount = (current?.complaint_count || 0) + (eventType === 'email.complained' ? 1 : 0);

  const isHardBounce = eventData.bounce?.type === 'hard' || eventType === 'email.complained';
  const hardBounceCount = isHardBounce && eventType === 'email.bounced'
    ? bounceCount
    : (current?.bounce_count || 0);

  // Auto-suppress: 3 hard bounces OU 2 complaints
  const shouldSuppress = hardBounceCount >= HARD_BOUNCE_THRESHOLD || complaintCount >= COMPLAINT_THRESHOLD;

  const payload = {
    recipient:         normalized,
    bounce_count:      bounceCount,
    complaint_count:   complaintCount,
    last_bounce_at:    eventType === 'email.bounced' ? now : (current?.last_bounce_at || null),
    last_complaint_at: eventType === 'email.complained' ? now : (current?.last_complaint_at || null),
    is_suppressed:     shouldSuppress,
    suppressed_at:     shouldSuppress && !current?.is_suppressed ? now : (current?.suppressed_at || null),
    updated_at:        now,
  };

  const { error } = await supabase
    .from('email_recipient_reputation')
    .upsert(payload, { onConflict: 'recipient' });

  if (error) {
    logger.warn('Falha ao atualizar reputação do destinatário', { service: SVC, recipient: normalized, error: error.message });
  } else if (shouldSuppress && !current?.is_suppressed) {
    logger.warn('Destinatário auto-suprimido', { service: SVC, recipient: normalized, bounceCount, complaintCount });
  }
}

module.exports = { processEvent, isRecipientSuppressed, getDeliveryStats };
