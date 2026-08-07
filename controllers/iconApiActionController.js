/**
 * @fileoverview IconChat REST API — Ações (Direção C) + Import/Sync (ML Integration)
 *
 * 5 endpoints POST para ações que o bot IconChat propõe e o backend ratifica (INV #7).
 * Cada ação é idempotente via icon_action_log dedup (INV #10).
 *
 * C1: cancelOrder        — cancela pedido marketplace
 * C2: cancelBooking      — cancela agendamento de serviço
 * C3: requestRefund      — sempre requires_human (INV #1, #8)
 * C4: openDispute        — abre disputa em pedido
 * C5: rescheduleBooking  — reagenda (cancel + create)
 * C6: createBooking      — cria agendamento via chat (cliente)
 * C9: confirmBooking     — confirma agendamento (prestador)
 * C11: completeBooking   — marca serviço como concluído (prestador)
 * C14: createProduct     — cria produto/serviço via chat (seller/team)
 *
 * B2: importProducts     — importação em lote de produtos ML (sem _wrapAction)
 * B3: syncProduct        — sync/patch parcial por external_id (sem _wrapAction)
 */

'use strict';

const Joi = require('joi');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');
const { resolveByPhone } = require('../utils/iconPhoneResolver');
const bookingService = require('../services/bookingService');
const marketplaceService = require('../services/marketplaceService');
const asaasService = require('../services/asaasService');
const SupportService = require('../services/SupportService');
const propertyStayService = require('../services/propertyStayService');

const CTRL = 'iconApiActionController';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

// ---------------------------------------------------------------------------
// Schemas Joi
// ---------------------------------------------------------------------------

const SCHEMAS = {
  cancelOrder: Joi.object({
    seller_id: Joi.string().required(),
    resource_id: Joi.string().required(),
    customer_phone: Joi.string().required(),
    reason: Joi.string().max(500).allow('', null),
    confidence: Joi.number().min(0).max(1),
  }),
  cancelBooking: Joi.object({
    seller_id: Joi.string().required(),
    resource_id: Joi.string().required(),
    customer_phone: Joi.string().required(),
    reason: Joi.string().max(500).allow('', null),
    confidence: Joi.number().min(0).max(1),
  }),
  requestRefund: Joi.object({
    seller_id: Joi.string().required(),
    resource_id: Joi.string().required(),
    customer_phone: Joi.string().required(),
    reason: Joi.string().max(500).allow('', null),
    amount: Joi.number().positive().allow(null),
    confidence: Joi.number().min(0).max(1),
  }),
  openDispute: Joi.object({
    seller_id: Joi.string().required(),
    resource_id: Joi.string().required(),
    customer_phone: Joi.string().required(),
    reason: Joi.string().max(500).required(),
    confidence: Joi.number().min(0).max(1),
  }),
  rescheduleBooking: Joi.object({
    seller_id: Joi.string().required(),
    resource_id: Joi.string().required(),
    customer_phone: Joi.string().required(),
    new_slot_start: Joi.string().isoDate().required(),
    reason: Joi.string().max(500).allow('', null),
    confidence: Joi.number().min(0).max(1),
  }),
  createBooking: Joi.object({
    seller_id: Joi.string().required(),
    resource_id: Joi.string().required(),         // service_id
    customer_phone: Joi.string().required(),
    slot_start: Joi.string().isoDate().required(),
    notes: Joi.string().max(500).allow('', null),
    confidence: Joi.number().min(0).max(1),
  }),
  confirmBooking: Joi.object({
    seller_id: Joi.string().required(),
    resource_id: Joi.string().required(),         // booking_id
    customer_phone: Joi.string().allow('', null),  // provider action — phone optional
    provider_notes: Joi.string().max(500).allow('', null),
    confidence: Joi.number().min(0).max(1),
  }),
  completeBooking: Joi.object({
    seller_id: Joi.string().required(),
    resource_id: Joi.string().required(),         // booking_id
    customer_phone: Joi.string().allow('', null),  // provider action — phone optional
    confidence: Joi.number().min(0).max(1),
  }),
  requestStay: Joi.object({
    seller_id: Joi.string().required(),
    resource_id: Joi.string().required(),         // property_id
    customer_phone: Joi.string().required(),
    check_in: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
    check_out: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
    guests_count: Joi.number().integer().min(1).max(20).default(1),
    special_requests: Joi.string().max(500).allow('', null),
    confidence: Joi.number().min(0).max(1),
  }),
  cancelStay: Joi.object({
    seller_id: Joi.string().required(),
    resource_id: Joi.string().required(),         // stay_id
    customer_phone: Joi.string().required(),
    reason: Joi.string().max(500).allow('', null),
    confidence: Joi.number().min(0).max(1),
  }),
  blockDates: Joi.object({
    seller_id: Joi.string().required(),
    resource_id: Joi.string().required(),         // property_id
    customer_phone: Joi.string().allow('', null),  // provider action — phone optional
    from: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
    to: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
    reason: Joi.string().max(500).allow('', null),
    confidence: Joi.number().min(0).max(1),
  }),

  // B2: Import em lote de produtos ML
  // Envelope: valida estrutura do batch. Cada produto é validado individualmente no loop.
  importProducts: Joi.object({
    seller_id: Joi.string().required(),
    products: Joi.array().max(50).min(1).items(Joi.object()).required(),
    confidence: Joi.number().min(0).max(1),
  }),

  // B2 per-product: validação individual dentro do loop (erro parcial, não rejeita o batch)
  importProductItem: Joi.object({
    external_id: Joi.string().required(),
    external_account_id: Joi.string().allow(null),
    name: Joi.string().required(),
    description: Joi.string().allow('', null),
    price_brl: Joi.number().positive().required(),
    category: Joi.string().allow('', null),
    product_type: Joi.string().valid('food_item', 'service', 'physical_product', 'property').default('physical_product'),
    stock: Joi.number().integer().min(0).allow(null),
    images: Joi.array().items(Joi.string().uri()).max(10).default([]),
    weight_kg: Joi.number().positive().allow(null),
    dimensions_cm: Joi.object({
      length: Joi.number().positive(),
      width: Joi.number().positive(),
      height: Joi.number().positive(),
    }).allow(null),
    sku: Joi.string().allow('', null),
  }),

  // B3: Sync/patch parcial por external_id
  syncProduct: Joi.object({
    seller_id: Joi.string().required(),
    price_brl: Joi.number().positive(),
    stock: Joi.number().integer().min(0).allow(null),
    active: Joi.boolean(),
    name: Joi.string(),
    description: Joi.string().allow('', null),
    images: Joi.array().items(Joi.string().uri()).max(10),
    category: Joi.string().allow('', null),
    weight_kg: Joi.number().positive().allow(null),
    dimensions_cm: Joi.object({
      length: Joi.number().positive(),
      width: Joi.number().positive(),
      height: Joi.number().positive(),
    }).allow(null),
    sku: Joi.string().allow('', null),
    confidence: Joi.number().min(0).max(1),
  }).required(),
};

