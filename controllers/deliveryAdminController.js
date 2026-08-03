/**
 * @fileoverview deliveryAdminController — Admin endpoints para delivery requests
 *
 * Permite que admins visualizem e resolvam delivery requests travados
 * (hold_manual, failed_no_deliverer, no_deliverer_found).
 */

'use strict';

const { logger } = require('../logger');
const { getSupabaseClient } = require('../config/supabase');
const deliveryService = require('../services/deliveryService');
const deliveryPaymentService = require('../services/deliveryPaymentService');

const CTRL = 'deliveryAdminController';

function sb() { return getSupabaseClient(); }

/**
 * GET /api/admin/delivery/stuck?status=hold_manual&page=1&limit=20
 */
exports.listStuck = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const p = Number(page);
    const l = Math.min(Number(limit), 100);
    const offset = (p - 1) * l;

    const statuses = status
      ? [status]
      : ['hold_manual', 'failed_no_deliverer', 'no_deliverer_found'];

    const { data, error } = await sb().rpc('list_stuck_delivery_requests', {
      p_statuses: statuses,
      p_limit:    l,
      p_offset:   offset,
    });

    if (error) throw new Error(error.message);

    const totalCount = data?.[0]?.total_count ?? 0;

    res.status(200).json({
      success: true,
      data:    data ?? [],
      pagination: {
        page:       p,
        limit:      l,
        totalCount: Number(totalCount),
        totalPages: Math.ceil(Number(totalCount) / l),
      },
    });
  } catch (err) {
    logger.error(`[${CTRL}] listStuck: ${err.message}`, { userId: req.user?.uid });
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/admin/delivery/:requestId
 */
exports.getDetail = async (req, res) => {
  try {
    const { requestId } = req.params;

    // Busca request com joins
    const { data: request, error } = await sb()
      .from('delivery_requests')
      .select(`
        *,
        seller:seller_id(id, trading_name, user_id),
        order:order_id(id, buyer_id, total_brl, payment_method, payment_id, status)
      `)
      .eq('id', requestId)
      .single();

    if (error || !request) {
      return res.status(404).json({ success: false, message: 'Request não encontrado.' });
    }

    // Busca ajustes de frete
    const { data: adjustments } = await sb()
      .from('delivery_freight_adjustments')
      .select('*')
      .eq('delivery_request_id', requestId)
      .order('created_at', { ascending: false });

    // Busca buyer name
    let buyerName = null;
    if (request.order?.buyer_id) {
      const { data: buyer } = await sb()
        .from('users')
        .select('full_name')
        .eq('id', request.order.buyer_id)
        .single();
      buyerName = buyer?.full_name;
    }

    res.status(200).json({
      success: true,
      data: {
        ...request,
        buyer_name:  buyerName,
        adjustments: adjustments ?? [],
      },
    });
  } catch (err) {
    logger.error(`[${CTRL}] getDetail: ${err.message}`, { userId: req.user?.uid });
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/admin/delivery/:requestId/resolve
 * body: { action: 'cancel' | 'retry', notes?: string }
 */
exports.resolve = async (req, res) => {
  try {
    const { action, notes } = req.body;
    if (!action) {
      return res.status(400).json({ success: false, message: "Campo 'action' é obrigatório (cancel | retry)" });
    }

    const result = await deliveryService.resolveDeliveryRequest(
      req.user.uid, req.params.requestId, action, { isAdmin: true }
    );

    logger.info(`[${CTRL}] Admin resolveu delivery request`, {
      adminId: req.user.uid, requestId: req.params.requestId, action, notes,
    });

    res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.warn(`[${CTRL}] resolve: ${err.message}`, { userId: req.user?.uid });
    const status = err.message.includes('não encontrada') ? 404
                 : err.message.includes('Ação inválida') || err.message.includes('não pode ser resolvida') ? 400
                 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/admin/delivery/:requestId/resolve-payment
 * body: { adjustmentId, action: 'mark_completed' | 'mark_failed', notes?: string }
 */
exports.resolvePayment = async (req, res) => {
  try {
    const { adjustmentId, action, notes } = req.body;
    if (!adjustmentId || !action) {
      return res.status(400).json({
        success: false,
        message: "Campos 'adjustmentId' e 'action' são obrigatórios.",
      });
    }
    if (!['mark_completed', 'mark_failed'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Ação inválida. Use 'mark_completed' ou 'mark_failed'.",
      });
    }

    const result = await deliveryPaymentService.adminForceResolvePayment(
      adjustmentId, req.user.uid, action, notes
    );

    logger.info(`[${CTRL}] Admin resolveu pagamento de ajuste`, {
      adminId: req.user.uid, adjustmentId, action, notes,
    });

    res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error(`[${CTRL}] resolvePayment: ${err.message}`, { userId: req.user?.uid });
    res.status(500).json({ success: false, message: err.message });
  }
};
