/**
 * @fileoverview fiscalService — Módulo de Gestão de Obrigações Fiscais
 * Gerencia carteira de clientes, pendências, ciência e histórico imutável.
 *
 * Delegações externas:
 *   - game-agent     → gamificationService.triggerEvent
 *   - trust-agent    → trustPassportService.recordEvent
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger }            = require('../logger');
const gamificationService   = require('./gamificationService');

const SERVICE = 'fiscalService';

// ──────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

function log(fn, msg, extra = {}) {
  logger.info(msg, { service: SERVICE, function: fn, ...extra });
}

function logError(fn, err, extra = {}) {
  logger.error(`Erro em ${fn}: ${err.message}`, {
    service: SERVICE, function: fn, error: err.message, ...extra,
  });
}

/**
 * OBRIGATÓRIO antes de updates em seller_client_pendencias.
 * Garante rastreabilidade no trigger fn_audit_pendencia_update().
 */
async function setCurrentUser(userId) {
  await sb().rpc('set_config', {
    setting: 'app.current_user_id',
    value:   userId,
    is_local: true,
  });
}

const CLIENT_SAFE_COLS = 'id, seller_id, client_user_id, apelido, regime_tributario, notas_internas, status, created_by, created_at, updated_at';
const CLIENT_PUBLIC_COLS = 'id, seller_id, client_user_id, apelido, regime_tributario, status, created_at';
const PENDENCIA_COLS = 'id, seller_client_id, seller_id, tipo, titulo, descricao, prazo_legal, responsavel_user_id, criado_por_user_id, status, ciencia_registrada_em, ciencia_registrada_por, concluida_em, concluida_por, metadata, created_at, updated_at';

// ──────────────────────────────────────────────────────
// Carteira de clientes
// ──────────────────────────────────────────────────────

async function listClients(sellerId, { status = 'active' } = {}) {
  log('listClients', 'Listando clientes', { sellerId, status });

  let query = sb()
    .from('seller_clients')
    .select(`
      ${CLIENT_SAFE_COLS},
      client:client_user_id (id, full_name, email, avatar_url)
    `)
    .eq('seller_id', sellerId);

  if (status !== 'all') query = query.eq('status', status);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw new Error(`Erro ao listar clientes: ${error.message}`);
  return data || [];
}

async function createClient(sellerId, callerUserId, { client_user_id, apelido, regime_tributario, notas_internas }) {
  log('createClient', 'Criando cliente', { sellerId, client_user_id });

  if (!client_user_id) throw new Error('client_user_id é obrigatório');

  // Verificar se o user existe
  const { data: user, error: userErr } = await sb()
    .from('users')
    .select('id, full_name')
    .eq('id', client_user_id)
    .maybeSingle();

  if (userErr || !user) throw new Error('Usuário não encontrado');

  const { data, error } = await sb()
    .from('seller_clients')
    .insert({
      seller_id:       sellerId,
      client_user_id,
      apelido:         apelido || null,
      regime_tributario: regime_tributario || null,
      notas_internas:  notas_internas || null,
      created_by:      callerUserId,
    })
    .select(CLIENT_SAFE_COLS)
    .single();

  if (error) {
    if (error.code === '23505') throw new Error('Este usuário já é cliente desta loja');
    throw new Error(`Erro ao criar cliente: ${error.message}`);
  }

  // Gamification: client_added
  gamificationService.triggerEvent('client_added', callerUserId, { seller_id: sellerId })
    .catch(err => logError('createClient', err, { context: 'gamification' }));

  return data;
}

async function getClient(sellerId, clientId) {
  const { data, error } = await sb()
    .from('seller_clients')
    .select(`
      ${CLIENT_SAFE_COLS},
      client:client_user_id (id, full_name, email, avatar_url)
    `)
    .eq('id', clientId)
    .eq('seller_id', sellerId)
    .single();

  if (error) throw new Error(`Cliente não encontrado: ${error.message}`);
  return data;
}

