'use strict';

const { getSupabaseClient } = require('../config/supabase');
const mlAuthService = require('./mlAuthService');
const { logger } = require('../logger');

const SVC = 'mlSyncService';

const ML_API_BASE = 'https://api.mercadolibre.com';
const ITEMS_SEARCH_LIMIT = 50;
const ITEMS_MULTIGET_LIMIT = 20;
const BATCH_DELAY_MS = 200;

function sb() {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase client indisponivel');
    return client;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Mapeia category_id do ML para categoria ElosCloud.
 * TODO: Implementar mapeamento real de categorias ML -> ElosCloud.
 * Por agora retorna null — o vendedor categoriza depois no painel.
 */
function _mapCategory(/* mlCategoryId */) {
    return null;
}

/**
 * Extrai peso do objeto shipping do ML (gramas -> kg).
 */
function _extractWeight(shipping) {
    if (!shipping?.dimensions) return null;
    // ML retorna weight em gramas no campo dimensions
    const weightStr = shipping.dimensions;
    // O campo dimensions do ML pode ser string "10x20x30,500" (CxLxA,peso)
    // ou pode vir como objeto { height, width, length, weight }
    if (typeof weightStr === 'string') {
        const parts = weightStr.split(',');
        if (parts.length >= 2) {
            const grams = parseFloat(parts[1]);
            return isNaN(grams) ? null : grams / 1000;
        }
        return null;
    }
    if (shipping.dimensions?.weight != null) {
        const grams = parseFloat(shipping.dimensions.weight);
        return isNaN(grams) ? null : grams / 1000;
    }
    // Tenta o campo weight direto do shipping
    if (shipping.weight != null) {
        const grams = parseFloat(shipping.weight);
        return isNaN(grams) ? null : grams / 1000;
    }
    return null;
}

/**
 * Extrai dimensoes do objeto shipping do ML (cm).
 * Retorna JSONB { height, width, length } ou null.
 */
function _extractDimensions(shipping) {
    if (!shipping?.dimensions) return null;
    const dims = shipping.dimensions;
    // Formato string "CxLxA,peso"
    if (typeof dims === 'string') {
        const sizePart = dims.split(',')[0];
        if (!sizePart) return null;
        const parts = sizePart.split('x').map(Number);
        if (parts.length >= 3 && parts.every(v => !isNaN(v) && v > 0)) {
            return { height: parts[0], width: parts[1], length: parts[2] };
        }
        return null;
    }
    // Formato objeto { height, width, length }
    if (dims.height != null && dims.width != null && dims.length != null) {
        return {
            height: parseFloat(dims.height),
            width: parseFloat(dims.width),
            length: parseFloat(dims.length),
        };
    }
    return null;
}

/**
 * Busca atributo SELLER_SKU dos attributes do item ML.
 */
function _extractSku(attributes) {
    if (!Array.isArray(attributes)) return null;
    const sku = attributes.find(a => a.id === 'SELLER_SKU');
    return sku?.value_name || null;
}

/**
 * Delay helper para rate limiting.
 */
function _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Funcoes principais
// ---------------------------------------------------------------------------

/**
 * Busca a conta ML ativa do seller.
 * Retorna { id, external_user_id } ou null.
 */
async function _getAccount(sellerId) {
    const { data, error } = await sb()
        .from('seller_external_accounts')
        .select('id, external_user_id')
        .eq('seller_id', sellerId)
        .eq('platform', 'mercadolivre')
        .eq('account_status', 'active')
        .maybeSingle();

    if (error) throw error;
    return data;
}

/**
 * Busca todos os items do catalogo ML de um seller.
 * Pagina items/search (50 por vez), depois multiget (20 por vez).
 * Retorna array de items completos do ML.
 */
async function fetchMlCatalog(sellerId) {
    const accessToken = await mlAuthService.getAccessToken(sellerId);
    if (!accessToken) {
        throw new Error('ML nao conectado ou token expirado');
    }

    const account = await _getAccount(sellerId);
    if (!account) {
        throw new Error('Conta ML nao encontrada para este seller');
    }

    const mlUserId = account.external_user_id;

    // 1) Paginar items/search para coletar todos os IDs
    const allIds = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
        const searchUrl = `${ML_API_BASE}/users/${mlUserId}/items/search?limit=${ITEMS_SEARCH_LIMIT}&offset=${offset}`;
        const searchResp = await fetch(searchUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!searchResp.ok) {
            const errText = await searchResp.text();
            throw new Error(`ML items/search failed (${searchResp.status}): ${errText}`);
        }

        const searchData = await searchResp.json();
        const ids = searchData.results || [];
        allIds.push(...ids);

        const paging = searchData.paging || {};
        offset += ITEMS_SEARCH_LIMIT;
        hasMore = offset < (paging.total || 0);

        if (hasMore) {
            await _delay(BATCH_DELAY_MS);
        }
    }

    logger.info(`[${SVC}] fetchMlCatalog: ${allIds.length} item IDs found`, { sellerId });

    if (allIds.length === 0) return [];

    // 2) Multiget em batches de 20
    const allItems = [];

    for (let i = 0; i < allIds.length; i += ITEMS_MULTIGET_LIMIT) {
        const batchIds = allIds.slice(i, i + ITEMS_MULTIGET_LIMIT);
        const idsParam = batchIds.join(',');
        const itemsUrl = `${ML_API_BASE}/items?ids=${idsParam}`;

        const itemsResp = await fetch(itemsUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!itemsResp.ok) {
            const errText = await itemsResp.text();
            logger.warn(`[${SVC}] ML multiget failed for batch`, { status: itemsResp.status, errText });
            // Nao abortar tudo — skip batch com erro
            continue;
        }

        const batchResults = await itemsResp.json();
        for (const result of batchResults) {
            if (result.code === 200 && result.body) {
                allItems.push(result.body);
            } else {
                logger.warn(`[${SVC}] ML multiget item error`, { id: result.body?.id, code: result.code });
            }
        }

        // Rate limit entre batches
        if (i + ITEMS_MULTIGET_LIMIT < allIds.length) {
            await _delay(BATCH_DELAY_MS);
        }
    }

    logger.info(`[${SVC}] fetchMlCatalog: ${allItems.length} items fetched`, { sellerId });
    return allItems;
}