// ---------------------------------------------------------------------------
// _wrapAction — padrão comum de dedup, validação e logging (Proposta B)
// ---------------------------------------------------------------------------

/**
 * Wrapper que encapsula validação, dedup outcome-aware e logging para cada ação.
 *
 * Fluxo de outcome:
 *   1. Dedup check: só `success` bloqueia repetição; `pending` protege contra
 *      retry durante janela de execução (ETIMEDOUT + retry do bot).
 *   2. INSERT com outcome='pending' antes de executar (trava contra retry).
 *   3. Handler executa.
 *   4. UPDATE outcome → 'success' (approved/requires_human) ou 'denied'.
 *   5. `denied` permite retry futuro na mesma conversa — o fix do design defect.
 *
 * @param {string} actionType — ex: 'cancel_order'
 * @param {Joi.ObjectSchema} schema
 * @param {Function} handler — async (req, res, { body, conversationId, resolved }) => response object
 */
function _wrapAction(actionType, schema, handler) {
  return async (req, res) => {
    const fn = `${CTRL}.${actionType}`;
    let logId = null;
    try {
      // 1) Conversation ID
      const conversationId = req.headers['x-elos-icon-conversation-id'];
      if (!conversationId) {
        return res.status(400).json({ error: 'missing_conversation_id' });
      }

      // 2) Joi validation
      const { error: valErr, value: body } = schema.validate(req.body, { stripUnknown: true });
      if (valErr) {
        return res.status(400).json({ error: 'validation_error', details: valErr.message });
      }

      // 3) Seller scoping (INV #5)
      if (body.seller_id !== req.iconSellerId) {
        return res.status(403).json({ error: 'seller_mismatch' });
      }

      const resourceId = body.resource_id || null;

      // 4) Dedup check — só 'success' bloqueia; 'pending' protege contra retry em voo
      const { data: existing } = await sb()
        .from('icon_action_log')
        .select('outcome, response_body')
        .eq('conversation_id', conversationId)
        .eq('action_type', actionType)
        .eq('resource_id', resourceId)
        .in('outcome', ['success', 'pending'])
        .maybeSingle();

      if (existing) {
        if (existing.outcome === 'success') {
          logger.info(`[${fn}] Dedup hit (success)`, { conversationId, actionType, resourceId });
          return res.json(existing.response_body);
        }
        // pending — request concorrente em voo, protege contra duplo cancelPayment()
        logger.info(`[${fn}] Dedup hit (pending)`, { conversationId, actionType, resourceId });
        return res.status(409).json({ error: 'action_in_progress' });
      }

      // 5) Inserir entry com outcome='pending' (trava contra retry)
      const { data: inserted, error: insertErr } = await sb()
        .from('icon_action_log')
        .insert({
          conversation_id: conversationId,
          action_type: actionType,
          seller_id: body.seller_id,
          customer_phone: body.customer_phone || null,
          resource_id: resourceId,
          outcome: 'pending',
          status: 'pending',
          request_body: body,
        })
        .select('id')
        .single();

      if (insertErr) throw insertErr;
      logId = inserted.id;

      // 6) Resolve phone
      const resolved = await resolveByPhone(body.customer_phone || '');

      // 7) Execute specific handler
      const result = await handler(req, res, { body, conversationId, resolved });

      // handler may have already sent response (e.g. early return on error)
      if (res.headersSent) {
        await sb().from('icon_action_log')
          .update({ outcome: 'denied', status: 'handler_early_return' })
          .eq('id', logId);
        return;
      }

      // 8) Determinar outcome pelo status do resultado
      //    approved / requires_human → success (ação tomada, não repetir)
      //    denied → denied (pode retried na mesma conversa)
      const outcome = (result.status === 'approved' || result.status === 'requires_human')
        ? 'success'
        : 'denied';

      // 9) Atualizar entry com resultado final
      await sb().from('icon_action_log')
        .update({
          outcome,
          status: result.status,
          reason: result.reason || null,
          response_body: result,
        })
        .eq('id', logId);

      // 10) Return
      return res.json(result);
    } catch (err) {
      // Se já inseriu pending, marcar como denied para liberar retries
      if (logId) {
        try {
          await sb().from('icon_action_log')
            .update({
              outcome: 'denied',
              status: 'error',
              reason: err.message,
              response_body: { error: 'internal_error' },
            })
            .eq('id', logId);
        } catch (logErr) {
          logger.error(`[${fn}] Failed to update action log on error`, { logId, error: logErr.message });
        }
      }
      logger.error(`[${fn}] Unhandled error`, { error: err.message, stack: err.stack });
      return res.status(500).json({ error: 'internal_error' });
    }
  };
}

// ---------------------------------------------------------------------------
// C1: POST /api/icon/actions/cancel-order
// ---------------------------------------------------------------------------