async function updateClient(sellerId, clientId, updates) {
  const allowed = ['apelido', 'regime_tributario', 'notas_internas', 'status'];
  const sanitized = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) sanitized[key] = updates[key];
  }

  const { data, error } = await sb()
    .from('seller_clients')
    .update(sanitized)
    .eq('id', clientId)
    .eq('seller_id', sellerId)
    .select(CLIENT_SAFE_COLS)
    .single();

  if (error) throw new Error(`Erro ao atualizar cliente: ${error.message}`);
  return data;
}

async function archiveClient(sellerId, clientId) {
  return updateClient(sellerId, clientId, { status: 'archived' });
}

// ──────────────────────────────────────────────────────
// Pendências
// ──────────────────────────────────────────────────────

async function listPendencias(sellerId, { status, responsavel_user_id, seller_client_id } = {}) {
  log('listPendencias', 'Listando pendências', { sellerId });

  let query = sb()
    .from('seller_client_pendencias')
    .select(`
      ${PENDENCIA_COLS},
      client:seller_client_id (id, apelido, client_user_id,
        client_user:client_user_id (full_name, email)
      ),
      responsavel:responsavel_user_id (full_name, email, avatar_url)
    `)
    .eq('seller_id', sellerId);

  if (status) query = query.eq('status', status);
  if (responsavel_user_id) query = query.eq('responsavel_user_id', responsavel_user_id);
  if (seller_client_id) query = query.eq('seller_client_id', seller_client_id);

  const { data, error } = await query.order('prazo_legal', { ascending: true });
  if (error) throw new Error(`Erro ao listar pendências: ${error.message}`);
  return data || [];
}

async function createPendencia(sellerId, callerUserId, {
  seller_client_id, tipo, titulo, descricao, prazo_legal,
  responsavel_user_id, ciencia_confirmada = false, metadata,
}) {
  log('createPendencia', 'Criando pendência', { sellerId, seller_client_id, tipo });

  if (!seller_client_id || !tipo || !titulo || !prazo_legal) {
    throw new Error('seller_client_id, tipo, titulo e prazo_legal são obrigatórios');
  }

  const insertData = {
    seller_client_id,
    seller_id:            sellerId,
    tipo,
    titulo,
    descricao:            descricao || null,
    prazo_legal,
    responsavel_user_id:  responsavel_user_id || callerUserId,
    criado_por_user_id:   callerUserId,
    status:               'aberta',
    metadata:             metadata || {},
  };

  // Ciência obrigatória
  if (ciencia_confirmada) {
    insertData.ciencia_registrada_em  = new Date().toISOString();
    insertData.ciencia_registrada_por = callerUserId;
  }

  const { data, error } = await sb()
    .from('seller_client_pendencias')
    .insert(insertData)
    .select(PENDENCIA_COLS)
    .single();

  if (error) throw new Error(`Erro ao criar pendência: ${error.message}`);

  // Primeiro registro no histórico
  await sb()
    .from('seller_client_pendencia_historico')
    .insert({
      pendencia_id:    data.id,
      user_id:         callerUserId,
      acao:            'criou',
      descricao:       `Pendência criada: ${titulo}`,
      snapshot_status: 'aberta',
    });

  // Dispatch webhook notification (pendencia_created)
  try {
    const notificationDispatcher = require('./NotificationDispatcher');
    // Resolver telefone do cliente para webhook
    let clientPhone = null;
    let clientName = null;
    if (seller_client_id) {
      const { data: clientData } = await sb()
        .from('seller_clients')
        .select('client_user_id, client_user:client_user_id (full_name, telefone)')
        .eq('id', seller_client_id)
        .maybeSingle();
      clientPhone = clientData?.client_user?.telefone || null;
      clientName = clientData?.client_user?.full_name || null;
    }

    notificationDispatcher.dispatch({
      userId: responsavel_user_id || callerUserId,
      type: 'pendencia_created',
      importance: 'low',
      data: { titulo, pendenciaId: data.id, sellerId, clientPhone, clientName },
      dedupKey: `pendencia_created_${data.id}`,
    }).catch(() => {});
  } catch (_) { /* best-effort */ }

  return data;
}

