'use strict';

const Joi = require('joi');
const guestCheckoutService = require('../services/guestCheckoutService');
const { logger } = require('../logger');

const LOG_TAG = 'PublicStoreController';

// ── Validation schemas ───────────────────────────────────────────────────────

const itemSchema = Joi.object({
  product_id: Joi.string().required(),
  qty: Joi.number().integer().min(1).required(),
  variant_id: Joi.string().optional(), // ELOS-BE-014: variante do produto
});

const guestSchema = Joi.object({
  full_name: Joi.string().min(2).max(120).required(),
  email: Joi.string().email().required(),
  phone: Joi.string().pattern(/^\d{10,11}$/).required().messages({
    'string.pattern.base': 'Telefone deve conter 10 ou 11 dígitos (DDD + número)',
  }),
});

const createOrderSchema = Joi.object({
  items: Joi.array().items(itemSchema).min(1).required(),
  guest: guestSchema.required(),
  fulfillment_type: Joi.string().valid('pickup', 'local_delivery', 'shipping').default('pickup'),
  delivery_address: Joi.string().max(300).when('fulfillment_type', {
    is: Joi.valid('local_delivery', 'shipping'),
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  delivery_fee: Joi.number().min(0).max(500).optional(),
  delivery_lat: Joi.number().min(-90).max(90).optional(),
  delivery_lng: Joi.number().min(-180).max(180).optional(),
  preferred_deliverer_service_id: Joi.string().optional(),
  // Shipping nacional (SHIP-W2)
  shipping_service_id: Joi.number().integer().when('fulfillment_type', {
    is: 'shipping',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  shipping_fee: Joi.number().min(0).max(1000).when('fulfillment_type', {
    is: 'shipping',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  shipping_postal_code: Joi.string().pattern(/^\d{8}$/).when('fulfillment_type', {
    is: 'shipping',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
});

const estimateDeliverySchema = Joi.object({
  lat: Joi.number().min(-90).max(90).optional(),
  lng: Joi.number().min(-180).max(180).optional(),
  address: Joi.string().min(10).max(300).optional(),
  cep: Joi.string().pattern(/^\d{8}$/).optional(),
  city: Joi.string().max(120).optional(),
  state: Joi.string().max(2).optional(),
}).or('address', 'lat', 'cep').messages({
  'object.missing': 'Informe coordenadas (lat/lng), endereço ou CEP',
});

const paymentSchema = Joi.object({
  token: Joi.string().hex().length(64).required(),
  payment_method: Joi.string().valid('pix', 'credit_card').required(),
  card_data: Joi.object({
    holderName: Joi.string().required(),
    number: Joi.string().creditCard().required(),
    expiryMonth: Joi.string().pattern(/^\d{2}$/).required(),
    expiryYear: Joi.string().pattern(/^\d{4}$/).required(),
    ccv: Joi.string().pattern(/^\d{3,4}$/).required(),
    postalCode: Joi.string().pattern(/^\d{8}$/).optional(),
  }).when('payment_method', {
    is: 'credit_card',
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
});

const statusSchema = Joi.object({
  token: Joi.string().hex().length(64).required(),
});

// ── Handlers ─────────────────────────────────────────────────────────────────

exports.getStore = async (req, res) => {
  try {
    const seller = await guestCheckoutService.getPublicSeller(req.params.sellerId);
    res.json({ success: true, data: seller });
  } catch (err) {
    const status = err.message.includes('não encontrada') || err.message.includes('não está ativa') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.listProducts = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));

    // Search & filter params
    const q = typeof req.query.q === 'string' ? req.query.q.substring(0, 200) : undefined;
    const category = typeof req.query.category === 'string' ? req.query.category.substring(0, 100) : undefined;
    const sort = ['price_asc', 'price_desc', 'name_asc', 'newest'].includes(req.query.sort)
      ? req.query.sort
      : undefined;
    const min_price = req.query.min_price != null ? parseFloat(req.query.min_price) : undefined;
    const max_price = req.query.max_price != null ? parseFloat(req.query.max_price) : undefined;

    const result = await guestCheckoutService.listPublicProducts(req.params.sellerId, {
      page, limit, q, category, sort, min_price, max_price,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

exports.listCategories = async (req, res) => {
  try {
    const categories = await guestCheckoutService.listPublicMenuCategories(req.params.sellerId);
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

exports.getProduct = async (req, res) => {
  try {
    const product = await guestCheckoutService.getPublicProduct(req.params.sellerId, req.params.productId);
    res.json({ success: true, data: product });
  } catch (err) {
    const status = err.message.includes('não encontrado') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.createGuestOrder = async (req, res) => {
  try {
    const { error, value } = createOrderSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        details: error.details.map(d => d.message),
      });
    }

    const result = await guestCheckoutService.createGuestOrder(req.params.sellerId, value);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    logger.warn(`[${LOG_TAG}] createGuestOrder error`, { error: err.message, sellerId: req.params.sellerId });
    const status = err.code === 'STOCK_INSUFFICIENT' ? 409 : 400;
    res.status(status).json({ success: false, message: err.message, code: err.code || undefined });
  }
};

exports.initiateGuestPayment = async (req, res) => {
  try {
    const { error, value } = paymentSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        details: error.details.map(d => d.message),
      });
    }

    const result = await guestCheckoutService.initiateGuestPayment(
      req.params.orderId,
      value.token,
      { payment_method: value.payment_method, card_data: value.card_data }
    );
    res.json({ success: true, data: result });
  } catch (err) {
    logger.warn(`[${LOG_TAG}] initiateGuestPayment error`, { error: err.message, orderId: req.params.orderId });
    const status = err.message.includes('inválido') ? 403 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.getGuestOrderStatus = async (req, res) => {
  try {
    const { error, value } = statusSchema.validate(req.query, { abortEarly: false });
    if (error) {
      return res.status(400).json({ success: false, message: 'Token obrigatório' });
    }

    const order = await guestCheckoutService.getGuestOrderStatus(req.params.orderId, value.token);
    res.json({ success: true, data: order });
  } catch (err) {
    const status = err.message.includes('inválido') ? 403 : err.message.includes('não encontrado') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};

// ── Shipping Quote (public, no auth — SHIP-W2) ──────────────────────────────

const shippingQuoteSchema = Joi.object({
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

exports.getShippingQuote = async (req, res) => {
  try {
    const { error, value } = shippingQuoteSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const { to_postal_code, items } = value;
    const sellerId = req.params.sellerId;
    const { getSupabaseClient } = require('../config/supabase');
    const supabase = getSupabaseClient();

    // 1. Seller shipping config
    const { data: shippingConfig } = await supabase
      .from('seller_shipping_config')
      .select('*')
      .eq('seller_id', sellerId)
      .maybeSingle();

    if (!shippingConfig?.accepts_national_shipping) {
      return res.status(400).json({ success: false, message: 'Vendedor não aceita envio nacional' });
    }

    // 2. Products with dimensions
    const productIds = items.map(i => i.product_id);
    const { data: products, error: prodErr } = await supabase
      .from('marketplace_products')
      .select('id, name, price_brl, weight_kg, dimensions_cm, product_type, active, seller_id')
      .in('id', productIds);

    if (prodErr) throw new Error(`Erro ao buscar produtos: ${prodErr.message}`);

    for (const p of (products || [])) {
      if (!p.active) return res.status(400).json({ success: false, message: `Produto "${p.name}" não está disponível` });
      if (p.seller_id !== sellerId) return res.status(400).json({ success: false, message: `Produto "${p.name}" não pertence a este vendedor` });
      if (!p.dimensions_cm?.width || !p.dimensions_cm?.height || !p.dimensions_cm?.length) {
        return res.status(400).json({ success: false, message: `Produto "${p.name}" não tem dimensões cadastradas para envio` });
      }
    }

    // 3. ME products
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

    // 4. Calculate
    const melhorEnvioService = require('../services/melhorEnvioService');
    const quotes = await melhorEnvioService.calculateShipping(
      shippingConfig.origin_postal_code,
      to_postal_code,
      meProducts
    );

    res.status(200).json({ success: true, data: { quotes } });
  } catch (err) {
    logger.error(`[${LOG_TAG}] getShippingQuote: ${err.message}`, { sellerId: req.params.sellerId });
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.estimateDelivery = async (req, res) => {
  try {
    const { error, value } = estimateDeliverySchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Endereço inválido',
        details: error.details.map(d => d.message),
      });
    }

    const result = await guestCheckoutService.estimateDeliveryForGuest(req.params.sellerId, value);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.warn(`[${LOG_TAG}] estimateDelivery error`, { error: err.message, sellerId: req.params.sellerId });
    const status = err.message.includes('não encontrada') || err.message.includes('não está ativa') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};
