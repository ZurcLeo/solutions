'use strict';

const Joi = require('joi');
const guestCheckoutService = require('../services/guestCheckoutService');
const { logger } = require('../logger');

const LOG_TAG = 'PublicStoreController';

// ── Validation schemas ───────────────────────────────────────────────────────

const itemSchema = Joi.object({
  product_id: Joi.string().required(),
  qty: Joi.number().integer().min(1).required(),
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
  fulfillment_type: Joi.string().valid('pickup', 'local_delivery').default('pickup'),
  delivery_address: Joi.string().max(300).when('fulfillment_type', {
    is: 'local_delivery',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  delivery_fee: Joi.number().min(0).max(500).optional(),
  delivery_lat: Joi.number().min(-90).max(90).optional(),
  delivery_lng: Joi.number().min(-180).max(180).optional(),
  preferred_deliverer_service_id: Joi.string().optional(),
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
    res.status(400).json({ success: false, message: err.message });
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
