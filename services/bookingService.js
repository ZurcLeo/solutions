/**
 * @fileoverview bookingService — ElosCloud Agendamento de Serviços
 * [SCHED-001]
 *
 * Orquestra o ciclo completo de agendamento:
 *   cliente solicita slot → prestador confirma/recusa → prestador completa → Stripe capture
 *
 * Máquina de estados:
 *   pending → confirmed → completed (caminho feliz)
 *   pending → cancelled/expired     (recusa ou timeout 2h)
 *   confirmed → cancelled           (cancelamento com política)
 *   confirmed → disputed            (contestação → disputa-agent)
 *
 * Pagamento (Stripe, via bookingPaymentService):
 *   Criação: PaymentIntent com capture_method=manual (hold)
 *   Conclusão: capture
 *   Cancelamento/expiração com hold: void
 *
 * Delegações:
 *   gamificationService → triggerEvent (XP por agendamento/conclusão)
 *   SupportService      → createTicket (cancelamento tardio contestado)
 *   socketManager       → emitToUser (notificações realtime)
 */

'use strict';

const crypto                 = require('crypto');
const { getSupabaseClient } = require('../config/supabase');
const { logger }            = require('../logger');
const gamificationService   = require('./gamificationService');
const supportService        = require('./SupportService');
const socketManager         = require('../config/socket/socketManager');
const notificationDispatcher = require('./NotificationDispatcher');

const SERVICE = 'bookingService';

// Booking expira em 2h sem confirmação do prestador (DA-SCHED-004)
const BOOKING_EXPIRY_HOURS = 2;

// ──────────────────────────────────────────────────────
// Helpers internos
// ──────────────────────────────────────────────────────

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
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

/**
 * Retorna o provider_id (user_id do vendedor) e seller_id de um marketplace_product.
 * Usado para verificar ownership antes de operações restritas ao prestador.
 */
async function getServiceProviderId(serviceId) {
  const { data, error } = await sb()
    .from('marketplace_products')
    .select('seller_id, seller_profiles!inner(user_id)')
    .eq('id', serviceId)
    .single();

  if (error || !data) return null;
  return { ownerId: data.seller_profiles?.user_id ?? null, sellerId: data.seller_id };
}

/**
 * Verifica se userId é o dono OU um team member manager+ do seller que possui o serviço.
 */
async function isServiceProvider(userId, serviceId) {
  const result = await getServiceProviderId(serviceId);
  if (!result || !result.ownerId) return false;

  // Dono direto
  if (result.ownerId === userId) return true;

  // Team member com role manager+
  const { data: member } = await sb()
    .from('seller_team_members')
    .select('role')
    .eq('seller_id', result.sellerId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('active', true)
    .in('role', ['manager', 'owner'])
    .maybeSingle();

  return !!member;
}

/**
 * Aplica a política de cancelamento e retorna o valor da taxa (em BRL).
 * policy = { advance_hours: 24, fee_pct: 0 }
 */
function calculateCancellationFee(scheduledAt, policy, amountBrl) {
  const now = new Date();
  const scheduled = new Date(scheduledAt);
  const hoursUntilService = (scheduled - now) / (1000 * 60 * 60);

  if (hoursUntilService >= (policy.advance_hours ?? 24)) {
    return 0; // dentro do prazo — sem taxa
  }

  const feePct = policy.fee_pct ?? 0;
  return Math.round(Number(amountBrl) * feePct * 100) / 100;
}

// ──────────────────────────────────────────────────────
// 1. Disponibilidade do prestador
// ──────────────────────────────────────────────────────

/**
 * Define (substitui) a grade semanal de disponibilidade de um serviço.
 * Dono do serviço OU manager da equipe podem alterar.
 *
 * @param {string} userId - ID do usuário (dono ou manager do seller)
 * @param {string} serviceId - ID do marketplace_product
 * @param {Array} slots - Array de blocos: [{ day_of_week, start_time, end_time, slot_duration_minutes, gap_minutes, max_capacity?, assigned_member_id? }]
 * [SCHED-CAP] max_capacity: número de vagas por slot (default 1 = individual, max 500).
 * @param {object} [options]
 * @param {boolean} [options.force] - Se true, salva mesmo com conflitos de membro
 */
async function setAvailability(userId, serviceId, slots, options = {}) {
  const fn = 'setAvailability';

  // Validar ownership ou team membership (manager+)
  const authorized = await isServiceProvider(userId, serviceId);
  if (!authorized) {
    throw new Error('Não autorizado: você não é o prestador deste serviço.');
  }

  if (!Array.isArray(slots) || slots.length === 0) {
    throw new Error('slots deve ser um array não-vazio.');
  }

  // Validar cada bloco
  const VALID_DURATIONS = [15, 30, 45, 60, 120];
  for (const slot of slots) {
    if (slot.day_of_week < 0 || slot.day_of_week > 6) {
      throw new Error(`day_of_week inválido: ${slot.day_of_week}. Use 0 (Dom) a 6 (Sáb).`);
    }
    if (!slot.start_time || !slot.end_time) {
      throw new Error('start_time e end_time são obrigatórios em cada bloco.');
    }
    if (slot.start_time >= slot.end_time) {
      throw new Error(`end_time deve ser após start_time (dia ${slot.day_of_week}).`);
    }
    const duration = slot.slot_duration_minutes ?? 60;
    if (!VALID_DURATIONS.includes(duration)) {
      throw new Error(`slot_duration_minutes inválido: ${duration}. Opções: ${VALID_DURATIONS.join(', ')}.`);
    }
    // [SCHED-CAP] Validar max_capacity por slot
    const capacity = slot.max_capacity ?? 1;
    if (capacity < 1 || capacity > 500) {
      throw new Error(`max_capacity inválido: ${capacity}. Deve ser entre 1 e 500.`);
    }
  }

  // Verificar conflitos de membros antes de salvar (se não forçado)
  if (!options.force) {
    const result = await getServiceProviderId(serviceId);
    if (result?.sellerId) {
      const slotsWithMember = slots.filter(s => s.assigned_member_id);
      const allConflicts = [];

      for (const slot of slotsWithMember) {
        const conflicts = await checkConflicts(
          result.sellerId,
          slot.assigned_member_id,
          slot.day_of_week,
          slot.start_time,
          slot.end_time,
        );
        // Filtrar conflitos que vêm do mesmo serviço (vamos substituir tudo)
        const externalConflicts = conflicts.filter(c => c.service_id !== serviceId);
        if (externalConflicts.length > 0) {
          allConflicts.push(...externalConflicts.map(c => ({
            ...c,
            member_id: slot.assigned_member_id,
          })));
        }
      }

      if (allConflicts.length > 0) {
        log(fn, 'Conflitos de membro detectados', { serviceId, count: allConflicts.length });
        return { conflicts: allConflicts };
      }
    }
  }

  // Substituir todos os blocos do serviço
  const { error: delError } = await sb()
    .from('service_availability')
    .delete()
    .eq('service_id', serviceId);

  if (delError) throw new Error(`Erro ao limpar disponibilidade anterior: ${delError.message}`);

  const rows = slots.map(slot => ({
    service_id:             serviceId,
    day_of_week:            slot.day_of_week,
    start_time:             slot.start_time,
    end_time:               slot.end_time,
    slot_duration_minutes:  slot.slot_duration_minutes ?? 60,
    gap_minutes:            slot.gap_minutes ?? 0,
    active:                 slot.active !== false,
    assigned_member_id:     slot.assigned_member_id ?? null,
    max_capacity:           slot.max_capacity ?? 1,          // [SCHED-CAP]
    price_override_brl:     slot.price_override_brl ?? null, // [SCHED-CAP-012] yield management
  }));

  const { data, error } = await sb()
    .from('service_availability')
    .insert(rows)
    .select();

  if (error) throw new Error(`Erro ao salvar disponibilidade: ${error.message}`);

  log(fn, 'Grade de disponibilidade atualizada', { userId, serviceId, blocks: rows.length });
  return data;
}

/**
 * Retorna a grade semanal de um serviço (leitura pública).
 */
async function getAvailability(serviceId) {
  const { data, error } = await sb()
    .from('service_availability')
    .select('*')
    .eq('service_id', serviceId)
    .eq('active', true)
    .order('day_of_week')
    .order('start_time');

  if (error) throw new Error(`Erro ao buscar disponibilidade: ${error.message}`);
  return data ?? [];
}

// ──────────────────────────────────────────────────────
// 2. Slots disponíveis
// ──────────────────────────────────────────────────────

/**
 * Consulta slots livres para um serviço em uma data específica.
 * Delega ao RPC get_available_slots (lógica de sobreposição no banco).
 *
 * @param {string} serviceId
 * @param {string} date - formato 'YYYY-MM-DD'
 * @returns {Array} [{ slot_start, slot_end, max_capacity, booked_count, available_seats, available, assigned_member_id }]
 * [SCHED-CAP] Retorno expandido com campos de capacidade vindos da RPC.
 */
/**
 * Retorna os dias da semana (0–6) que têm disponibilidade configurada para um serviço.
 * Usado pelo BookingCalendar para desabilitar dias sem agenda.
 */
async function getActiveDays(serviceId) {
  if (!serviceId) throw new Error('service_id é obrigatório.');
  const { data, error } = await sb()
    .from('service_availability')
    .select('day_of_week')
    .eq('service_id', serviceId);
  if (error) throw new Error(`Erro ao buscar dias ativos: ${error.message}`);
  return (data || []).map(r => r.day_of_week);
}

async function getAvailableSlots(serviceId, date) {
  if (!serviceId) throw new Error('service_id é obrigatório.');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('date é obrigatório no formato YYYY-MM-DD.');
  }

  const { data, error } = await sb()
    .rpc('get_available_slots', { p_service_id: serviceId, p_date: date });

  if (error) throw new Error(`Erro ao buscar slots: ${error.message}`);
  return data ?? [];
}

