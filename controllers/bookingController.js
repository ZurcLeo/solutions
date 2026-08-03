'use strict';

/**
 * bookingController — ElosCloud Agendamento de Serviços
 * [SCHED-001]
 *
 * Endpoints REST para o sistema de agendamentos.
 * Toda lógica de negócio fica em bookingService / bookingPaymentService.
 */

const bookingService        = require('../services/bookingService');
const bookingPaymentService = require('../services/bookingPaymentService');
const { logger }            = require('../logger');

const CTRL = 'bookingController';

function handleError(res, err, fn) {
  logger.error(`[${CTRL}] ${fn}: ${err.message}`, { error: err.message });

  if (err.message.includes('Não autorizado') || err.message.includes('não autorizado')) {
    return res.status(403).json({ success: false, error: err.message });
  }
  if (err.message.includes('não encontrado') || err.message.includes('Não encontrado')) {
    return res.status(404).json({ success: false, error: err.message });
  }
  return res.status(400).json({ success: false, error: err.message });
}

// ──────────────────────────────────────────────────────
// Disponibilidade do prestador
// ──────────────────────────────────────────────────────

/**
 * PUT /api/bookings/availability
 * Body: { service_id, slots: [{ day_of_week, start_time, end_time, slot_duration_minutes, gap_minutes, max_capacity?, assigned_member_id? }] }
 * Substitui toda a grade de disponibilidade do serviço.
 * [SCHED-CAP] max_capacity: número de vagas por slot (default 1 = individual).
 */
async function setAvailability(req, res) {
  const fn = 'setAvailability';
  try {
    const { service_id, slots, force } = req.body;
    if (!service_id) return res.status(400).json({ success: false, error: 'service_id é obrigatório.' });

    const result = await bookingService.setAvailability(req.user.uid, service_id, slots, { force: !!force });

    // Se retornou conflitos (sem force), responde 409 com os conflitos
    if (result?.conflicts) {
      return res.status(409).json({ success: false, conflicts: result.conflicts });
    }

    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, fn);
  }
}

/**
 * GET /api/bookings/availability/:serviceId
 * Retorna a grade semanal de um serviço (leitura pública — autenticado).
 */
async function getAvailability(req, res) {
  const fn = 'getAvailability';
  try {
    const data = await bookingService.getAvailability(req.params.serviceId);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return handleError(res, err, fn);
  }
}

// ──────────────────────────────────────────────────────
// Dias ativos da semana (prefetch do calendário)
// ──────────────────────────────────────────────────────

/**
 * GET /api/bookings/available-days?service_id=X
 * Retorna os day_of_week (0–6) que têm disponibilidade configurada.
 * Usado pelo BookingCalendar para desabilitar dias sem agenda.
 */
async function getActiveDays(req, res) {
  const fn = 'getActiveDays';
  try {
    const { service_id } = req.query;
    if (!service_id) return res.status(400).json({ success: false, error: 'service_id é obrigatório.' });
    const data = await bookingService.getActiveDays(service_id);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return handleError(res, err, fn);
  }
}

// ──────────────────────────────────────────────────────
// Slots disponíveis
// ──────────────────────────────────────────────────────

/**
 * GET /api/bookings/slots?service_id=...&date=YYYY-MM-DD
 * Retorna slots disponíveis/ocupados para um serviço numa data.
 * [SCHED-CAP] Cada slot inclui: max_capacity, booked_count, available_seats, available.
 */
async function getAvailableSlots(req, res) {
  const fn = 'getAvailableSlots';
  try {
    const { service_id, date } = req.query;
    if (!service_id) return res.status(400).json({ success: false, error: 'service_id é obrigatório.' });
    if (!date)       return res.status(400).json({ success: false, error: 'date é obrigatório (YYYY-MM-DD).' });

    const data = await bookingService.getAvailableSlots(service_id, date);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return handleError(res, err, fn);
  }
}

// ──────────────────────────────────────────────────────
// CRUD de agendamentos
// ──────────────────────────────────────────────────────

/**
 * POST /api/bookings
 * Body: { service_id, slot_start, notes? }
 * Cria um agendamento e — opcionalmente — inicia o PaymentIntent Stripe.
 *
 * Se STRIPE_SECRET_KEY estiver configurado, cria o PaymentIntent imediatamente
 * e retorna clientSecret para o frontend confirmar o hold.
 */