async function updatePendencia(sellerId, pendenciaId, callerUserId, updates) {
  log('updatePendencia', 'Atualizando pendência', { pendenciaId });

  // Setar current_user para o trigger de auditoria
  await setCurrentUser(callerUserId);

  const allowed = ['titulo', 'descricao', 'prazo_legal', 'responsavel_user_id', 'status', 'metadata'];
  const sanitized = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) sanitized[key] = updates[key];
  }

  const { data, error } = await sb()
    .from('seller_client_pendencias')
    .update(sanitized)
    .eq('id', pendenciaId)
    .eq('seller_id', sellerId)
    .select(PENDENCIA_COLS)
    .single();

  if (error) throw new Error(`Erro ao atualizar pendência: ${error.message}`);
  return data;
}

async function resolvePendencia(sellerId, pendenciaId, callerUserId) {
  log('resolvePendencia', 'Concluindo pendência', { pendenciaId });

  await setCurrentUser(callerUserId);

  const now = new Date().toISOString();

  const { data, error } = await sb()
    .from('seller_client_pendencias')
    .update({
      status:       'concluida',
      concluida_em: now,
      concluida_por: callerUserId,
    })
    .eq('id', pendenciaId)
    .eq('seller_id', sellerId)
    .in('status', ['aberta', 'em_andamento'])
    .select(PENDENCIA_COLS)
    .single();

  if (error) throw new Error(`Erro ao concluir pendência: ${error.message}`);

  // Gamification: XP somente se concluída DENTRO do prazo
  const concluidaEm = new Date(now);
  const prazoLegal  = new Date(data.prazo_legal);

  if (concluidaEm <= prazoLegal) {
    gamificationService.triggerEvent('pendencia_resolved_no_prazo', callerUserId, {
      pendencia_id: pendenciaId, seller_id: sellerId,
    }).catch(err => logError('resolvePendencia', err, { context: 'gamification' }));
  }

  // Trust Passport — sempre registra
  try {
    const trustPassportService = require('./trustPassportService');
    trustPassportService.recordEvent(
      callerUserId,
      'marketplace',
      'fiscal_pendencia_resolved',
      2,
      false,
      { pendencia_id: pendenciaId, no_prazo: concluidaEm <= prazoLegal },
    ).catch(() => {});
  } catch (_) { /* trust passport pode não estar disponível */ }

  // Dispatch webhook notification (pendencia_resolved)
  try {
    const notificationDispatcher = require('./NotificationDispatcher');
    notificationDispatcher.dispatch({
      userId: callerUserId,
      type: 'pendencia_resolved',
      importance: 'low',
      data: { titulo: data.titulo, pendenciaId, sellerId, clientPhone: null, clientName: null },
      dedupKey: `pendencia_resolved_${pendenciaId}`,
    }).catch(() => {});
  } catch (_) { /* best-effort */ }

  return data;
}

