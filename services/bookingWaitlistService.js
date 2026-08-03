/**
 * @fileoverview bookingWaitlistService — ElosCloud Fila de Espera para Agendamentos
 * [SCHED-CAP-013]
 *
 * Gerencia a fila de espera para slots lotados no sistema de agendamento.
 * Quando um slot atinge capacidade maxima, clientes podem entrar na fila.
 * Ao liberar uma vaga (cancelamento/no-show), o proximo da fila e promovido
 * automaticamente com criacao de booking.
 *
 * Limites:
 *   - Max 20 entries por slot (anti-abuse)
 *   - Max 5 waitlists simultaneas por cliente
 *   - Entry expira quando o slot comeca (scheduled_at)
 *
 * Socket.IO events emitidos:
 *   waitlist:joined   — cliente entrou na fila
 *   waitlist:left     — cliente saiu da fila
 *   waitlist:promoted — cliente promovido (vaga liberada)
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger }            = require('../logger');
const socketManager         = require('../config/socket/socketManager');
const notificationDispatcher = require('./NotificationDispatcher');

const SERVICE = 'bookingWaitlistService';

// ── Limites [SCHED-CAP-013] ──────────────────────────
const MAX_WAITLIST_PER_SLOT   = 20;
const MAX_WAITLISTS_PER_USER  = 5;

// ──────────────────────────────────────────────────────
// Helpers internos
// ──────────────────────────────────────────────────────

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponivel');
  return client;
}

function log(fn, msg, extra = {}) {
  logger.info(msg, { service: SERVICE, function: fn, ...extra });
}

function logWarn(fn, msg, extra = {}) {
  logger.warn(msg, { service: SERVICE, function: fn, ...extra });
}

function logError(fn, err, extra = {}) {
  logger.error(`Erro em ${fn}: ${err.message}`, {
    service: SERVICE, function: fn, error: err.message, ...extra,
  });
}

// ──────────────────────────────────────────────────────
// 1. Entrar na fila de espera
// ──────────────────────────────────────────────────────

/**
 * Cliente entra na fila de espera para um slot lotado.
 *
 * Validacoes:
 *   - Slot existe e esta lotado (available_seats === 0)
 *   - Cliente nao tem booking ativo neste slot
 *   - Cliente nao esta ja na waitlist para este slot
 *   - Limite de 20 entries por slot
 *   - Limite de 5 waitlists simultaneas por cliente
 *
 * @param {string} clientId — ID do cliente (JWT uid)
 * @param {object} params
 * @param {string} params.service_id — UUID do servico
 * @param {string} params.slot_start — ISO string do inicio do slot
 * @returns {{ waitlistId: string, position: number }}
 */
