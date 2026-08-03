'use strict';

/**
 * @fileoverview Admin Communications Controller
 * Painel unificado para notificações, emails e OTP.
 * Endpoints admin-only para relatório cruzado, preview HTML e emissão manual.
 */

const Joi = require('joi');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const TAG = 'AdminCommunications';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

// ── Relatório Unificado ──────────────────────────────────────

/**
 * GET /api/admin/communications/report
 * Timeline unificada: notification_jobs + email_logs + security_tickets
 */
exports.getReport = async (req, res) => {
  const schema = Joi.object({
    userId: Joi.string().optional(),
    email: Joi.string().email().optional(),
    from: Joi.string().isoDate().optional(),
    to: Joi.string().isoDate().optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(30),
  });

  const { error, value } = schema.validate(req.query);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const { userId, email, from, to, page, limit } = value;
  const offset = (page - 1) * limit;

  try {
    // Resolve userId from email if needed
    let resolvedUserId = userId;
    if (!resolvedUserId && email) {
      const { data: user } = await sb()
        .from('users')
        .select('id')
        .eq('email', email)
        .maybeSingle();
      resolvedUserId = user?.id;
      if (!resolvedUserId) {
        return res.json({ success: true, data: [], pagination: { page, limit, total: 0 }, resolvedUser: null });
      }
    }

    if (!resolvedUserId) {
      return res.status(400).json({ error: 'userId ou email é obrigatório' });
    }

    // Fetch user info
    const { data: userInfo } = await sb()
      .from('users')
      .select('id, nome, email, telefone')
      .eq('id', resolvedUserId)
      .maybeSingle();

    // Parallel queries for all 3 systems
    const [notifResult, emailResult, otpResult] = await Promise.all([
      _queryNotifications(resolvedUserId, from, to),
      _queryEmails(resolvedUserId, from, to),
      _queryOtps(resolvedUserId, from, to),
    ]);

    // Merge into unified timeline
    const timeline = [
      ...notifResult.map(n => ({
        source: 'notification',
        id: n.id,
        type: n.type,
        status: n.status,
        channels: n.channels,
        triggeredBy: n.metadata?.triggeredBy || 'system',
        created_at: n.created_at,
        hasPreview: true,
      })),
      ...emailResult.map(e => ({
        source: 'email',
        id: e.id,
        type: e.template_type,
        status: e.status,
        subject: e.subject,
        recipient: e.recipient_to,
        messageId: e.message_id,
        referenceType: e.reference_type,
        referenceId: e.reference_id,
        created_at: e.created_at,
        hasPreview: true,
      })),
      ...otpResult.map(o => ({
        source: 'otp',
        id: o.id,
        type: o.type,
        status: o.status,
        channel: 'email', // Currently email-only
        attempts: o.attempts_count,
        ipAddress: o.ip_address,
        created_at: o.created_at,
        hasPreview: false,
      })),
    ];

    // Sort by created_at DESC
    timeline.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const total = timeline.length;
    const paginated = timeline.slice(offset, offset + limit);

    res.json({
      success: true,
      data: paginated,
      user: userInfo,
      pagination: { page, limit, total },
      summary: {
        notifications: notifResult.length,
        emails: emailResult.length,
        otps: otpResult.length,
      },
    });
  } catch (err) {
    logger.error(`[${TAG}] getReport error`, { error: err.message });
    res.status(500).json({ error: err.message });
  }
};

// ── Listar Notificações ──────────────────────────────────────

/**
 * GET /api/admin/communications/notifications
 */
exports.listNotifications = async (req, res) => {
  const schema = Joi.object({
    userId: Joi.string().optional(),
    type: Joi.string().optional(),
    status: Joi.string().valid('pending', 'processing', 'completed', 'failed', 'retrying').optional(),
    from: Joi.string().isoDate().optional(),
    to: Joi.string().isoDate().optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(30),
  });

  const { error, value } = schema.validate(req.query);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const { userId, type, status, from, to, page, limit } = value;
  const offset = (page - 1) * limit;

  try {
    let query = sb()
      .from('notification_jobs')
      .select('id, user_id, type, importance, channels, status, attempts, triggered_by, metadata, created_at, completed_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (userId) query = query.eq('user_id', userId);
    if (type) query = query.eq('type', type);
    if (status) query = query.eq('status', status);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data, count, error: queryErr } = await query;
    if (queryErr) throw queryErr;

    res.json({ success: true, data, pagination: { page, limit, total: count } });
  } catch (err) {
    logger.error(`[${TAG}] listNotifications error`, { error: err.message });
    res.status(500).json({ error: err.message });
  }
};

