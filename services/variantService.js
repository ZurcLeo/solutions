/**
 * @fileoverview variantService — Product Variants (ELOS-BE-014)
 *
 * Gerencia variantes de produtos (cor, tamanho, etc.) com SKU/estoque/preço próprios.
 * Independente de product_modifiers (add-ons/montagem do FEAT-012) — podem coexistir.
 *
 * Estoque: decrementado atomicamente no checkout via RPC decrement_variant_stock.
 * Compensação: restore_variant_stock em cancelamento/expiração.
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger }            = require('../logger');

const SERVICE = 'variantService';

// ──────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

/**
 * Normaliza attributes: ordena keys alfabeticamente.
 * Trigger do DB também normaliza, mas fazemos no service para
 * comparação de duplicatas antes do INSERT.
 */
function normalizeAttributes(attrs) {
  if (!attrs || typeof attrs !== 'object') return attrs;
  const sorted = {};
  Object.keys(attrs).sort().forEach(k => { sorted[k] = attrs[k]; });
  return sorted;
}

/**
 * Valida que sellerId é o dono do produto.
 * Retorna o produto ou lança erro.
 */
async function _requireProductOwnership(productId, sellerId) {
  const { data: product, error } = await sb()
    .from('marketplace_products')
    .select('id, seller_id, variant_attributes, price_brl, active')
    .eq('id', productId)
    .single();

  if (error || !product) {
    const err = new Error('Produto não encontrado');
    err.status = 404;
    throw err;
  }
  if (product.seller_id !== sellerId) {
    const err = new Error('Sem permissão para modificar variantes deste produto');
    err.status = 403;
    throw err;
  }
  return product;
}

/**
 * Valida que o produto tem variant_attributes definido e que as keys do attributes
 * estão contidas nos eixos. O trigger do DB faz a mesma validação, mas validar
 * no service dá mensagem de erro mais amigável.
 */
function _validateAttributeKeys(productAxes, attributes) {
  if (!productAxes || !Array.isArray(productAxes) || productAxes.length === 0) {
    const err = new Error('Produto não possui eixos de variação (variant_attributes). Defina-os antes de criar variantes.');
    err.status = 400;
    throw err;
  }

  const attrKeys = Object.keys(attributes);
  if (attrKeys.length === 0) {
    const err = new Error('attributes da variante não pode ser vazio.');
    err.status = 400;
    throw err;
  }

  // Todas as keys devem estar nos eixos
  for (const key of attrKeys) {
    if (!productAxes.includes(key)) {
      const err = new Error(`Atributo "${key}" não é um eixo declarado no produto. Eixos válidos: ${productAxes.join(', ')}`);
      err.status = 400;
      throw err;
    }
  }

  // Todos os eixos devem estar presentes
  for (const axis of productAxes) {
    if (!attrKeys.includes(axis)) {
      const err = new Error(`Eixo "${axis}" declarado no produto mas ausente nos attributes. Todos os eixos devem estar presentes.`);
      err.status = 400;
      throw err;
    }
  }
}

// ──────────────────────────────────────────────────────
// CRUD
// ──────────────────────────────────────────────────────

/**
 * Lista variantes de um produto (ordenadas por sort_order).
 */
async function listVariants(productId) {
  const { data, error } = await sb()
    .from('product_variants')
    .select('*')
    .eq('product_id', productId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    logger.error('Erro ao listar variantes', { service: SERVICE, productId, error: error.message });
    throw error;
  }
  return data || [];
}

/**
 * Busca uma variante por ID (com produto-pai).
 */
async function getVariant(variantId) {
  const { data, error } = await sb()
    .from('product_variants')
    .select('*, marketplace_products!inner(id, name, seller_id, price_brl, variant_attributes, active)')
    .eq('id', variantId)
    .single();

  if (error || !data) {
    const err = new Error('Variante não encontrada');
    err.status = 404;
    throw err;
  }
  return data;
}

/**
 * Cria uma variante para um produto.
 */