async function joinWaitlist(clientId, { service_id, slot_start }) {
  const fn = 'joinWaitlist';

  if (!service_id) throw new Error('service_id e obrigatorio.');
  if (!slot_start) throw new Error('slot_start e obrigatorio.');

  const slotStartDate = new Date(slot_start);
  if (isNaN(slotStartDate.getTime())) throw new Error('slot_start invalido (formato ISO esperado).');
  if (slotStartDate <= new Date()) throw new Error('Nao e possivel entrar na fila para um horario no passado.');

  // Buscar servico para obter dados
  const { data: product, error: prodErr } = await sb()
    .from('marketplace_products')
    .select('id, name, seller_id, seller_profiles!inner(user_id)')
    .eq('id', service_id)
    .eq('active', true)
    .single();

  if (prodErr || !product) throw new Error('Serviço não encontrado ou inativo.');

  const providerId = product.seller_profiles?.user_id;
  if (providerId === clientId) throw new Error('Voce nao pode entrar na fila do proprio servico.');

  // Verificar que o slot existe e esta lotado via RPC
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
    .format(slotStartDate);

  const { data: slots, error: slotErr } = await sb()
    .rpc('get_available_slots', { p_service_id: service_id, p_date: dateStr });

  if (slotErr) throw new Error(`Erro ao buscar slots: ${slotErr.message}`);

  const matchingSlot = (slots || []).find(
    s => new Date(s.slot_start).getTime() === slotStartDate.getTime()
  );

  if (!matchingSlot) throw new Error('Slot não encontrado para este serviço nesta data.');

  // Slot deve estar lotado para entrar na fila
  if ((matchingSlot.available_seats ?? 0) > 0) {
    throw new Error('Este slot ainda tem vagas disponiveis. Faca o agendamento normalmente.');
  }

  // Verificar que max_capacity > 1 (so turmas tem waitlist)
  if ((matchingSlot.max_capacity ?? 1) <= 1) {
    throw new Error('Fila de espera disponivel apenas para servicos em grupo.');
  }

  // Verificar que cliente nao tem booking ativo neste slot
  const { data: existingBooking } = await sb()
    .from('service_bookings')
    .select('id')
    .eq('service_id', service_id)
    .eq('client_id', clientId)
    .eq('scheduled_at', slotStartDate.toISOString())
    .in('status', ['pending', 'confirmed', 'pre_reserved'])
    .maybeSingle();

  if (existingBooking) {
    throw new Error('Voce ja tem um agendamento ativo para este horario.');
  }

  // Verificar que cliente nao esta ja na waitlist para este slot
  const { data: existingWaitlist } = await sb()
    .from('booking_waitlist')
    .select('id')
    .eq('service_id', service_id)
    .eq('client_id', clientId)
    .eq('scheduled_at', slotStartDate.toISOString())
    .eq('status', 'waiting')
    .maybeSingle();

  if (existingWaitlist) {
    throw new Error('Voce ja esta na fila de espera para este horario.');
  }

  // Verificar limite de 20 entries por slot
  const { count: slotCount } = await sb()
    .from('booking_waitlist')
    .select('id', { count: 'exact', head: true })
    .eq('service_id', service_id)
    .eq('scheduled_at', slotStartDate.toISOString())
    .eq('status', 'waiting');

  if ((slotCount ?? 0) >= MAX_WAITLIST_PER_SLOT) {
    throw new Error(`Fila de espera lotada para este horario (maximo ${MAX_WAITLIST_PER_SLOT}).`);
  }

  // Verificar limite de 5 waitlists simultaneas por cliente
  const { count: clientCount } = await sb()
    .from('booking_waitlist')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('status', 'waiting');

  if ((clientCount ?? 0) >= MAX_WAITLISTS_PER_USER) {
    throw new Error(`Voce ja esta na fila de espera de ${MAX_WAITLISTS_PER_USER} slots. Saia de uma fila antes de entrar em outra.`);
  }

  // Calcular position: MAX(position) para o slot + 1
  const { data: maxPos } = await sb()
    .from('booking_waitlist')
    .select('position')
    .eq('service_id', service_id)
    .eq('scheduled_at', slotStartDate.toISOString())
    .eq('status', 'waiting')
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const position = (maxPos?.position ?? 0) + 1;

  // Inserir entry na waitlist
  const slotEnd = new Date(matchingSlot.slot_end);

  const { data: entry, error: insertErr } = await sb()
    .from('booking_waitlist')
    .insert({
      service_id,
      client_id:     clientId,
      scheduled_at:  slotStartDate.toISOString(),
      scheduled_end: slotEnd.toISOString(),
      position,
      status:        'waiting',
      expires_at:    slotStartDate.toISOString(), // expira quando o slot comeca
    })
    .select()
    .single();

  if (insertErr) throw new Error(`Erro ao entrar na fila: ${insertErr.message}`);

  log(fn, '[SCHED-CAP] Cliente entrou na waitlist', {
    clientId, serviceId: service_id, slotStart: slot_start, position, waitlistId: entry.id,
  });

  // Socket.IO: notificar cliente
  try {
    socketManager.emitToUser(clientId, 'waitlist:joined', {
      waitlistId:  entry.id,
      serviceId:   service_id,
      serviceName: product.name,
      scheduledAt: slotStartDate.toISOString(),
      position,
    });
  } catch (e) {
    logWarn(fn, 'Falha ao notificar cliente via socket', { clientId, err: e.message });
  }

  return { waitlistId: entry.id, position };
}

// ──────────────────────────────────────────────────────
// 2. Sair da fila de espera
// ──────────────────────────────────────────────────────

/**
 * Cliente sai da fila de espera.
 *
 * @param {string} clientId — ID do cliente
 * @param {string} waitlistId — UUID da entry
 */