exports.cancelOrder = _wrapAction('cancel_order', SCHEMAS.cancelOrder, async (req, res, { body, resolved }) => {
  const { resource_id: orderId, seller_id: sellerId, reason } = body;

  // Buscar pedido
  const { data: order, error } = await sb()
    .from('marketplace_orders')
    .select('id, status, buyer_id, guest_buyer_id, seller_id, payment_id, payment_method')
    .eq('id', orderId)
    .eq('seller_id', sellerId)
    .maybeSingle();

  if (error) throw error;
  if (!order) {
    return { status: 'denied', reason: 'order_not_found', display_to_customer: 'Pedido não encontrado.' };
  }

  // Verificar buyer match
  const buyerMatch = (resolved.userId && order.buyer_id === resolved.userId)
    || (resolved.guestId && order.guest_buyer_id === resolved.guestId);
  if (!buyerMatch) {
    return { status: 'denied', reason: 'buyer_mismatch', display_to_customer: 'Você não é o comprador deste pedido.' };
  }

  // Status válido (offline_confirmed = pagamento manual, sem charge Asaas)
  if (!['paid', 'in_progress', 'offline_confirmed'].includes(order.status)) {
    return {
      status: 'denied',
      reason: 'invalid_status',
      display_to_customer: `Pedido com status "${order.status}" não pode ser cancelado.`,
    };
  }

  // Verificar se delivery em trânsito
  const { data: delivery } = await sb()
    .from('delivery_requests')
    .select('id, status')
    .eq('order_id', orderId)
    .in('status', ['picked_up', 'in_transit_to_customer', 'in_transit_to_seller'])
    .maybeSingle();

  if (delivery) {
    return {
      status: 'denied',
      reason: 'in_transit',
      display_to_customer: 'Pedido já está em trânsito e não pode ser cancelado.',
    };
  }

  // Aprovar cancelamento
  const { error: updateErr } = await sb()
    .from('marketplace_orders')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', orderId);

  if (updateErr) throw updateErr;

  // Cancelar pagamento Asaas se existir (offline_confirmed não tem charge)
  if (order.payment_id && order.status !== 'offline_confirmed') {
    try {
      await asaasService.cancelPayment(order.payment_id);
    } catch (payErr) {
      logger.warn(`[${CTRL}] cancelOrder: Asaas cancel failed`, { orderId, paymentId: order.payment_id, error: payErr.message });
    }
  }

  // display_to_customer diferenciado: offline_confirmed não tem estorno automático
  let displayMsg = 'Seu pedido foi cancelado com sucesso.';
  if (order.status === 'offline_confirmed') {
    const { data: sellerProfile } = await sb()
      .from('seller_profiles')
      .select('business_name')
      .eq('id', sellerId)
      .maybeSingle();
    const sellerName = sellerProfile?.business_name || 'a loja';
    displayMsg = `Pedido cancelado. Como o pagamento foi feito diretamente com a loja, combine o reembolso com a ${sellerName}.`;
  }

  return {
    status: 'approved',
    reason: reason || 'Cancelamento solicitado via IconChat',
    order_id: orderId,
    display_to_customer: displayMsg,
  };
});

// ---------------------------------------------------------------------------
// C2: POST /api/icon/actions/cancel-booking
// ---------------------------------------------------------------------------

exports.cancelBooking = _wrapAction('cancel_booking', SCHEMAS.cancelBooking, async (req, res, { body, resolved }) => {
  const { resource_id: bookingId, reason } = body;

  if (!resolved.userId) {
    return {
      status: 'denied',
      reason: 'customer_not_found',
      display_to_customer: 'Não foi possível identificar o cliente. Agendamentos requerem conta cadastrada.',
    };
  }

  try {
    const result = await bookingService.cancelBooking(resolved.userId, bookingId, 'client', reason || 'Cancelamento via IconChat');
    const fee = result.cancellationFee || 0;

    return {
      status: 'approved',
      reason: fee > 0
        ? `Cancelamento aprovado. Taxa de cancelamento: R$ ${fee.toFixed(2)}`
        : 'Cancelamento aprovado sem taxa.',
      booking_id: bookingId,
      cancellation_fee: fee,
      display_to_customer: fee > 0
        ? `Agendamento cancelado. Uma taxa de R$ ${fee.toFixed(2)} será cobrada conforme a política de cancelamento.`
        : 'Agendamento cancelado com sucesso.',
    };
  } catch (err) {
    return {
      status: 'denied',
      reason: err.message,
      display_to_customer: `Não foi possível cancelar: ${err.message}`,
    };
  }
});

// ---------------------------------------------------------------------------
// C3: POST /api/icon/actions/request-refund — SEMPRE requires_human (INV #1, #8)
// ---------------------------------------------------------------------------

exports.requestRefund = _wrapAction('request_refund', SCHEMAS.requestRefund, async (req, res, { body, resolved }) => {
  const { resource_id: orderId, reason, seller_id: sellerId } = body;

  // Criar ticket de suporte (side effect)
  try {
    const supportService = new SupportService();
    await supportService.createTicket({
      userId: resolved.userId || `guest:${resolved.guestId || 'unknown'}`,
      category: 'financial',
      module: 'marketplace',
      issueType: 'refund_request',
      title: `Solicitação de reembolso — Pedido ${orderId}`,
      description: `Motivo: ${reason || 'Não informado'}. Seller: ${sellerId}. Via IconChat.`,
    });
  } catch (ticketErr) {
    logger.warn(`[${CTRL}] requestRefund: ticket creation failed`, { error: ticketErr.message });
  }

  return {
    status: 'requires_human',
    reason: 'Reembolsos requerem análise humana.',
    handoff_target: 'seller',
    order_id: orderId,
    display_to_customer: 'Sua solicitação de reembolso foi registrada. O vendedor será notificado para análise.',
  };
});

