// models/SupportTicket.js — Supabase-first (migrado de Firestore em 2026-05-19)
const { getSupabaseClient } = require('../config/supabase');
const { getFirestore } = require('../firebaseAdmin');
const { randomUUID } = require('crypto');
const { logger } = require('../logger');

const TABLE = 'support_tickets';

// ─── Categorias de Suporte (mantidas intactas) ───────────────────────────────

const SUPPORT_CATEGORIES = {
  FINANCIAL: {
    name: 'financial',
    modules: ['wallet', 'payment', 'transaction', 'mercadopago', 'stripe'],
    issues: {
      PAYMENT_FAILED: 'payment_failed',
      BALANCE_INCORRECT: 'balance_incorrect',
      REFUND_NEEDED: 'refund_needed',
      WITHDRAWAL_FAILED: 'withdrawal_failed',
      CHARGE_DISPUTE: 'charge_dispute'
    }
  },
  CAIXINHA: {
    name: 'caixinha',
    modules: ['caixinha', 'contribution', 'groups'],
    issues: {
      CANT_CONTRIBUTE: 'cant_contribute',
      MEMBER_ISSUE: 'member_issue',
      PAYOUT_PROBLEM: 'payout_problem',
      GROUP_ACCESS: 'group_access',
      INVITE_PROBLEM: 'invite_problem'
    }
  },
  LOAN: {
    name: 'loan',
    modules: ['loan', 'emprestimo'],
    issues: {
      APPROVAL_DELAYED: 'approval_delayed',
      PAYMENT_ISSUE: 'payment_issue',
      TERMS_DISPUTE: 'terms_dispute',
      INTEREST_CALCULATION: 'interest_calculation'
    }
  },
  ACCOUNT: {
    name: 'account',
    modules: ['auth', 'profile', 'user'],
    issues: {
      LOGIN_FAILED: 'login_failed',
      ACCOUNT_LOCKED: 'account_locked',
      DATA_UPDATE_FAILED: 'data_update_failed',
      VERIFICATION_ISSUE: 'verification_issue',
      PASSWORD_RESET: 'password_reset'
    }
  },
  TECHNICAL: {
    name: 'technical',
    modules: ['app', 'api', 'system'],
    issues: {
      APP_CRASH: 'app_crash',
      SYNC_ERROR: 'sync_error',
      PERFORMANCE_ISSUE: 'performance_issue',
      API_ERROR: 'api_error',
      FEATURE_NOT_WORKING: 'feature_not_working'
    }
  },
  SECURITY: {
    name: 'security',
    modules: ['auth', 'account', 'fraud'],
    issues: {
      ACCOUNT_COMPROMISED: 'account_compromised',
      SUSPICIOUS_ACTIVITY: 'suspicious_activity',
      FRAUD_REPORT: 'fraud_report',
      UNAUTHORIZED_ACCESS: 'unauthorized_access'
    }
  },
  GENERAL: {
    name: 'general',
    modules: ['app', 'support'],
    issues: {
      FEATURE_REQUEST: 'feature_request',
      GENERAL_INQUIRY: 'general_inquiry',
      FEEDBACK: 'feedback',
      OTHER: 'other'
    }
  }
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

function mapTicket(row) {
  if (!row) return null;
  const ctx = row.context || {};
  return {
    id:                   row.id,
    userId:               row.user_id,
    userName:             row.user_name           || null,
    userEmail:            row.user_email          || null,
    userPhotoURL:         ctx.userPhotoURL         || null,
    category:             row.category            || 'general',
    module:               row.module              || 'app',
    issueType:            row.issue_type          || 'other',
    status:               row.status              || 'pending',
    priority:             row.priority            || 'medium',
    title:                row.subject             || 'Solicitação de Suporte',
    description:          row.description         || '',
    context:              ctx,
    conversationId:       row.conversation_id     || null,
    conversationHistory:  row.conversation_history || [],
    assignedTo:           row.assigned_to         || null,
    assignedAt:           row.assigned_at         || null,
    resolvedAt:           row.resolved_at         || null,
    closedAt:             row.closed_at           || null,
    resolutionSummary:    row.resolution          || '',
    firstResponseDueAt:   row.first_response_due_at  || null,
    resolutionDueAt:      row.resolution_due_at      || null,
    firstRespondedAt:     row.first_responded_at     || null,
    slaBreached:          row.sla_breached            || false,
    slaFirstResponseBreached: row.sla_first_response_breached || false,
    notes:                row.notes               || [],
    internalNotes:        row.internal_notes      || [],
    tags:                 row.tags                || [],
    userAgent:            ctx.userAgent           || '',
    deviceInfo:           ctx.deviceInfo          || {},
    sessionData:          ctx.sessionData         || {},
    errorLogs:            ctx.errorLogs           || [],
    lastMessageSnippet:   row.last_message_snippet || '',
    csatScore:            row.csat_score            ?? null,
    csatComment:          row.csat_comment          || null,
    csatRespondedAt:      row.csat_responded_at     || null,
    csatSurveyToken:      row.csat_survey_token     || null,
    csatSurveySentAt:     row.csat_survey_sent_at   || null,
    createdAt:            row.created_at ? new Date(row.created_at) : new Date(),
    updatedAt:            row.updated_at ? new Date(row.updated_at) : new Date(),
    requestedAt:          row.created_at ? new Date(row.created_at) : new Date(),
  };
}

function toRow(data) {
  // Campos técnicos extras são mesclados no context JSONB
  const ctx = {
    ...(data.context          || {}),
    ...(data.userPhotoURL  && { userPhotoURL: data.userPhotoURL }),
    ...(data.userAgent     && { userAgent:    data.userAgent }),
    ...(data.deviceInfo    && { deviceInfo:   data.deviceInfo }),
    ...(data.sessionData   && { sessionData:  data.sessionData }),
    ...(data.errorLogs     && { errorLogs:    data.errorLogs }),
  };

  const row = {};
  if (data.userId        !== undefined) row.user_id              = data.userId;
  if (data.userName      !== undefined) row.user_name            = data.userName;
  if (data.userEmail     !== undefined) row.user_email           = data.userEmail;
  if (data.category      !== undefined) row.category             = data.category;
  if (data.module        !== undefined) row.module               = data.module;
  if (data.issueType     !== undefined) row.issue_type           = data.issueType;
  if (data.status        !== undefined) row.status               = data.status;
  if (data.priority      !== undefined) row.priority             = data.priority;
  if (data.title         !== undefined) row.subject              = data.title;
  if (data.subject       !== undefined) row.subject              = data.subject;
  if (data.description   !== undefined) row.description          = data.description;
  if (Object.keys(ctx).length)          row.context              = ctx;
  if (data.conversationId !== undefined)  row.conversation_id    = data.conversationId;
  if (data.conversationHistory !== undefined) row.conversation_history = data.conversationHistory;
  if (data.assignedTo    !== undefined) row.assigned_to          = data.assignedTo;
  if (data.assignedAt    !== undefined) row.assigned_at          = data.assignedAt ? new Date(data.assignedAt).toISOString() : null;
  if (data.resolvedAt    !== undefined) row.resolved_at          = data.resolvedAt ? new Date(data.resolvedAt).toISOString() : null;
  if (data.closedAt      !== undefined) row.closed_at            = data.closedAt   ? new Date(data.closedAt).toISOString()   : null;
  if (data.resolutionSummary !== undefined) row.resolution        = data.resolutionSummary;
  if (data.resolution    !== undefined) row.resolution           = data.resolution;
  if (data.notes         !== undefined) row.notes                = data.notes;
  if (data.internalNotes !== undefined) row.internal_notes       = data.internalNotes;
  if (data.tags          !== undefined) row.tags                 = data.tags;
  if (data.attachments   !== undefined) row.attachments          = data.attachments;
  if (data.lastMessageSnippet !== undefined) row.last_message_snippet = data.lastMessageSnippet;
  if (data.firstResponseDueAt !== undefined) row.first_response_due_at = data.firstResponseDueAt ? new Date(data.firstResponseDueAt).toISOString() : null;
  if (data.resolutionDueAt    !== undefined) row.resolution_due_at     = data.resolutionDueAt    ? new Date(data.resolutionDueAt).toISOString()    : null;
  if (data.firstRespondedAt   !== undefined) row.first_responded_at    = data.firstRespondedAt   ? new Date(data.firstRespondedAt).toISOString()   : null;
  if (data.slaBreached        !== undefined) row.sla_breached          = data.slaBreached;
  if (data.slaFirstResponseBreached !== undefined) row.sla_first_response_breached = data.slaFirstResponseBreached;
  if (data.csatScore        !== undefined) row.csat_score           = data.csatScore;
  if (data.csatComment      !== undefined) row.csat_comment         = data.csatComment;
  if (data.csatRespondedAt  !== undefined) row.csat_responded_at    = data.csatRespondedAt  ? new Date(data.csatRespondedAt).toISOString()  : null;
  if (data.csatSurveyToken  !== undefined) row.csat_survey_token    = data.csatSurveyToken;
  if (data.csatSurveySentAt !== undefined) row.csat_survey_sent_at  = data.csatSurveySentAt ? new Date(data.csatSurveySentAt).toISOString() : null;

  return row;
}

// ─── Classe SupportTicket ─────────────────────────────────────────────────────

class SupportTicket {
  constructor(data) {
    this.id                  = data.id;
    this.userId              = data.userId;
    this.userName            = data.userName;
    this.userEmail           = data.userEmail;
    this.userPhotoURL        = data.userPhotoURL;

    this.category            = data.category   || 'general';
    this.module              = data.module     || 'app';
    this.issueType           = data.issueType  || 'other';

    this.status              = data.status     || 'pending';
    this.priority            = data.priority   || 'medium';

    this.title               = data.title      || 'Solicitação de Suporte';
    this.description         = data.description || '';
    this.context             = data.context    || {};

    this.conversationId      = data.conversationId      || null;
    this.conversationHistory = data.conversationHistory || [];

    this.assignedTo          = data.assignedTo          || null;
    this.assignedAt          = data.assignedAt          || null;
    this.resolvedAt          = data.resolvedAt          || null;
    this.closedAt            = data.closedAt            || null;
    this.resolutionSummary   = data.resolutionSummary   || '';

    this.firstResponseDueAt  = data.firstResponseDueAt  || null;
    this.resolutionDueAt     = data.resolutionDueAt     || null;
    this.firstRespondedAt    = data.firstRespondedAt    || null;
    this.slaBreached         = data.slaBreached         || false;
    this.slaFirstResponseBreached = data.slaFirstResponseBreached || false;

    this.notes               = data.notes               || [];
    this.internalNotes       = data.internalNotes       || [];
    this.tags                = data.tags                || [];

    this.userAgent           = data.userAgent  || '';
    this.deviceInfo          = data.deviceInfo || {};
    this.sessionData         = data.sessionData || {};
    this.errorLogs           = data.errorLogs  || [];

    this.createdAt           = data.createdAt || new Date();
    this.updatedAt           = data.updatedAt || new Date();
    this.requestedAt         = data.requestedAt || data.createdAt || new Date();
    this.lastMessageSnippet  = data.lastMessageSnippet || (this.description || '').substring(0, 100);

    this.csatScore        = data.csatScore        ?? null;
    this.csatComment      = data.csatComment      || null;
    this.csatRespondedAt  = data.csatRespondedAt  || null;
    this.csatSurveyToken  = data.csatSurveyToken  || null;
    this.csatSurveySentAt = data.csatSurveySentAt || null;
  }

  static get CATEGORIES() {
    return SUPPORT_CATEGORIES;
  }

  static getCategoryByModule(module) {
    for (const category of Object.values(SUPPORT_CATEGORIES)) {
      if (category.modules.includes(module)) return category.name;
    }
    return 'general';
  }

  static getIssuesByCategory(categoryName) {
    const category = Object.values(SUPPORT_CATEGORIES).find(cat => cat.name === categoryName);
    return category ? category.issues : SUPPORT_CATEGORIES.GENERAL.issues;
  }

  toPlainObject() {
    const obj = { ...this };
    const toISO = (v) => v instanceof Date ? v.toISOString() : v?.toDate ? v.toDate().toISOString() : v;
    obj.createdAt    = toISO(obj.createdAt);
    obj.updatedAt    = toISO(obj.updatedAt);
    obj.requestedAt  = toISO(obj.requestedAt);
    obj.assignedAt   = toISO(obj.assignedAt);
    obj.resolvedAt       = toISO(obj.resolvedAt);
    obj.closedAt         = toISO(obj.closedAt);
    obj.csatRespondedAt  = toISO(obj.csatRespondedAt);
    obj.csatSurveySentAt = toISO(obj.csatSurveySentAt);
    return obj;
  }

  // ── Escrita ─────────────────────────────────────────────────────────────────

  static async create(ticketData) {
    const ticketId = randomUUID();
    const row = {
      id: ticketId,
      ...toRow({
        ...ticketData,
        lastMessageSnippet: ticketData.lastMessageSnippet || (ticketData.description || '').substring(0, 100),
      }),
      // garantir defaults explícitos
      status:   ticketData.status   || 'pending',
      priority: ticketData.priority || 'medium',
      subject:  ticketData.title    || ticketData.subject || 'Solicitação de Suporte',
    };

    const { data: created, error } = await sb()
      .from(TABLE)
      .insert(row)
      .select()
      .single();

    if (error) throw error;

    logger.info('Support ticket criado', {
      ticketId, userId: ticketData.userId,
      category: ticketData.category, module: ticketData.module,
    });

    // Backup Firestore fire-and-forget
    try {
      const ticket = new SupportTicket({ ...ticketData, id: ticketId });
      getFirestore()
        .collection('supportTickets').doc(ticketId)
        .set(ticket.toPlainObject()).catch(() => {});
    } catch (_) {}

    return new SupportTicket(mapTicket(created));
  }

  static async update(ticketId, updateData) {
    const row = toRow(updateData);

    logger.info('SupportTicket.update — iniciando', {
      ticketId,
      status: updateData.status,
      hasConversationHistory: !!updateData.conversationHistory,
      hasInternalNotes: !!updateData.internalNotes,
    });

    const { data: updated, error } = await sb()
      .from(TABLE)
      .update(row)
      .eq('id', ticketId)
      .select()
      .single();

    if (error) throw error;

    logger.info('SupportTicket.update — concluído', { ticketId });

    // Backup Firestore fire-and-forget
    try {
      getFirestore()
        .collection('supportTickets').doc(ticketId)
        .update(updateData).catch(() => {});
    } catch (_) {}

    return new SupportTicket(mapTicket(updated));
  }

  // ── Leitura ─────────────────────────────────────────────────────────────────

  static async getById(ticketId) {
    const { data, error } = await sb()
      .from(TABLE)
      .select('*')
      .eq('id', ticketId)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      logger.warn('Support ticket não encontrado', { ticketId });
      return null;
    }
    return new SupportTicket(mapTicket(data));
  }

  static async getBySurveyToken(token) {
    const { data, error } = await sb()
      .from(TABLE)
      .select('*')
      .eq('csat_survey_token', token)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return new SupportTicket(mapTicket(data));
  }

  static async findByConversationId(conversationId, status = null) {
    let query = sb().from(TABLE).select('*').eq('conversation_id', conversationId);
    if (status) query = query.eq('status', status);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(row => new SupportTicket(mapTicket(row)));
  }

  static async findByUserId(userId, status = null, limit = 20) {
    let query = sb().from(TABLE).select('*').eq('user_id', userId);
    if (status) query = query.eq('status', status);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data || []).map(row => new SupportTicket(mapTicket(row)));
  }

  static async findByCategory(category, status = null, limit = 20) {
    let query = sb().from(TABLE).select('*').eq('category', category);
    if (status) query = query.eq('status', status);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data || []).map(row => new SupportTicket(mapTicket(row)));
  }

  static async findByModule(module, status = null, limit = 20) {
    let query = sb().from(TABLE).select('*').eq('module', module);
    if (status) query = query.eq('status', status);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data || []).map(row => new SupportTicket(mapTicket(row)));
  }

  static async getTicketsByStatus(status, limit = 20) {
    const { data, error } = await sb()
      .from(TABLE).select('*')
      .eq('status', status)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return (data || []).map(row => new SupportTicket(mapTicket(row)));
  }

  static async getTicketsByPriority(priority, limit = 20) {
    const { data, error } = await sb()
      .from(TABLE).select('*')
      .eq('priority', priority)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).map(row => new SupportTicket(mapTicket(row)));
  }

  static async getTicketsByAgent(agentId, status = 'active', limit = 20) {
    let query = sb()
      .from(TABLE).select('*')
      .eq('assigned_to', agentId);

    if (status === 'active' || !status) {
      // Todos os tickets "em tratativa": assigned + in_progress + waiting_user_response
      query = query.in('status', ['assigned', 'in_progress', 'waiting_user_response']);
    } else {
      query = query.eq('status', status);
    }

    const { data, error } = await query
      .order('assigned_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).map(row => new SupportTicket(mapTicket(row)));
  }

  static async getAllTickets(limit = 50, status = null) {
    let query = sb().from(TABLE).select('*');
    if (status) query = query.eq('status', status);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data || []).map(row => new SupportTicket(mapTicket(row)));
  }

  static async getAnalytics(timeRange = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - timeRange);

    const { data, error } = await sb()
      .from(TABLE).select('*')
      .gte('created_at', startDate.toISOString());

    if (error) throw error;
    const tickets = (data || []).map(row => new SupportTicket(mapTicket(row)));

    const resolvedTickets = tickets.filter(t => t.status === 'resolved' || t.status === 'closed');
    const csatTickets = resolvedTickets.filter(t => t.csatScore !== null && t.csatScore !== undefined);

    // ── Agent Workload ────────────────────────────────────────────────────────
    const ACTIVE_STATUSES = ['assigned', 'in_progress', 'waiting_user_response'];

    const agentMap = {};
    for (const t of tickets) {
      if (!t.assignedTo) continue;
      if (!agentMap[t.assignedTo]) agentMap[t.assignedTo] = { openTickets: 0, responseTimes: [] };
      if (ACTIVE_STATUSES.includes(t.status)) agentMap[t.assignedTo].openTickets++;
      if (t.firstRespondedAt && t.assignedAt) {
        const hrs = (new Date(t.firstRespondedAt) - new Date(t.assignedAt)) / (1000 * 60 * 60);
        if (hrs >= 0) agentMap[t.assignedTo].responseTimes.push(hrs);
      }
    }

    const agentWorkload = Object.entries(agentMap)
      .map(([agentId, d]) => ({
        agentId,
        openTickets: d.openTickets,
        avgFirstResponseHours: d.responseTimes.length > 0
          ? Math.round((d.responseTimes.reduce((s, v) => s + v, 0) / d.responseTimes.length) * 100) / 100
          : null,
      }))
      .sort((a, b) => b.openTickets - a.openTickets);

    const unassignedOpen = tickets.filter(
      t => !t.assignedTo && ACTIVE_STATUSES.includes(t.status)
    ).length;

    return {
      total:             tickets.length,
      byStatus:          this._groupBy(tickets, 'status'),
      byCategory:        this._groupBy(tickets, 'category'),
      byPriority:        this._groupBy(tickets, 'priority'),
      byModule:          this._groupBy(tickets, 'module'),
      avgResolutionTime: this._calculateAvgResolutionTime(tickets.filter(t => t.resolvedAt)),
      avgCsat:           csatTickets.length > 0
        ? Math.round((csatTickets.reduce((s, t) => s + t.csatScore, 0) / csatTickets.length) * 100) / 100
        : null,
      csatResponseRate:  resolvedTickets.length > 0
        ? Math.round((csatTickets.length / resolvedTickets.length) * 100) / 100
        : 0,
      csatResponses:     csatTickets.length,
      agentWorkload,
      unassignedOpen,
    };
  }

  // ── Vínculos entre tickets (SUPP-LINK-001) ───────────────────────────────────

  static async createLink(ticketId, linkedTicketId, linkType, createdBy) {
    const { data, error } = await sb()
      .from('support_ticket_links')
      .insert({ ticket_id: ticketId, linked_ticket_id: linkedTicketId, link_type: linkType, created_by: createdBy })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  static async getLinks(ticketId) {
    const [{ data: asSource, error: e1 }, { data: asTarget, error: e2 }] = await Promise.all([
      sb().from('support_ticket_links').select('*').eq('ticket_id', ticketId),
      sb().from('support_ticket_links').select('*').eq('linked_ticket_id', ticketId),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;

    // Normaliza: perspectiva sempre de ticketId como origem
    return [
      ...(asSource || []),
      ...(asTarget || []).map(r => ({
        ...r,
        ticket_id: r.linked_ticket_id,
        linked_ticket_id: r.ticket_id,
      })),
    ];
  }

  static async deleteLink(linkId) {
    const { error } = await sb()
      .from('support_ticket_links')
      .delete()
      .eq('id', linkId);
    if (error) throw error;
  }

  // ── Helpers privados ─────────────────────────────────────────────────────────

  static _groupBy(array, key) {
    return array.reduce((result, item) => {
      const group = item[key] || 'unknown';
      result[group] = (result[group] || 0) + 1;
      return result;
    }, {});
  }

  static _calculateAvgResolutionTime(resolvedTickets) {
    if (resolvedTickets.length === 0) return 0;
    const totalTime = resolvedTickets.reduce((sum, ticket) => {
      const created  = new Date(ticket.createdAt);
      const resolved = new Date(ticket.resolvedAt);
      return sum + (resolved.getTime() - created.getTime());
    }, 0);
    return Math.round(totalTime / resolvedTickets.length / (1000 * 60 * 60)); // horas
  }
}

module.exports = SupportTicket;