async function createBooking(req, res) {
  const fn = 'createBooking';
  try {
    const booking = await bookingService.createBooking(req.user.uid, req.body);

    // Tentar criar PaymentIntent (hold) se Stripe estiver configurado
    let paymentData = null;
    if (process.env.STRIPE_SECRET_KEY && booking.amount_brl > 0) {
      try {
        paymentData = await bookingPaymentService.authorizeBookingPayment(
          booking.id,
          booking.amount_brl,
          req.body.stripe_customer_id ?? null,
          req.body.service_description ?? null,
        );
      } catch (payErr) {
        // Pagamento falhou — não bloquear criação do booking mas avisar
        logger.warn(`[${CTRL}] ${fn}: Stripe indisponível, booking criado sem hold`, {
          bookingId: booking.id, error: payErr.message,
        });
      }
    }

    return res.status(201).json({
      success: true,
      data: booking,
      payment: paymentData,  // null se Stripe não configurado
    });
  } catch (err) {
    return handleError(res, err, fn);
  }
}

/**
 * GET /api/bookings
 * Query: role=client|provider, status=pending|confirmed|...
 */
async function getMyBookings(req, res) {
  const fn = 'getMyBookings';
  try {
    const role   = req.query.role   ?? 'client';
    const status = req.query.status ?? undefined;
    const data = await bookingService.getMyBookings(req.user.uid, role, status);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return handleError(res, err, fn);
  }
}

/**
 * GET /api/bookings/:id
 */