async function getPendenciaHistorico(pendenciaId) {
  const { data, error } = await sb()
    .from('seller_client_pendencia_historico')
    .select('id, pendencia_id, user_id, acao, descricao, snapshot_status, created_at')
    .eq('pendencia_id', pendenciaId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Erro ao buscar histórico: ${error.message}`);
  return data || [];
}

async function addComment(pendenciaId, callerUserId, descricao) {
  const { data, error } = await sb()
    .from('seller_client_pendencia_historico')
    .insert({
      pendencia_id: pendenciaId,
      user_id:      callerUserId,
      acao:         'comentou',
      descricao,
    })
    .select('id, pendencia_id, user_id, acao, descricao, created_at')
    .single();

  if (error) throw new Error(`Erro ao adicionar comentário: ${error.message}`);
  return data;
}

// ──────────────────────────────────────────────────────
// Painel do cliente (D3)
// ──────────────────────────────────────────────────────

async function getMyPendencias(clientUserId) {
  log('getMyPendencias', 'Buscando pendências do cliente', { clientUserId });

  const { data, error } = await sb()
    .from('seller_client_pendencias')
    .select(`
      id, tipo, titulo, prazo_legal, status, ciencia_registrada_em,
      concluida_em, created_at,
      seller:seller_id (business_name, trading_name),
      client:seller_client_id (apelido)
    `)
    .in('seller_client_id', sb()
      .from('seller_clients')
      .select('id')
      .eq('client_user_id', clientUserId)
    )
    .order('prazo_legal', { ascending: true });

  // Fallback if subquery approach fails — use manual approach
  if (error) {
    // Get client IDs first
    const { data: clients } = await sb()
      .from('seller_clients')
      .select('id')
      .eq('client_user_id', clientUserId);

    if (!clients || clients.length === 0) return [];

    const clientIds = clients.map(c => c.id);
    const { data: pendencias, error: pErr } = await sb()
      .from('seller_client_pendencias')
      .select(`
        id, tipo, titulo, prazo_legal, status, ciencia_registrada_em,
        concluida_em, created_at,
        seller:seller_id (business_name, trading_name)
      `)
      .in('seller_client_id', clientIds)
      .order('prazo_legal', { ascending: true });

    if (pErr) throw new Error(`Erro ao buscar pendências: ${pErr.message}`);
    return pendencias || [];
  }

  return data || [];
}

// ──────────────────────────────────────────────────────
// Buscar user por email (para vincular cliente)
// ──────────────────────────────────────────────────────

async function searchUserByEmail(email) {
  const { data, error } = await sb()
    .from('users')
    .select('id, full_name, email, avatar_url')
    .ilike('email', `%${email}%`)
    .limit(10);

  if (error) throw new Error(`Erro ao buscar usuário: ${error.message}`);
  return data || [];
}

// ──────────────────────────────────────────────────────
// Deadline notification job
// ──────────────────────────────────────────────────────

async function getPendenciasVencendoEm(days) {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + days);

  const { data, error } = await sb()
    .from('seller_client_pendencias')
    .select(`
      ${PENDENCIA_COLS},
      client:seller_client_id (id, client_user_id, apelido),
      responsavel:responsavel_user_id (full_name, email)
    `)
    .in('status', ['aberta', 'em_andamento'])
    .lte('prazo_legal', targetDate.toISOString())
    .gte('prazo_legal', new Date().toISOString())
    .order('prazo_legal', { ascending: true });

  if (error) throw new Error(`Erro ao buscar pendências vencendo: ${error.message}`);
  return data || [];
}

async function markExpiredPendencias() {
  log('markExpiredPendencias', 'Verificando pendências vencidas');

  const { data, error } = await sb()
    .from('seller_client_pendencias')
    .update({ status: 'vencida' })
    .in('status', ['aberta', 'em_andamento'])
    .lt('prazo_legal', new Date().toISOString())
    .select('id, seller_id, seller_client_id, titulo, responsavel_user_id');

  if (error) {
    logError('markExpiredPendencias', error);
    return [];
  }

  log('markExpiredPendencias', `${(data || []).length} pendências marcadas como vencidas`);
  return data || [];
}

/**
 * Job periódico: verifica prazos e envia notificações.
 * Chamado a cada 30min pelo index.js.
 * Deduplicação via dedupKey: fiscal_prazo_{pendenciaId}_{dias}_{date}
 */
async function runDeadlineNotificationJob() {
  const notificationDispatcher = require('./NotificationDispatcher');

  log('runDeadlineNotificationJob', 'Iniciando verificação de prazos');

  // 1. Marcar vencidas
  const expired = await markExpiredPendencias();
  for (const p of expired) {
    // Notificar equipe inteira + cliente
    const { data: owner } = await sb()
      .from('seller_profiles')
      .select('user_id')
      .eq('id', p.seller_id)
      .single();

    const recipients = new Set();
    if (p.responsavel_user_id) recipients.add(p.responsavel_user_id);
    if (owner?.user_id) recipients.add(owner.user_id);

    // Resolver cliente e seu telefone para webhook
    let clientPhone = null;
    let clientName = null;
    if (p.seller_client_id) {
      const { data: client } = await sb()
        .from('seller_clients')
        .select('client_user_id, client_user:client_user_id (full_name, telefone)')
        .eq('id', p.seller_client_id)
        .single();
      if (client?.client_user_id) {
        recipients.add(client.client_user_id);
        clientPhone = client.client_user?.telefone || null;
        clientName = client.client_user?.full_name || null;
      }
    }

    const today = new Date().toISOString().split('T')[0];
    for (const userId of recipients) {
      notificationDispatcher.dispatch({
        userId,
        type: 'fiscal_pendencia_vencida',
        data: {
          titulo: p.titulo, pendenciaId: p.id, url: '/mercado/vendedor',
          sellerId: p.seller_id, clientPhone, clientName,
        },
        dedupKey: `fiscal_prazo_${p.id}_vencida_${today}`,
      }).catch(() => {});
    }
  }

  // 2. Verificar prazos de 1, 3 e 7 dias
  const thresholds = [
    { days: 1, type: 'fiscal_prazo_1d',  notifyOwner: true },
    { days: 3, type: 'fiscal_prazo_3d',  notifyOwner: true },
    { days: 7, type: 'fiscal_prazo_7d',  notifyOwner: false },
  ];

  for (const { days, type, notifyOwner } of thresholds) {
    try {
      const pendencias = await getPendenciasVencendoEm(days);
      // Filter to only those expiring within this exact day bracket
      const today = new Date();
      const targetStart = new Date(today);
      targetStart.setDate(targetStart.getDate() + days - 1);
      const targetEnd = new Date(today);
      targetEnd.setDate(targetEnd.getDate() + days);

      const filtered = pendencias.filter(p => {
        const prazo = new Date(p.prazo_legal);
        return prazo >= targetStart && prazo < targetEnd;
      });

      const todayStr = today.toISOString().split('T')[0];

      for (const p of filtered) {
        const recipients = new Set();
        if (p.responsavel_user_id) recipients.add(p.responsavel_user_id);

        if (notifyOwner) {
          const { data: owner } = await sb()
            .from('seller_profiles')
            .select('user_id')
            .eq('id', p.seller_id)
            .single();
          if (owner?.user_id) recipients.add(owner.user_id);
        }

        // Resolver telefone do cliente para webhook
        let clientPhone = null;
        let clientName = null;
        if (p.client?.client_user_id) {
          const { data: clientUser } = await sb()
            .from('users')
            .select('full_name, telefone')
            .eq('id', p.client.client_user_id)
            .maybeSingle();
          clientPhone = clientUser?.telefone || null;
          clientName = clientUser?.full_name || null;
        }

        for (const userId of recipients) {
          notificationDispatcher.dispatch({
            userId,
            type,
            data: {
              titulo: p.titulo, pendenciaId: p.id, url: '/mercado/vendedor',
              sellerId: p.seller_id, clientPhone, clientName,
            },
            dedupKey: `fiscal_prazo_${p.id}_${days}d_${todayStr}`,
          }).catch(() => {});
        }
      }
    } catch (err) {
      logError('runDeadlineNotificationJob', err, { days, type });
    }
  }

  log('runDeadlineNotificationJob', 'Verificação de prazos concluída');
}

module.exports = {
  // Clientes
  listClients,
  createClient,
  getClient,
  updateClient,
  archiveClient,
  searchUserByEmail,
  // Pendências
  listPendencias,
  createPendencia,
  updatePendencia,
  resolvePendencia,
  getPendenciaHistorico,
  addComment,
  // Cliente (D3)
  getMyPendencias,
  // Jobs
  getPendenciasVencendoEm,
  markExpiredPendencias,
  runDeadlineNotificationJob,
};
