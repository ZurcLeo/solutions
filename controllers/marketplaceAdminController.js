/**
 * @fileoverview marketplaceAdminController — Admin endpoints para pedidos parados
 *
 * Permite que admins visualizem e cancelem marketplace_orders
 * que estão parados (>24h sem progresso).
 */

'use strict';

const { logger } = require('../logger');
const { getSupabaseClient } = require('../config/supabase');

const CTRL = 'marketplaceAdminController';

function sb() { return getSupabaseClient(); }

/**
 * GET /api/admin/marketplace/orders?status=paid&page=1&limit=20
 * Lista pedidos parados (>24h sem atualização, status pendente/pago/em preparo).
 */
exports.listStuckOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const p = Number(page);
    const l = Math.min(Number(limit), 100);
    const offset = (p - 1) * l;

    const statuses = status
      ? [status]
      : ['pending', 'paid', 'in_progress'];

    // 24h threshold
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    let query = sb()
      .from('marketplace_orders')
      .select(`
        *,
        seller:seller_id(id, business_name, trading_name)
      `, { count: 'exact' })
      .in('status', statuses)
      .lt('updated_at', cutoff)
      .order('updated_at', { ascending: true })
      .range(offset, offset + l - 1);

    const { data, error, count } = await query;

    if (error) throw new Error(error.message);

    // Enriquecer com buyer_name (resolve snapshot → users → guest_buyers)
    const rows = data ?? [];
    const buyerIdsToResolve = [];
    const guestIdsToResolve = [];

    for (const row of rows) {
      const snap = row.buyer_snapshot;
      if (snap && typeof snap === 'object' && snap.full_name) {
        row.buyer_name = snap.full_name;
      } else if (row.buyer_id) {
        buyerIdsToResolve.push(row.buyer_id);
      } else if (row.guest_buyer_id) {
        guestIdsToResolve.push(row.guest_buyer_id);
      }
    }

    // Batch lookup registered buyers
    if (buyerIdsToResolve.length) {
      const { data: users } = await sb()
        .from('users')
        .select('id, full_name, username, email')
        .in('id', [...new Set(buyerIdsToResolve)]);
      const userMap = {};
      for (const u of (users || [])) {
        userMap[u.id] = u.full_name || u.username || u.email?.split('@')[0] || null;
      }
      for (const row of rows) {
        if (!row.buyer_name && row.buyer_id && userMap[row.buyer_id]) {
          row.buyer_name = userMap[row.buyer_id];
        }
      }
    }

    // Batch lookup guest buyers
    if (guestIdsToResolve.length) {
      const { data: guests } = await sb()
        .from('guest_buyers')
        .select('id, full_name, email')
        .in('id', [...new Set(guestIdsToResolve)]);
      const guestMap = {};
      for (const g of (guests || [])) {
        guestMap[g.id] = g.full_name || g.email || null;
      }
      for (const row of rows) {
        if (!row.buyer_name && row.guest_buyer_id && guestMap[row.guest_buyer_id]) {
          row.buyer_name = guestMap[row.guest_buyer_id];
        }
      }
    }

    res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        page: p,
        limit: l,
        totalCount: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / l),
      },
    });
  } catch (err) {
    logger.error(`[${CTRL}] listStuckOrders: ${err.message}`, { userId: req.user?.uid });
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/admin/marketplace/orders/:orderId/cancel
 * Cancela um pedido parado. Opcionalmente cancela delivery_request associado.
 */
exports.cancelOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { notes } = req.body;
    const adminId = req.user?.uid;

    // Verificar que o pedido existe e está em status cancelável
    const { data: order, error: fetchErr } = await sb()
      .from('marketplace_orders')
      .select('id, status, seller_id')
      .eq('id', orderId)
      .single();

    if (fetchErr || !order) {
      return res.status(404).json({ success: false, message: 'Pedido nao encontrado.' });
    }

    if (order.status === 'cancelled' || order.status === 'completed') {
      return res.status(400).json({ success: false, message: `Pedido ja esta ${order.status}.` });
    }

    // Cancelar o pedido
    const { error: updateErr } = await sb()
      .from('marketplace_orders')
      .update({ status: 'cancelled' })
      .eq('id', orderId);

    if (updateErr) throw new Error(updateErr.message);

    // Cancelar delivery_request pendente associado (se existir)
    const { data: deliveryReqs } = await sb()
      .from('delivery_requests')
      .select('id, status')
      .eq('order_id', orderId)
      .in('status', ['open', 'no_deliverer_found', 'failed_no_deliverer', 'hold_manual', 're_auctioning']);

    if (deliveryReqs?.length) {
      for (const dr of deliveryReqs) {
        await sb()
          .from('delivery_requests')
          .update({ status: 'cancelled' })
          .eq('id', dr.id);
      }
    }

    logger.info(`[${CTRL}] cancelOrder: order=${orderId} cancelled by admin=${adminId}`, { notes });

    res.status(200).json({ success: true, message: 'Pedido cancelado com sucesso.' });
  } catch (err) {
    logger.error(`[${CTRL}] cancelOrder: ${err.message}`, { userId: req.user?.uid });
    res.status(500).json({ success: false, message: err.message });
  }
};
