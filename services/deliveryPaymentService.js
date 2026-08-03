/**
 * @fileoverview deliveryPaymentService — Processamento real de ajustes de frete
 *
 * Gerencia reembolsos e cobranças extras decorrentes de re-auction de entrega:
 *   - Frete menor: refund parcial ao comprador
 *   - Frete maior: cobrança adicional ao comprador
 *
 * Stripe-aware: para pedidos Stripe, usa stripe.refunds.create() ou novo PI.
 * Non-Stripe (PIX/ElosCoins): registra payment_status='manual_required' e notifica.
 *
 * Segue padrão de bookingPaymentService.js (lazy Stripe, service-role Supabase).
 */

'use strict';

const { logger }            = require('../logger');
const { createClient }      = require('@supabase/supabase-js');
const socketManager          = require('../config/socket/socketManager');
const notificationDispatcher = require('./NotificationDispatcher');

const SERVICE = 'deliveryPaymentService';

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

const asaasService = require('./asaasService');

// ── Service-role Supabase (bypassa RLS) ─────────────────────
function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados.');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Helpers internos ────────────────────────────────────────

async function _updateAdjustmentPayment(adjustmentId, patch) {
  const { error } = await getServiceClient()
    .from('delivery_freight_adjustments')
    .update({ ...patch, payment_processed_at: new Date().toISOString() })
    .eq('id', adjustmentId);

  if (error) {
    throw new Error(`Erro ao atualizar adjustment ${adjustmentId}: ${error.message}`);
  }
}

async function getOrderPaymentInfo(orderId) {
  const { data, error } = await getServiceClient()
    .from('marketplace_orders')
    .select('id, payment_method, payment_id, buyer_id, total_brl')
    .eq('id', orderId)
    .single();

  if (error || !data) {
    throw new Error(`Pedido ${orderId} não encontrado: ${error?.message ?? 'not found'}`);
  }
  return data;
}

// ── Refund ───────────────────────────────────────────────────

/**
 * Processa reembolso de frete (frete novo mais barato que o original).
 * Stripe: stripe.refunds.create(). Outros: manual_required.
 */
async function processFreightRefund(orderId, amountBrl, adjustmentId) {
  const fn = 'processFreightRefund';
  const order = await getOrderPaymentInfo(orderId);

  // Se tem payment_id (Asaas ou legado), tenta refund automático
  if (order.payment_id) {
    return _processRefund(order, amountBrl, adjustmentId);
  }

  return _manualRefund(order, amountBrl, adjustmentId);
}

async function _processRefund(order, amountBrl, adjustmentId) {
  const fn = '_processRefund';

  try {
    const refund = await asaasService.refundPayment(order.payment_id, amountBrl);

    await _updateAdjustmentPayment(adjustmentId, {
      payment_method:       'asaas',
      payment_action:       'refund',
      payment_status:       'completed',
      payment_reference_id: refund.paymentId,
      payment_amount_brl:   amountBrl,
    });

    log(fn, 'Refund Asaas processado', {
      orderId: order.id, paymentId: refund.paymentId, amountBrl,
    });

    _notifyBuyer(order.buyer_id, 'delivery:freight_refund_processed', {
      orderId: order.id, amountBrl, method: 'asaas', paymentId: refund.paymentId,
      message: `Reembolso de R$ ${amountBrl.toFixed(2)} processado automaticamente.`,
    });

    return { ok: true, method: 'asaas', paymentId: refund.paymentId };
  } catch (err) {
    logError(fn, err, { orderId: order.id, adjustmentId });

    await _updateAdjustmentPayment(adjustmentId, {
      payment_method: 'asaas',
      payment_action: 'refund',
      payment_status: 'failed',
      payment_error:  err.message,
    });

    return { ok: false, method: 'asaas', error: err.message };
  }
}

async function _manualRefund(order, amountBrl, adjustmentId) {
  const fn = '_manualRefund';

  await _updateAdjustmentPayment(adjustmentId, {
    payment_method:     order.payment_method || 'unknown',
    payment_action:     'ledger_credit',
    payment_status:     'manual_required',
    payment_amount_brl: amountBrl,
  });

  log(fn, 'Refund manual registrado', { orderId: order.id, amountBrl });

  _notifyBuyer(order.buyer_id, 'delivery:freight_refund', {
    orderId: order.id, amountBrl, requiresManualAction: true,
    message: `Reembolso de R$ ${amountBrl.toFixed(2)} será processado pelo vendedor.`,
  });

  return { ok: true, method: 'manual', requiresManualAction: true };
}

// ── Extra charge ────────────────────────────────────────────

/**
 * Processa cobrança extra de frete (frete novo mais caro).
 * Stripe: cria novo PI com client_secret. Outros: manual_required.
 */