async function createVariant(productId, data, sellerId) {
  const product = await _requireProductOwnership(productId, sellerId);

  const normalized = normalizeAttributes(data.attributes);
  _validateAttributeKeys(product.variant_attributes, normalized);

  // Verificar duplicata antes do INSERT (trigger + UNIQUE index também barram)
  const { data: existing } = await sb()
    .from('product_variants')
    .select('id')
    .eq('product_id', productId)
    .eq('attributes', normalized)
    .maybeSingle();

  if (existing) {
    const err = new Error('Já existe uma variante com esses atributos para este produto.');
    err.status = 409;
    throw err;
  }

  const insertData = {
    product_id:     productId,
    attributes:     normalized,
    sku:            data.sku || null,
    gtin:           data.gtin || null,
    stock:          data.stock ?? 0,
    price_override: data.price_override ?? null,
    image_url:      data.image_url || null,
    is_available:   data.is_available ?? true,
    sort_order:     data.sort_order ?? 0,
  };

  const { data: variant, error } = await sb()
    .from('product_variants')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    logger.error('Erro ao criar variante', { service: SERVICE, productId, error: error.message });
    // Traduzir erros do trigger
    if (error.message?.includes('VARIANT_GUARD')) {
      const err = new Error(error.message);
      err.status = 400;
      throw err;
    }
    throw error;
  }

  logger.info('Variante criada', { service: SERVICE, variantId: variant.id, productId });
  return variant;
}

/**
 * Atualiza uma variante existente.
 */
async function updateVariant(variantId, updates, sellerId) {
  // Buscar variante para pegar product_id
  const existing = await getVariant(variantId);
  const productId = existing.product_id || existing.marketplace_products?.id;

  await _requireProductOwnership(productId, sellerId);

  const updateData = {};
  if (updates.attributes !== undefined) {
    const product = existing.marketplace_products;
    const normalized = normalizeAttributes(updates.attributes);
    _validateAttributeKeys(product.variant_attributes, normalized);
    updateData.attributes = normalized;
  }
  if (updates.sku !== undefined)            updateData.sku            = updates.sku;
  if (updates.gtin !== undefined)           updateData.gtin           = updates.gtin;
  if (updates.stock !== undefined)          updateData.stock          = updates.stock;
  if (updates.price_override !== undefined) updateData.price_override = updates.price_override;
  if (updates.image_url !== undefined)      updateData.image_url      = updates.image_url;
  if (updates.is_available !== undefined)   updateData.is_available   = updates.is_available;
  if (updates.sort_order !== undefined)     updateData.sort_order     = updates.sort_order;

  if (Object.keys(updateData).length === 0) {
    const err = new Error('Nenhum campo válido para atualizar.');
    err.status = 400;
    throw err;
  }

  updateData.updated_at = new Date().toISOString();

  const { data: variant, error } = await sb()
    .from('product_variants')
    .update(updateData)
    .eq('id', variantId)
    .select()
    .single();

  if (error) {
    logger.error('Erro ao atualizar variante', { service: SERVICE, variantId, error: error.message });
    if (error.message?.includes('VARIANT_GUARD')) {
      const err = new Error(error.message);
      err.status = 400;
      throw err;
    }
    throw error;
  }

  logger.info('Variante atualizada', { service: SERVICE, variantId });
  return variant;
}

/**
 * Remove uma variante (hard delete — CASCADE garante integridade).
 */
async function deleteVariant(variantId, sellerId) {
  const existing = await getVariant(variantId);
  const productId = existing.product_id || existing.marketplace_products?.id;

  await _requireProductOwnership(productId, sellerId);

  const { error } = await sb()
    .from('product_variants')
    .delete()
    .eq('id', variantId);

  if (error) {
    logger.error('Erro ao deletar variante', { service: SERVICE, variantId, error: error.message });
    throw error;
  }

  logger.info('Variante removida', { service: SERVICE, variantId, productId });
}

// ──────────────────────────────────────────────────────
// Batch Operations
// ──────────────────────────────────────────────────────

/**
 * Gera matriz cartesiana de variantes.
 * Ex: axes = { cor: ["rosa","azul"], tamanho: ["P","M","G"] }
 * → 6 variantes com combinações de todos os eixos.
 * Insere apenas combinações que ainda não existem.
 */