// ---------------------------------------------------------------------------
// C4: POST /api/icon/actions/open-dispute
// ---------------------------------------------------------------------------

exports.openDispute = _wrapAction('open_dispute', SCHEMAS.openDispute, async (req, res, { body, resolved }) => {
  const { resource_id: orderId, reason } = body;

  if (!resolved.userId) {
    return {
      status: 'denied',
      reason: 'customer_not_found',
      display_to_customer: 'Não foi possível identificar o cliente. Disputas requerem conta cadastrada.',
    };
  }

  try {
    const updated = await marketplaceService.createOrderDispute(resolved.userId, orderId, reason);
    return {
      status: 'approved',
      reason: 'Disputa aberta com sucesso.',
      order_id: orderId,
      dispute_reference: updated.id,
      display_to_customer: 'A disputa foi aberta. O vendedor será notificado e terá prazo para responder.',
    };
  } catch (err) {
    return {
      status: 'denied',
      reason: err.message,
      display_to_customer: `Não foi possível abrir a disputa: ${err.message}`,
    };
  }
});

// ---------------------------------------------------------------------------
// C5: POST /api/icon/actions/reschedule-booking
// ---------------------------------------------------------------------------

exports.rescheduleBooking = _wrapAction('reschedule_booking', SCHEMAS.rescheduleBooking, async (req, res, { body, resolved }) => {
  const { resource_id: bookingId, new_slot_start: newSlotStart, reason } = body;

  if (!resolved.userId) {
    return {
      status: 'denied',
      reason: 'customer_not_found',
      display_to_customer: 'Não foi possível identificar o cliente. Agendamentos requerem conta cadastrada.',
    };
  }

  // Buscar booking atual
  let booking;
  try {
    booking = await bookingService.getBookingById(resolved.userId, bookingId);
  } catch {
    return {
      status: 'denied',
      reason: 'booking_not_found',
      display_to_customer: 'Agendamento não encontrado.',
    };
  }

  // Verificar seller match
  const { data: product } = await sb()
    .from('marketplace_products')
    .select('id, seller_id')
    .eq('id', booking.service_id)
    .maybeSingle();

  if (!product || product.seller_id !== req.iconSellerId) {
    return {
      status: 'denied',
      reason: 'seller_mismatch',
      display_to_customer: 'Este agendamento não pertence a este negócio.',
    };
  }

  // Verificar disponibilidade do novo slot
  const newDate = newSlotStart.split('T')[0]; // YYYY-MM-DD
  let availableSlots;
  try {
    availableSlots = await bookingService.getAvailableSlots(booking.service_id, newDate);
  } catch (err) {
    logger.warn(`[${CTRL}] rescheduleBooking: getAvailableSlots failed`, { error: err.message });
    availableSlots = [];
  }

  const slotAvailable = availableSlots.some(s => s.slot_start === newSlotStart);

  if (!slotAvailable) {
    // Sugestão de slots disponíveis
    const suggestions = availableSlots.slice(0, 5).map(s => s.slot_start);
    return {
      status: 'denied',
      reason: 'slot_unavailable',
      available_slots: suggestions,
      display_to_customer: suggestions.length > 0
        ? `O horário solicitado não está disponível. Horários disponíveis: ${suggestions.join(', ')}`
        : 'Não há horários disponíveis nesta data.',
    };
  }

  // Step 1: Cancelar booking atual
  try {
    await bookingService.cancelBooking(resolved.userId, bookingId, 'client', reason || 'Reagendamento via IconChat');
  } catch (err) {
    return {
      status: 'denied',
      reason: `cancel_failed: ${err.message}`,
      display_to_customer: `Não foi possível cancelar o agendamento atual: ${err.message}`,
    };
  }

  // Step 2: Criar novo booking
  try {
    const newBooking = await bookingService.createBooking(resolved.userId, {
      service_id: booking.service_id,
      slot_start: newSlotStart,
      notes: `Reagendado via IconChat. Original: ${bookingId}. ${reason || ''}`.trim(),
    });

    return {
      status: 'approved',
      reason: 'Reagendamento realizado com sucesso.',
      old_booking_id: bookingId,
      new_booking_id: newBooking.id,
      new_slot_start: newSlotStart,
      display_to_customer: `Agendamento reagendado com sucesso para ${newSlotStart}.`,
    };
  } catch (createErr) {
    // Falha parcial — cancel ok mas create falhou → requires_human
    logger.error(`[${CTRL}] rescheduleBooking: createBooking failed after cancel`, {
      bookingId, newSlotStart, error: createErr.message,
    });

    // Criar ticket de suporte
    try {
      const supportService = new SupportService();
      await supportService.createTicket({
        userId: resolved.userId,
        category: 'scheduling',
        module: 'marketplace',
        issueType: 'reschedule_failure',
        title: `Reagendamento parcial — Booking ${bookingId}`,
        description: `Cancelamento OK mas novo booking falhou. Slot: ${newSlotStart}. Erro: ${createErr.message}`,
      });
    } catch { /* best-effort */ }

    return {
      status: 'requires_human',
      reason: 'Cancelamento realizado mas novo agendamento falhou. Suporte notificado.',
      handoff_target: 'seller',
      old_booking_id: bookingId,
      display_to_customer: 'O agendamento anterior foi cancelado, mas houve um erro ao criar o novo. Nossa equipe foi notificada e entrará em contato.',
    };
  }
});

// ---------------------------------------------------------------------------
// Helper: resolve provider userId from seller_profiles (for C9, C11)
// ---------------------------------------------------------------------------

async function _getProviderUserId(sellerId) {
  const { data, error } = await sb()
    .from('seller_profiles')
    .select('user_id')
    .eq('id', sellerId)
    .maybeSingle();
  if (error) throw error;
  return data?.user_id || null;
}

// ---------------------------------------------------------------------------
// C6: POST /api/icon/actions/create-booking
// ---------------------------------------------------------------------------