async function processFreightExtraCharge(orderId, requestId, deltaBrl, adjustmentId) {
  const fn = 'processFreightExtraCharge';
  const order = await getOrderPaymentInfo(orderId);

  // Se tem payment_id (Asaas), tenta cobrança extra automática
  if (order.payment_id) {
    return _processExtraCharge(order, requestId, deltaBrl, adjustmentId);
  }

  return _manualExtraCharge(order, requestId, deltaBrl, adjustmentId);
}

async function _processExtraCharge(order, requestId, deltaBrl, adjustmentId) {
  const fn = '_processExtraCharge';

  try {
    // Buscar customer do pagamento original para reusar
    const originalPayment = await asaasService.getPaymentStatus(order.payment_id);

    const charge = await asaasService.createCardCharge({
      customerId: originalPayment.customerId || undefined,
      value: deltaBrl,
      description: `Ajuste de frete ElosCloud - Pedido ${order.id}`,
      externalReference: `freight_extra:${order.id}:${adjustmentId}`,
    });

    await _updateAdjustmentPayment(adjustmentId, {
      payment_method:       'asaas',
      payment_action:       'charge',
      payment_status:       'processing',
      payment_reference_id: charge.paymentId,
      payment_amount_brl:   deltaBrl,
    });

    log(fn, 'Extra charge Asaas criado', {
      orderId: order.id, paymentId: charge.paymentId, deltaBrl,
    });

    // Notifica buyer via socket (sem clientSecret — Asaas processa server-side)
    socketManager.emitToUser(order.buyer_id, 'delivery:freight_extra_charge_required', {
      orderId: order.id,
      requestId,
      deltaBrl,
      paymentId: charge.paymentId,
      message: `Cobrança adicional de R$ ${deltaBrl.toFixed(2)} referente ao ajuste de frete.`,
    });

    return { ok: true, method: 'asaas', paymentId: charge.paymentId };
  } catch (err) {
    logError(fn, err, { orderId: order.id, adjustmentId });

    await _updateAdjustmentPayment(adjustmentId, {
      payment_method: 'asaas',
      payment_action: 'charge',
      payment_status: 'failed',
      payment_error:  err.message,
    });

    return { ok: false, method: 'asaas', error: err.message };
  }
}

async function _manualExtraCharge(order, requestId, deltaBrl, adjustmentId) {
  const fn = '_manualExtraCharge';

  await _updateAdjustmentPayment(adjustmentId, {
    payment_method:     order.payment_method || 'unknown',
    payment_action:     'ledger_debit',
    payment_status:     'manual_required',
    payment_amount_brl: deltaBrl,
  });

  log(fn, 'Extra charge manual registrado', { orderId: order.id, deltaBrl });

  _notifyBuyer(order.buyer_id, 'delivery:freight_extra_charge', {
    orderId: order.id, deltaBrl, requiresManualAction: true,
    message: `Cobrança adicional de R$ ${deltaBrl.toFixed(2)} referente ao ajuste de frete.`,
  });

  return { ok: true, method: 'manual', requiresManualAction: true };
}

// ── Webhook confirmation ────────────────────────────────────

/**
 * Confirma que extra charge foi pago (chamado via webhook Stripe).
 */
async function confirmExtraChargePayment(paymentIntentId, adjustmentId) {
  const fn = 'confirmExtraChargePayment';

  await _updateAdjustmentPayment(adjustmentId, {
    payment_status: 'completed',
  });

  log(fn, 'Extra charge confirmado via webhook', { paymentIntentId, adjustmentId });
  return { ok: true };
}

// ── Admin force resolve ─────────────────────────────────────

/**
 * Admin marca um ajuste de pagamento como resolvido manualmente.
 */
async function adminForceResolvePayment(adjustmentId, adminUserId, action, notes) {
  const fn = 'adminForceResolvePayment';

  const newStatus = action === 'mark_completed' ? 'completed' : 'failed';

  const { data } = await getServiceClient().rpc('admin_resolve_freight_payment', {
    p_adjustment_id:  adjustmentId,
    p_payment_status: newStatus,
    p_payment_reference: `admin_${action}`,
    p_admin_user_id:  adminUserId,
    p_admin_notes:    notes,
  });

  if (!data?.ok) {
    throw new Error(data?.error ?? 'Falha ao resolver ajuste de pagamento.');
  }

  log(fn, 'Admin resolveu ajuste de pagamento', {
    adjustmentId, adminUserId, action, newStatus,
  });

  return data;
}

// ── Notificações internas ───────────────────────────────────

function _notifyBuyer(buyerId, event, payload) {
  if (!buyerId) return;
  socketManager.emitToUser(buyerId, event, payload);
  notificationDispatcher.dispatch({
    userId:     buyerId,
    type:       event.replace('delivery:', 'delivery_'),
    importance: 'medium',
    data:       payload,
    metadata:   { triggeredBy: 'system' },
    dedupKey:   `${event}_${payload.orderId}`,
  }).catch(() => {});
}

module.exports = {
  getOrderPaymentInfo,
  processFreightRefund,
  processFreightExtraCharge,
  confirmExtraChargePayment,
  adminForceResolvePayment,
};