async function generateMatrix(productId, axes, sellerId) {
  const product = await _requireProductOwnership(productId, sellerId);

  // Validar que os eixos do axes correspondem ao variant_attributes do produto
  const axisNames = Object.keys(axes);
  if (!product.variant_attributes || !Array.isArray(product.variant_attributes)) {
    const err = new Error('Produto não possui variant_attributes definido.');
    err.status = 400;
    throw err;
  }

  // Verificar correspondência exata
  const productAxes = [...product.variant_attributes].sort();
  const requestAxes = [...axisNames].sort();
  if (JSON.stringify(productAxes) !== JSON.stringify(requestAxes)) {
    const err = new Error(`Eixos fornecidos (${requestAxes.join(',')}) não correspondem aos do produto (${productAxes.join(',')}).`);
    err.status = 400;
    throw err;
  }

  // Gerar produto cartesiano
  const values = axisNames.map(k => axes[k]);
  const combinations = cartesianProduct(values);

  // Buscar variantes existentes para evitar duplicatas
  const { data: existingVariants } = await sb()
    .from('product_variants')
    .select('attributes')
    .eq('product_id', productId);

  const existingSet = new Set(
    (existingVariants || []).map(v => JSON.stringify(normalizeAttributes(v.attributes)))
  );

  // Montar inserts para combinações novas
  const toInsert = [];
  let sortOrder = (existingVariants || []).length;

  for (const combo of combinations) {
    const attrs = {};
    axisNames.forEach((name, i) => { attrs[name] = combo[i]; });
    const normalized = normalizeAttributes(attrs);

    if (!existingSet.has(JSON.stringify(normalized))) {
      toInsert.push({
        product_id:     productId,
        attributes:     normalized,
        stock:          0,
        is_available:   true,
        sort_order:     sortOrder++,
      });
    }
  }

  if (toInsert.length === 0) {
    return { created: 0, total: (existingVariants || []).length, variants: [] };
  }

  const { data: created, error } = await sb()
    .from('product_variants')
    .insert(toInsert)
    .select();

  if (error) {
    logger.error('Erro ao gerar matriz de variantes', { service: SERVICE, productId, error: error.message });
    throw error;
  }

  logger.info('Matriz de variantes gerada', {
    service: SERVICE, productId, created: created.length,
    total: (existingVariants || []).length + created.length,
  });

  return {
    created: created.length,
    total: (existingVariants || []).length + created.length,
    variants: created,
  };
}

/**
 * Atualização em lote de variantes (stock, price, sku, available).
 * Recebe array de { id, stock?, price_override?, sku?, gtin?, is_available? }
 */
async function bulkUpdate(productId, variants, sellerId) {
  await _requireProductOwnership(productId, sellerId);

  const results = [];
  const errors  = [];

  for (const v of variants) {
    if (!v.id) {
      errors.push({ id: null, error: 'id é obrigatório' });
      continue;
    }

    const updateData = {};
    if (v.stock !== undefined)          updateData.stock          = v.stock;
    if (v.price_override !== undefined) updateData.price_override = v.price_override;
    if (v.sku !== undefined)            updateData.sku            = v.sku;
    if (v.gtin !== undefined)           updateData.gtin           = v.gtin;
    if (v.is_available !== undefined)   updateData.is_available   = v.is_available;
    if (v.image_url !== undefined)      updateData.image_url      = v.image_url;

    if (Object.keys(updateData).length === 0) {
      errors.push({ id: v.id, error: 'Nenhum campo para atualizar' });
      continue;
    }

    updateData.updated_at = new Date().toISOString();

    const { data: updated, error } = await sb()
      .from('product_variants')
      .update(updateData)
      .eq('id', v.id)
      .eq('product_id', productId) // segurança: só variantes deste produto
      .select()
      .single();

    if (error) {
      errors.push({ id: v.id, error: error.message });
    } else {
      results.push(updated);
    }
  }

  logger.info('Bulk update variantes', {
    service: SERVICE, productId,
    updated: results.length, errors: errors.length,
  });

  return { updated: results, errors };
}

/**
 * Toggle de disponibilidade.
 */
