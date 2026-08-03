/**
 * @fileoverview IconChat Marketplace Discovery Controller
 *
 * E1: GET /api/icon/marketplace/search     — busca cross-seller com full-text + relevance
 * E2: GET /api/icon/marketplace/categories — categorias com filtros de refinamento por vertical
 *
 * Autenticação: HMAC de canal (verifyIconChannelHmac), sem seller-scope.
 * Ticket: ICON-SEARCH-002
 */

'use strict';

const Joi = require('joi');
const { logger } = require('../logger');
const marketplaceService = require('../services/marketplaceService');

const CTRL = 'iconMarketplaceController';

// ---------------------------------------------------------------------------
// E1: search — Busca cross-seller com full-text + relevance
// ---------------------------------------------------------------------------

const searchSchema = Joi.object({
  q:            Joi.string().trim().max(200).allow('', null),
  category:     Joi.string().valid('alimentacao', 'servicos', 'produtos', 'imoveis', 'outros').allow(null),
  city:         Joi.string().trim().max(100).allow('', null),
  state:        Joi.string().trim().max(100).allow('', null),
  neighborhood: Joi.string().trim().max(100).allow('', null),
  lat:          Joi.number().min(-90).max(90).allow(null),
  lng:          Joi.number().min(-180).max(180).allow(null),
  min_price:    Joi.number().min(0).allow(null),
  max_price:    Joi.number().positive().allow(null),
  fulfillment:  Joi.string().trim().max(200).allow('', null),
  listing_type: Joi.string().valid('venda', 'aluguel_fixo', 'temporada').allow(null),
  page:         Joi.number().integer().min(1).default(1),
  limit:        Joi.number().integer().min(1).max(20).default(10),
});

exports.search = async (req, res) => {
  const fn = `${CTRL}.search`;
  try {
    const { error: valErr, value: params } = searchSchema.validate(req.query, { stripUnknown: true });
    if (valErr) {
      return res.status(400).json({ error: 'validation_error', details: valErr.message });
    }

    const result = await marketplaceService.searchMarketplace(
      {
        q:            params.q || null,
        category:     params.category || null,
        city:         params.city || null,
        state:        params.state || null,
        neighborhood: params.neighborhood || null,
        lat:          params.lat ?? null,
        lng:          params.lng ?? null,
        min_price:    params.min_price ?? null,
        max_price:    params.max_price ?? null,
        fulfillment:  params.fulfillment || null,
        listing_type: params.listing_type || null,
      },
      { limit: params.limit, page: params.page },
    );

    // Build filters_applied echo (only non-null filters)
    const filtersApplied = {};
    for (const key of ['q', 'category', 'city', 'state', 'neighborhood', 'lat', 'lng', 'min_price', 'max_price', 'fulfillment', 'listing_type']) {
      const v = params[key];
      if (v != null && v !== '') filtersApplied[key] = v;
    }

    res.set('Cache-Control', 'private, max-age=60');
    return res.json({
      results: result.products,
      pagination: {
        page:  result.page,
        limit: result.limit,
        total: result.total,
      },
      filters_applied: filtersApplied,
    });
  } catch (err) {
    logger.error(`[${fn}] Unhandled error`, { error: err.message, stack: err.stack });
    return res.status(500).json({ error: 'internal_error' });
  }
};

// ---------------------------------------------------------------------------
// E2: categories — Categorias com filtros de refinamento por vertical
// ---------------------------------------------------------------------------

const CATEGORIES = [
  {
    slug: 'alimentacao',
    label: 'Alimentação',
    product_type: 'food_item',
    refinement_filters: [
      { key: 'city',         label: 'Cidade',       type: 'text',   required: true },
      { key: 'neighborhood', label: 'Bairro',       type: 'text' },
      { key: 'max_price',    label: 'Preço máximo', type: 'number' },
    ],
    refinement_prompts: {
      city:         'Em qual cidade você está?',
      neighborhood: 'Algum bairro de preferência?',
      max_price:    'Tem um valor máximo em mente?',
    },
  },
  {
    slug: 'servicos',
    label: 'Serviços',
    product_type: 'service',
    refinement_filters: [
      { key: 'city',        label: 'Cidade',     type: 'text',   required: true },
      { key: 'fulfillment', label: 'Modalidade', type: 'enum', values: ['in_person_service', 'remote_service'] },
      { key: 'max_price',   label: 'Preço máximo', type: 'number' },
    ],
    refinement_prompts: {
      city:        'Em qual cidade você precisa do serviço?',
      fulfillment: 'Presencial ou remoto?',
      max_price:   'Tem um orçamento máximo?',
    },
  },
  {
    slug: 'produtos',
    label: 'Produtos',
    product_type: 'physical_product',
    refinement_filters: [
      { key: 'city',         label: 'Cidade',       type: 'text' },
      { key: 'min_price',    label: 'Preço mínimo', type: 'number' },
      { key: 'max_price',    label: 'Preço máximo', type: 'number' },
      { key: 'fulfillment',  label: 'Entrega',      type: 'enum', values: ['pickup', 'local_delivery', 'shipping'] },
    ],
    refinement_prompts: {
      city:        'Em qual cidade você está?',
      fulfillment: 'Retirada, entrega local ou envio?',
    },
  },
  {
    slug: 'imoveis',
    label: 'Imóveis',
    product_type: 'property',
    refinement_filters: [
      { key: 'city',         label: 'Cidade',        type: 'text',   required: true },
      { key: 'listing_type', label: 'Tipo',          type: 'enum', values: ['venda', 'aluguel_fixo', 'temporada'] },
      { key: 'min_price',    label: 'Preço mínimo',  type: 'number' },
      { key: 'max_price',    label: 'Preço máximo',  type: 'number' },
    ],
    refinement_prompts: {
      city:         'Em qual cidade você busca?',
      listing_type: 'Compra, aluguel fixo ou temporada?',
      min_price:    'Valor mínimo?',
      max_price:    'Valor máximo?',
    },
  },
  {
    slug: 'outros',
    label: 'Outros',
    product_type: 'physical_product',
    refinement_filters: [
      { key: 'city',      label: 'Cidade',       type: 'text' },
      { key: 'max_price', label: 'Preço máximo', type: 'number' },
    ],
    refinement_prompts: {
      city:      'Em qual cidade você está?',
      max_price: 'Tem um valor máximo em mente?',
    },
  },
];

exports.categories = async (_req, res) => {
  const fn = `${CTRL}.categories`;
  try {
    res.set('Cache-Control', 'public, max-age=3600');
    return res.json({ categories: CATEGORIES });
  } catch (err) {
    logger.error(`[${fn}] Unhandled error`, { error: err.message, stack: err.stack });
    return res.status(500).json({ error: 'internal_error' });
  }
};