async function leaveWaitlist(clientId, waitlistId) {
  const fn = 'leaveWaitlist';

  // Buscar entry e validar ownership
  const { data: entry, error: fetchErr } = await sb()
    .from('booking_waitlist')
    .select('*')
    .eq('id', waitlistId)
    .single();

  if (fetchErr || !entry) throw new Error('Entrada na fila não encontrada.');
  if (entry.client_id !== clientId) throw new Error('Não autorizado.');
  if (entry.status !== 'waiting') throw new Error('Esta entrada na fila nao esta mais ativa.');

  // Marcar como cancelled
  const { error: updateErr } = await sb()
    .from('booking_waitlist')
    .update({ status: 'cancelled' })
    .eq('id', waitlistId);

  if (updateErr) throw new Error(`Erro ao sair da fila: ${updateErr.message}`);

  // Reordenar positions dos waiting restantes para o slot
  await _reorderPositions(entry.service_id, entry.scheduled_at);

  log(fn, '[SCHED-CAP] Cliente saiu da waitlist', {
    clientId, waitlistId, serviceId: entry.service_id,
  });

  // Socket.IO: notificar cliente
  try {
    socketManager.emitToUser(clientId, 'waitlist:left', {
      waitlistId,
      serviceId:   entry.service_id,
      scheduledAt: entry.scheduled_at,
    });
  } catch (e) {
    logWarn(fn, 'Falha ao notificar cliente via socket', { clientId, err: e.message });
  }
}

// ──────────────────────────────────────────────────────
// 3. Promover proximo da fila
// ──────────────────────────────────────────────────────

/**
 * Promove o proximo da fila de espera quando uma vaga e liberada.
 * Cria booking automaticamente e notifica o cliente.
 *
 * Chamado por bookingService.cancelBooking() e markNoShow().
 *
 * @param {string} serviceId — UUID do servico
 * @param {string} slotStart — ISO string do inicio do slot
 * @returns {object|null} booking criado ou null se nao havia fila
 */
async function promoteNextInWaitlist(serviceId, slotStart) {
  const fn = 'promoteNextInWaitlist';

  const slotStartDate = new Date(slotStart);

  // Buscar o primeiro waiting (menor position) para o slot
  const { data: nextEntry, error: fetchErr } = await sb()
    .from('booking_waitlist')
    .select('*')
    .eq('service_id', serviceId)
    .eq('scheduled_at', slotStartDate.toISOString())
    .eq('status', 'waiting')
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fetchErr) {
    logWarn(fn, 'Erro ao buscar waitlist', { serviceId, slotStart, err: fetchErr.message });
    return null;
  }

  if (!nextEntry) {
    log(fn, '[SCHED-CAP] Nenhuma entry na waitlist para promover', { serviceId, slotStart });
    return null;
  }

  // Verificar que o slot tem available_seats > 0
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
    .format(slotStartDate);

  const { data: slots } = await sb()
    .rpc('get_available_slots', { p_service_id: serviceId, p_date: dateStr });

  const matchingSlot = (slots || []).find(
    s => new Date(s.slot_start).getTime() === slotStartDate.getTime()
  );

  if (!matchingSlot || (matchingSlot.available_seats ?? 0) <= 0) {
    log(fn, '[SCHED-CAP] Slot ainda sem vagas, nao promover', { serviceId, slotStart });
    return null;
  }

  // Criar booking automaticamente via bookingService
  // Importa aqui para evitar circular dependency
  const bookingService = require('./bookingService');
  let newBooking;
  try {
    newBooking = await bookingService.createBooking(nextEntry.client_id, {
      service_id: serviceId,
      slot_start: slotStart,
      notes: 'Agendamento criado automaticamente via fila de espera.',
    });
  } catch (e) {
    logWarn(fn, 'Falha ao criar booking via promocao da waitlist', {
      waitlistId: nextEntry.id, clientId: nextEntry.client_id, err: e.message,
    });
    return null;
  }

  // Marcar waitlist entry como promoted
  const { error: updateErr } = await sb()
    .from('booking_waitlist')
    .update({
      status:              'promoted',
      promoted_at:         new Date().toISOString(),
      promoted_booking_id: newBooking.id,
    })
    .eq('id', nextEntry.id);

  if (updateErr) {
    logWarn(fn, 'Falha ao marcar waitlist entry como promoted', {
      waitlistId: nextEntry.id, err: updateErr.message,
    });
  }

  // Reordenar positions restantes
  await _reorderPositions(serviceId, slotStartDate.toISOString());

  log(fn, '[SCHED-CAP] Cliente promovido da waitlist', {
    waitlistId: nextEntry.id, clientId: nextEntry.client_id,
    bookingId: newBooking.id, serviceId, slotStart,
  });

  // Buscar nome do servico para notificacao
  const { data: product } = await sb()
    .from('marketplace_products')
    .select('name')
    .eq('id', serviceId)
    .maybeSingle();

  const serviceName = product?.name || 'Servico agendado';
  const scheduledAtFormatted = new Date(slotStart).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long', day: '2-digit', month: 'long',
    hour: '2-digit', minute: '2-digit',
  });

  // Socket.IO: notificar cliente
  try {
    socketManager.emitToUser(nextEntry.client_id, 'waitlist:promoted', {
      waitlistId:  nextEntry.id,
      bookingId:   newBooking.id,
      serviceId,
      serviceName,
      scheduledAt: slotStart,
    });
  } catch (e) {
    logWarn(fn, 'Falha ao notificar cliente via socket (promoted)', {
      clientId: nextEntry.client_id, err: e.message,
    });
  }

  // Notificacao persistente (fire-and-forget)
  setImmediate(() => {
    notificationDispatcher.dispatch({
      userId:     nextEntry.client_id,
      type:       'waitlist_promoted',
      importance: 'high',
      data: {
        bookingId:   newBooking.id,
        serviceId,
        serviceName,
        scheduledAt: slotStart,
      },
      metadata: { triggeredBy: 'system' },
      dedupKey: `waitlist_promoted_${nextEntry.id}`,
    }).catch(() => {});
  });

  // Email: "Sua vaga na fila de espera foi liberada!"
  _sendWaitlistEmail(
    nextEntry.client_id,
    'Sua vaga na fila de espera foi liberada!',
    'waitlist_promoted',
    {
      serviceName,
      scheduledAt: scheduledAtFormatted,
      bookingUrl:  'https://eloscloud.com/mercado/agendamentos',
    },
    nextEntry.id,
  );

  return newBooking;
}