// ── Listar Emails ────────────────────────────────────────────

/**
 * GET /api/admin/communications/emails
 */
exports.listEmails = async (req, res) => {
  const schema = Joi.object({
    userId: Joi.string().optional(),
    email: Joi.string().email().optional(),
    templateType: Joi.string().optional(),
    status: Joi.string().valid('pending', 'sent', 'delivered', 'bounced', 'complained', 'error', 'resent', 'canceled').optional(),
    from: Joi.string().isoDate().optional(),
    to: Joi.string().isoDate().optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(30),
  });

  const { error, value } = schema.validate(req.query);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const { userId, email, templateType, status, from, to, page, limit } = value;
  const offset = (page - 1) * limit;

  try {
    let query = sb()
      .from('email_logs')
      .select('id, recipient_to, subject, template_type, status, message_id, reference_type, reference_id, user_id, error_message, retry_count, created_at, sent_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (userId) query = query.eq('user_id', userId);
    if (email) query = query.eq('recipient_to', email);
    if (templateType) query = query.eq('template_type', templateType);
    if (status) query = query.eq('status', status);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data, count, error: queryErr } = await query;
    if (queryErr) throw queryErr;

    res.json({ success: true, data, pagination: { page, limit, total: count } });
  } catch (err) {
    logger.error(`[${TAG}] listEmails error`, { error: err.message });
    res.status(500).json({ error: err.message });
  }
};

// ── Listar OTPs ──────────────────────────────────────────────

/**
 * GET /api/admin/communications/otps
 */
exports.listOtps = async (req, res) => {
  const schema = Joi.object({
    userId: Joi.string().optional(),
    type: Joi.string().valid('login', 'saque', 'kyc', 'email_verify', 'pagamento_pix', 'recovery_email_verify', 'account_recovery').optional(),
    status: Joi.string().valid('pending', 'used', 'expired').optional(),
    from: Joi.string().isoDate().optional(),
    to: Joi.string().isoDate().optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(30),
  });

  const { error, value } = schema.validate(req.query);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const { userId, type, status, from, to, page, limit } = value;
  const offset = (page - 1) * limit;

  try {
    let query = sb()
      .from('security_tickets')
      .select('id, user_id, type, status, attempts_count, ip_address, locked_until, metadata, used_at, created_at, expires_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (userId) query = query.eq('user_id', userId);
    if (type) query = query.eq('type', type);
    if (status) query = query.eq('status', status);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data, count, error: queryErr } = await query;
    if (queryErr) throw queryErr;

    res.json({ success: true, data, pagination: { page, limit, total: count } });
  } catch (err) {
    logger.error(`[${TAG}] listOtps error`, { error: err.message });
    res.status(500).json({ error: err.message });
  }
};

// ── Preview Email HTML ───────────────────────────────────────

/**
 * GET /api/admin/communications/emails/:id/preview
 * Re-renderiza o HTML do email a partir do template_type + template_data salvos
 */
exports.previewEmail = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: emailLog, error } = await sb()
      .from('email_logs')
      .select('template_type, template_data, subject, recipient_to')
      .eq('id', id)
      .single();

    if (error || !emailLog) {
      return res.status(404).json({ error: 'Email não encontrado' });
    }

    const templates = require('../templates/emails/index');
    const templateFn = templates[emailLog.template_type];

    if (!templateFn || typeof templateFn !== 'function') {
      return res.json({
        success: true,
        html: null,
        message: `Template "${emailLog.template_type}" não encontrado — não é possível re-renderizar.`,
        meta: { subject: emailLog.subject, recipient: emailLog.recipient_to, templateType: emailLog.template_type },
      });
    }

    const html = templateFn(emailLog.template_data || {});

    res.json({
      success: true,
      html,
      meta: { subject: emailLog.subject, recipient: emailLog.recipient_to, templateType: emailLog.template_type },
    });
  } catch (err) {
    logger.error(`[${TAG}] previewEmail error`, { error: err.message, id: req.params.id });
    res.status(500).json({ error: err.message });
  }
};

// ── Preview Notification Content ─────────────────────────────

/**
 * GET /api/admin/communications/notifications/:id/preview
 * Retorna o conteúdo renderizado da notification_job (content JSONB)
 */