async function toggleAvailability(variantId, sellerId) {
  const existing = await getVariant(variantId);
  const productId = existing.product_id || existing.marketplace_products?.id;

  await _requireProductOwnership(productId, sellerId);

  const newValue = !existing.is_available;

  const { data: variant, error } = await sb()
    .from('product_variants')
    .update({ is_available: newValue, updated_at: new Date().toISOString() })
    .eq('id', variantId)
    .select()
    .single();

  if (error) {
    logger.error('Erro ao toggle variante', { service: SERVICE, variantId, error: error.message });
    throw error;
  }

  logger.info('Variante toggle', { service: SERVICE, variantId, is_available: newValue });
  return variant;
}

// ──────────────────────────────────────────────────────
// Public Store Queries
// ──────────────────────────────────────────────────────

/**
 * Variantes disponíveis para vitrine pública.
 * is_available=true AND stock > 0
 */
async function getAvailableVariants(productId) {
  const { data, error } = await sb()
    .from('product_variants')
    .select('id, attributes, sku, stock, price_override, image_url, is_available')
    .eq('product_id', productId)
    .eq('is_available', true)
    .gt('stock', 0)
    .order('sort_order', { ascending: true });

  if (error) {
    logger.error('Erro ao buscar variantes públicas', { service: SERVICE, productId, error: error.message });
    throw error;
  }
  return data || [];
}

/**
 * Verifica se um produto tem variantes e retorna info de preço para listagem.
 * Retorna { has_variants, variant_count, variant_price_range }
 */
async function getVariantSummary(productId, productPriceBrl) {
  const { data: variants, error } = await sb()
    .from('product_variants')
    .select('price_override, is_available, stock')
    .eq('product_id', productId)
    .eq('is_available', true)
    .gt('stock', 0);

  if (error || !variants || variants.length === 0) {
    return { has_variants: false, variant_count: 0, variant_price_range: null };
  }

  const prices = variants.map(v =>
    v.price_override != null ? Number(v.price_override) : Number(productPriceBrl)
  );

  return {
    has_variants: true,
    variant_count: variants.length,
    variant_price_range: {
      min: Math.min(...prices),
      max: Math.max(...prices),
    },
  };
}

// ──────────────────────────────────────────────────────
// Stock RPCs (wrappers para chamadas do service_role)
// ──────────────────────────────────────────────────────

/**
 * Decrementa estoque de variantes atomicamente (all-or-nothing).
 * @param {Array<{variant_id: string, qty: number}>} items
 * @returns {Array<{variant_id: string, new_stock: number}>}
 */
async function decrementStock(items) {
  if (!items || items.length === 0) return [];

  const { data, error } = await sb()
    .rpc('decrement_variant_stock', { p_items: items });

  if (error) {
    logger.error('Erro ao decrementar estoque de variantes', {
      service: SERVICE, items, error: error.message,
    });
    // Repassar a mensagem do RPC para o caller tratar
    const err = new Error(error.message);
    err.status = error.message?.includes('STOCK_INSUFFICIENT') ? 409 : 500;
    err.code = 'STOCK_INSUFFICIENT';
    throw err;
  }

  return data || [];
}

/**
 * Restaura estoque de variantes (compensação para cancelamento/expiração).
 * @param {Array<{variant_id: string, qty: number}>} items
 */
async function restoreStock(items) {
  if (!items || items.length === 0) return [];

  const { data, error } = await sb()
    .rpc('restore_variant_stock', { p_items: items });

  if (error) {
    logger.error('Erro ao restaurar estoque de variantes', {
      service: SERVICE, items, error: error.message,
    });
    throw error;
  }

  return data || [];
}

// ──────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────

/**
 * Produto cartesiano de arrays.
 * Ex: [[1,2],[3,4]] → [[1,3],[1,4],[2,3],[2,4]]
 */
function cartesianProduct(arrays) {
  if (arrays.length === 0) return [[]];
  return arrays.reduce(
    (acc, curr) => acc.flatMap(a => curr.map(v => [...a, v])),
    [[]]
  );
}

module.exports = {
  // CRUD
  listVariants,
  getVariant,
  createVariant,
  updateVariant,
  deleteVariant,
  // Batch
  generateMatrix,
  bulkUpdate,
  toggleAvailability,
  // Public
  getAvailableVariants,
  getVariantSummary,
  // Stock RPCs
  decrementStock,
  restoreStock,
  // Utils (exported for testing)
  normalizeAttributes,
};