/**
 * Transforma um item ML no formato da RPC upsert_external_product.
 */
function mapMlProduct(mlItem, sellerId, externalAccountId) {
    return {
        p_seller_id: sellerId,
        p_source: 'ml',
        p_external_id: mlItem.id,
        p_external_account_id: externalAccountId,
        p_name: mlItem.title,
        p_description: null, // description requer chamada separada por item, skip por agora
        p_price_brl: mlItem.price,
        p_category: _mapCategory(mlItem.category_id),
        p_product_type: 'physical_product',
        p_stock: mlItem.available_quantity ?? 0,
        p_images: (mlItem.pictures || []).slice(0, 10).map(p => p.secure_url || p.url),
        p_weight_kg: _extractWeight(mlItem.shipping),
        p_dimensions_cm: _extractDimensions(mlItem.shipping),
        p_sku: _extractSku(mlItem.attributes),
    };
}

/**
 * Importa/sincroniza todos os produtos ML de um seller.
 * Commit individual — um erro nao para os outros.
 * Retorna { created, updated, errors, total }.
 */
async function importAll(sellerId) {
    const account = await _getAccount(sellerId);
    if (!account) {
        throw new Error('Conta ML nao encontrada para este seller');
    }

    const items = await fetchMlCatalog(sellerId);
    const externalAccountId = account.id;

    let created = 0;
    let updated = 0;
    const errors = [];

    for (const item of items) {
        try {
            const mapped = mapMlProduct(item, sellerId, externalAccountId);
            const { data, error } = await sb()
                .rpc('upsert_external_product', mapped)
                .single();

            if (error) {
                logger.warn(`[${SVC}] upsert error`, { externalId: item.id, error: error.message });
                errors.push({ external_id: item.id, error: error.message });
                continue;
            }

            if (data.was_inserted) {
                created++;
            } else {
                updated++;
            }
        } catch (err) {
            logger.warn(`[${SVC}] import item error`, { externalId: item.id, error: err.message });
            errors.push({ external_id: item.id, error: err.message });
        }
    }

    // Atualizar last_sync_at na conta externa
    await sb()
        .from('seller_external_accounts')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('id', externalAccountId);

    const result = { created, updated, errors, total: items.length };
    logger.info(`[${SVC}] importAll done`, { sellerId, ...result, errorCount: errors.length });
    return result;
}

/**
 * Sincroniza um unico produto ML.
 * Usado quando o ML envia webhook de mudanca de um item especifico.
 */
async function syncSingleProduct(sellerId, mlItemId) {
    const accessToken = await mlAuthService.getAccessToken(sellerId);
    if (!accessToken) {
        throw new Error('ML nao conectado ou token expirado');
    }

    const account = await _getAccount(sellerId);
    if (!account) {
        throw new Error('Conta ML nao encontrada para este seller');
    }

    const itemUrl = `${ML_API_BASE}/items/${mlItemId}`;
    const resp = await fetch(itemUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`ML GET /items/${mlItemId} failed (${resp.status}): ${errText}`);
    }

    const mlItem = await resp.json();
    const mapped = mapMlProduct(mlItem, sellerId, account.id);

    const { data, error } = await sb()
        .rpc('upsert_external_product', mapped)
        .single();

    if (error) throw error;

    logger.info(`[${SVC}] syncSingleProduct done`, {
        sellerId, mlItemId, wasInserted: data.was_inserted,
    });

    return { id: data.id, was_inserted: data.was_inserted };
}

/**
 * Atualiza apenas o status/active de um produto ML.
 * Mapeamento:
 *   active | under_review → active=true
 *   paused                → active=true, stock=0 (esgotado visivel)
 *   closed | inactive     → active=false (some do catalogo)
 */
async function syncProductStatus(sellerId, mlItemId, mlStatus) {
    const updateFields = { updated_at: new Date().toISOString() };

    switch (mlStatus) {
        case 'active':
        case 'under_review':
            updateFields.active = true;
            break;
        case 'paused':
            updateFields.active = true;
            updateFields.stock = 0;
            break;
        case 'closed':
        case 'inactive':
            updateFields.active = false;
            break;
        default:
            logger.warn(`[${SVC}] unknown ML status`, { sellerId, mlItemId, mlStatus });
            updateFields.active = false;
            break;
    }

    const { error } = await sb()
        .from('marketplace_products')
        .update(updateFields)
        .eq('seller_id', sellerId)
        .eq('external_id', mlItemId);

    if (error) throw error;

    logger.info(`[${SVC}] syncProductStatus done`, { sellerId, mlItemId, mlStatus, updateFields });
    return updateFields;
}

module.exports = {
    fetchMlCatalog,
    mapMlProduct,
    importAll,
    syncSingleProduct,
    syncProductStatus,
};
