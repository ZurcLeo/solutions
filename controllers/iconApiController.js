/**
 * @fileoverview IconChat REST API Controller
 *
 * Endpoints de consulta scoped por seller (autenticado via HMAC).
 * IconChat consulta dados de pedidos, entregas e catálogo.
 *
 * Todas as queries são filtradas por req.iconSellerId (set pelo middleware HMAC).
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const CTRL = 'iconApiController';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

// ---------------------------------------------------------------------------
// GET /api/icon/orders/:orderId
// ---------------------------------------------------------------------------

exports.getOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const sellerId = req.iconSellerId;

    const { data: order, error } = await sb()
      .from('marketplace_orders')
      .select(`
        id, status, payment_method, payment_status, total_brl,
        items, notes, created_at, updated_at,
        buyer:buyer_id (id, nome, telefone)
      `)
      .eq('id', orderId)
      .eq('seller_id', sellerId)
      .maybeSingle();

    if (error) throw error;

    if (!order) {
      return res.status(404).json({ error: 'order_not_found' });
    }

    // Buscar delivery associado (se houver)
    const { data: delivery } = await sb()
      .from('delivery_requests')
      .select('id, status, matched_at, delivered_at')
      .eq('order_id', orderId)
      .maybeSingle();

    return res.json({
      success: true,
      data: {
        id: order.id,
        status: order.status,
        payment_method: order.payment_method,
        payment_status: order.payment_status,
        total_brl: order.total_brl,
        items: order.items,
        notes: order.notes,
        created_at: order.created_at,
        updated_at: order.updated_at,
        buyer: order.buyer ? {
          name: order.buyer.nome,
          phone: order.buyer.telefone,
        } : null,
        delivery: delivery ? {
          id: delivery.id,
          status: delivery.status,
          matched_at: delivery.matched_at,
          delivered_at: delivery.delivered_at,
        } : null,
      },
    });
  } catch (err) {
    logger.error(`[${CTRL}] getOrder error`, { error: err.message, orderId: req.params.orderId });
    return res.status(500).json({ error: 'internal_error' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/icon/deliveries/:deliveryId
// ---------------------------------------------------------------------------

exports.getDelivery = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const sellerId = req.iconSellerId;

    const { data: delivery, error } = await sb()
      .from('delivery_requests')
      .select(`
        id, status, matched_at, picked_up_at, delivered_at,
        created_at, estimated_distance_km,
        order:order_id (id, seller_id),
        deliverer:deliverer_id (id, nome)
      `)
      .eq('id', deliveryId)
      .maybeSingle();

    if (error) throw error;

    if (!delivery || delivery.order?.seller_id !== sellerId) {
      return res.status(404).json({ error: 'delivery_not_found' });
    }

    // Buscar veículo do entregador se houver
    let vehicle = null;
    if (delivery.deliverer?.id) {
      const { data: v } = await sb()
        .from('user_vehicles')
        .select('vehicle_type, plate')
        .eq('user_id', delivery.deliverer.id)
        .eq('is_primary', true)
        .maybeSingle();
      vehicle = v;
    }

    return res.json({
      success: true,
      data: {
        id: delivery.id,
        status: delivery.status,
        matched_at: delivery.matched_at,
        picked_up_at: delivery.picked_up_at,
        delivered_at: delivery.delivered_at,
        created_at: delivery.created_at,
        estimated_distance_km: delivery.estimated_distance_km,
        deliverer: delivery.deliverer ? {
          name: delivery.deliverer.nome,
          vehicle_type: vehicle?.vehicle_type || null,
          plate: vehicle?.plate || null,
        } : null,
      },
    });
  } catch (err) {
    logger.error(`[${CTRL}] getDelivery error`, { error: err.message, deliveryId: req.params.deliveryId });
    return res.status(500).json({ error: 'internal_error' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/icon/sellers/:sellerId/catalog
// ---------------------------------------------------------------------------

exports.getCatalog = async (req, res) => {
  try {
    const { sellerId } = req.params;

    // Garantir que o seller requisitado é o mesmo da autenticação
    if (sellerId !== req.iconSellerId) {
      return res.status(403).json({ error: 'seller_mismatch' });
    }

    const [productsRes, sellerRes] = await Promise.all([
      sb().from('marketplace_products')
        .select('id, name, price_brl, description, product_type, images, created_at')
        .eq('seller_id', sellerId)
        .eq('active', true)
        .order('name', { ascending: true }),
      sb().from('seller_profiles')
        .select('business_name, whatsapp, username, category, seller_subtype')
        .eq('id', sellerId)
        .maybeSingle(),
    ]);

    if (productsRes.error) throw productsRes.error;

    const seller = sellerRes.data;
    return res.json({
      success: true,
      seller: {
        name: seller?.business_name || null,
        publicContact: seller?.whatsapp || null,
        username: seller?.username || null,
        category: seller?.category || null,
        seller_subtype: seller?.seller_subtype || null,
      },
      data: (productsRes.data || []).map(p => ({
        id: p.id,
        name: p.name,
        price_brl: p.price_brl,
        description: p.description,
        product_type: p.product_type,
        image_url: Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : null,
      })),
    });
  } catch (err) {
    logger.error(`[${CTRL}] getCatalog error`, { error: err.message, sellerId: req.params.sellerId });
    return res.status(500).json({ error: 'internal_error' });
  }
};