// ──────────────────────────────────────────────────────
// 4. Consultas
// ──────────────────────────────────────────────────────

/**
 * Lista entries ativas (waiting) do cliente com position.
 *
 * @param {string} clientId
 * @returns {Array} [{ id, service_id, scheduled_at, position, created_at, service_name }]
 */
async function getMyWaitlistEntries(clientId) {
  const fn = 'getMyWaitlistEntries';

  const { data, error } = await sb()
    .from('booking_waitlist')
    .select('id, service_id, scheduled_at, scheduled_end, position, created_at, expires_at')
    .eq('client_id', clientId)
    .eq('status', 'waiting')
    .order('scheduled_at', { ascending: true });

  if (error) throw new Error(`Erro ao listar fila de espera: ${error.message}`);

  // Enriquecer com nome do servico
  const entries = data || [];
  if (entries.length === 0) return entries;

  const serviceIds = [...new Set(entries.map(e => e.service_id))];
  const { data: products } = await sb()
    .from('marketplace_products')
    .select('id, name')
    .in('id', serviceIds);

  const productMap = {};
  (products || []).forEach(p => { productMap[p.id] = p.name; });

  return entries.map(e => ({
    ...e,
    service_name: productMap[e.service_id] || 'Servico',
  }));
}

/**
 * Provider consulta a fila de espera de um slot.
 *
 * @param {string} userId — ID do provider
 * @param {string} serviceId — UUID do servico
 * @param {string} slotStart — ISO string do inicio do slot
 * @returns {Array} [{ id, position, client_id, client_name, created_at }]
 */
async function getSlotWaitlist(userId, serviceId, slotStart) {
  const fn = 'getSlotWaitlist';

  // Validar que userId e o provider do servico
  const { data: product } = await sb()
    .from('marketplace_products')
    .select('seller_id, seller_profiles!inner(user_id)')
    .eq('id', serviceId)
    .single();

  if (!product) throw new Error('Serviço não encontrado.');

  const ownerId = product.seller_profiles?.user_id;
  if (ownerId !== userId) {
    // Verificar se e team member manager+
    const { data: member } = await sb()
      .from('seller_team_members')
      .select('role')
      .eq('seller_id', product.seller_id)
      .eq('user_id', userId)
      .eq('status', 'active')
      .eq('active', true)
      .in('role', ['manager', 'owner'])
      .maybeSingle();

    if (!member) throw new Error('Não autorizado.');
  }

  const slotStartDate = new Date(slotStart);

  const { data, error } = await sb()
    .from('booking_waitlist')
    .select('id, position, client_id, created_at')
    .eq('service_id', serviceId)
    .eq('scheduled_at', slotStartDate.toISOString())
    .eq('status', 'waiting')
    .order('position', { ascending: true });

  if (error) throw new Error(`Erro ao listar fila do slot: ${error.message}`);

  const entries = data || [];
  if (entries.length === 0) return entries;

  // Enriquecer com nomes dos clientes
  const clientIds = entries.map(e => e.client_id);
  const { data: users } = await sb()
    .from('users')
    .select('id, nome, display_name')
    .in('id', clientIds);

  const userMap = {};
  (users || []).forEach(u => { userMap[u.id] = u.nome || u.display_name || 'Cliente'; });

  return entries.map(e => ({
    ...e,
    client_name: userMap[e.client_id] || 'Cliente',
  }));
}