exports.previewNotification = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: job, error } = await sb()
      .from('notification_jobs')
      .select('type, content, channels, importance, metadata, created_at')
      .eq('id', id)
      .single();

    if (error || !job) {
      return res.status(404).json({ error: 'Notification job não encontrada' });
    }

    res.json({
      success: true,
      content: job.content,
      meta: { type: job.type, channels: job.channels, importance: job.importance, created_at: job.created_at },
    });
  } catch (err) {
    logger.error(`[${TAG}] previewNotification error`, { error: err.message, id: req.params.id });
    res.status(500).json({ error: err.message });
  }
};

// ── Emitir Notificação ───────────────────────────────────────

/**
 * POST /api/admin/communications/emit-notification
 * Dispara uma notificação via NotificationDispatcher
 */
exports.emitNotification = async (req, res) => {
  const schema = Joi.object({
    userId: Joi.string().required(),
    type: Joi.string().required(),
    importance: Joi.string().valid('high', 'low').default('low'),
    data: Joi.object().default({}),
  });

  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const NotificationDispatcher = require('../services/NotificationDispatcher');
    const result = await NotificationDispatcher.dispatch({
      userId: value.userId,
      type: value.type,
      importance: value.importance,
      data: value.data,
      metadata: { triggeredBy: `admin:${req.user.uid}` },
    });

    logger.info(`[${TAG}] Notification emitted by admin`, { adminId: req.user.uid, targetUserId: value.userId, type: value.type });

    res.json({ success: true, ...result });
  } catch (err) {
    logger.error(`[${TAG}] emitNotification error`, { error: err.message });
    res.status(500).json({ error: err.message });
  }
};

// ── Emitir Email ─────────────────────────────────────────────

/**
 * POST /api/admin/communications/emit-email
 * Envia um email via emailService
 */
exports.emitEmail = async (req, res) => {
  const schema = Joi.object({
    to: Joi.string().email().required(),
    subject: Joi.string().min(3).max(200).required(),
    templateType: Joi.string().default('padrao'),
    data: Joi.object().default({}),
    userId: Joi.string().optional(),
  });

  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const emailService = require('../services/emailService');
    const result = await emailService.sendEmail({
      to: value.to,
      subject: value.subject,
      templateType: value.templateType,
      data: value.data,
      userId: value.userId,
      reference: `admin_emit_${Date.now()}`,
      referenceType: 'admin_manual',
    });

    logger.info(`[${TAG}] Email emitted by admin`, { adminId: req.user.uid, to: value.to, templateType: value.templateType });

    res.json({ success: true, ...result });
  } catch (err) {
    logger.error(`[${TAG}] emitEmail error`, { error: err.message });
    res.status(500).json({ error: err.message });
  }
};

// ── Stats Rápidos ────────────────────────────────────────────

/**
 * GET /api/admin/communications/stats
 * Contadores rápidos para o dashboard card
 */
exports.getStats = async (req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [notifCount, emailCount, otpCount, failedCount] = await Promise.all([
      sb().from('notification_jobs').select('id', { count: 'exact', head: true }).gte('created_at', since),
      sb().from('email_logs').select('id', { count: 'exact', head: true }).gte('created_at', since),
      sb().from('security_tickets').select('id', { count: 'exact', head: true }).gte('created_at', since),
      sb().from('notification_jobs').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', since),
    ]);

    res.json({
      success: true,
      stats: {
        notifications24h: notifCount.count || 0,
        emails24h: emailCount.count || 0,
        otps24h: otpCount.count || 0,
        failed24h: failedCount.count || 0,
      },
    });
  } catch (err) {
    logger.error(`[${TAG}] getStats error`, { error: err.message });
    res.status(500).json({ error: err.message });
  }
};

// ── Helpers ──────────────────────────────────────────────────

async function _queryNotifications(userId, from, to) {
  let query = sb()
    .from('notification_jobs')
    .select('id, type, status, channels, importance, metadata, created_at, completed_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data, error } = await query;
  if (error) { logger.warn(`[${TAG}] _queryNotifications error`, { error: error.message }); return []; }
  return data || [];
}

async function _queryEmails(userId, from, to) {
  let query = sb()
    .from('email_logs')
    .select('id, template_type, subject, recipient_to, status, message_id, reference_type, reference_id, created_at, sent_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data, error } = await query;
  if (error) { logger.warn(`[${TAG}] _queryEmails error`, { error: error.message }); return []; }
  return data || [];
}

async function _queryOtps(userId, from, to) {
  let query = sb()
    .from('security_tickets')
    .select('id, type, status, attempts_count, ip_address, metadata, used_at, created_at, expires_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data, error } = await query;
  if (error) { logger.warn(`[${TAG}] _queryOtps error`, { error: error.message }); return []; }
  return data || [];
}