// ──────────────────────────────────────────────────────
// 3. Criar agendamento
// ──────────────────────────────────────────────────────

/**
 * Cliente cria um agendamento para um slot disponível.
 * O pagamento (hold Stripe) é processado separadamente via bookingPaymentService.
 *
 * [SCHED-CAP] Determina booking_type automaticamente:
 *   - 'confirmed'    → serviços individuais (service_mode='individual' ou min_capacity=1)
 *   - 'pre_reserved' → turmas (service_mode='group' com min_capacity>1)
 * Para group mode, emite evento Socket.IO booking:slot_updated com contagem de vagas.
 *
 * @param {string} clientId - ID do cliente (do JWT)
 * @param {object} data
 * @param {string} data.service_id
 * @param {string} data.slot_start - ISO string do início do slot
 * @param {string} [data.notes]
 */
async function createBooking(clientId, data) {
  const fn = 'createBooking';
  const { service_id, slot_start, notes } = data;

  if (!service_id) throw new Error('service_id é obrigatório.');
  if (!slot_start)  throw new Error('slot_start é obrigatório.');

  const slotStartDate = new Date(slot_start);
  if (isNaN(slotStartDate.getTime())) throw new Error('slot_start inválido (formato ISO esperado).');
  if (slotStartDate <= new Date()) throw new Error('Não é possível agendar em um horário no passado.');

  // Buscar o serviço e verificar que existe
  const { data: product, error: prodError } = await sb()
    .from('marketplace_products')
    .select('id, price_brl, seller_id, seller_profiles!inner(user_id, trading_name, business_name), name, cancellation_policy, service_mode, min_capacity')
    .eq('id', service_id)
    .eq('active', true)
    .single();

  if (prodError || !product) throw new Error('Serviço não encontrado ou inativo.');

  const providerId = product.seller_profiles?.user_id;
  if (!providerId) throw new Error('Prestador não encontrado para este serviço.');

  // Impedir auto-agendamento (constraint sb_no_self_booking também cobre isso)
  if (providerId === clientId) throw new Error('Você não pode agendar o próprio serviço.');

  // Verificar que o slot está disponível via RPC
  // Usa o timezone de Brasília para extrair a data — necessário porque a RPC
  // get_available_slots() interpreta os horários como America/Sao_Paulo.
  // Slots entre 21h e 23h59 BRT correspondem ao dia seguinte em UTC, então
  // toISOString().slice(0,10) retornaria a data errada nesses casos.
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
    .format(slotStartDate); // 'YYYY-MM-DD' em horário de Brasília
  const slots = await getAvailableSlots(service_id, dateStr);

  const matchingSlot = slots.find(
    s => new Date(s.slot_start).getTime() === slotStartDate.getTime()
  );

  if (!matchingSlot) throw new Error('Slot não encontrado para este serviço nesta data.');
  // [SCHED-CAP] Mensagem de erro diferenciada para turmas lotadas
  if (!matchingSlot.available) {
    const msg = matchingSlot.max_capacity > 1
      ? `Turma lotada (${matchingSlot.booked_count}/${matchingSlot.max_capacity} vagas preenchidas). Escolha outro horário.`
      : 'Slot indisponível. Escolha outro horário.';
    throw new Error(msg);
  }

  // [SCHED-CAP] Determinar booking_type baseado no service_mode e min_capacity
  const bookingType = (product.service_mode === 'group' && product.min_capacity > 1)
    ? 'pre_reserved'
    : 'confirmed';

  const slotEnd = new Date(matchingSlot.slot_end);

  // Política de cancelamento: usar campo do produto ou padrão
  const cancellationPolicy = product.cancellation_policy ??
    { advance_hours: 24, fee_pct: 0 };

  // Calcular expires_at (2h a partir de agora — DA-SCHED-004)
  const expiresAt = new Date(Date.now() + BOOKING_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

  const { data: booking, error: insertError } = await sb()
    .from('service_bookings')
    .insert({
      service_id,
      provider_id:         providerId,
      client_id:           clientId,
      scheduled_at:        slotStartDate.toISOString(),
      scheduled_end:       slotEnd.toISOString(),
      status:              'pending',
      payment_status:      'pending',
      amount_brl:          Number(matchingSlot.price_brl ?? product.price_brl), // [SCHED-CAP-012] preco do slot (yield) ou fallback produto
      cancellation_policy: cancellationPolicy,
      notes:               notes?.trim() ?? null,
      expires_at:          expiresAt,
      assigned_member_id:  matchingSlot.assigned_member_id ?? null,
      booking_type:        bookingType,                            // [SCHED-CAP]
    })
    .select()
    .single();

  if (insertError) throw new Error(`Erro ao criar agendamento: ${insertError.message}`);

  log(fn, 'Agendamento criado', { clientId, bookingId: booking.id, serviceId: service_id });

  // Notificar prestador via Socket.IO
  try {
    socketManager.emitToUser(providerId, 'booking:new_request', {
      bookingId:   booking.id,
      clientId,
      serviceName: product.name,
      scheduledAt: booking.scheduled_at,
      expiresAt:   booking.expires_at,
      amountBrl:   booking.amount_brl,
    });
  } catch (e) {
    logWarn(fn, 'Falha ao notificar prestador via socket', { providerId, err: e.message });
  }

  // [SCHED-CAP] Emitir contagem de vagas para clientes do slot (group mode)
  if (product.service_mode === 'group') {
    try {
      const updatedSlots = await getAvailableSlots(service_id, dateStr);
      const updatedSlot = updatedSlots.find(
        s => new Date(s.slot_start).getTime() === slotStartDate.getTime()
      );
      if (updatedSlot) {
        socketManager.emitToRoom(`service:${service_id}`, 'booking:slot_updated', {
          serviceId:      service_id,
          slotStart:      slot_start,
          maxCapacity:    updatedSlot.max_capacity,
          bookedCount:    updatedSlot.booked_count,
          availableSeats: updatedSlot.available_seats,
        });

        // [SCHED-CAP-005] Verificar thresholds de capacidade e notificar escassez
        _checkCapacityThresholds(
          service_id,
          slot_start,
          updatedSlot.booked_count,
          updatedSlot.max_capacity,
          providerId,
          product.name,
        );
      }
    } catch (e) {
      logWarn(fn, 'Falha ao emitir slot_updated para group mode', { serviceId: service_id, err: e.message });
    }
  }

  // Gamificação — Lei do Time
  await gamificationService.triggerEvent('service_booked', clientId, {
    bookingId: booking.id, serviceId: service_id,
  }).catch(e => logWarn(fn, 'triggerEvent service_booked falhou', { err: e.message }));

  const providerName = product.seller_profiles?.trading_name
    || product.seller_profiles?.business_name
    || 'Prestador';

  // Email ao prestador (fire-and-forget)
  _sendBookingEmail(
    providerId,
    `Novo agendamento solicitado — ${product.name}`,
    'booking_new_request',
    {
      serviceName: product.name,
      scheduledAt: new Date(booking.scheduled_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      expiresAt:   new Date(booking.expires_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      notes:       booking.notes ?? '',
      manageUrl:   'https://eloscloud.com/mercado/agendamentos',
    },
    booking.id,
  );

  // Email ao cliente — recibo da solicitação (fire-and-forget)
  _sendBookingEmail(
    clientId,
    `Solicitação de agendamento enviada — ${product.name}`,
    'booking_created',
    {
      serviceName:  product.name,
      scheduledAt:  new Date(booking.scheduled_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      providerName,
      manageUrl:    'https://eloscloud.com/mercado/agendamentos',
    },
    booking.id,
  );

  return booking;
}

// ──────────────────────────────────────────────────────
// 4. Ações do prestador
// ──────────────────────────────────────────────────────

/**
 * Prestador confirma um agendamento pendente.
 */
async function confirmBooking(userId, bookingId, providerNotes) {
  const fn = 'confirmBooking';

  const booking = await _getBookingForProvider(userId, bookingId, fn);
  if (booking.status !== 'pending') {
    throw new Error(`Booking não está pendente (status atual: ${booking.status}).`);
  }

  const { data: updated, error } = await sb()
    .from('service_bookings')
    .update({
      status:         'confirmed',
      confirmed_at:   new Date().toISOString(),
      provider_notes: providerNotes?.trim() ?? null,
    })
    .eq('id', bookingId)
    .select()
    .single();

  if (error) throw new Error(`Erro ao confirmar booking: ${error.message}`);

  log(fn, 'Booking confirmado', { userId, bookingId });

  // Email ao cliente
  _sendBookingEmail(
    booking.client_id,
    'Seu agendamento foi confirmado!',
    'booking_confirmed',
    {
      scheduledAt:   new Date(updated.scheduled_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      providerNotes: updated.provider_notes ?? '',
      bookingUrl:    `https://eloscloud.com/agendamentos/${bookingId}`,
    },
    bookingId,
  );

  // Notificar cliente via Socket.IO
  try {
    socketManager.emitToUser(booking.client_id, 'booking:confirmed', {
      bookingId,
      providerNotes: updated.provider_notes,
      scheduledAt:   updated.scheduled_at,
    });
  } catch (e) {
    logWarn(fn, 'Falha ao notificar cliente via socket', { clientId: booking.client_id });
  }

  return updated;
}

/**
 * Prestador recusa um agendamento pendente.
 * Semanticamente é uma recusa (não expiração), mas usa status cancelled + cancelled_by=provider.
 */
async function declineBooking(userId, bookingId, reason) {
  const fn = 'declineBooking';

  const booking = await _getBookingForProvider(userId, bookingId, fn);
  if (booking.status !== 'pending') {
    throw new Error(`Booking não pode ser recusado (status atual: ${booking.status}).`);
  }

  const { data: updated, error } = await sb()
    .from('service_bookings')
    .update({
      status:        'cancelled',
      cancelled_at:  new Date().toISOString(),
      cancelled_by:  'provider',
      provider_notes: reason?.trim() ?? null,
    })
    .eq('id', bookingId)
    .select()
    .single();

  if (error) throw new Error(`Erro ao recusar booking: ${error.message}`);

  log(fn, 'Booking recusado pelo prestador', { userId, bookingId });

  // Email ao cliente informando a recusa
  _sendBookingEmail(
    booking.client_id,
    'Agendamento não confirmado pelo prestador',
    'booking_declined',
    {
      scheduledAt: new Date(booking.scheduled_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      reason:      updated.provider_notes ?? 'Não informado',
      searchUrl:   'https://eloscloud.com/mercado',
    },
    bookingId,
  );

  // Se havia hold, sinalizar necessidade de void (SCHED-2C processa)
  if (updated.payment_status === 'authorized' && updated.payment_intent_id) {
    logWarn(fn, 'Booking recusado com hold ativo — void necessário', {
      bookingId, paymentIntentId: updated.payment_intent_id,
    });
  }

  // Notificar cliente
  try {
    socketManager.emitToUser(booking.client_id, 'booking:cancelled', {
      bookingId, reason: 'provider_declined',
    });
  } catch (e) {
    logWarn(fn, 'Falha ao notificar cliente', { clientId: booking.client_id });
  }

  return updated;
}

/**
 * Prestador marca um agendamento como concluído.
 * Valida que o horário agendado já passou ou está em andamento.
 */
async function completeBooking(userId, bookingId) {
  const fn = 'completeBooking';

  const booking = await _getBookingForProvider(userId, bookingId, fn);
  if (booking.status !== 'confirmed') {
    throw new Error(`Booking não pode ser concluído (status atual: ${booking.status}).`);
  }

  if (new Date(booking.scheduled_at) > new Date()) {
    throw new Error('Não é possível concluir um agendamento antes de seu horário de início.');
  }

  const { data: updated, error } = await sb()
    .from('service_bookings')
    .update({
      status:       'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', bookingId)
    .select()
    .single();

  if (error) throw new Error(`Erro ao concluir booking: ${error.message}`);

  log(fn, 'Booking concluído', { userId, bookingId });

  // Sinalizar para SCHED-2C fazer capture do Stripe
  if (updated.payment_status === 'authorized' && updated.payment_intent_id) {
    log(fn, 'Capture Stripe necessário', { bookingId, paymentIntentId: updated.payment_intent_id });
    // bookingPaymentService.captureBookingPayment é chamado pelo controller após este retorno
  }

  // Gamificação — Lei do Time
  await gamificationService.triggerEvent('service_completed', userId, {
    bookingId, clientId: booking.client_id,
  }).catch(e => logWarn(fn, 'triggerEvent service_completed falhou', { err: e.message }));

  await gamificationService.triggerEvent('service_received', booking.client_id, {
    bookingId, providerId: userId,
  }).catch(e => logWarn(fn, 'triggerEvent service_received falhou', { err: e.message }));

  // Trust Passport — serviço concluído (+2 prestador, +1 cliente)
  const trustPassportService = require('./trustPassportService');
  trustPassportService.recordEvent(userId, 'marketplace', 'service_completed', 2, false, {
    bookingId, clientId: booking.client_id,
  }).catch(e => logWarn(fn, 'trust event service_completed falhou', { err: e.message }));
  trustPassportService.recordEvent(booking.client_id, 'marketplace', 'service_received', 1, false, {
    bookingId, providerId: userId,
  }).catch(e => logWarn(fn, 'trust event service_received falhou', { err: e.message }));

  return updated;
}

// ──────────────────────────────────────────────────────
// 5. Cancelamento
// ──────────────────────────────────────────────────────

/**
 * Cancela um agendamento (cliente ou prestador).
 * Aplica política de cancelamento se cliente cancelar fora do prazo.
 *
 * @param {string} userId
 * @param {string} bookingId
 * @param {'client'|'provider'} role - quem está cancelando
 * @param {string} [reason]
 */
async function cancelBooking(userId, bookingId, role, reason) {
  const fn = 'cancelBooking';

  if (!['client', 'provider'].includes(role)) {
    throw new Error('role deve ser "client" ou "provider".');
  }

  // Buscar booking e verificar ownership
  const { data: booking, error: fetchErr } = await sb()
    .from('service_bookings')
    .select('*')
    .eq('id', bookingId)
    .single();

  if (fetchErr || !booking) throw new Error('Agendamento não encontrado.');

  if (role === 'client' && booking.client_id !== userId) throw new Error('Não autorizado.');
  if (role === 'provider' && booking.provider_id !== userId) {
    // Verificar se é manager da equipe
    const authorized = await isServiceProvider(userId, booking.service_id);
    if (!authorized) throw new Error('Não autorizado.');
  }

  const cancellableStatuses = ['pending', 'confirmed'];
  if (!cancellableStatuses.includes(booking.status)) {
    throw new Error(`Agendamento não pode ser cancelado (status atual: ${booking.status}).`);
  }

  // Calcular taxa de cancelamento (aplica apenas ao cliente)
  const policy = booking.cancellation_policy ?? { advance_hours: 24, fee_pct: 0 };
  const fee = role === 'client'
    ? calculateCancellationFee(booking.scheduled_at, policy, booking.amount_brl)
    : 0;

  if (fee > 0) {
    logWarn(fn, 'Cancelamento com taxa aplicada', {
      bookingId, userId, fee, policy,
      hoursBeforeService: (new Date(booking.scheduled_at) - new Date()) / (1000 * 60 * 60),
    });

    // Abrir ticket de suporte para acompanhamento da cobrança de taxa
    try {
      await supportService.createTicket({
        userId,
        title: `Taxa de cancelamento — Agendamento ${bookingId}`,
        description: `Cancelamento tardio do agendamento. Taxa aplicada: R$ ${fee.toFixed(2)}. ` +
          `Política: ${JSON.stringify(policy)}. Motivo: ${reason ?? 'não informado'}`,
        priority: 'medium',
        metadata: { booking_id: bookingId, cancellation_fee: fee, policy },
      });
    } catch (e) {
      logWarn(fn, 'Falha ao criar ticket de suporte para cancelamento com taxa', { err: e.message });
    }
  }

  const { data: updated, error } = await sb()
    .from('service_bookings')
    .update({
      status:        'cancelled',
      cancelled_at:  new Date().toISOString(),
      cancelled_by:  role,
      provider_notes: role === 'provider' ? reason?.trim() ?? null : booking.provider_notes,
      notes:          role === 'client'   ? (booking.notes ? `${booking.notes} | Motivo do cancelamento: ${reason ?? '-'}` : reason?.trim() ?? null) : booking.notes,
    })
    .eq('id', bookingId)
    .select()
    .single();

  if (error) throw new Error(`Erro ao cancelar booking: ${error.message}`);

  log(fn, 'Booking cancelado', { userId, bookingId, role, fee });

  // Se havia hold ativo, sinalizar necessidade de void ou refund (SCHED-2C processa)
  if (updated.payment_status === 'authorized' && updated.payment_intent_id) {
    logWarn(fn, 'Cancelamento com hold ativo — void/refund necessário', {
      bookingId, paymentIntentId: updated.payment_intent_id, fee,
    });
  }

  // Notificar a outra parte
  const notifyId = role === 'client' ? booking.provider_id : booking.client_id;
  try {
    socketManager.emitToUser(notifyId, 'booking:cancelled', {
      bookingId, cancelledBy: role, reason,
    });
  } catch (e) {
    logWarn(fn, 'Falha ao notificar via socket', { notifyId });
  }

  // Gamificação
  await gamificationService.triggerEvent('service_cancelled', userId, {
    bookingId, role, hasFee: fee > 0,
  }).catch(e => logWarn(fn, 'triggerEvent service_cancelled falhou', { err: e.message }));

  // [SCHED-CAP-013] Promover próximo da waitlist se houver fila
  try {
    const bookingWaitlistService = require('./bookingWaitlistService');
    await bookingWaitlistService.promoteNextInWaitlist(booking.service_id, booking.scheduled_at);
  } catch (e) {
    logWarn(fn, 'Promoção waitlist falhou', { bookingId, err: e.message });
  }

  return { booking: updated, cancellationFee: fee };
}

// ──────────────────────────────────────────────────────
// 6. Consultas
// ──────────────────────────────────────────────────────

/**
 * Lista bookings do usuário como cliente ou prestador.
 *
 * @param {string} userId
 * @param {'client'|'provider'} role
 * @param {string} [status] - filtro opcional por status
 */
async function getMyBookings(userId, role, status) {
  if (!['client', 'provider'].includes(role)) {
    throw new Error('role deve ser "client" ou "provider".');
  }

  const field = role === 'client' ? 'client_id' : 'provider_id';
  let query = sb()
    .from('service_bookings')
    .select('*')
    .eq(field, userId)
    .order('scheduled_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw new Error(`Erro ao listar bookings: ${error.message}`);
  return data ?? [];
}

/**
 * Retorna detalhe de um booking (cliente ou prestador têm acesso).
 */
async function getBookingById(userId, bookingId) {
  const { data, error } = await sb()
    .from('service_bookings')
    .select('*')
    .eq('id', bookingId)
    .or(`client_id.eq.${userId},provider_id.eq.${userId}`)
    .single();

  if (error || !data) throw new Error('Agendamento não encontrado.');
  return data;
}

// ──────────────────────────────────────────────────────
// 7. No-show (prestador marca ausência do cliente)
// ──────────────────────────────────────────────────────

/**
 * Prestador marca um agendamento confirmado como no-show (cliente não compareceu).
 * Só pode ser chamado após o horário agendado ter passado.
 *
 * Máquina de estados: confirmed → no_show
 *
 * @param {string} userId    - ID do prestador (deve ser o provider do booking)
 * @param {string} bookingId - ID do agendamento
 * @returns {object} booking atualizado
 */
async function markNoShow(userId, bookingId) {
  const fn = 'markNoShow';

  const booking = await _getBookingForProvider(userId, bookingId, fn);

  if (booking.status !== 'confirmed') {
    throw new Error(`Booking não pode ser marcado como no-show (status atual: ${booking.status}).`);
  }

  // Só permitir no-show após o horário agendado
  if (new Date(booking.scheduled_at) > new Date()) {
    throw new Error('Não é possível marcar no-show antes do horário agendado.');
  }

  const { data: updated, error } = await sb()
    .from('service_bookings')
    .update({
      status:     'no_show',
      no_show_at: new Date().toISOString(),
    })
    .eq('id', bookingId)
    .select()
    .single();

  if (error) throw new Error(`Erro ao marcar no-show: ${error.message}`);

  log(fn, 'Booking marcado como no-show', { userId, bookingId });

  // Notificar prestador via Socket.IO
  try {
    socketManager.emitToUser(userId, 'booking:no_show', {
      bookingId,
      scheduledAt: updated.scheduled_at,
    });
  } catch (e) {
    logWarn(fn, 'Falha ao notificar prestador via socket', { userId, err: e.message });
  }

  // Buscar dados do cliente e seller para a notificação persistente
  const clientData = await _getBookingClientData(booking.client_id);
  const sellerData = await _getBookingSellerData(booking.service_id);

  // Notificação persistente (fire-and-forget) — notifica o prestador (seller)
  setImmediate(() => {
    notificationDispatcher.dispatch({
      userId:     sellerData.userId,
      type:       'booking_no_show',
      importance: 'medium',
      data: {
        bookingId:   bookingId,
        bookingRef:  bookingId,
        clientName:  clientData.name,
        clientPhone: clientData.phone,
        sellerId:    sellerData.sellerId,
      },
      metadata: { triggeredBy: 'system' },
      dedupKey: `booking_no_show_${bookingId}`,
    }).catch(() => {});
  });

  // Se havia hold ativo, sinalizar necessidade de void (SCHED-2C processa)
  if (updated.payment_status === 'authorized' && updated.payment_intent_id) {
    logWarn(fn, 'No-show com hold ativo — void/capture necessário conforme política', {
      bookingId, paymentIntentId: updated.payment_intent_id,
    });
  }

  // Email ao cliente informando o no-show (fire-and-forget)
  _sendBookingEmail(
    booking.client_id,
    'Você não compareceu ao agendamento',
    'booking_no_show',
    {
      scheduledAt: new Date(booking.scheduled_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      bookingUrl:  `https://eloscloud.com/agendamentos/${bookingId}`,
    },
    bookingId,
  );

  // Trust Passport — no-show negativo para o cliente (-2)
  const trustPassportService = require('./trustPassportService');
  trustPassportService.recordEvent(booking.client_id, 'marketplace', 'booking_no_show', -2, true, {
    bookingId, providerId: userId,
  }).catch(e => logWarn(fn, 'trust event booking_no_show falhou', { err: e.message }));

  // [SCHED-CAP-013] Promover próximo da waitlist se houver fila (no-show libera vaga)
  try {
    const bookingWaitlistService = require('./bookingWaitlistService');
    await bookingWaitlistService.promoteNextInWaitlist(booking.service_id, booking.scheduled_at);
  } catch (e) {
    logWarn(fn, 'Promoção waitlist falhou', { bookingId, err: e.message });
  }

  return updated;
}

// ──────────────────────────────────────────────────────
// 8. Job de expiração (cron)
// ──────────────────────────────────────────────────────

/**
 * Expira bookings pending que ultrapassaram expires_at.
 * Deve ser chamado periodicamente pelo servidor (ex: a cada 15min).
 *
 * Retorna a lista de { booking_id, payment_intent_id, had_hold } para que
 * o chamador (ou bookingPaymentService) processe o void no Stripe.
 *
 * @returns {{ expired: Array, count: number }}
 */
async function runExpirationJob() {
  const fn = 'runExpirationJob';

  const { data, error } = await sb()
    .rpc('expire_pending_bookings');

  if (error) {
    logError(fn, error);
    return { expired: [], count: 0 };
  }

  const expired = data ?? [];
  if (expired.length > 0) {
    log(fn, `${expired.length} booking(s) expirado(s)`, {
      withHold: expired.filter(e => e.had_hold).length,
    });

    // Notificar clientes cujos bookings expiraram
    for (const item of expired) {
      try {
        // Buscar client_id para notificação (booking já está expired no banco)
        const { data: b } = await sb()
          .from('service_bookings')
          .select('client_id, provider_id')
          .eq('id', item.booking_id)
          .single();

        if (b?.client_id) {
          socketManager.emitToUser(b.client_id, 'booking:expired', {
            bookingId: item.booking_id,
          });
        }
      } catch (e) {
        logWarn(fn, 'Falha ao notificar expiração via socket', { bookingId: item.booking_id });
      }
    }
  }

  return { expired, count: expired.length };
}

// ──────────────────────────────────────────────────────
// 9. [SCHED-CAP-004] Confirmação automática de turmas
// ──────────────────────────────────────────────────────

/**
 * Cron job: confirma turmas cujas pré-reservas atingiram o min_capacity.
 * Roda a cada 15 minutos via sreWorker.
 *
 * Para cada slot que atingiu o mínimo:
 *   - Atualiza booking_type para 'confirmed' em todos os pre_reserved+pending
 *   - Notifica cada cliente via Socket.IO (booking:group_confirmed)
 *   - Envia email a cada cliente e ao prestador
 *
 * NÃO aciona pagamento Asaas — o pagamento continua no fluxo existente
 * (prestador confirma manualmente → capture).
 *
 * @returns {{ confirmed: number, slots: number }}
 */
async function runGroupConfirmationJob() {
  const fn = 'runGroupConfirmationJob';

  // Buscar todos os bookings pre_reserved + pending de serviços group com min_capacity > 1
  const { data: rawSlots, error: rawErr } = await sb()
    .from('service_bookings')
    .select(`
      id,
      service_id,
      scheduled_at,
      scheduled_end,
      client_id,
      provider_id,
      amount_brl,
      marketplace_products!inner(min_capacity, name, service_mode)
    `)
    .eq('booking_type', 'pre_reserved')
    .eq('status', 'pending')
    .eq('marketplace_products.service_mode', 'group');

  if (rawErr) {
    logError(fn, rawErr);
    return { confirmed: 0, slots: 0 };
  }

  if (!rawSlots || rawSlots.length === 0) {
    return { confirmed: 0, slots: 0 };
  }

  // Agrupar por service_id + scheduled_at e filtrar pelo min_capacity
  const grouped = {};
  for (const row of rawSlots) {
    const key = `${row.service_id}|${row.scheduled_at}`;
    if (!grouped[key]) {
      grouped[key] = {
        service_id:    row.service_id,
        scheduled_at:  row.scheduled_at,
        scheduled_end: row.scheduled_end,
        min_capacity:  row.marketplace_products.min_capacity,
        service_name:  row.marketplace_products.name,
        bookings:      [],
      };
    }
    grouped[key].bookings.push(row);
  }

  const slotsToProcess = Object.values(grouped).filter(
    s => s.min_capacity > 1 && s.bookings.length >= s.min_capacity
  );

  if (slotsToProcess.length === 0) {
    return { confirmed: 0, slots: 0 };
  }

  let totalConfirmed = 0;
  let slotsConfirmed = 0;

  // Para cada slot elegível, confirmar todas as pré-reservas
  for (const slot of slotsToProcess) {
    try {
      const bookingIds = slot.bookings.map(b => b.id);

      // UPDATE todos para booking_type = 'confirmed'
      const { error: updateErr } = await sb()
        .from('service_bookings')
        .update({ booking_type: 'confirmed' })
        .in('id', bookingIds)
        .eq('booking_type', 'pre_reserved')
        .eq('status', 'pending');

      if (updateErr) {
        logError(fn, updateErr, { serviceId: slot.service_id, scheduledAt: slot.scheduled_at });
        continue;
      }

      totalConfirmed += slot.bookings.length;
      slotsConfirmed++;

      log(fn, `Turma confirmada: ${slot.bookings.length} pré-reserva(s) → confirmed`, {
        serviceId: slot.service_id, scheduledAt: slot.scheduled_at,
        serviceName: slot.service_name, minCapacity: slot.min_capacity,
      });

      // Notificar cada cliente (fire-and-forget)
      const providerId = slot.bookings[0]?.provider_id;
      const scheduledBR = new Date(slot.scheduled_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

      for (const b of slot.bookings) {
        try {
          socketManager.emitToUser(b.client_id, 'booking:group_confirmed', {
            bookingId:   b.id,
            serviceId:   b.service_id,
            serviceName: slot.service_name,
            scheduledAt: b.scheduled_at,
          });
        } catch (e) {
          logWarn(fn, 'Socket notify falhou para cliente', { clientId: b.client_id, err: e.message });
        }

        // Email ao cliente
        _sendBookingEmail(
          b.client_id,
          `Turma confirmada! Sua vaga em ${slot.service_name} está garantida`,
          'booking_group_confirmed',
          {
            serviceName: slot.service_name,
            scheduledAt: scheduledBR,
            bookingUrl:  `https://eloscloud.com/agendamentos/${b.id}`,
          },
          b.id,
        );
      }

      // Email ao prestador
      if (providerId) {
        _sendBookingEmail(
          providerId,
          `Turma de ${slot.service_name} atingiu o mínimo de ${slot.min_capacity} alunos`,
          'booking_group_min_reached',
          {
            serviceName:  slot.service_name,
            scheduledAt:  scheduledBR,
            minCapacity:  slot.min_capacity,
            totalBooked:  slot.bookings.length,
            manageUrl:    'https://eloscloud.com/mercado/agendamentos',
          },
          slot.bookings[0].id,
        );
      }
    } catch (slotErr) {
      logError(fn, slotErr, { serviceId: slot.service_id, scheduledAt: slot.scheduled_at });
      // Continua com próximo slot — tolerante a falhas
    }
  }

  if (totalConfirmed > 0) {
    log(fn, `Job concluído: ${totalConfirmed} booking(s) confirmado(s) em ${slotsConfirmed} slot(s)`);
  }

  return { confirmed: totalConfirmed, slots: slotsConfirmed };
}

/**
 * [SCHED-CAP-004b] Prestador confirma todos os bookings pending de um slot de uma vez.
 * Útil para group mode — em vez de confirmar um a um.
 *
 * @param {string} userId - ID do prestador
 * @param {string} serviceId - ID do marketplace_product
 * @param {string} slotStart - ISO string do início do slot
 * @returns {{ confirmed: number, bookingIds: string[] }}
 */
async function confirmSlotBookings(userId, serviceId, slotStart) {
  const fn = 'confirmSlotBookings';

  // Validar que o userId é o prestador do serviço
  const authorized = await isServiceProvider(userId, serviceId);
  if (!authorized) {
    throw new Error('Não autorizado: você não é o prestador deste serviço.');
  }

  if (!serviceId || !slotStart) {
    throw new Error('serviceId e slotStart são obrigatórios.');
  }

  const slotStartDate = new Date(slotStart);
  if (isNaN(slotStartDate.getTime())) {
    throw new Error('slotStart inválido (formato ISO esperado).');
  }

  // Buscar todos os bookings pending para este slot
  const { data: bookings, error: fetchErr } = await sb()
    .from('service_bookings')
    .select('id, client_id, provider_id, scheduled_at, amount_brl, booking_type')
    .eq('service_id', serviceId)
    .eq('scheduled_at', slotStartDate.toISOString())
    .eq('status', 'pending');

  if (fetchErr) throw new Error(`Erro ao buscar bookings do slot: ${fetchErr.message}`);
  if (!bookings || bookings.length === 0) {
    throw new Error('Nenhum booking pendente encontrado para este slot.');
  }

  const bookingIds = bookings.map(b => b.id);

  // Confirmar todos de uma vez
  const { error: updateErr } = await sb()
    .from('service_bookings')
    .update({
      status:       'confirmed',
      confirmed_at: new Date().toISOString(),
    })
    .in('id', bookingIds)
    .eq('status', 'pending');

  if (updateErr) throw new Error(`Erro ao confirmar bookings do slot: ${updateErr.message}`);

  log(fn, `Slot confirmado em lote: ${bookings.length} booking(s)`, {
    userId, serviceId, slotStart, bookingIds,
  });

  // Buscar nome do serviço para notificações
  const { data: product } = await sb()
    .from('marketplace_products')
    .select('name')
    .eq('id', serviceId)
    .single();
  const serviceName = product?.name ?? 'Serviço';

  // Notificar cada cliente (fire-and-forget)
  for (const b of bookings) {
    try {
      socketManager.emitToUser(b.client_id, 'booking:confirmed', {
        bookingId:   b.id,
        scheduledAt: b.scheduled_at,
      });
    } catch (e) {
      logWarn(fn, 'Socket notify falhou para cliente', { clientId: b.client_id, err: e.message });
    }

    _sendBookingEmail(
      b.client_id,
      `Seu agendamento foi confirmado! — ${serviceName}`,
      'booking_confirmed',
      {
        scheduledAt: new Date(b.scheduled_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        bookingUrl:  `https://eloscloud.com/agendamentos/${b.id}`,
      },
      b.id,
    );
  }

  return { confirmed: bookings.length, bookingIds };
}

// ──────────────────────────────────────────────────────
// 10. [SCHED-CAP-006] Cancelamento coletivo por deadline
// ──────────────────────────────────────────────────────

/**
 * Cron job: cancela turmas cujo deadline expirou SEM atingir min_capacity.
 * Roda a cada 15 minutos via sreWorker.
 *
 * Para cada slot que NÃO atingiu o mínimo e cujo deadline já passou:
 *   - Cancela todos os pre_reserved + pending bookings (status='cancelled', cancelled_by='system')
 *   - Void de holds Asaas se existirem
 *   - Notifica cada cliente via Socket.IO (booking:group_cancelled)
 *   - Envia email a cada cliente e ao prestador
 *
 * @returns {{ cancelled: number, slots: number, voided: number }}
 */
async function runGroupDeadlineJob() {
  const fn = 'runGroupDeadlineJob';
  const bookingPaymentService = require('./bookingPaymentService');

  // Buscar todos os bookings pre_reserved + pending de serviços group
  const { data: rawSlots, error: rawErr } = await sb()
    .from('service_bookings')
    .select(`
      id,
      service_id,
      scheduled_at,
      scheduled_end,
      client_id,
      provider_id,
      payment_status,
      payment_intent_id,
      amount_brl,
      marketplace_products!inner(min_capacity, booking_deadline_hours, name, service_mode)
    `)
    .eq('booking_type', 'pre_reserved')
    .eq('status', 'pending')
    .eq('marketplace_products.service_mode', 'group');

  if (rawErr) {
    logError(fn, rawErr);
    return { cancelled: 0, slots: 0, voided: 0 };
  }

  if (!rawSlots || rawSlots.length === 0) {
    return { cancelled: 0, slots: 0, voided: 0 };
  }

  // Agrupar por service_id + scheduled_at
  const grouped = {};
  for (const row of rawSlots) {
    const key = `${row.service_id}|${row.scheduled_at}`;
    if (!grouped[key]) {
      grouped[key] = {
        service_id:             row.service_id,
        scheduled_at:           row.scheduled_at,
        scheduled_end:          row.scheduled_end,
        min_capacity:           row.marketplace_products.min_capacity,
        booking_deadline_hours: row.marketplace_products.booking_deadline_hours ?? 24,
        service_name:           row.marketplace_products.name,
        bookings:               [],
      };
    }
    grouped[key].bookings.push(row);
  }

  // Filtrar: deadline expirado E count < min_capacity
  const now = new Date();
  const expiredSlots = Object.values(grouped).filter(slot => {
    if (slot.min_capacity <= 1) return false;
    const scheduledAt = new Date(slot.scheduled_at);
    const deadlineAt = new Date(scheduledAt.getTime() - slot.booking_deadline_hours * 60 * 60 * 1000);
    return now >= deadlineAt && slot.bookings.length < slot.min_capacity;
  });

  if (expiredSlots.length === 0) {
    return { cancelled: 0, slots: 0, voided: 0 };
  }

  let totalCancelled = 0;
  let slotsCancelled = 0;
  let totalVoided = 0;

  // Para cada slot expirado, cancelar todas as pré-reservas
  for (const slot of expiredSlots) {
    try {
      const bookingIds = slot.bookings.map(b => b.id);

      // UPDATE todos para status='cancelled', cancelled_by='system'
      const { error: updateErr } = await sb()
        .from('service_bookings')
        .update({
          status:       'cancelled',
          cancelled_at: new Date().toISOString(),
          cancelled_by: 'system',
        })
        .in('id', bookingIds)
        .eq('status', 'pending');

      if (updateErr) {
        logError(fn, updateErr, { serviceId: slot.service_id, scheduledAt: slot.scheduled_at });
        continue;
      }

      totalCancelled += slot.bookings.length;
      slotsCancelled++;

      log(fn, `Turma cancelada por deadline: ${slot.bookings.length} pré-reserva(s)`, {
        serviceId: slot.service_id, scheduledAt: slot.scheduled_at,
        serviceName: slot.service_name, minCapacity: slot.min_capacity,
        actualCount: slot.bookings.length,
        deadlineHours: slot.booking_deadline_hours,
      });

      // Void holds Asaas (tolerante a falhas)
      for (const b of slot.bookings) {
        if (b.payment_status === 'authorized' && b.payment_intent_id) {
          try {
            await bookingPaymentService.voidBookingHold(b.payment_intent_id);
            totalVoided++;
          } catch (e) {
            logWarn(fn, 'Void hold falhou para booking cancelado', {
              bookingId: b.id, paymentIntentId: b.payment_intent_id, err: e.message,
            });
          }
        }
      }

      // Notificar clientes (fire-and-forget)
      const scheduledBR = new Date(slot.scheduled_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const providerId = slot.bookings[0]?.provider_id;

      for (const b of slot.bookings) {
        try {
          socketManager.emitToUser(b.client_id, 'booking:group_cancelled', {
            bookingId:   b.id,
            serviceId:   b.service_id,
            serviceName: slot.service_name,
            scheduledAt: b.scheduled_at,
            reason:      'min_capacity_not_reached',
          });
        } catch (e) {
          logWarn(fn, 'Socket notify falhou para cliente', { clientId: b.client_id, err: e.message });
        }

        // Email ao cliente
        _sendBookingEmail(
          b.client_id,
          `Turma de ${slot.service_name} cancelada — mínimo não atingido`,
          'booking_group_cancelled',
          {
            serviceName: slot.service_name,
            scheduledAt: scheduledBR,
            minCapacity: slot.min_capacity,
            actualCount: slot.bookings.length,
            searchUrl:   'https://eloscloud.com/mercado',
          },
          b.id,
        );
      }

      // Email ao prestador
      if (providerId) {
        _sendBookingEmail(
          providerId,
          `Turma de ${slot.service_name} cancelada — apenas ${slot.bookings.length}/${slot.min_capacity} alunos`,
          'booking_group_deadline_cancelled',
          {
            serviceName:  slot.service_name,
            scheduledAt:  scheduledBR,
            minCapacity:  slot.min_capacity,
            actualCount:  slot.bookings.length,
            manageUrl:    'https://eloscloud.com/mercado/agendamentos',
          },
          slot.bookings[0].id,
        );
      }
    } catch (slotErr) {
      logError(fn, slotErr, { serviceId: slot.service_id, scheduledAt: slot.scheduled_at });
      // Continua com próximo slot — tolerante a falhas
    }
  }

  if (totalCancelled > 0) {
    log(fn, `Job concluído: ${totalCancelled} pré-reserva(s) cancelada(s) em ${slotsCancelled} slot(s), ${totalVoided} hold(s) liberado(s)`);
  }

  return { cancelled: totalCancelled, slots: slotsCancelled, voided: totalVoided };
}

// ──────────────────────────────────────────────────────
// Helpers privados
// ──────────────────────────────────────────────────────

/**
 * Envia email transacional sobre um evento de booking.
 * Fire-and-forget: falhas são logadas mas não interrompem o fluxo principal.
 *
 * @param {string} toUserId  - UID do destinatário (para buscar email)
 * @param {string} subject
 * @param {string} templateType - ex: 'booking_confirmed'
 * @param {object} data
 * @param {string} bookingId
 */
async function _sendBookingEmail(toUserId, subject, templateType, data, bookingId) {
  try {
    const emailService = require('./emailService');
    const User         = require('../models/User');
    const user         = await User.getById(toUserId);
    if (!user?.email) return;

    await emailService.sendEmail({
      to:           user.email,
      subject,
      templateType,
      data:         { ...data, userName: user.nome || user.displayName || 'Usuário' },
      userId:       toUserId,
      reference:    bookingId,
      referenceType: 'service_booking',
    });
  } catch (e) {
    logWarn('_sendBookingEmail', `Email não enviado (templateType=${templateType})`, { err: e.message, bookingId });
  }
}

/**
 * [SCHED-CAP-005] Verifica thresholds de capacidade (50%, 80%, 100%) e emite
 * notificações de escassez ao prestador + alerta Socket.IO na room do serviço.
 *
 * Fire-and-forget: falhas são logadas mas não interrompem o fluxo principal.
 *
 * @param {string} serviceId
 * @param {string} slotStart - ISO string do início do slot
 * @param {number} bookedCount - vagas ocupadas APÓS o booking recém-criado
 * @param {number} maxCapacity - capacidade total do slot
 * @param {string} providerId - user_id do prestador (para notificação)
 * @param {string} serviceName - nome do serviço
 */
function _checkCapacityThresholds(serviceId, slotStart, bookedCount, maxCapacity, providerId, serviceName) {
  const fn = '_checkCapacityThresholds';

  // Só faz sentido para turmas com capacidade > 1
  if (maxCapacity <= 1) return;

  const percentFilled = Math.round((bookedCount / maxCapacity) * 100);
  const availableSeats = maxCapacity - bookedCount;

  // Definir thresholds atingidos (dedup: só dispara o mais alto atingido nesta chamada)
  const THRESHOLDS = [100, 80, 50];
  const hitThreshold = THRESHOLDS.find(t => percentFilled >= t);
  if (!hitThreshold) return;

  // Evitar spam: só notificar se o booking RECÉM-CRIADO é o que cruza o threshold
  // (booking anterior estava abaixo do threshold)
  const prevCount = bookedCount - 1;
  const prevPercent = Math.round((prevCount / maxCapacity) * 100);
  if (prevPercent >= hitThreshold) return; // threshold já havia sido cruzado antes

  setImmediate(async () => {
    try {
      const isFull = hitThreshold === 100;
      const alertMsg = isFull
        ? `Turma LOTADA! Sua turma de ${serviceName} atingiu 100% da capacidade (${bookedCount}/${maxCapacity} vagas).`
        : `Sua turma de ${serviceName} atingiu ${hitThreshold}% da capacidade (${bookedCount}/${maxCapacity} vagas).`;

      // Socket.IO: alerta na room do serviço (clientes que estão vendo os slots)
      socketManager.emitToRoom(`service:${serviceId}`, 'booking:capacity_alert', {
        serviceId,
        slotStart,
        percentFilled,
        availableSeats,
        maxCapacity,
      });

      // Notificação persistente ao prestador
      notificationDispatcher.dispatch({
        userId:     providerId,
        type:       'booking_capacity_alert',
        importance: isFull ? 'high' : 'medium',
        data: {
          serviceId,
          serviceName,
          slotStart,
          percentFilled,
          bookedCount,
          maxCapacity,
          availableSeats,
          isFull,
        },
        metadata: { triggeredBy: 'system' },
        dedupKey: `capacity_alert_${serviceId}_${slotStart}_${hitThreshold}`,
      }).catch(() => {});

      log(fn, alertMsg, { serviceId, slotStart, percentFilled, hitThreshold });
    } catch (e) {
      logWarn(fn, 'Falha ao processar threshold de capacidade', { serviceId, err: e.message });
    }
  });
}

/**
 * Busca um booking e valida que o userId é o provider (dono ou manager da equipe).
 */
async function _getBookingForProvider(userId, bookingId, fn) {
  const { data, error } = await sb()
    .from('service_bookings')
    .select('*')
    .eq('id', bookingId)
    .single();

  if (error || !data) throw new Error('Agendamento não encontrado ou não autorizado.');

  // Dono direto do booking
  if (data.provider_id === userId) return data;

  // Team member manager+ do seller que possui o serviço
  const authorized = await isServiceProvider(userId, data.service_id);
  if (!authorized) throw new Error('Agendamento não encontrado ou não autorizado.');

  return data;
}

/**
 * Busca nome e telefone do cliente para notificações.
 * @param {string} clientId
 * @returns {{ name: string, phone: string }}
 */
async function _getBookingClientData(clientId) {
  try {
    const User = require('../models/User');
    const user = await User.getById(clientId);
    return {
      name:  user?.nome || user?.displayName || 'Cliente',
      phone: user?.telefone || '',
    };
  } catch {
    return { name: 'Cliente', phone: '' };
  }
}

/**
 * Busca userId e sellerId do prestador a partir do service_id do booking.
 * @param {string} serviceId
 * @returns {{ userId: string|null, sellerId: string|null }}
 */
async function _getBookingSellerData(serviceId) {
  try {
    const { data } = await sb()
      .from('marketplace_products')
      .select('seller_id, seller_profiles!inner(user_id)')
      .eq('id', serviceId)
      .single();
    return {
      userId:   data?.seller_profiles?.user_id ?? null,
      sellerId: data?.seller_id ?? null,
    };
  } catch {
    return { userId: null, sellerId: null };
  }
}

// ──────────────────────────────────────────────────────
// 11. Scheduling Intelligence — Team Member Assignment
// ──────────────────────────────────────────────────────

/**
 * Verifica conflitos de disponibilidade de um membro da equipe.
 * Chama a RPC check_member_availability_conflicts.
 *
 * @param {string} sellerId
 * @param {string} memberId - ID do seller_team_members
 * @param {number} dayOfWeek - 0–6
 * @param {string} startTime - formato 'HH:MM'
 * @param {string} endTime - formato 'HH:MM'
 * @param {string} [excludeId] - ID do service_availability a excluir (auto-conflito)
 * @returns {Array} [{ availability_id, service_id, service_name, day_of_week, start_time, end_time }]
 */
async function checkConflicts(sellerId, memberId, dayOfWeek, startTime, endTime, excludeId = null) {
  const fn = 'checkConflicts';

  if (!sellerId || !memberId) return [];

  const { data, error } = await sb()
    .rpc('check_member_availability_conflicts', {
      p_seller_id:               sellerId,
      p_member_id:               memberId,
      p_day_of_week:             dayOfWeek,
      p_start_time:              startTime,
      p_end_time:                endTime,
      p_exclude_availability_id: excludeId,
    });

  if (error) {
    logWarn(fn, `Erro ao verificar conflitos: ${error.message}`, { sellerId, memberId });
    return [];
  }

  return data ?? [];
}

/**
 * Retorna membros da equipe elegíveis para atribuição em agendamentos.
 * Membros ativos com permissão can_manage_orders (employee+).
 *
 * @param {string} sellerId
 * @returns {Array} [{ id, user_id, role, user_name, user_avatar }]
 */
async function getTeamMembersForService(sellerId) {
  const fn = 'getTeamMembersForService';

  let { data, error } = await sb()
    .from('seller_team_members')
    .select(`
      id, user_id, role,
      users:user_id (full_name, avatar_url)
    `)
    .eq('seller_id', sellerId)
    .eq('status', 'active')
    .eq('active', true)
    .order('role', { ascending: false });

  if (error) {
    logWarn(fn, `Erro ao listar membros para serviço: ${error.message}`, { sellerId });
    return [];
  }

  // Auto-seed: se nenhum membro ativo, criar o owner como team member
  if (!data || data.length === 0) {
    try {
      const sellerTeamService = require('./sellerTeamService');
      const { data: seller } = await sb()
        .from('seller_profiles')
        .select('user_id')
        .eq('id', sellerId)
        .single();

      if (seller?.user_id) {
        await sellerTeamService.seedOwner(sellerId, seller.user_id);
        // Re-fetch após seed
        const refetch = await sb()
          .from('seller_team_members')
          .select(`
            id, user_id, role,
            users:user_id (full_name, avatar_url)
          `)
          .eq('seller_id', sellerId)
          .eq('status', 'active')
          .eq('active', true)
          .order('role', { ascending: false });

        data = refetch.data ?? [];
        log(fn, 'Owner auto-seeded como team member', { sellerId });
      }
    } catch (seedErr) {
      logWarn(fn, `Auto-seed falhou: ${seedErr.message}`, { sellerId });
    }
  }

  return (data ?? []).map(m => ({
    id:          m.id,
    user_id:     m.user_id,
    role:        m.role,
    user_name:   m.users?.full_name ?? 'Membro',
    user_avatar: m.users?.avatar_url ?? null,
  }));
}

// ──────────────────────────────────────────────────────
// [SCHED-CAP-011] Check-in QR Code
// ──────────────────────────────────────────────────────

/**
 * Prestador gera (ou recupera existente) token de check-in para um slot.
 * O mesmo token é compartilhado por TODOS os bookings confirmed do mesmo
 * service_id + scheduled_at, para que o QR code sirva para toda a turma.
 *
 * @param {string} userId   - provider (dono ou manager+ do seller)
 * @param {string} bookingId - qualquer booking confirmed do slot
 * @returns {{ token: string, expiresAt: string }}
 */
async function generateCheckinCode(userId, bookingId) {
  const fn = 'generateCheckinCode';

  // 1. Validar que o provider é dono/manager do serviço
  const booking = await _getBookingForProvider(userId, bookingId, fn);

  if (booking.status !== 'confirmed') {
    throw new Error(`Booking não está confirmado (status atual: ${booking.status}).`);
  }

  // 2. Janela temporal: scheduled_at deve ser hoje ou futuro próximo (±2h)
  const now = new Date();
  const scheduledAt = new Date(booking.scheduled_at);
  const twoHoursBefore = new Date(scheduledAt.getTime() - 2 * 60 * 60 * 1000);
  const scheduledEnd = booking.scheduled_end
    ? new Date(booking.scheduled_end)
    : new Date(scheduledAt.getTime() + 60 * 60 * 1000); // fallback 1h
  const thirtyAfterEnd = new Date(scheduledEnd.getTime() + 30 * 60 * 1000);

  if (now < twoHoursBefore) {
    throw new Error('QR de check-in só pode ser gerado até 2h antes do horário agendado.');
  }
  if (now > thirtyAfterEnd) {
    throw new Error('Janela de check-in encerrada (30min após o término do serviço).');
  }

  // 3. Se já existe token para o slot, retornar o existente
  const { data: existing } = await sb()
    .from('service_bookings')
    .select('checkin_token')
    .eq('service_id', booking.service_id)
    .eq('scheduled_at', booking.scheduled_at)
    .eq('status', 'confirmed')
    .not('checkin_token', 'is', null)
    .limit(1)
    .maybeSingle();

  if (existing?.checkin_token) {
    log(fn, 'Token de check-in existente retornado', { bookingId, token: existing.checkin_token.slice(0, 8) });
    return { token: existing.checkin_token, expiresAt: thirtyAfterEnd.toISOString() };
  }

  // 4. Gerar token único
  const token = crypto.randomBytes(16).toString('hex');

  // 5. Atribuir o token a TODOS os bookings confirmed do slot
  const { error: updateErr } = await sb()
    .from('service_bookings')
    .update({ checkin_token: token })
    .eq('service_id', booking.service_id)
    .eq('scheduled_at', booking.scheduled_at)
    .eq('status', 'confirmed');

  if (updateErr) {
    throw new Error(`Erro ao salvar token de check-in: ${updateErr.message}`);
  }

  log(fn, '[SCHED-CAP] Token de check-in gerado para slot', {
    bookingId, serviceId: booking.service_id, scheduledAt: booking.scheduled_at,
    tokenPrefix: token.slice(0, 8),
  });

  return { token, expiresAt: thirtyAfterEnd.toISOString() };
}

/**
 * Cliente faz check-in escaneando o QR code.
 *
 * @param {string} token    - checkin_token do slot
 * @param {string} clientId - user_id do cliente autenticado
 * @returns {object} booking atualizado
 */
async function checkinBooking(token, clientId) {
  const fn = 'checkinBooking';

  if (!token) throw new Error('Token de check-in é obrigatório.');
  if (!clientId) throw new Error('Não autorizado.');

  // 1. Buscar booking do cliente pelo token
  const { data: booking, error: fetchErr } = await sb()
    .from('service_bookings')
    .select('*')
    .eq('checkin_token', token)
    .eq('client_id', clientId)
    .eq('status', 'confirmed')
    .maybeSingle();

  if (fetchErr) throw new Error(`Erro ao buscar booking: ${fetchErr.message}`);
  if (!booking) throw new Error('Agendamento não encontrado para este token e usuário.');

  // 2. Já fez check-in?
  if (booking.checked_in_at) {
    throw new Error('Você já fez check-in neste agendamento.');
  }

  // 3. Janela temporal: scheduled_at -15min até scheduled_end +30min
  const now = new Date();
  const scheduledAt = new Date(booking.scheduled_at);
  const fifteenBefore = new Date(scheduledAt.getTime() - 15 * 60 * 1000);
  const scheduledEnd = booking.scheduled_end
    ? new Date(booking.scheduled_end)
    : new Date(scheduledAt.getTime() + 60 * 60 * 1000);
  const thirtyAfterEnd = new Date(scheduledEnd.getTime() + 30 * 60 * 1000);

  if (now < fifteenBefore) {
    throw new Error('Check-in abre 15 minutos antes do horário agendado.');
  }
  if (now > thirtyAfterEnd) {
    throw new Error('Janela de check-in encerrada (30min após o término do serviço).');
  }

  // 4. Marcar check-in
  const checkedInAt = new Date().toISOString();
  const { data: updated, error: updateErr } = await sb()
    .from('service_bookings')
    .update({ checked_in_at: checkedInAt })
    .eq('id', booking.id)
    .select()
    .single();

  if (updateErr) throw new Error(`Erro ao registrar check-in: ${updateErr.message}`);

  log(fn, '[SCHED-CAP] Check-in realizado', {
    bookingId: booking.id, clientId, checkedInAt,
  });

  // 5. Notificar provider via Socket.IO
  try {
    socketManager.emitToUser(booking.provider_id, 'booking:checkin', {
      bookingId:   booking.id,
      clientId,
      checkedInAt,
    });
  } catch (e) {
    logWarn(fn, 'Falha ao notificar provider via socket (check-in)', { providerId: booking.provider_id });
  }

  return updated;
}

/**
 * Provider consulta quem fez check-in num slot específico.
 *
 * @param {string} userId    - provider autenticado
 * @param {string} serviceId - ID do serviço
 * @param {string} slotStart - ISO timestamp do início do slot
 * @returns {Array<{ bookingId, clientId, clientName, checkedInAt, status }>}
 */
async function getSlotCheckins(userId, serviceId, slotStart) {
  const fn = 'getSlotCheckins';

  // Verificar que o provider tem acesso ao serviço
  const authorized = await isServiceProvider(userId, serviceId);
  if (!authorized) throw new Error('Não autorizado a consultar check-ins deste serviço.');

  const { data, error } = await sb()
    .from('service_bookings')
    .select(`
      id,
      client_id,
      checked_in_at,
      status,
      users:client_id (full_name, avatar_url)
    `)
    .eq('service_id', serviceId)
    .eq('scheduled_at', slotStart)
    .in('status', ['confirmed', 'completed']);

  if (error) throw new Error(`Erro ao buscar check-ins: ${error.message}`);

  log(fn, '[SCHED-CAP] Check-ins consultados', { serviceId, slotStart, count: data?.length ?? 0 });

  return (data ?? []).map(b => ({
    bookingId:   b.id,
    clientId:    b.client_id,
    clientName:  b.users?.full_name ?? 'Cliente',
    clientAvatar: b.users?.avatar_url ?? null,
    checkedInAt: b.checked_in_at,
    status:      b.status,
  }));
}

// ──────────────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────────────

module.exports = {
  setAvailability,
  getAvailability,
  getAvailableSlots,
  getActiveDays,
  createBooking,
  confirmBooking,
  declineBooking,
  completeBooking,
  cancelBooking,
  markNoShow,
  getMyBookings,
  getBookingById,
  runExpirationJob,
  checkConflicts,
  getTeamMembersForService,
  // [SCHED-CAP-004] Confirmação automática de turmas
  runGroupConfirmationJob,
  confirmSlotBookings,
  // [SCHED-CAP-006] Cancelamento coletivo por deadline
  runGroupDeadlineJob,
  // [SCHED-CAP-011] Check-in QR Code
  generateCheckinCode,
  checkinBooking,
  getSlotCheckins,
};