/**
 * Retorna a quantidade de entries waiting para um slot.
 * Usado pelo frontend para exibir badge de waitlist.
 *
 * @param {string} serviceId
 * @param {string} slotStart
 * @returns {number}
 */
async function getSlotWaitlistCount(serviceId, slotStart) {
  const slotStartDate = new Date(slotStart);
  const { count } = await sb()
    .from('booking_waitlist')
    .select('id', { count: 'exact', head: true })
    .eq('service_id', serviceId)
    .eq('scheduled_at', slotStartDate.toISOString())
    .eq('status', 'waiting');

  return count ?? 0;
}

// ──────────────────────────────────────────────────────
// 5. Job de expiracao (cron)
// ──────────────────────────────────────────────────────

/**
 * Expira entries cuja expires_at ou scheduled_at ja passou.
 * Deve ser chamado periodicamente (ex: a cada 15 min no Group Booking Worker).
 *
 * @returns {{ expired: number }}
 */
async function runWaitlistExpirationJob() {
  const fn = 'runWaitlistExpirationJob';
  const now = new Date().toISOString();

  const { data, error } = await sb()
    .from('booking_waitlist')
    .update({ status: 'expired' })
    .eq('status', 'waiting')
    .or(`expires_at.lt.${now},scheduled_at.lt.${now}`)
    .select('id, client_id, service_id, scheduled_at');

  if (error) {
    logError(fn, error);
    return { expired: 0 };
  }

  const expired = data?.length ?? 0;

  if (expired > 0) {
    log(fn, `[SCHED-CAP] ${expired} waitlist entries expiradas`, { expired });

    // Notificar clientes que foram expirados
    (data || []).forEach(entry => {
      try {
        socketManager.emitToUser(entry.client_id, 'waitlist:expired', {
          waitlistId:  entry.id,
          serviceId:   entry.service_id,
          scheduledAt: entry.scheduled_at,
        });
      } catch (e) {
        // silencioso
      }
    });
  }

  return { expired };
}

// ──────────────────────────────────────────────────────
// Helpers privados
// ──────────────────────────────────────────────────────

/**
 * Reordena positions sequenciais (1, 2, 3...) para entries waiting de um slot.
 */
async function _reorderPositions(serviceId, scheduledAt) {
  const { data: entries, error } = await sb()
    .from('booking_waitlist')
    .select('id')
    .eq('service_id', serviceId)
    .eq('scheduled_at', scheduledAt)
    .eq('status', 'waiting')
    .order('position', { ascending: true });

  if (error || !entries || entries.length === 0) return;

  // Atualizar posicoes sequenciais
  for (let i = 0; i < entries.length; i++) {
    await sb()
      .from('booking_waitlist')
      .update({ position: i + 1 })
      .eq('id', entries[i].id);
  }
}

/**
 * Envia email de waitlist (fire-and-forget).
 */
async function _sendWaitlistEmail(toUserId, subject, templateType, data, referenceId) {
  try {
    const emailService = require('./emailService');
    const User         = require('../models/User');
    const user         = await User.getById(toUserId);
    if (!user?.email) return;

    await emailService.sendEmail({
      to:            user.email,
      subject,
      templateType,
      data:          { ...data, userName: user.nome || user.displayName || 'Usuario' },
      userId:        toUserId,
      reference:     referenceId,
      referenceType: 'booking_waitlist',
    });
  } catch (e) {
    logWarn('_sendWaitlistEmail', `Email nao enviado (templateType=${templateType})`, { err: e.message, referenceId });
  }
}

module.exports = {
  joinWaitlist,
  leaveWaitlist,
  promoteNextInWaitlist,
  getMyWaitlistEntries,
  getSlotWaitlist,
  getSlotWaitlistCount,
  runWaitlistExpirationJob,
};
