/**
 * @fileoverview marketplaceController — ElosCloud Mercado Local
 * Camada fina: extrai parâmetros da request, delega ao marketplaceService,
 * retorna resposta padronizada { success, data } ou { message }.
 */

'use strict';

const Joi                  = require('joi');
const marketplaceService   = require('../services/marketplaceService');
const variantService       = require('../services/variantService');
const googlePlacesService  = require('../services/googlePlacesService');
const { logger }           = require('../logger');
const { getSupabaseClient } = require('../config/supabase');

const CTRL = 'marketplaceController';

// ──────────────────────────────────────────────────────
// Taxonomia
// ──────────────────────────────────────────────────────

exports.getCategories = async (req, res) => {
  try {
    const categories = await marketplaceService.getCategories();
    res.status(200).json({ success: true, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Seller Profiles
// ──────────────────────────────────────────────────────

exports.createSellerProfile = async (req, res) => {
  try {
    const profile = await marketplaceService.createSellerProfile(req.user.uid, req.body);
    res.status(201).json({ success: true, data: profile });
  } catch (err) {
    logger.warn(`[${CTRL}] createSellerProfile: ${err.message}`, { userId: req.user?.uid });
    const isKyc    = err.message.includes('CPF') || err.message.includes('KYC') || err.message.includes('validado') || err.message.includes('identidade');
    const isBadReq = err.message.includes('obrigatório') || err.message.includes('inválido');
    const status   = isKyc ? 403 : isBadReq ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

// PATCH /api/marketplace/sellers/:id/approve — admin ou support:manage_tickets
exports.approveSellerProfile = async (req, res) => {
  // RBAC: admin ou agente com permissão support:manage_tickets
  const roles = req.user.roles || [];
  const perms = req.user.permissions || [];
  const isAdmin = roles.includes('admin') || req.user.role === 'admin';
  const isSupport = perms.includes('support:manage_tickets') || roles.includes('support');
  if (!isAdmin && !isSupport) {
    return res.status(403).json({ success: false, message: 'Acesso restrito a administradores ou agentes de suporte.' });
  }

  const { id } = req.params;
  const { approved, reason } = req.body;

  if (typeof approved !== 'boolean') {
    return res.status(400).json({ success: false, message: 'Campo "approved" (boolean) é obrigatório.' });
  }

  try {
    const profile = await marketplaceService.approveSellerProfile(id, {
      approved,
      reason: reason || '',
      agentUserId: req.user.uid,
    });
    res.json({ success: true, data: profile });
  } catch (err) {
    logger.warn(`[${CTRL}] approveSellerProfile: ${err.message}`, { sellerId: id, agentId: req.user?.uid });
    const status = err.message.includes('não encontrado') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.listSellers = async (req, res) => {
  try {
    const { category, address_city, address_neighborhood } = req.query;
    const { limit, page } = req.query;
    const result = await marketplaceService.listSellers(
      { category, address_city, address_neighborhood },
      { limit, page }
    );
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getSellerProfile = async (req, res) => {
  try {
    const profile = await marketplaceService.getSellerProfile(req.params.id);
    res.status(200).json({ success: true, data: profile });
  } catch (err) {
    res.status(404).json({ success: false, message: err.message });
  }
};

exports.updateSellerProfile = async (req, res) => {
  try {
    const profile = await marketplaceService.updateSellerProfile(req.user.uid, req.body);
    res.status(200).json({ success: true, data: profile });
  } catch (err) {
    logger.warn(`[${CTRL}] updateSellerProfile: ${err.message}`, { userId: req.user?.uid });
    res.status(400).json({ success: false, message: err.message });
  }
};

exports.getMySellerProfile = async (req, res) => {
  try {
    const sellerId = req.headers['x-seller-context'] || null;
    const profile = await marketplaceService.getMySellerProfile(req.user.uid, sellerId);
    res.status(200).json({ success: true, data: profile });
  } catch (err) {
    res.status(404).json({ success: false, message: err.message });
  }
};

// GET /api/marketplace/seller/my-businesses — [BIZ-002] lista negócios do user (owner + team)
exports.getMyBusinesses = async (req, res) => {
  try {
    const businesses = await marketplaceService.getMyBusinesses(req.user.uid);
    res.status(200).json({ success: true, data: businesses });
  } catch (err) {
    logger.warn(`[${CTRL}] getMyBusinesses: ${err.message}`, { userId: req.user?.uid });
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/marketplace/seller/location — direito ao esquecimento (LGPD Art. 18)
exports.removeSellerLocation = async (req, res) => {
  try {
    const result = await marketplaceService.removeSellerLocation(req.user.uid);
    res.status(200).json({ success: true, data: result, message: 'Dados de localização removidos com sucesso.' });
  } catch (err) {
    logger.warn(`[${CTRL}] removeSellerLocation: ${err.message}`, { userId: req.user?.uid });
    res.status(404).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Produtos
// ──────────────────────────────────────────────────────

/**
 * GET /api/marketplace/seller/products
 * Lista apenas os produtos do próprio vendedor (ativo ou não).
 * Usado pelo SellerDashboard para evitar cross-contamination com o catálogo público.
 */
exports.listMyProducts = async (req, res) => {
  try {
    const { limit, page } = req.query;
    const sellerId = req.headers['x-seller-context'] || null;
    const result = await marketplaceService.listMyProducts(req.user.uid, { limit, page }, sellerId);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    const status = err.message.includes('não encontrado') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.createProduct = async (req, res) => {
  try {
    const sellerId = req.headers['x-seller-context'] || null;
    const product = await marketplaceService.createProduct(req.user.uid, req.body, sellerId);
    res.status(201).json({ success: true, data: product });
  } catch (err) {
    logger.warn(`[${CTRL}] createProduct: ${err.message}`, { userId: req.user?.uid });
    const is400 = ['obrigatório', 'ativo', 'inválido', 'não-vazio', 'não pode ser'].some(k => err.message.includes(k));
    res.status(is400 ? 400 : 500).json({ success: false, message: err.message });
  }
};

exports.listProducts = async (req, res) => {
  try {
    const {
      seller_id, category, listing_type, min_price, max_price, limit, page,
      // Parâmetros geo / fulfillment (HYPER-002 + HYPER-004)
      lat, lng, fulfillment, neighborhood, city, state, max_browse_km,
    } = req.query;

    const hasExplicitGeoFilter = lat || lng || fulfillment || neighborhood || city || state;

    // Auto-inject localização do usuário autenticado quando sem filtros explícitos
    let resolvedNeighborhood = neighborhood;
    let resolvedCity         = city;
    let resolvedState        = state;

    if (!hasExplicitGeoFilter && req.user?.uid) {
      try {
        const userLoc = await marketplaceService.getUserLocation(req.user.uid);
        if (userLoc) {
          resolvedNeighborhood = userLoc.bairro;
          resolvedCity         = userLoc.cidade;
          resolvedState        = userLoc.estado;
        }
      } catch { /* sem localização — busca global */ }
    }

    // resolvedState incluído: usuário com apenas estado configurado já usa busca geo
    const useGeoPath = lat || lng || fulfillment || resolvedNeighborhood || resolvedCity || resolvedState;

    let result;
    if (useGeoPath) {
      result = await marketplaceService.listProductsNear(
        { lat, lng, fulfillment, neighborhood: resolvedNeighborhood, city: resolvedCity, state: resolvedState, category, listing_type, max_browse_km },
        { limit, page }
      );
    } else {
      result = await marketplaceService.listProducts(
        { seller_id, category, listing_type, min_price, max_price },
        { limit, page }
      );
    }

    res.status(200).json({ success: true, ...result });
  } catch (err) {
    const status = err.message.includes('inválido') || err.message.includes('juntos') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.getProduct = async (req, res) => {
  try {
    const product = await marketplaceService.getProduct(req.params.id);
    res.json({ success: true, data: product });
  } catch (err) {
    const status = err.status === 404 || err.message.includes('não encontrado') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const sellerId = req.headers['x-seller-context'] || null;
    const product = await marketplaceService.updateProduct(req.user.uid, req.params.id, req.body, sellerId);
    res.status(200).json({ success: true, data: product });
  } catch (err) {
    const status = err.message.includes('permissão') ? 403 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.deactivateProduct = async (req, res) => {
  try {
    const sellerId = req.headers['x-seller-context'] || null;
    const product = await marketplaceService.deactivateProduct(req.user.uid, req.params.id, sellerId);
    res.status(200).json({ success: true, data: product });
  } catch (err) {
    const status = err.message.includes('permissão') ? 403 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.toggleProductActive = async (req, res) => {
  try {
    const schema = Joi.object({ active: Joi.boolean().required() });
    const { error: valErr, value } = schema.validate(req.body);
    if (valErr) return res.status(400).json({ success: false, message: valErr.details[0].message });

    const sellerId = req.headers['x-seller-context'] || null;
    const product = await marketplaceService.toggleProductActive(req.user.uid, req.params.productId, value.active, sellerId);
    res.status(200).json({ success: true, data: product });
  } catch (err) {
    const status = err.message.includes('permissão') ? 403 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Pedidos
// ──────────────────────────────────────────────────────

/**
 * GET /api/marketplace/seller/:sellerId/payment-methods (CMP-014)
 * Retorna métodos de pagamento disponíveis para um seller baseado no plano.
 */
exports.getSellerPaymentMethods = async (req, res) => {
  try {
    const methods = await marketplaceService.getAvailablePaymentMethods(req.params.sellerId);
    res.json({ success: true, data: methods });
  } catch (err) {
    logger.error(`[${CTRL}] getSellerPaymentMethods: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Joi schema para card_data (CMP-014 — mesma validação de guestCheckoutService)
const cardDataSchema = Joi.object({
  holderName: Joi.string().required(),
  number: Joi.string().creditCard().required(),
  expiryMonth: Joi.string().pattern(/^\d{2}$/).required(),
  expiryYear: Joi.string().pattern(/^\d{4}$/).required(),
  ccv: Joi.string().pattern(/^\d{3,4}$/).required(),
  postalCode: Joi.string().pattern(/^\d{8}$/).optional(),
});

exports.createOrder = async (req, res) => {
  try {
    // Validação Joi de card_data quando payment_method === credit_card
    if (req.body.payment_method === 'credit_card') {
      if (!req.body.card_data) {
        return res.status(400).json({ success: false, message: 'Dados do cartão são obrigatórios para pagamento com cartão' });
      }
      const { error: cardErr } = cardDataSchema.validate(req.body.card_data);
      if (cardErr) {
        return res.status(400).json({ success: false, message: `Dados do cartão inválidos: ${cardErr.details[0].message}` });
      }
    }

    const order = await marketplaceService.createOrder(req.user.uid, req.body);

    // Se há valor a pagar, inicia a cobrança imediatamente
    if (order.total_brl > 0 && req.body.payment_method === 'pix') {
      // Valida CPF (opcional): apenas dígitos, 11 caracteres
      const rawCpf = req.body.cpf;
      if (rawCpf != null) {
        const cpfDigits = String(rawCpf).replace(/\D/g, '');
        if (cpfDigits.length !== 11) {
          return res.status(400).json({ success: false, message: 'CPF inválido: deve conter 11 dígitos.' });
        }
      }
      try {
        const { order: updatedOrder, payment } = await marketplaceService.initiateOrderPayment(
          order.id,
          {
            uid:   req.user.uid,
            email: req.user.email,
            name:  req.user.name || req.user.displayName,
            cpf:   rawCpf ? String(rawCpf).replace(/\D/g, '') : undefined,
          }
        );
        return res.status(201).json({ success: true, data: updatedOrder, payment });
      } catch (payErr) {
        // Pagamento falhou mas pedido foi criado — retorna ambos para o frontend reagir
        logger.error(`[${CTRL}] createOrder PIX error: ${payErr.message}`, {
          userId: req.user?.uid, orderId: order.id,
        });
        return res.status(201).json({
          success: true,
          data: order,
          paymentError: payErr.message,
        });
      }
    }

    // Credit card — processa cobrança imediata via Asaas (CMP-014)
    if (order.total_brl > 0 && req.body.payment_method === 'credit_card') {
      try {
        const { order: updatedOrder, payment } = await marketplaceService.initiateCardPayment(
          order.id,
          {
            uid:   req.user.uid,
            email: req.user.email,
            name:  req.user.name || req.user.displayName,
            phone: req.user.phoneNumber || undefined,
          },
          req.body.card_data
        );
        return res.status(201).json({ success: true, data: updatedOrder, payment });
      } catch (payErr) {
        logger.error(`[${CTRL}] createOrder card error: ${payErr.message}`, {
          userId: req.user?.uid, orderId: order.id,
        });
        return res.status(201).json({
          success: true,
          data: order,
          paymentError: payErr.message,
        });
      }
    }

    res.status(201).json({ success: true, data: order });
  } catch (err) {
    logger.error(`[${CTRL}] createOrder: ${err.message}`, { userId: req.user?.uid });

    if (err.code === 'DELIVERY_FEE_MISMATCH') {
      return res.status(422).json({
        success: false,
        code: 'DELIVERY_FEE_MISMATCH',
        message: err.message,
        serverFee: err.serverFee,
        minFee: err.minFee,
        maxFee: err.maxFee,
      });
    }

    if (err.code === 'NO_DELIVERERS') {
      return res.status(409).json({
        success: false,
        code: 'NO_DELIVERERS',
        message: err.message,
      });
    }

    if (err.code === 'SHIPPING_FEE_MISMATCH') {
      return res.status(422).json({
        success: false,
        code: 'SHIPPING_FEE_MISMATCH',
        message: err.message,
        serverFee: err.serverFee,
      });
    }

    if (err.code === 'STOCK_INSUFFICIENT') {
      return res.status(409).json({
        success: false,
        code: 'STOCK_INSUFFICIENT',
        message: err.message,
      });
    }

    const status = err.message.includes('obrigatório') || err.message.includes('próprios') || err.message.includes('insuficiente') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.getOrder = async (req, res) => {
  try {
    const order = await marketplaceService.getOrder(req.user.uid, req.params.id);
    res.status(200).json({ success: true, data: order });
  } catch (err) {
    const status = err.message.includes('Acesso') ? 403 : err.message.includes('não encontrado') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.getActiveOrders = async (req, res) => {
  try {
    const orders = await marketplaceService.getActiveOrdersForBuyer(req.user.uid);
    res.status(200).json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.listOrders = async (req, res) => {
  try {
    const { status, role, limit, page } = req.query;
    const sellerCtx = req.headers['x-seller-context'] || null;
    const result = await marketplaceService.listOrders(
      req.user.uid,
      { status, role },
      { limit, page },
      sellerCtx
    );
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ success: false, message: 'status é obrigatório' });
    const sellerCtx = req.headers['x-seller-context'] || null;
    const order = await marketplaceService.updateOrderStatus(req.user.uid, req.params.id, status, sellerCtx);
    res.status(200).json({ success: true, data: order });
  } catch (err) {
    const status = err.message.includes('permissão') ? 403 : err.message.includes('inválida') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

// ── Seller Order Cancellation (FLOW-AUDIT W3.4 / DSH-016 / GAP-008) ────────

const cancelOrderSchema = Joi.object({
  reason: Joi.string().valid('sem_estoque', 'erro_no_pedido', 'cliente_solicitou', 'outro').required()
    .messages({ 'any.only': 'Motivo deve ser: sem_estoque, erro_no_pedido, cliente_solicitou ou outro' }),
});

exports.cancelOrderBySeller = async (req, res) => {
  try {
    const { error: valErr, value } = cancelOrderSchema.validate(req.body);
    if (valErr) return res.status(400).json({ success: false, message: valErr.details[0].message });

    const sellerCtx = req.headers['x-seller-context'] || null;
    const result = await marketplaceService.cancelOrderBySeller(req.params.id, sellerCtx, req.user.uid, value.reason);
    res.status(200).json({ success: true, data: result.order, monthlyCount: result.monthlyCount });
  } catch (err) {
    logger.warn(`[${CTRL}] cancelOrderBySeller: ${err.message}`, { userId: req.user?.uid, orderId: req.params.id });
    const status = err.message.includes('permissão') ? 403
      : err.message.includes('não encontrado') ? 404
      : err.message.includes('expirou') || err.message.includes('Apenas pedidos') || err.message.includes('inválido') ? 400
      : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.getSellerMonthlyCancellations = async (req, res) => {
  try {
    const sellerCtx = req.headers['x-seller-context'] || null;
    let sellerId = sellerCtx;
    if (!sellerId) {
      const supabase = getSupabaseClient();
      const { data: sp } = await supabase
        .from('seller_profiles')
        .select('id')
        .eq('user_id', req.user.uid)
        .single();
      sellerId = sp?.id;
    }
    if (!sellerId) return res.status(404).json({ success: false, message: 'Perfil de vendedor não encontrado' });
    const data = await marketplaceService.getSellerMonthlyCancellations(sellerId);
    res.status(200).json({ success: true, data });
  } catch (err) {
    logger.warn(`[${CTRL}] getSellerMonthlyCancellations: ${err.message}`, { userId: req.user?.uid });
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.renewOrderPix = async (req, res) => {
  try {
    const result = await marketplaceService.renewOrderPix(req.user.uid, req.params.id);
    res.status(200).json({ success: true, data: result.order, payment: result.payment });
  } catch (err) {
    logger.warn(`[${CTRL}] renewOrderPix: ${err.message}`, { userId: req.user?.uid, orderId: req.params.id });
    const status = err.message.includes('não encontrado') ? 404
      : err.message.includes('ainda está válido') ? 409
      : err.message.includes('pendente') || err.message.includes('não utiliza') ? 400
      : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.confirmPaymentOffline = async (req, res) => {
  try {
    const order = await marketplaceService.confirmPaymentOffline(req.user.uid, req.params.id);
    res.status(200).json({ success: true, data: order });
  } catch (err) {
    const status = err.message.includes('permissão') ? 403
      : err.message.includes('inválida') ? 400
      : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.createOrderDispute = async (req, res) => {
  try {
    const { reason } = req.body;
    const order = await marketplaceService.createOrderDispute(req.user.uid, req.params.id, reason);
    res.status(200).json({ success: true, data: order });
  } catch (err) {
    const status = err.message.includes('permissão') || err.message.includes('não pode') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Metas Comunitárias
// ──────────────────────────────────────────────────────

exports.createCommunityGoal = async (req, res) => {
  try {
    const goal = await marketplaceService.createCommunityGoal(req.user.uid, req.body);
    res.status(201).json({ success: true, data: goal });
  } catch (err) {
    const status = err.message.includes('obrigatório') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.listCommunityGoals = async (req, res) => {
  try {
    const { category, caixinha_id, status, limit, page } = req.query;
    const result = await marketplaceService.listCommunityGoals(
      { category, caixinha_id, status },
      { limit, page }
    );
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.contributeToGoal = async (req, res) => {
  try {
    const contribution = await marketplaceService.contributeToGoal(req.user.uid, req.params.id, req.body);
    res.status(201).json({ success: true, data: contribution });
  } catch (err) {
    logger.error(`[${CTRL}] contributeToGoal: ${err.message}`, { userId: req.user?.uid });
    const status = err.message.includes('obrigatório') || err.message.includes('insuficiente') || err.message.includes('não aceita') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Avaliações de Loja (MKTPLACE-REVIEW-001)
// ──────────────────────────────────────────────────────

exports.createReview = async (req, res) => {
  try {
    const { order_id, rating, comment, is_anonymous } = req.body;
    if (!order_id || !rating) {
      return res.status(400).json({ success: false, message: 'order_id e rating são obrigatórios.' });
    }
    const result = await marketplaceService.createReview(req.user.uid, order_id, { rating, comment, is_anonymous });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    const status = err.message.includes('não encontrado') ? 404
      : err.message.includes('comprador') || err.message.includes('concluído') || err.message.includes('expirado') || err.message.includes('já avaliou') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.getSellerReviews = async (req, res) => {
  try {
    const { page, limit } = req.query;
    const result = await marketplaceService.getSellerReviews(req.params.sellerId, { page, limit });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getOrderReview = async (req, res) => {
  try {
    const review = await marketplaceService.getOrderReview(req.params.orderId);
    res.status(200).json({ success: true, data: review });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.replyToReview = async (req, res) => {
  try {
    const { reply } = req.body;
    if (!reply?.trim()) {
      return res.status(400).json({ success: false, message: 'reply é obrigatório.' });
    }
    const result = await marketplaceService.replyToReview(req.user.uid, req.params.reviewId, reply);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    const status = err.message.includes('não encontrada') ? 404
      : err.message.includes('vendedor') || err.message.includes('já respondeu') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Financeiro (Seller Financial Panel)
// ──────────────────────────────────────────────────────

exports.getSellerFinancials = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const now = new Date();
    const defaultEnd = now.toISOString();
    const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const startDate = start_date || defaultStart;
    const endDate = end_date || defaultEnd;

    const sellerCtx = req.headers['x-seller-context'] || null;
    const result = await marketplaceService.getSellerFinancials(req.user.uid, startDate, endDate, sellerCtx);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error(`[${CTRL}] getSellerFinancials: ${err.message}`, { userId: req.user?.uid });
    const status = err.message.includes('não encontrado') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Clientes por Pedido (Order Clients)
// ──────────────────────────────────────────────────────

exports.listOrderClients = async (req, res) => {
  try {
    const { search, page, limit } = req.query;
    const sellerCtx = req.headers['x-seller-context'] || null;
    const result = await marketplaceService.listOrderClients(
      req.user.uid,
      { search, page, limit },
      sellerCtx
    );
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    logger.error(`[${CTRL}] listOrderClients: ${err.message}`, { userId: req.user?.uid });
    const status = err.message.includes('não encontrado') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.listOrdersByBuyer = async (req, res) => {
  try {
    const { buyerId } = req.params;
    const { buyer_type = 'registered', status, page, limit } = req.query;
    const sellerCtx = req.headers['x-seller-context'] || null;
    const result = await marketplaceService.listOrdersByBuyer(
      req.user.uid,
      buyerId,
      buyer_type,
      { status, page, limit },
      sellerCtx
    );
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    logger.error(`[${CTRL}] listOrdersByBuyer: ${err.message}`, { userId: req.user?.uid });
    const status = err.message.includes('não encontrado') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Seller Subtypes
// ──────────────────────────────────────────────────────

exports.listSellerSubtypes = async (req, res) => {
  try {
    const { category } = req.query;
    const data = await marketplaceService.listSellerSubtypes(category);
    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Menu Categories (alimentação)
// ──────────────────────────────────────────────────────

exports.createMenuCategory = async (req, res) => {
  try {
    const data = await marketplaceService.createMenuCategory(req.user.uid, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) {
    const status = err.message.includes('alimentação') || err.message.includes('ativo') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.listMenuCategories = async (req, res) => {
  try {
    const data = await marketplaceService.listMenuCategories(req.params.sellerId);
    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateMenuCategory = async (req, res) => {
  try {
    const data = await marketplaceService.updateMenuCategory(req.user.uid, req.params.id, req.body);
    res.status(200).json({ success: true, data });
  } catch (err) {
    const status = err.message.includes('não encontrada') || err.message.includes('sem permissão') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.getSellerMenu = async (req, res) => {
  try {
    const data = await marketplaceService.getSellerMenu(req.params.sellerId);
    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Product Modifiers (customizações de prato)
// ──────────────────────────────────────────────────────

exports.addProductModifier = async (req, res) => {
  try {
    const data = await marketplaceService.addProductModifier(req.user.uid, req.params.productId, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) {
    const status = err.message.includes('não encontrado') ? 404
      : err.message.includes('food_item') || err.message.includes('obrigatório') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.listProductModifiers = async (req, res) => {
  try {
    const data = await marketplaceService.listProductModifiers(req.params.productId);
    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateProductModifier = async (req, res) => {
  try {
    const data = await marketplaceService.updateProductModifier(req.user.uid, req.params.modifierId, req.body);
    res.status(200).json({ success: true, data });
  } catch (err) {
    const status = err.message.includes('não encontrado') || err.message.includes('sem permissão') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.removeProductModifier = async (req, res) => {
  try {
    await marketplaceService.removeProductModifier(req.user.uid, req.params.modifierId);
    res.status(200).json({ success: true, message: 'Modifier removido.' });
  } catch (err) {
    const status = err.message.includes('não encontrado') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

// ── Upload de imagens ─────────────────────────────────────────────────────────

exports.uploadProductImage = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'Nenhuma imagem fornecida.' });
  try {
    const supabase  = getSupabaseClient();
    const seller    = await marketplaceService.getMySellerProfile(req.user.uid);
    if (!seller) return res.status(403).json({ success: false, message: 'Perfil de vendedor não encontrado.' });
    const ext      = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const filePath = `${seller.id}/products/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('marketplace-images')
      .upload(filePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (uploadError) throw uploadError;
    const { data: { publicUrl } } = supabase.storage.from('marketplace-images').getPublicUrl(filePath);
    res.status(200).json({ success: true, url: publicUrl });
  } catch (err) {
    logger.error('uploadProductImage error', { uid: req.user.uid, error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.uploadSellerCover = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'Nenhuma imagem fornecida.' });
  try {
    const supabase  = getSupabaseClient();
    const seller    = await marketplaceService.getMySellerProfile(req.user.uid);
    if (!seller) return res.status(403).json({ success: false, message: 'Perfil de vendedor não encontrado.' });
    const ext      = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const filePath = `${seller.id}/cover/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('marketplace-images')
      .upload(filePath, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (uploadError) throw uploadError;
    const { data: { publicUrl } } = supabase.storage.from('marketplace-images').getPublicUrl(filePath);
    await marketplaceService.updateSellerProfile(req.user.uid, { cover_image_url: publicUrl });
    res.status(200).json({ success: true, url: publicUrl });
  } catch (err) {
    logger.error('uploadSellerCover error', { uid: req.user.uid, error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Gestão de Loja (desativação / exclusão)
// ──────────────────────────────────────────────────────

exports.deactivateStore = async (req, res) => {
  try {
    const data = await marketplaceService.deactivateStore(req.user.uid);
    res.status(200).json({ success: true, data });
  } catch (err) {
    const status = err.message.includes('pedidos ativos') ? 409 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.reactivateStore = async (req, res) => {
  try {
    const data = await marketplaceService.reactivateStore(req.user.uid);
    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

exports.deleteStore = async (req, res) => {
  try {
    const data = await marketplaceService.deleteStore(req.user.uid);
    res.status(200).json({ success: true, data });
  } catch (err) {
    const status = err.message.includes('pedidos ativos') ? 409 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Google Places — vinculação seller ↔ estabelecimento
// ──────────────────────────────────────────────────────

// GET /api/marketplace/seller/google-place-suggestion — sugestão auto-detect
exports.getGooglePlaceSuggestion = async (req, res) => {
  try {
    const result = await googlePlacesService.getPlaceSuggestion(req.user.uid);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.warn(`[${CTRL}] getGooglePlaceSuggestion: ${err.message}`, { userId: req.user?.uid });
    const status = err.message.includes('não encontrado') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

// POST /api/marketplace/seller/google-place-link — seller confirma vinculação
exports.confirmGooglePlaceLink = async (req, res) => {
  try {
    const { placeId, linkedBy } = req.body;
    if (!placeId) {
      return res.status(400).json({ success: false, message: 'placeId é obrigatório' });
    }
    const data = await googlePlacesService.confirmPlaceLink(req.user.uid, placeId, linkedBy || 'auto_confirm');
    res.status(200).json({ success: true, data });
  } catch (err) {
    logger.warn(`[${CTRL}] confirmGooglePlaceLink: ${err.message}`, { userId: req.user?.uid });
    const isConflict = err.message.includes('já está vinculado');
    const status = isConflict ? 409 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

// GET /api/marketplace/seller/google-place-search?q=padaria — busca manual
exports.searchGooglePlaces = async (req, res) => {
  try {
    const query = req.query.q;
    if (!query || query.length < 3) {
      return res.status(400).json({ success: false, message: 'Busca precisa ter pelo menos 3 caracteres' });
    }

    // Buscar coords do seller para referência geográfica
    const { data: seller } = await getSupabaseClient()
      .from('seller_profiles')
      .select('address_lat, address_lng')
      .eq('user_id', req.user.uid)
      .neq('status', 'deleted')
      .single();

    if (!seller?.address_lat || !seller?.address_lng) {
      return res.status(400).json({ success: false, message: 'Cadastre o endereço da loja primeiro' });
    }

    const results = await googlePlacesService.searchPlaces(query, seller.address_lat, seller.address_lng);
    res.status(200).json({ success: true, data: results });
  } catch (err) {
    logger.warn(`[${CTRL}] searchGooglePlaces: ${err.message}`, { userId: req.user?.uid });
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/marketplace/seller/google-place-link — seller remove vinculação
exports.unlinkGooglePlace = async (req, res) => {
  try {
    const data = await googlePlacesService.unlinkPlace(req.user.uid);
    res.status(200).json({ success: true, data });
  } catch (err) {
    logger.warn(`[${CTRL}] unlinkGooglePlace: ${err.message}`, { userId: req.user?.uid });
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/marketplace/seller/google-place-sync — admin: batch sync de Places
exports.batchSyncGooglePlaces = async (req, res) => {
  try {
    const roles = req.user.roles || [];
    const isAdmin = roles.includes('admin') || req.user.role === 'admin';
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Apenas administradores.' });

    const limit = Math.min(Number(req.body.limit) || 50, 200);
    const result = await googlePlacesService.batchSyncPlaces({ limit });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error(`[${CTRL}] batchSyncGooglePlaces: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/marketplace/seller/backfill-coords — admin: geocodifica vendedores sem coords
exports.backfillSellerCoords = async (req, res) => {
  try {
    const roles = req.user.roles || [];
    const isAdmin = roles.includes('admin') || req.user.role === 'admin';
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Apenas administradores.' });

    const limit = Math.min(Number(req.body.limit) || 50, 200);
    const result = await marketplaceService.backfillSellerCoords({ limit });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error(`[${CTRL}] backfillSellerCoords: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Shipping Config — Envio Nacional (SHIP-001)
// ──────────────────────────────────────────────────────

const SHIPPING_DEFAULTS = {
  accepts_national_shipping: false,
  origin_postal_code: null,
  origin_address: null,
  origin_number: null,
  origin_district: null,
  origin_city: null,
  origin_state_abbr: null,
  sender_name: null,
  sender_phone: null,
  sender_email: null,
  sender_document: null,
};

const updateShippingSchema = Joi.object({
  accepts_national_shipping: Joi.boolean(),
  origin_postal_code: Joi.string().pattern(/^\d{8}$/).allow('', null),
  origin_address: Joi.string().max(200).allow('', null),
  origin_number: Joi.string().max(20).allow('', null),
  origin_district: Joi.string().max(100).allow('', null),
  origin_city: Joi.string().max(100).allow('', null),
  origin_state_abbr: Joi.string().length(2).uppercase().allow('', null),
  sender_name: Joi.string().max(100).allow('', null),
  sender_phone: Joi.string().max(20).allow('', null),
  sender_email: Joi.string().email({ tlds: false }).allow('', null),
  sender_document: Joi.string().max(20).allow('', null),
});

// GET /api/marketplace/sellers/:id/shipping-config
exports.getShippingConfig = async (req, res) => {
  try {
    const sellerId = req.params.id;
    const supabase = getSupabaseClient();

    // Verificar ownership
    const { data: seller, error: sellerErr } = await supabase
      .from('seller_profiles')
      .select('id')
      .eq('id', sellerId)
      .eq('user_id', req.user.uid)
      .single();

    if (sellerErr || !seller) {
      return res.status(403).json({ success: false, message: 'Sem permissão para acessar este vendedor.' });
    }

    const { data: config } = await supabase
      .from('seller_shipping_config')
      .select('*')
      .eq('seller_id', sellerId)
      .single();

    res.status(200).json({
      success: true,
      data: { shipping_config: config || { ...SHIPPING_DEFAULTS, seller_id: sellerId } },
    });
  } catch (err) {
    logger.error(`[${CTRL}] getShippingConfig: ${err.message}`, { userId: req.user?.uid, sellerId: req.params.id });
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/marketplace/sellers/:id/shipping-config
exports.updateShippingConfig = async (req, res) => {
  try {
    const sellerId = req.params.id;
    const supabase = getSupabaseClient();

    // Joi validation
    const { error: joiErr, value } = updateShippingSchema.validate(req.body, { stripUnknown: true });
    if (joiErr) {
      return res.status(400).json({ success: false, message: joiErr.details[0].message });
    }

    // Verificar ownership
    const { data: seller, error: sellerErr } = await supabase
      .from('seller_profiles')
      .select('id, category')
      .eq('id', sellerId)
      .eq('user_id', req.user.uid)
      .single();

    if (sellerErr || !seller) {
      return res.status(403).json({ success: false, message: 'Sem permissão para acessar este vendedor.' });
    }

    // Validação de negócio: alimentação não pode usar envio nacional
    if (seller.category === 'alimentacao') {
      return res.status(400).json({
        success: false,
        error: 'shipping_not_available',
        message: 'Restaurantes não podem usar envio por transportadora',
      });
    }

    // Se ativando, validar campos obrigatórios
    if (value.accepts_national_shipping === true) {
      const required = ['origin_postal_code', 'origin_address', 'origin_city', 'origin_state_abbr', 'sender_name'];
      const missing = required.filter(f => !value[f]);
      if (missing.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Campos obrigatórios para ativar envio nacional: ${missing.join(', ')}`,
        });
      }
    }

    // Upsert
    const payload = { seller_id: sellerId, ...value, updated_at: new Date().toISOString() };
    const { data: config, error: upsertErr } = await supabase
      .from('seller_shipping_config')
      .upsert(payload, { onConflict: 'seller_id' })
      .select('*')
      .single();

    if (upsertErr) {
      logger.error(`[${CTRL}] updateShippingConfig upsert: ${upsertErr.message}`, { sellerId });
      throw upsertErr;
    }

    logger.info(`[${CTRL}] updateShippingConfig OK`, { sellerId, accepts: config.accepts_national_shipping });
    res.status(200).json({ success: true, data: { shipping_config: config } });
  } catch (err) {
    logger.error(`[${CTRL}] updateShippingConfig: ${err.message}`, { userId: req.user?.uid, sellerId: req.params.id });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Shipping Quote & Tracking (SHIP-003)
// ──────────────────────────────────────────────────────

/**
 * POST /api/marketplace/shipping/quote
 * Buyer informa CEP e produtos, recebe opções de frete nacional via Melhor Envio.
 */
exports.getShippingQuote = async (req, res) => {
  try {
    const schema = Joi.object({
      seller_id: Joi.string().uuid().required(),
      to_postal_code: Joi.string().pattern(/^\d{8}$/).required().messages({
        'string.pattern.base': 'CEP deve conter exatamente 8 dígitos numéricos',
      }),
      items: Joi.array().items(
        Joi.object({
          product_id: Joi.string().uuid().required(),
          qty: Joi.number().integer().min(1).default(1),
        })
      ).min(1).required(),
    });

    const { error: valErr, value } = schema.validate(req.body);
    if (valErr) return res.status(400).json({ success: false, message: valErr.details[0].message });

    const { seller_id, to_postal_code, items } = value;
    const supabase = getSupabaseClient();

    // 1. Buscar seller_shipping_config → origin_postal_code
    const { data: shippingConfig } = await supabase
      .from('seller_shipping_config')
      .select('*')
      .eq('seller_id', seller_id)
      .maybeSingle();

    if (!shippingConfig?.accepts_national_shipping) {
      return res.status(400).json({ success: false, message: 'Vendedor não aceita envio nacional' });
    }

    // 2. Buscar produtos dos items
    const productIds = items.map(i => i.product_id);
    const { data: products } = await supabase
      .from('marketplace_products')
      .select('id, name, weight_kg, dimensions_cm, product_type, price_brl')
      .in('id', productIds);

    if (!products || products.length === 0) {
      return res.status(400).json({ success: false, message: 'Nenhum produto encontrado' });
    }

    // Validar que TODOS são physical_product com dimensions_cm preenchido
    for (const p of products) {
      if (p.product_type !== 'physical_product') {
        return res.status(400).json({ success: false, message: `Produto "${p.name}" não é elegível para envio por transportadora` });
      }
      if (!p.dimensions_cm?.width || !p.dimensions_cm?.height || !p.dimensions_cm?.length) {
        return res.status(400).json({ success: false, message: `Produto "${p.name}" não tem dimensões cadastradas para envio` });
      }
    }

    // 3. Montar array de products para ME
    const meProducts = products.map(p => {
      const item = items.find(i => i.product_id === p.id);
      return {
        id: p.id,
        width: p.dimensions_cm.width,
        height: p.dimensions_cm.height,
        length: p.dimensions_cm.length,
        weight: p.weight_kg || 0.5,
        insurance_value: p.price_brl || 0,
        quantity: item?.qty || 1,
      };
    });

    // 4. Chamar melhorEnvioService.calculateShipping
    const melhorEnvioService = require('../services/melhorEnvioService');
    const quotes = await melhorEnvioService.calculateShipping(
      shippingConfig.origin_postal_code,
      to_postal_code,
      meProducts
    );

    // 5. Retornar
    res.status(200).json({ success: true, data: { quotes } });
  } catch (err) {
    logger.error(`[${CTRL}] getShippingQuote: ${err.message}`, { userId: req.user?.uid });
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/marketplace/shipping/:orderId/tracking
 * Retorna tracking do envio nacional de um pedido.
 */
exports.getShippingTracking = async (req, res) => {
  try {
    const { orderId } = req.params;
    const supabase = getSupabaseClient();

    // 1. Buscar shipping_order
    const { data: shippingOrder, error: soErr } = await supabase
      .from('shipping_orders')
      .select('*')
      .eq('order_id', orderId)
      .maybeSingle();

    if (soErr || !shippingOrder) {
      return res.status(404).json({ success: false, message: 'Envio não encontrado para este pedido' });
    }

    // 2. Verificar que req.user.uid é buyer ou seller do pedido
    const { data: order } = await supabase
      .from('marketplace_orders')
      .select('buyer_id, seller_id, seller:seller_id ( user_id )')
      .eq('id', orderId)
      .maybeSingle();

    if (!order) {
      return res.status(404).json({ success: false, message: 'Pedido não encontrado' });
    }

    const isBuyer = order.buyer_id === req.user.uid;
    const isSeller = order.seller?.user_id === req.user.uid;
    if (!isBuyer && !isSeller) {
      return res.status(403).json({ success: false, message: 'Acesso negado a este pedido' });
    }

    // 3. Buscar shipping_tracking_events
    const { data: events } = await supabase
      .from('shipping_tracking_events')
      .select('*')
      .eq('shipping_order_id', shippingOrder.id)
      .order('occurred_at', { ascending: false });

    // 4. Retornar
    res.status(200).json({
      success: true,
      data: {
        shipping_order: shippingOrder,
        events: events || [],
      },
    });
  } catch (err) {
    logger.error(`[${CTRL}] getShippingTracking: ${err.message}`, { userId: req.user?.uid, orderId: req.params.orderId });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// Product Variants (ELOS-BE-014)
// ──────────────────────────────────────────────────────

const variantSchemas = {
  create: Joi.object({
    attributes:     Joi.object().required(),
    sku:            Joi.string().max(100).allow(null, '').optional(),
    gtin:           Joi.string().max(50).allow(null, '').optional(),
    stock:          Joi.number().integer().min(0).default(0),
    price_override: Joi.number().min(0).allow(null).optional(),
    image_url:      Joi.string().uri().allow(null, '').optional(),
    is_available:   Joi.boolean().default(true),
    sort_order:     Joi.number().integer().min(0).default(0),
  }),
  update: Joi.object({
    attributes:     Joi.object().optional(),
    sku:            Joi.string().max(100).allow(null, '').optional(),
    gtin:           Joi.string().max(50).allow(null, '').optional(),
    stock:          Joi.number().integer().min(0).optional(),
    price_override: Joi.number().min(0).allow(null).optional(),
    image_url:      Joi.string().uri().allow(null, '').optional(),
    is_available:   Joi.boolean().optional(),
    sort_order:     Joi.number().integer().min(0).optional(),
  }).min(1),
  matrix: Joi.object().pattern(Joi.string(), Joi.array().items(Joi.string().min(1)).min(1)).min(1),
  bulkUpdate: Joi.array().items(Joi.object({
    id:             Joi.string().required(),
    stock:          Joi.number().integer().min(0).optional(),
    price_override: Joi.number().min(0).allow(null).optional(),
    sku:            Joi.string().max(100).allow(null, '').optional(),
    gtin:           Joi.string().max(50).allow(null, '').optional(),
    is_available:   Joi.boolean().optional(),
    image_url:      Joi.string().uri().allow(null, '').optional(),
  }).min(2)).min(1), // min(2) = id + at least one field
};

exports.listVariants = async (req, res) => {
  try {
    const variants = await variantService.listVariants(req.params.productId);
    res.json({ success: true, data: variants });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

exports.createVariant = async (req, res) => {
  try {
    const { error, value } = variantSchemas.create.validate(req.body, { abortEarly: false });
    if (error) return res.status(400).json({ success: false, message: 'Dados inválidos', details: error.details.map(d => d.message) });

    const sellerId = req.headers['x-seller-context'] || null;
    const seller = await marketplaceService.getMySellerProfile(req.user.uid, sellerId);
    const variant = await variantService.createVariant(req.params.productId, value, seller.id);
    res.status(201).json({ success: true, data: variant });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

exports.generateVariantMatrix = async (req, res) => {
  try {
    const { error, value } = variantSchemas.matrix.validate(req.body, { abortEarly: false });
    if (error) return res.status(400).json({ success: false, message: 'Dados inválidos', details: error.details.map(d => d.message) });

    const sellerId = req.headers['x-seller-context'] || null;
    const seller = await marketplaceService.getMySellerProfile(req.user.uid, sellerId);
    const result = await variantService.generateMatrix(req.params.productId, value, seller.id);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

exports.updateVariant = async (req, res) => {
  try {
    const { error, value } = variantSchemas.update.validate(req.body, { abortEarly: false });
    if (error) return res.status(400).json({ success: false, message: 'Dados inválidos', details: error.details.map(d => d.message) });

    const sellerId = req.headers['x-seller-context'] || null;
    const seller = await marketplaceService.getMySellerProfile(req.user.uid, sellerId);
    const variant = await variantService.updateVariant(req.params.variantId, value, seller.id);
    res.json({ success: true, data: variant });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

exports.deleteVariant = async (req, res) => {
  try {
    const sellerId = req.headers['x-seller-context'] || null;
    const seller = await marketplaceService.getMySellerProfile(req.user.uid, sellerId);
    await variantService.deleteVariant(req.params.variantId, seller.id);
    res.json({ success: true, message: 'Variante removida' });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

exports.toggleVariantAvailability = async (req, res) => {
  try {
    const sellerId = req.headers['x-seller-context'] || null;
    const seller = await marketplaceService.getMySellerProfile(req.user.uid, sellerId);
    const variant = await variantService.toggleAvailability(req.params.variantId, seller.id);
    res.json({ success: true, data: variant });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

exports.bulkUpdateVariants = async (req, res) => {
  try {
    const { error, value } = variantSchemas.bulkUpdate.validate(req.body, { abortEarly: false });
    if (error) return res.status(400).json({ success: false, message: 'Dados inválidos', details: error.details.map(d => d.message) });

    const sellerId = req.headers['x-seller-context'] || null;
    const seller = await marketplaceService.getMySellerProfile(req.user.uid, sellerId);
    const result = await variantService.bulkUpdate(req.params.productId, value, seller.id);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};