async function getBookingById(req, res) {
  const fn = 'getBookingById';
  try {
    const data = await bookingService.getBookingById(req.user.uid, req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return handleError(res, err, fn);
  }
}

// ──────────────────────────────────────────────────────
// Ações do prestador
// ──────────────────────────────────────────────────────

/**
 * PATCH /api/bookings/:id/confirm
 * Body: { provider_notes? }
 */
async function confirmBooking(req, res) {
  const fn = 'confirmBooking';
  try {
    const data = await bookingService.confirmBooking(
      req.user.uid,
      req.params.id,
      req.body.provider_notes,
    );
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return handleError(res, err, fn);
  }
}

/**
 * PATCH /api/bookings/:id/decline
 * Body: { reason? }
 */
async function declineBooking(req, res) {
  const fn = 'declineBooking';
  try {
    const data = await bookingService.declineBooking(
      req.user.uid,
      req.params.id,
      req.body.reason,
    );
    // Void do hold se necessário
    if (data.payment_status === 'voided' && data.payment_intent_id) {
      bookingPaymentService.voidBookingHold(data.payment_intent_id)
        .catch(e => logger.warn(`[${CTRL}] void após decline falhou`, { error: e.message }));
    }
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return handleError(res, err, fn);
  }
}

/**
 * PATCH /api/bookings/:id/complete
 * Prestador conclui o serviço → capture Stripe.
 */
async function completeBooking(req, res) {
  const fn = 'completeBooking';
  try {
    const booking = await bookingService.completeBooking(req.user.uid, req.params.id);

    // Capture do pagamento (fire-and-forget seguro — falha fica no log)
    if (booking.payment_status === 'authorized' && booking.payment_intent_id) {
      bookingPaymentService.captureBookingPayment(booking.payment_intent_id)
        .catch(e => logger.error(`[${CTRL}] capture após complete falhou`, {
          bookingId: booking.id, error: e.message,
        }));
    }

    return res.status(200).json({ success: true, data: booking });
  } catch (err) {
    return handleError(res, err, fn);
  }
}

// ──────────────────────────────────────────────────────
// No-show
// ──────────────────────────────────────────────────────

/**
 * PATCH /api/bookings/:id/no-show
 * Prestador marca que o cliente não compareceu ao agendamento confirmado.
 */
async function markNoShow(req, res) {
  const fn = 'markNoShow';
  try {
    const booking = await bookingService.markNoShow(req.user.uid, req.params.id);

    // Se havia hold ativo, processar conforme política (void ou capture parcial)
    if (booking.payment_status === 'authorized' && booking.payment_intent_id) {
      const policy = booking.cancellation_policy ?? { fee_pct: 0 };
      if (policy.fee_pct > 0) {
        // No-show: capturar taxa conforme política de cancelamento
        bookingPaymentService.captureWithPartialRefund(booking.payment_intent_id, policy.fee_pct)
          .catch(e => logger.error(`[${CTRL}] captureWithPartialRefund após no-show falhou`, {
            bookingId: booking.id, error: e.message,
          }));
      } else {
        // Sem taxa — liberar hold
        bookingPaymentService.voidBookingHold(booking.payment_intent_id)
          .catch(e => logger.error(`[${CTRL}] void após no-show falhou`, {
            bookingId: booking.id, error: e.message,
          }));
      }
    }

    return res.status(200).json({ success: true, data: booking });
  } catch (err) {
    return handleError(res, err, fn);
  }
}

// ──────────────────────────────────────────────────────
// Cancelamento
// ──────────────────────────────────────────────────────

/**
 * PATCH /api/bookings/:id/cancel
 * Body: { role: 'client'|'provider', reason? }
 */
async function cancelBooking(req, res) {
  const fn = 'cancelBooking';
  try {
    const { role, reason } = req.body;
    const result = await bookingService.cancelBooking(
      req.user.uid, req.params.id, role, reason,
    );

    // Processar pagamento conforme taxa de cancelamento
    const booking = result.booking;
    const fee     = result.cancellationFee ?? 0;

    if (booking.payment_intent_id && booking.payment_status === 'authorized') {
      if (fee > 0 && role === 'client') {
        // Capturar proporcionalmente e reembolsar o restante
        const feePct = booking.cancellation_policy?.fee_pct ?? 0;
        bookingPaymentService.captureWithPartialRefund(booking.payment_intent_id, feePct)
          .catch(e => logger.error(`[${CTRL}] captureWithPartialRefund falhou`, {
            bookingId: booking.id, error: e.message,
          }));
      } else {
        // Sem taxa — liberar hold sem cobrança
        bookingPaymentService.voidBookingHold(booking.payment_intent_id)
          .catch(e => logger.error(`[${CTRL}] void após cancel falhou`, {
            bookingId: booking.id, error: e.message,
          }));
      }
    }

    return res.status(200).json({
      success: true,
      data:    booking,
      cancellationFee: fee,
    });
  } catch (err) {
    return handleError(res, err, fn);
  }
}

// ──────────────────────────────────────────────────────
// Scheduling Intelligence — Team Member Assignment
// ──────────────────────────────────────────────────────

/**
 * GET /api/bookings/conflicts?sellerId=&memberId=&dayOfWeek=&startTime=&endTime=&excludeId=
 * Verifica conflitos de disponibilidade de um membro.
 */
async function checkConflicts(req, res) {
  const fn = 'checkConflicts';
  try {
    const { sellerId, memberId, dayOfWeek, startTime, endTime, excludeId } = req.query;
    if (!sellerId || !memberId || dayOfWeek == null || !startTime || !endTime) {
      return res.status(400).json({ success: false, error: 'sellerId, memberId, dayOfWeek, startTime e endTime são obrigatórios.' });
    }
    const data = await bookingService.checkConflicts(
      sellerId, memberId, Number(dayOfWeek), startTime, endTime, excludeId || null,
    );
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return handleError(res, err, fn);
  }
}

/**
 * GET /api/bookings/service-team/:sellerId
 * Retorna membros da equipe elegíveis para atribuição.
 */
async function getServiceTeam(req, res) {
  const fn = 'getServiceTeam';
  try {
    const { sellerId } = req.params;
    if (!sellerId) return res.status(400).json({ success: false, error: 'sellerId é obrigatório.' });
    const data = await bookingService.getTeamMembersForService(sellerId);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return handleError(res, err, fn);
  }
}

// ──────────────────────────────────────────────────────
// [SCHED-CAP-011] Check-in QR Code
// ──────────────────────────────────────────────────────

/**
 * POST /api/bookings/:id/checkin-code
 * Prestador gera QR code de check-in para um slot.
 * Retorna token + URL pública para o QR.
 */
async function generateCheckin(req, res) {
  const fn = 'generateCheckin';
  try {
    const { token, expiresAt } = await bookingService.generateCheckinCode(
      req.user.uid,
      req.params.id,
    );

    const qrData = `https://eloscloud.com/checkin?t=${token}`;

    return res.status(200).json({
      success: true,
      data: { token, qrData, expiresAt },
    });
  } catch (err) {
    return handleError(res, err, fn);
  }
}

/**
 * POST /api/bookings/checkin
 * Cliente faz check-in escaneando o QR code (autenticado).
 * Body: { token }
 */
async function performCheckin(req, res) {
  const fn = 'performCheckin';
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, error: 'token é obrigatório.' });

    const data = await bookingService.checkinBooking(token, req.user.uid);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return handleError(res, err, fn);
  }
}