exports.createBooking = _wrapAction('create_booking', SCHEMAS.createBooking, async (req, res, { body, resolved }) => {
  const { resource_id: serviceId, slot_start: slotStart, notes } = body;

  if (!resolved.userId) {
    return {
      status: 'denied',
      reason: 'customer_not_found',
      display_to_customer: 'Não foi possível identificar o cliente. Agendamentos requerem conta cadastrada.',
    };
  }

  // Verificar que o serviço pertence ao seller e é agendável
  const { data: service } = await sb()
    .from('marketplace_products')
    .select('id, name, seller_id, duration_minutes')
    .eq('id', serviceId)
    .eq('seller_id', req.iconSellerId)
    .eq('product_type', 'service')
    .not('duration_minutes', 'is', null)
    .eq('active', true)
    .maybeSingle();

  if (!service) {
    return {
      status: 'denied',
      reason: 'service_not_found',
      display_to_customer: 'Serviço não encontrado ou indisponível.',
    };
  }

  // Verificar disponibilidade do slot
  const date = slotStart.split('T')[0];
  let availableSlots;
  try {
    availableSlots = await bookingService.getAvailableSlots(serviceId, date);
  } catch (err) {
    logger.warn(`[${CTRL}] createBooking: getAvailableSlots failed`, { error: err.message });
    availableSlots = [];
  }

  const slotAvailable = availableSlots.some(s => s.slot_start === slotStart);

  if (!slotAvailable) {
    const suggestions = availableSlots.slice(0, 5).map(s => s.slot_start);
    return {
      status: 'denied',
      reason: 'slot_unavailable',
      available_slots: suggestions,
      display_to_customer: suggestions.length > 0
        ? `O horário solicitado não está disponível. Horários disponíveis: ${suggestions.join(', ')}`
        : 'Não há horários disponíveis nesta data.',
    };
  }

  try {
    const booking = await bookingService.createBooking(resolved.userId, {
      service_id: serviceId,
      slot_start: slotStart,
      notes: notes || 'Agendamento via IconChat',
    });

    return {
      status: 'approved',
      reason: 'Agendamento criado com sucesso.',
      booking_id: booking.id,
      service_name: service.name,
      slot_start: slotStart,
      display_to_customer: `Agendamento criado para ${service.name} em ${slotStart}. Aguarde a confirmação do prestador.`,
    };
  } catch (err) {
    return {
      status: 'denied',
      reason: err.message,
      display_to_customer: `Não foi possível criar o agendamento: ${err.message}`,
    };
  }
});

// ---------------------------------------------------------------------------
// C9: POST /api/icon/actions/confirm-booking
// ---------------------------------------------------------------------------

exports.confirmBooking = _wrapAction('confirm_booking', SCHEMAS.confirmBooking, async (req, res, { body }) => {
  const { resource_id: bookingId, provider_notes: providerNotes } = body;

  const providerUserId = await _getProviderUserId(req.iconSellerId);
  if (!providerUserId) {
    return {
      status: 'denied',
      reason: 'provider_not_found',
      display_to_customer: 'Prestador não encontrado.',
    };
  }

  try {
    await bookingService.confirmBooking(providerUserId, bookingId, providerNotes || '');

    return {
      status: 'approved',
      reason: 'Agendamento confirmado com sucesso.',
      booking_id: bookingId,
      display_to_customer: 'Agendamento confirmado pelo prestador.',
    };
  } catch (err) {
    return {
      status: 'denied',
      reason: err.message,
      display_to_customer: `Não foi possível confirmar: ${err.message}`,
    };
  }
});

// ---------------------------------------------------------------------------
// C11: POST /api/icon/actions/complete-booking
// ---------------------------------------------------------------------------

exports.completeBooking = _wrapAction('complete_booking', SCHEMAS.completeBooking, async (req, res, { body }) => {
  const { resource_id: bookingId } = body;

  const providerUserId = await _getProviderUserId(req.iconSellerId);
  if (!providerUserId) {
    return {
      status: 'denied',
      reason: 'provider_not_found',
      display_to_customer: 'Prestador não encontrado.',
    };
  }

  try {
    await bookingService.completeBooking(providerUserId, bookingId);

    return {
      status: 'approved',
      reason: 'Serviço marcado como concluído.',
      booking_id: bookingId,
      display_to_customer: 'O serviço foi marcado como concluído.',
    };
  } catch (err) {
    return {
      status: 'denied',
      reason: err.message,
      display_to_customer: `Não foi possível concluir: ${err.message}`,
    };
  }
});

// ---------------------------------------------------------------------------
// C7: POST /api/icon/actions/request-stay
// ---------------------------------------------------------------------------

