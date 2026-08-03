/**
 * @fileoverview bookingPaymentService — Asaas pre-auth para Agendamentos
 * [SCHED-2C]
 *
 * Gerencia o ciclo completo de pagamento via Asaas authorizeOnly
 * (hold na solicitação, capture na conclusão).
 *
 * Fluxo:
 *   1. createBooking()     → authorizeBookingPayment() → Asaas payment criado (hold pendente)
 *   2. Webhook PAYMENT_AUTHORIZED → confirmAuthorization()
 *   3. completeBooking()   → captureBookingPayment()   → valor debitado
 *   4. cancelBooking() /
 *      runExpirationJob()  → voidBookingHold()         → hold liberado sem cobrança
 *
 * Variáveis de ambiente necessárias:
 *   ASAAS_API_KEY             — chave Asaas
 *   SUPABASE_SERVICE_ROLE_KEY — para atualizar payment_status sem RLS
 */

'use strict';

const { logger } = require('../logger');
const { createClient } = require('@supabase/supabase-js');
const asaasService = require('./asaasService');

const SERVICE = 'bookingPaymentService';

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

// Cliente Supabase com service_role para bypassa RLS ao atualizar payment_status
function getServiceClient() {
  const url  = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados.');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Atualiza payment_status e payment_intent_id em service_bookings via service_role.
 */
async function _updateBookingPayment(bookingId, patch) {
  const { error } = await getServiceClient()
    .from('service_bookings')
    .update(patch)
    .eq('id', bookingId);

  if (error) {
    throw new Error(`Erro ao atualizar booking ${bookingId}: ${error.message}`);
  }
}

// ──────────────────────────────────────────────────────
// 1. Criar pagamento Asaas (hold)
// ──────────────────────────────────────────────────────

/**
 * Cria um pagamento Asaas com authorizeOnly=true para reservar o valor no cartão do cliente.
 * O valor fica em hold até o prestador confirmar a conclusão (capture) ou cancelar (refund/void).
 *
 * @param {string} bookingId
 * @param {number} amountBrl - valor em BRL (ex: 50.00)
 * @param {string} [customerId] - ID do customer Asaas do cliente
 * @param {string} [description] - descrição do serviço
 * @returns {{ paymentId: string, status: string }}
 */
async function authorizeBookingPayment(bookingId, amountBrl, customerId, description) {
  const fn = 'authorizeBookingPayment';

  if (Number(amountBrl) < 5) {
    throw new Error('Valor mínimo para agendamento é R$ 5,00.');
  }

  const result = await asaasService.authorizeCardPayment({
    customerId,
    value: Number(amountBrl),
    description: description ?? `Agendamento ElosCloud ${bookingId}`,
    externalReference: `booking:${bookingId}`,
  });

  log(fn, 'Pagamento Asaas criado (hold pendente)', {
    bookingId, paymentId: result.paymentId, amountBrl,
  });

  // Salvar payment_intent_id no booking (reutiliza coluna existente)
  await _updateBookingPayment(bookingId, {
    payment_intent_id: result.paymentId,
  });

  return {
    paymentId: result.paymentId,
    status: result.status,
  };
}

// ──────────────────────────────────────────────────────
// 2. Confirmar autorização (webhook)
// ──────────────────────────────────────────────────────

/**
 * Chamado após o webhook PAYMENT_AUTHORIZED do Asaas,
 * indicando que o banco autorizou o hold.
 *
 * @param {string} paymentId - ID do pagamento Asaas
 * @returns {{ success: boolean, bookingId: string }}
 */
async function confirmAuthorization(paymentId) {
  const fn = 'confirmAuthorization';

  const payment = await asaasService.getPaymentStatus(paymentId);

  if (payment.status !== 'AUTHORIZED') {
    logWarn(fn, 'Pagamento não está em AUTHORIZED', {
      paymentId, asaasStatus: payment.status,
    });
    return { success: false, bookingId: null, asaasStatus: payment.status };
  }

  // Extrair bookingId de externalReference (formato: "booking:{id}")
  const bookingId = payment.externalReference?.startsWith('booking:')
    ? payment.externalReference.split(':')[1]
    : null;

  if (!bookingId) {
    logWarn(fn, 'bookingId não encontrado no externalReference', { paymentId });
    return { success: false, bookingId: null };
  }

  await _updateBookingPayment(bookingId, {
    payment_status: 'authorized',
  });

  log(fn, 'Hold autorizado pelo banco', { bookingId, paymentId });
  return { success: true, bookingId };
}

// ──────────────────────────────────────────────────────
// 3. Capturar (conclusão do serviço)
// ──────────────────────────────────────────────────────

/**
 * Captura o valor reservado no cartão do cliente após conclusão do serviço.
 *
 * @param {string} paymentId - ID do pagamento Asaas
 * @returns {object} resultado da captura
 */
async function captureBookingPayment(paymentId) {
  const fn = 'captureBookingPayment';

  let captureResult;
  try {
    captureResult = await asaasService.captureAuthorizedPayment(paymentId);
  } catch (err) {
    logError(fn, err, { paymentId });
    throw new Error(`Falha ao capturar pagamento: ${err.message}`);
  }

  // Buscar booking pelo payment_intent_id
  const { data: booking } = await getServiceClient()
    .from('service_bookings')
    .select('id')
    .eq('payment_intent_id', paymentId)
    .single();

  if (booking) {
    await _updateBookingPayment(booking.id, {
      payment_status: 'captured',
    });
  }

  log(fn, 'Pagamento capturado com sucesso', { paymentId, bookingId: booking?.id });
  return captureResult;
}

// ──────────────────────────────────────────────────────
// 4. Void (cancelamento / expiração)
// ──────────────────────────────────────────────────────

/**
 * Cancela o hold Asaas sem cobrar o cliente (refund em AUTHORIZED = void).
 *
 * @param {string} paymentId - ID do pagamento Asaas
 * @returns {object} resultado do void
 */
async function voidBookingHold(paymentId) {
  const fn = 'voidBookingHold';

  let result;
  try {
    result = await asaasService.refundPayment(paymentId);
  } catch (err) {
    logError(fn, err, { paymentId });
    throw new Error(`Falha ao cancelar hold: ${err.message}`);
  }

  if (result.status === 'already_refunded') {
    logWarn(fn, 'Pagamento já estava em estado terminal', { paymentId });
    return { canceled: false, alreadyTerminal: true };
  }

  // Buscar booking pelo payment_intent_id
  const { data: booking } = await getServiceClient()
    .from('service_bookings')
    .select('id')
    .eq('payment_intent_id', paymentId)
    .single();

  if (booking) {
    await _updateBookingPayment(booking.id, {
      payment_status: 'voided',
    });
  }

  log(fn, 'Hold cancelado (void)', { paymentId, bookingId: booking?.id });
  return result;
}

/**
 * Processa void para uma lista de bookings expirados.
 * Tolerante a falhas: um void que falha não interrompe os demais.
 *
 * @param {Array} expiredList - [{ booking_id, payment_intent_id, had_hold }]
 * @returns {{ voided: number, errors: Array }}
 */
async function voidExpiredBookings(expiredList) {
  const fn = 'voidExpiredBookings';
  let voided = 0;
  const errors = [];

  for (const item of expiredList) {
    if (!item.had_hold || !item.payment_intent_id) continue;

    try {
      await voidBookingHold(item.payment_intent_id);
      voided++;
    } catch (err) {
      logError(fn, err, { bookingId: item.booking_id, paymentId: item.payment_intent_id });
      errors.push({ bookingId: item.booking_id, error: err.message });
    }
  }

  if (voided > 0 || errors.length > 0) {
    log(fn, `Voids processados: ${voided} sucesso, ${errors.length} erro(s)`, { errors });
  }

  return { voided, errors };
}

// ──────────────────────────────────────────────────────
// 5. Reembolso parcial (cancelamento tardio com taxa)
// ──────────────────────────────────────────────────────

/**
 * Captura o valor total e em seguida reembolsa parcialmente (taxa de cancelamento).
 * Asaas não suporta captura parcial — faz capture full + refund parcial.
 * Ex: taxa de 50% → captura R$100, reembolsa R$50.
 *
 * @param {string} paymentId - ID do pagamento Asaas
 * @param {number} feePct - percentual retido (0.0 a 1.0)
 * @returns {{ captured: object, refunded: object|null }}
 */
async function captureWithPartialRefund(paymentId, feePct) {
  const fn = 'captureWithPartialRefund';

  // Recuperar valor original
  const payment = await asaasService.getPaymentStatus(paymentId);
  const originalAmount = payment.value;
  const retainAmount = Math.round(originalAmount * feePct * 100) / 100;
  const refundAmount = Math.round((originalAmount - retainAmount) * 100) / 100;

  // Captura total (Asaas não suporta captura parcial)
  const captured = await asaasService.captureAuthorizedPayment(paymentId);

  log(fn, 'Capture total para taxa de cancelamento', {
    paymentId, originalAmount, retainAmount, refundAmount, feePct,
  });

  // Buscar booking
  const { data: booking } = await getServiceClient()
    .from('service_bookings')
    .select('id')
    .eq('payment_intent_id', paymentId)
    .single();

  if (booking) {
    await _updateBookingPayment(booking.id, { payment_status: 'captured' });
  }

  let refunded = null;
  if (refundAmount > 0) {
    refunded = await asaasService.refundPayment(paymentId, refundAmount);
    if (booking) {
      await _updateBookingPayment(booking.id, { payment_status: 'refunded' });
    }
    log(fn, 'Reembolso parcial realizado', { paymentId, refundAmount });
  }

  return { captured, refunded };
}

// ──────────────────────────────────────────────────────
// 6. Status (reconciliação)
// ──────────────────────────────────────────────────────

/**
 * Consulta o status atual de um pagamento no Asaas.
 * Mapeia status Asaas → status interno.
 */
async function getBookingPaymentStatus(paymentId) {
  const payment = await asaasService.getPaymentStatus(paymentId);

  // Mapear status Asaas para status interno
  const statusMap = {
    AUTHORIZED: 'authorized',
    CONFIRMED: 'captured',
    RECEIVED: 'captured',
    REFUNDED: 'refunded',
    PENDING: 'pending',
  };

  return {
    status: statusMap[payment.status] || payment.status.toLowerCase(),
    amount: payment.value,
    currency: 'brl',
    bookingId: payment.externalReference?.startsWith('booking:')
      ? payment.externalReference.split(':')[1]
      : null,
  };
}

// ──────────────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────────────

module.exports = {
  authorizeBookingPayment,
  confirmAuthorization,
  captureBookingPayment,
  voidBookingHold,
  voidExpiredBookings,
  captureWithPartialRefund,
  getBookingPaymentStatus,
};