/**
 * GET /api/bookings/checkins?service_id=...&slot_start=...
 * Provider consulta lista de check-ins de um slot.
 */
async function getCheckins(req, res) {
  const fn = 'getCheckins';
  try {
    const { service_id, slot_start } = req.query;
    if (!service_id) return res.status(400).json({ success: false, error: 'service_id é obrigatório.' });
    if (!slot_start) return res.status(400).json({ success: false, error: 'slot_start é obrigatório.' });

    const data = await bookingService.getSlotCheckins(req.user.uid, service_id, slot_start);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return handleError(res, err, fn);
  }
}

// ──────────────────────────────────────────────────────
// [SCHED-CAP-013] Waitlist / Fila de Espera
// ──────────────────────────────────────────────────────

const bookingWaitlistService = require('../services/bookingWaitlistService');

/**
 * POST /api/bookings/waitlist
 * Body: { service_id, slot_start }
 * Cliente entra na fila de espera para um slot lotado.
 */
async function joinWaitlist(req, res) {
  const fn = 'joinWaitlist';
  try {
    const { service_id, slot_start } = req.body;
    if (!service_id) return res.status(400).json({ success: false, error: 'service_id e obrigatorio.' });
    if (!slot_start) return res.status(400).json({ success: false, error: 'slot_start e obrigatorio.' });

    const result = await bookingWaitlistService.joinWaitlist(req.user.uid, { service_id, slot_start });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, fn);
  }
}

/**
 * DELETE /api/bookings/waitlist/:id
 * Cliente sai da fila de espera.
 */
async function leaveWaitlist(req, res) {
  const fn = 'leaveWaitlist';
  try {
    await bookingWaitlistService.leaveWaitlist(req.user.uid, req.params.id);
    return res.status(200).json({ success: true });
  } catch (err) {
    return handleError(res, err, fn);
  }
}

/**
 * GET /api/bookings/waitlist
 * Lista entries ativas da fila de espera do cliente.
 */
async function getMyWaitlistEntries(req, res) {
  const fn = 'getMyWaitlistEntries';
  try {
    const data = await bookingWaitlistService.getMyWaitlistEntries(req.user.uid);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return handleError(res, err, fn);
  }
}

/**
 * GET /api/bookings/waitlist/slot?service_id=...&slot_start=...
 * Provider consulta a fila de espera de um slot.
 */
async function getSlotWaitlist(req, res) {
  const fn = 'getSlotWaitlist';
  try {
    const { service_id, slot_start } = req.query;
    if (!service_id) return res.status(400).json({ success: false, error: 'service_id e obrigatorio.' });
    if (!slot_start) return res.status(400).json({ success: false, error: 'slot_start e obrigatorio.' });

    const data = await bookingWaitlistService.getSlotWaitlist(req.user.uid, service_id, slot_start);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return handleError(res, err, fn);
  }
}

module.exports = {
  setAvailability,
  getAvailability,
  getActiveDays,
  getAvailableSlots,
  createBooking,
  getMyBookings,
  getBookingById,
  confirmBooking,
  declineBooking,
  completeBooking,
  markNoShow,
  cancelBooking,
  checkConflicts,
  getServiceTeam,
  // [SCHED-CAP-011] Check-in QR Code
  generateCheckin,
  performCheckin,
  getCheckins,
  // [SCHED-CAP-013] Waitlist / Fila de Espera
  joinWaitlist,
  leaveWaitlist,
  getMyWaitlistEntries,
  getSlotWaitlist,
};