exports.requestStay = _wrapAction('request_stay', SCHEMAS.requestStay, async (req, res, { body, resolved }) => {
  const { resource_id: propertyId, check_in: checkIn, check_out: checkOut, guests_count: guestsCount, special_requests: specialRequests } = body;

  if (!resolved.userId) {
    return {
      status: 'denied',
      reason: 'customer_not_found',
      display_to_customer: 'Não foi possível identificar o cliente. Estadias requerem conta cadastrada.',
    };
  }

  // Verificar que o imóvel pertence ao seller
  const { data: property } = await sb()
    .from('marketplace_products')
    .select('id, name, seller_id, price_brl, property_details')
    .eq('id', propertyId)
    .eq('seller_id', req.iconSellerId)
    .eq('active', true)
    .maybeSingle();

  if (!property) {
    return {
      status: 'denied',
      reason: 'property_not_found',
      display_to_customer: 'Imóvel não encontrado ou indisponível.',
    };
  }

  // Validar datas
  const checkInDate = new Date(checkIn);
  const checkOutDate = new Date(checkOut);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (checkInDate < today) {
    return { status: 'denied', reason: 'past_date', display_to_customer: 'A data de check-in não pode ser no passado.' };
  }
  if (checkOutDate <= checkInDate) {
    return { status: 'denied', reason: 'invalid_dates', display_to_customer: 'A data de check-out deve ser posterior ao check-in.' };
  }

  const nights = Math.round((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
  const minNights = property.property_details?.min_nights || 1;
  if (nights < minNights) {
    return {
      status: 'denied',
      reason: 'min_nights',
      display_to_customer: `Estadia mínima de ${minNights} noite(s). Você solicitou ${nights}.`,
    };
  }

  const maxGuests = property.property_details?.max_guests;
  if (maxGuests && guestsCount > maxGuests) {
    return {
      status: 'denied',
      reason: 'max_guests',
      display_to_customer: `Capacidade máxima: ${maxGuests} hóspede(s). Você solicitou ${guestsCount}.`,
    };
  }

  // Verificar disponibilidade
  let busyDates;
  try {
    busyDates = await propertyStayService.getAvailability(propertyId, checkIn, checkOut);
  } catch (err) {
    logger.warn(`[${CTRL}] requestStay: getAvailability failed`, { error: err.message });
    busyDates = [];
  }

  if (busyDates.length > 0) {
    return {
      status: 'denied',
      reason: 'dates_unavailable',
      busy_dates: busyDates.map(d => d.busy_date),
      display_to_customer: `Algumas datas não estão disponíveis: ${busyDates.map(d => d.busy_date).join(', ')}.`,
    };
  }

  try {
    const { stay } = await propertyStayService.createStay(resolved.userId, {
      propertyId,
      checkIn,
      checkOut,
      guestsCount,
      specialRequests: specialRequests || null,
    });

    const totalPrice = property.price_brl ? Number(property.price_brl) * nights : null;

    return {
      status: 'approved',
      reason: 'Solicitação de estadia criada com sucesso.',
      stay_id: stay.id,
      property_name: property.name,
      check_in: checkIn,
      check_out: checkOut,
      nights,
      total_price: totalPrice,
      display_to_customer: `Estadia solicitada em ${property.name} de ${checkIn} a ${checkOut} (${nights} noite${nights > 1 ? 's' : ''}). Aguarde a confirmação do anfitrião.`,
    };
  } catch (err) {
    return {
      status: 'denied',
      reason: err.message,
      display_to_customer: `Não foi possível criar a solicitação: ${err.message}`,
    };
  }
});

// ---------------------------------------------------------------------------
// C8: POST /api/icon/actions/cancel-stay
// ---------------------------------------------------------------------------

exports.cancelStay = _wrapAction('cancel_stay', SCHEMAS.cancelStay, async (req, res, { body, resolved }) => {
  const { resource_id: stayId, reason } = body;

  if (!resolved.userId) {
    return {
      status: 'denied',
      reason: 'customer_not_found',
      display_to_customer: 'Não foi possível identificar o cliente. Estadias requerem conta cadastrada.',
    };
  }

  try {
    const updated = await propertyStayService.cancelStay(resolved.userId, stayId, reason || 'Cancelamento via IconChat');

    return {
      status: 'approved',
      reason: 'Estadia cancelada com sucesso.',
      stay_id: stayId,
      display_to_customer: 'Sua estadia foi cancelada com sucesso.',
    };
  } catch (err) {
    return {
      status: 'denied',
      reason: err.message,
      display_to_customer: `Não foi possível cancelar: ${err.message}`,
    };
  }
});

// ---------------------------------------------------------------------------
// C10: POST /api/icon/actions/block-dates
// ---------------------------------------------------------------------------

exports.blockDates = _wrapAction('block_dates', SCHEMAS.blockDates, async (req, res, { body }) => {
  const { resource_id: propertyId, from, to, reason } = body;

  const providerUserId = await _getProviderUserId(req.iconSellerId);
  if (!providerUserId) {
    return {
      status: 'denied',
      reason: 'provider_not_found',
      display_to_customer: 'Prestador não encontrado.',
    };
  }

  // Validar datas
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (fromDate < today) {
    return { status: 'denied', reason: 'past_date', display_to_customer: 'A data inicial não pode ser no passado.' };
  }
  if (toDate < fromDate) {
    return { status: 'denied', reason: 'invalid_dates', display_to_customer: 'A data final deve ser igual ou posterior à inicial.' };
  }

  try {
    await propertyStayService.blockDates(providerUserId, propertyId, {
      from,
      to,
      reason: reason || 'outro',
    });

    const days = Math.round((toDate - fromDate) / (1000 * 60 * 60 * 24)) + 1;

    return {
      status: 'approved',
      reason: 'Datas bloqueadas com sucesso.',
      property_id: propertyId,
      from,
      to,
      days_blocked: days,
      display_to_customer: `${days} dia(s) bloqueado(s) de ${from} a ${to}.`,
    };
  } catch (err) {
    return {
      status: 'denied',
      reason: err.message,
      display_to_customer: `Não foi possível bloquear as datas: ${err.message}`,
    };
  }
});

// ---------------------------------------------------------------------------
// B2: POST /api/icon/sellers/:sellerId/products/import
// Importação em lote de produtos ML — handler dedicado (sem _wrapAction)
// ---------------------------------------------------------------------------

exports.importProducts = async (req, res) => {
  const fn = `${CTRL}.importProducts`;
  try {
    // 1) Conversation ID
    const conversationId = req.headers['x-elos-icon-conversation-id'];
    if (!conversationId) {
      return res.status(400).json({ error: 'missing_conversation_id' });
    }

    // 2) Joi validation
    const { error: valErr, value: body } = SCHEMAS.importProducts.validate(req.body, { stripUnknown: true });
    if (valErr) {
      return res.status(400).json({ error: 'validation_error', details: valErr.message });
    }

    // 3) Seller scoping (INV #5) — body.seller_id must match URL param AND HMAC seller
    const sellerId = req.params.sellerId;
    if (body.seller_id !== req.iconSellerId || body.seller_id !== sellerId) {
      return res.status(403).json({ error: 'seller_mismatch' });
    }

    // 4) Loop por cada produto — commit individual, um erro não derruba os outros
    let created = 0;
    let updated = 0;
    const errors = [];

    for (const rawProduct of body.products) {
      // Validação per-product (erro parcial — não rejeita o batch inteiro)
      const { error: itemErr, value: product } = SCHEMAS.importProductItem.validate(rawProduct, { stripUnknown: true });
      if (itemErr) {
        errors.push({ external_id: rawProduct.external_id || 'unknown', error: itemErr.message });
        continue;
      }

      try {
        const { data, error } = await sb().rpc('upsert_external_product', {
          p_seller_id: sellerId,
          p_source: 'ml',
          p_external_id: product.external_id,
          p_external_account_id: product.external_account_id || null,
          p_name: product.name,
          p_description: product.description || null,
          p_price_brl: product.price_brl,
          p_category: product.category || null,
          p_product_type: product.product_type || 'physical_product',
          p_stock: product.stock ?? null,
          p_images: product.images || [],
          p_weight_kg: product.weight_kg || null,
          p_dimensions_cm: product.dimensions_cm || null,
          p_sku: product.sku || null,
        }).single();

        if (error) throw error;

        if (data.was_inserted) {
          created++;
        } else {
          updated++;
        }
      } catch (prodErr) {
        errors.push({ external_id: product.external_id, error: prodErr.message });
      }
    }

    const result = {
      status: 'completed',
      created,
      updated,
      errors,
      total: body.products.length,
    };

    logger.info(`[${fn}] Import completed`, {
      sellerId,
      conversationId,
      created,
      updated,
      errorCount: errors.length,
      total: body.products.length,
    });

    return res.json(result);
  } catch (err) {
    logger.error(`[${fn}] Unhandled error`, { error: err.message, stack: err.stack });
    return res.status(500).json({ error: 'internal_error' });
  }
};

// ---------------------------------------------------------------------------
// B3: PATCH /api/icon/sellers/:sellerId/products/by-external-id/:externalId
// Sync/patch parcial por external_id — handler dedicado (sem _wrapAction)
// Naturalmente idempotente: atualizar para o mesmo valor não causa dano.
// ---------------------------------------------------------------------------

exports.syncProduct = async (req, res) => {
  const fn = `${CTRL}.syncProduct`;
  try {
    // 1) Conversation ID
    const conversationId = req.headers['x-elos-icon-conversation-id'];
    if (!conversationId) {
      return res.status(400).json({ error: 'missing_conversation_id' });
    }

    // 2) Joi validation
    const { error: valErr, value: body } = SCHEMAS.syncProduct.validate(req.body, { stripUnknown: true });
    if (valErr) {
      return res.status(400).json({ error: 'validation_error', details: valErr.message });
    }

    // 3) Seller scoping (INV #5)
    const sellerId = req.params.sellerId;
    if (body.seller_id !== req.iconSellerId || body.seller_id !== sellerId) {
      return res.status(403).json({ error: 'seller_mismatch' });
    }

    const externalId = req.params.externalId;

    // 4) Buscar produto por external_id
    const { data: product, error: findErr } = await sb()
      .from('marketplace_products')
      .select('id, external_id')
      .eq('seller_id', sellerId)
      .eq('external_id', externalId)
      .maybeSingle();

    if (findErr) throw findErr;

    if (!product) {
      return res.json({ status: 'denied', reason: 'product_not_found' });
    }

    // 5) Montar objeto de update apenas com campos presentes no body
    const updateFields = {};
    const allowed = ['price_brl', 'stock', 'active', 'name', 'description', 'images', 'category', 'weight_kg', 'dimensions_cm', 'sku'];
    for (const field of allowed) {
      if (body[field] !== undefined) updateFields[field] = body[field];
    }

    if (Object.keys(updateFields).length === 0) {
      return res.json({ status: 'denied', reason: 'no_fields_to_update' });
    }

    updateFields.updated_at = new Date().toISOString();

    // 6) Update
    const { error: updateErr } = await sb()
      .from('marketplace_products')
      .update(updateFields)
      .eq('id', product.id);

    if (updateErr) throw updateErr;

    const result = {
      status: 'approved',
      product_id: product.id,
      external_id: externalId,
      fields_updated: Object.keys(updateFields).filter(k => k !== 'updated_at'),
    };

    logger.info(`[${fn}] Sync completed`, {
      sellerId,
      conversationId,
      externalId,
      productId: product.id,
      fieldsUpdated: result.fields_updated,
    });

    return res.json(result);
  } catch (err) {
    logger.error(`[${fn}] Unhandled error`, { error: err.message, stack: err.stack });
    return res.status(500).json({ error: 'internal_error' });
  }
};

// ---------------------------------------------------------------------------
// C13: POST /api/icon/actions/create-agenda-task
// Creates a seller_internal task via IconChat conversation
// ---------------------------------------------------------------------------

exports.createAgendaTask = async (req, res) => {
  const fn = `${CTRL}.createAgendaTask`;
  try {
    const conversationId = req.headers['x-elos-icon-conversation-id'];
    if (!conversationId) {
      return res.status(400).json({ error: 'missing_conversation_id' });
    }

    const schema = Joi.object({
      seller_id: Joi.string().required(),
      title: Joi.string().required().max(200),
      description: Joi.string().allow('', null).max(2000),
      scheduled_at: Joi.date().iso().required(),
      scheduled_end: Joi.date().iso().allow(null),
      duration_minutes: Joi.number().integer().min(1).max(480).allow(null),
      assignee_id: Joi.string().allow(null),
      priority: Joi.string().valid('low', 'medium', 'high', 'urgent').default('medium'),
    });

    const { error: valErr, value: body } = schema.validate(req.body, { stripUnknown: true });
    if (valErr) {
      return res.status(400).json({ error: 'validation_error', details: valErr.message });
    }

    if (body.seller_id !== req.iconSellerId) {
      return res.status(403).json({ error: 'seller_mismatch' });
    }

    const agendaService = require('../services/agendaService');

    // Use seller owner as created_by
    const { data: owner } = await sb()
      .from('seller_team_members')
      .select('user_id')
      .eq('seller_id', body.seller_id)
      .eq('role', 'owner')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    const actorId = owner?.user_id || body.seller_id;

    const task = await agendaService.createSellerInternalTask(body.seller_id, body, actorId, req);

    logger.info(`[${fn}] Agenda task created via IconChat`, {
      taskId: task.id,
      sellerId: body.seller_id,
      conversationId,
    });

    return res.status(201).json({
      status: 'approved',
      task_id: task.id,
      title: task.title,
      scheduled_at: task.scheduled_at,
    });
  } catch (err) {
    logger.error(`[${fn}] Unhandled error`, { error: err.message, stack: err.stack });
    return res.status(500).json({ error: 'internal_error' });
  }
};

// ---------------------------------------------------------------------------
// C14: createProduct — Criar produto/serviço via IconChat (seller/team)
// ---------------------------------------------------------------------------

exports.createProduct = async (req, res) => {
  const fn = `${CTRL}.createProduct`;
  try {
    const conversationId = req.headers['x-elos-icon-conversation-id'];
    if (!conversationId) {
      return res.status(400).json({ error: 'missing_conversation_id' });
    }

    const schema = Joi.object({
      seller_id: Joi.string().required(),
      actor_phone: Joi.string().required(),
      name: Joi.string().required().max(200),
      price_brl: Joi.number().positive().required(),
      description: Joi.string().allow('', null).max(2000),
      stock: Joi.number().integer().min(0).allow(null),
      duration_minutes: Joi.number().valid(15, 30, 45, 60, 90, 120, 180, 240, 480).allow(null),
      service_mode: Joi.string().valid('individual', 'group').allow(null),
      cancellation_policy: Joi.string().allow('', null),
      weight_kg: Joi.number().positive().allow(null),
      dimensions_cm: Joi.object({
        length: Joi.number().positive(),
        width: Joi.number().positive(),
        height: Joi.number().positive(),
      }).allow(null),
      sku: Joi.string().allow('', null),
      listing_type: Joi.string().valid('venda', 'aluguel_fixo', 'temporada').allow(null),
      property_details: Joi.object().allow(null),
      property_status: Joi.string().valid('disponivel', 'reservado', 'vendido', 'alugado').allow(null),
      prep_time_min: Joi.number().integer().positive().allow(null),
      serves: Joi.number().integer().positive().allow(null),
      allergens: Joi.array().items(Joi.string()).allow(null),
      confidence: Joi.number().min(0).max(1),
    });

    const { error: valErr, value: body } = schema.validate(req.body, { stripUnknown: true });
    if (valErr) {
      return res.status(400).json({ error: 'validation_error', details: valErr.message });
    }

    // Seller HMAC mismatch guard
    if (body.seller_id !== req.iconSellerId) {
      return res.status(403).json({ error: 'seller_mismatch' });
    }

    // Resolve actor identity by phone
    const { userId: actorUserId } = await resolveByPhone(body.actor_phone);
    if (!actorUserId) {
      return res.status(403).json({ error: 'actor_not_found' });
    }

    // Verify permission: owner or team member with can_manage_catalog
    const { data: seller } = await sb()
      .from('seller_profiles')
      .select('id, user_id, status, category')
      .eq('id', body.seller_id)
      .single();

    if (!seller) {
      return res.status(404).json({ error: 'seller_not_found' });
    }

    if (seller.status !== 'active') {
      return res.status(403).json({ error: 'seller_not_active' });
    }

    let hasPermission = seller.user_id === actorUserId;
    if (!hasPermission) {
      const { data: member } = await sb()
        .from('seller_team_members')
        .select('permissions')
        .eq('seller_id', body.seller_id)
        .eq('user_id', actorUserId)
        .eq('status', 'active')
        .maybeSingle();

      hasPermission = member?.permissions?.can_manage_catalog === true;
    }

    if (!hasPermission) {
      return res.status(403).json({ error: 'no_catalog_permission' });
    }

    // Build product data — category auto-detected from seller profile
    const productData = {
      source: 'iconchat',
      name: body.name,
      price_brl: body.price_brl,
      description: body.description || null,
      images: [],
      stock: body.stock ?? null,
      duration_minutes: body.duration_minutes ?? null,
      service_mode: body.service_mode ?? null,
      cancellation_policy: body.cancellation_policy ?? null,
      weight_kg: body.weight_kg ?? null,
      dimensions_cm: body.dimensions_cm ?? null,
      sku: body.sku ?? null,
      listing_type: body.listing_type ?? null,
      property_details: body.property_details ?? null,
      property_status: body.property_status ?? null,
      prep_time_min: body.prep_time_min ?? null,
      serves: body.serves ?? null,
      allergens: body.allergens ?? null,
    };

    const product = await marketplaceService.createProduct(actorUserId, productData, body.seller_id);

    logger.info(`[${fn}] Product created via IconChat`, {
      productId: product.id,
      sellerId: body.seller_id,
      actorUserId,
      conversationId,
    });

    const priceFmt = Number(product.price_brl).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

    return res.status(201).json({
      status: 'approved',
      product_id: product.id,
      name: product.name,
      price_brl: product.price_brl,
      product_type: product.product_type,
      display_to_customer: `Produto "${product.name}" criado! Preço: R$${priceFmt}.`,
    });
  } catch (err) {
    logger.error(`[${fn}] Unhandled error`, { error: err.message, stack: err.stack });
    return res.status(500).json({ error: 'internal_error' });
  }
};
