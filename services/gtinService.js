'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const SVC = 'gtinService';

const OSCBR_BASE = 'https://api.oscbr.com/v3';

// ---------------------------------------------------------------------------
// Supabase helper
// ---------------------------------------------------------------------------

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponivel');
  return client;
}

// ---------------------------------------------------------------------------
// 1. validateGTIN — local check digit (mod-10 algorithm)
// ---------------------------------------------------------------------------

/**
 * Valida GTIN via algoritmo mod-10 (check digit).
 * Suporta EAN-8 (8 dígitos), EAN-13 (13 dígitos), UPC-A (12 dígitos).
 *
 * @param {string} code — código de barras (apenas dígitos)
 * @returns {{ valid: boolean, type: string|null }}
 */
function validateGTIN(code) {
  if (!code || typeof code !== 'string') {
    return { valid: false, type: null };
  }

  // Remove espaços e garante apenas dígitos
  const clean = code.trim();
  if (!/^\d+$/.test(clean)) {
    return { valid: false, type: null };
  }

  const len = clean.length;
  let type = null;

  if (len === 8) type = 'EAN-8';
  else if (len === 12) type = 'UPC-A';
  else if (len === 13) type = 'EAN-13';
  else if (len === 14) type = 'GTIN-14';
  else return { valid: false, type: null };

  // Mod-10 check digit: pesos alternados 1/3 da direita para esquerda
  const digits = clean.split('').map(Number);
  const checkDigit = digits[digits.length - 1];
  let sum = 0;
  for (let i = 0; i < digits.length - 1; i++) {
    // Contando da direita (excluindo check digit), posição ímpar peso 3, par peso 1
    const weight = (digits.length - 1 - i) % 2 === 0 ? 1 : 3;
    sum += digits[i] * weight;
  }
  const calculated = (10 - (sum % 10)) % 10;

  return { valid: calculated === checkDigit, type };
}

// ---------------------------------------------------------------------------
// 2. OSCBR Token — Basic→Bearer, cached 55min
// ---------------------------------------------------------------------------

let _oscbrToken = null;
let _oscbrTokenExpiry = 0;

/**
 * Obtém Bearer token da OSCBR (Basic Auth → token).
 * Cached por 55 minutos (token válido ~1h).
 * Auto-renew on 401 via forceRefresh param.
 *
 * @param {boolean} [forceRefresh=false] — força obtenção de novo token
 * @returns {Promise<string|null>} bearer token ou null se credenciais ausentes
 */
async function getOscbrToken(forceRefresh = false) {
  const user = process.env.GTIN_USER;
  const pass = process.env.GTIN_PASS;

  if (!user || !pass) {
    logger.warn(`[${SVC}] OSCBR credentials missing (GTIN_USER / GTIN_PASS)`);
    return null;
  }

  // Usa token cached se ainda válido
  if (!forceRefresh && _oscbrToken && Date.now() < _oscbrTokenExpiry) {
    return _oscbrToken;
  }

  try {
    const basicAuth = Buffer.from(`${user}:${pass}`).toString('base64');
    const resp = await fetch(`${OSCBR_BASE}/auth`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      logger.error(`[${SVC}] OSCBR auth failed (${resp.status})`, { errText });
      return null;
    }

    const data = await resp.json();
    _oscbrToken = data.token;
    // Cache por 55 minutos (token válido ~1h)
    _oscbrTokenExpiry = Date.now() + 55 * 60 * 1000;

    logger.info(`[${SVC}] OSCBR token obtained, cached 55min`);
    return _oscbrToken;
  } catch (err) {
    logger.error(`[${SVC}] OSCBR auth error`, { error: err.message });
    return null;
  }
}

// ---------------------------------------------------------------------------
// 3. Serial Queue — max 1 concurrent OSCBR request
// ---------------------------------------------------------------------------

const _queue = [];
let _processing = false;

/**
 * Enfileira uma função para execução sequencial.
 * Garante max 1 requisição concorrente à OSCBR (rate limit 20/min global).
 *
 * @param {Function} fn — async function a executar
 * @returns {Promise<*>} resultado da função
 */
function enqueueOscbr(fn) {
  return new Promise((resolve, reject) => {
    _queue.push({ fn, resolve, reject });
    _processQueue();
  });
}

async function _processQueue() {
  if (_processing || _queue.length === 0) return;
  _processing = true;

  while (_queue.length > 0) {
    const { fn, resolve, reject } = _queue.shift();
    try {
      const result = await fn();
      resolve(result);
    } catch (err) {
      reject(err);
    }
    // Pequeno delay entre chamadas para não estourar rate limit
    if (_queue.length > 0) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  _processing = false;
}

// ---------------------------------------------------------------------------
// 4. downloadAndStoreImage — fetch OSCBR image → Supabase Storage
// ---------------------------------------------------------------------------

/**
 * Baixa imagem da OSCBR e armazena no Supabase Storage (bucket product-catalog).
 * Nunca hotlinka URL da OSCBR — imagem é interna.
 *
 * @param {string} linkFoto — URL da imagem na OSCBR
 * @param {string} gtin — código EAN/UPC para nomear o arquivo
 * @returns {Promise<string|null>} URL pública do Storage ou null se falhar
 */
async function downloadAndStoreImage(linkFoto, gtin) {
  if (!linkFoto) return null;

  try {
    const token = await getOscbrToken();
    if (!token) return null;

    const resp = await fetch(linkFoto, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });

    // 204 = no image available
    if (resp.status === 204) {
      logger.info(`[${SVC}] OSCBR image 204 (no image) for ${gtin}`);
      return null;
    }

    if (!resp.ok) {
      logger.warn(`[${SVC}] OSCBR image download failed (${resp.status}) for ${gtin}`);
      return null;
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    if (buffer.length === 0) {
      logger.warn(`[${SVC}] OSCBR image empty for ${gtin}`);
      return null;
    }

    // Detecta content-type, fallback para PNG
    const contentType = resp.headers.get('content-type') || 'image/png';
    const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';
    const filePath = `${gtin}.${ext}`;

    const { error: uploadError } = await sb().storage
      .from('product-catalog')
      .upload(filePath, buffer, { contentType, upsert: true });

    if (uploadError) {
      logger.error(`[${SVC}] Storage upload failed for ${gtin}`, { error: uploadError.message });
      return null;
    }

    const { data: { publicUrl } } = sb().storage
      .from('product-catalog')
      .getPublicUrl(filePath);

    logger.info(`[${SVC}] Image stored for ${gtin}`, { publicUrl });
    return publicUrl;
  } catch (err) {
    logger.error(`[${SVC}] downloadAndStoreImage error for ${gtin}`, { error: err.message });
    return null;
  }
}

// ---------------------------------------------------------------------------
// 5. lookupOscbr — GET /products/{gtin}
// ---------------------------------------------------------------------------

/**
 * Consulta produto na OSCBR API v3.
 * Mapeia campos: nome→name, marca→brand, ncm→ncm(padStart), etc.
 *
 * NUNCA lança exceção — retorna null em caso de erro (graceful degradation).
 *
 * @param {string} gtin — código EAN/UPC
 * @returns {Promise<object|null>} dados do produto ou null
 */
async function lookupOscbr(gtin) {
  return enqueueOscbr(async () => {
    let token = await getOscbrToken();
    if (!token) return null;

    try {
      let resp = await fetch(`${OSCBR_BASE}/products/${gtin}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      // Auto-renew on 401
      if (resp.status === 401) {
        logger.info(`[${SVC}] OSCBR 401, refreshing token`);
        token = await getOscbrToken(true);
        if (!token) return null;

        resp = await fetch(`${OSCBR_BASE}/products/${gtin}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(10000),
        });
      }

      // 404 = produto não encontrado na base
      if (resp.status === 404) {
        logger.info(`[${SVC}] OSCBR product not found: ${gtin}`);
        return null;
      }

      // 429 = rate limited
      if (resp.status === 429) {
        logger.warn(`[${SVC}] OSCBR rate limited (429) for ${gtin}`);
        return null;
      }

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        logger.warn(`[${SVC}] OSCBR lookup failed (${resp.status}) for ${gtin}`, { errText });
        return null;
      }

      const data = await resp.json();

      // Mapear campos OSCBR → catálogo interno
      const ncmRaw = data.ncm;
      const ncm = ncmRaw != null ? String(ncmRaw).padStart(8, '0') : null;

      // Download e armazenamento da imagem (nunca hotlink)
      const imageUrl = await downloadAndStoreImage(data.link_foto, gtin);

      const product = {
        gtin: String(data.ean || gtin),
        name: data.nome || null,
        brand: data.marca || null,
        ncm,
        image_url: imageUrl,
        weight_kg: null,       // OSCBR não retorna peso
        dimensions_cm: null,   // OSCBR não retorna dimensões
        attributes: {},
        source: 'oscbr',
      };

      // Atributos extras → JSONB attributes
      if (data.categoria) product.attributes.categoria_oscbr = data.categoria;
      if (data.pais) product.attributes.pais = data.pais;
      if (data.ean_tipo) product.attributes.ean_tipo = data.ean_tipo;

      logger.info(`[${SVC}] OSCBR product found: ${gtin}`, { name: product.name, brand: product.brand });
      return product;
    } catch (err) {
      // Timeout, network error etc. — graceful degradation
      logger.error(`[${SVC}] OSCBR lookup error for ${gtin}`, { error: err.message });
      return null;
    }
  });
}

// ---------------------------------------------------------------------------
// 6. lookupCascade — main entry point
// ---------------------------------------------------------------------------

/**
 * Busca produto por GTIN em cascata:
 *   1. Validação local (check digit)
 *   2. Catálogo interno (platform_product_catalog)
 *   3. OSCBR API (se não encontrado internamente)
 *   4. Retorna { found: false } se nenhuma fonte tem o produto
 *
 * @param {string} gtin — código EAN/UPC
 * @returns {Promise<object>} { found: true, product } ou { found: false, error? }
 */
async function lookupCascade(gtin) {
  // Step 1: Validação local
  const validation = validateGTIN(gtin);
  if (!validation.valid) {
    return { found: false, error: 'invalid_gtin' };
  }

  // Step 2: Buscar no catálogo interno
  try {
    const { data: existing, error } = await sb()
      .from('platform_product_catalog')
      .select('*')
      .eq('gtin', gtin)
      .maybeSingle();

    if (!error && existing) {
      logger.info(`[${SVC}] Catalog hit for ${gtin}`, { source: existing.source, verified: existing.verified });
      return { found: true, product: existing };
    }
  } catch (err) {
    logger.error(`[${SVC}] Catalog lookup error for ${gtin}`, { error: err.message });
    // Continua para OSCBR mesmo se DB falhar
  }

  // Step 3: Consulta OSCBR
  const oscbrProduct = await lookupOscbr(gtin);
  if (oscbrProduct) {
    // Insere no catálogo interno
    try {
      const { data: inserted, error: insertErr } = await sb()
        .from('platform_product_catalog')
        .insert({
          gtin: oscbrProduct.gtin,
          name: oscbrProduct.name,
          brand: oscbrProduct.brand,
          ncm: oscbrProduct.ncm,
          image_url: oscbrProduct.image_url,
          weight_kg: oscbrProduct.weight_kg,
          dimensions_cm: oscbrProduct.dimensions_cm,
          attributes: oscbrProduct.attributes,
          source: 'oscbr',
          confirmations_count: 0,
          verified: false,
        })
        .select()
        .single();

      if (insertErr) {
        // Pode ser race condition (outro request inseriu primeiro) — tenta ler
        logger.warn(`[${SVC}] Catalog insert failed for ${gtin}`, { error: insertErr.message });
        const { data: fallback } = await sb()
          .from('platform_product_catalog')
          .select('*')
          .eq('gtin', gtin)
          .maybeSingle();
        if (fallback) {
          return { found: true, product: fallback };
        }
        // Retorna dados OSCBR mesmo sem persistir
        return { found: true, product: oscbrProduct };
      }

      logger.info(`[${SVC}] Catalog entry created from OSCBR for ${gtin}`);
      return { found: true, product: inserted };
    } catch (err) {
      logger.error(`[${SVC}] Catalog insert error for ${gtin}`, { error: err.message });
      // Retorna dados OSCBR mesmo sem persistir
      return { found: true, product: oscbrProduct };
    }
  }

  // Step 4: Não encontrado em nenhuma fonte
  logger.info(`[${SVC}] Product not found anywhere: ${gtin}`);
  return { found: false };
}

// ---------------------------------------------------------------------------
// 7. upsertCatalogOnSave — crowdsourced catalog enrichment
// ---------------------------------------------------------------------------

/**
 * Chamado quando seller salva produto com GTIN.
 * Enriquece o catálogo canônico com dados do merchant:
 *   - Se não existe: cria entrada source='merchant'
 *   - Se existe e dados batem: incrementa confirmations_count (verified=true se >=3)
 *   - Se existe e dados divergem: reset confirmations_count=0, verified=false, atualiza campos
 *
 * SOMENTE identidade + físicos. NUNCA preço, estoque ou imagens do seller.
 *
 * @param {string} gtin — código EAN/UPC
 * @param {{ name?: string, brand?: string, weight_kg?: number, dimensions_cm?: object }} merchantData
 */
async function upsertCatalogOnSave(gtin, merchantData) {
  if (!gtin) return;

  const validation = validateGTIN(gtin);
  if (!validation.valid) {
    logger.warn(`[${SVC}] upsertCatalogOnSave: invalid GTIN ${gtin}, skipping`);
    return;
  }

  try {
    const { data: existing } = await sb()
      .from('platform_product_catalog')
      .select('*')
      .eq('gtin', gtin)
      .maybeSingle();

    if (!existing) {
      // Cria entrada nova com dados do merchant
      const { error } = await sb()
        .from('platform_product_catalog')
        .insert({
          gtin,
          name: merchantData.name || 'Produto sem nome',
          brand: merchantData.brand || null,
          ncm: null,
          image_url: null,
          weight_kg: merchantData.weight_kg || null,
          dimensions_cm: merchantData.dimensions_cm || null,
          attributes: {},
          source: 'merchant',
          confirmations_count: 1,
          verified: false,
        });

      if (error) {
        logger.warn(`[${SVC}] upsertCatalogOnSave insert failed for ${gtin}`, { error: error.message });
      } else {
        logger.info(`[${SVC}] Catalog entry created from merchant for ${gtin}`);
      }
      return;
    }

    // Verifica se dados do merchant batem com o catálogo
    const matches = _merchantDataMatches(existing, merchantData);

    if (matches) {
      // Incrementa confirmações
      const newCount = (existing.confirmations_count || 0) + 1;
      const verified = newCount >= 3;

      const { error } = await sb()
        .from('platform_product_catalog')
        .update({
          confirmations_count: newCount,
          verified,
        })
        .eq('gtin', gtin);

      if (error) {
        logger.warn(`[${SVC}] upsertCatalogOnSave confirmation failed for ${gtin}`, { error: error.message });
      } else {
        logger.info(`[${SVC}] Catalog confirmed for ${gtin}`, { confirmations_count: newCount, verified });
      }
    } else {
      // Dados divergem — reset e atualiza
      const updatePayload = {
        confirmations_count: 0,
        verified: false,
      };
      // Atualiza apenas campos que o merchant forneceu
      if (merchantData.name) updatePayload.name = merchantData.name;
      if (merchantData.brand) updatePayload.brand = merchantData.brand;
      if (merchantData.weight_kg != null) updatePayload.weight_kg = merchantData.weight_kg;
      if (merchantData.dimensions_cm != null) updatePayload.dimensions_cm = merchantData.dimensions_cm;

      const { error } = await sb()
        .from('platform_product_catalog')
        .update(updatePayload)
        .eq('gtin', gtin);

      if (error) {
        logger.warn(`[${SVC}] upsertCatalogOnSave divergence update failed for ${gtin}`, { error: error.message });
      } else {
        logger.info(`[${SVC}] Catalog reset (merchant data diverged) for ${gtin}`);
      }
    }
  } catch (err) {
    logger.error(`[${SVC}] upsertCatalogOnSave error for ${gtin}`, { error: err.message });
  }
}

/**
 * Compara dados do merchant com o catálogo existente.
 * Compara apenas campos de identidade + físicos.
 * Tolerância: name case-insensitive trim, weight_kg com delta 0.01.
 */
function _merchantDataMatches(existing, merchantData) {
  // Nome (case-insensitive, trimmed)
  if (merchantData.name) {
    const existingName = (existing.name || '').toLowerCase().trim();
    const merchantName = merchantData.name.toLowerCase().trim();
    if (existingName !== merchantName) return false;
  }

  // Marca (case-insensitive, trimmed)
  if (merchantData.brand) {
    const existingBrand = (existing.brand || '').toLowerCase().trim();
    const merchantBrand = merchantData.brand.toLowerCase().trim();
    if (existingBrand !== merchantBrand) return false;
  }

  // Peso (delta 0.01 kg)
  if (merchantData.weight_kg != null && existing.weight_kg != null) {
    if (Math.abs(Number(existing.weight_kg) - Number(merchantData.weight_kg)) > 0.01) return false;
  }

  // Dimensões (cada eixo com delta 0.5 cm)
  if (merchantData.dimensions_cm != null && existing.dimensions_cm != null) {
    const ed = existing.dimensions_cm;
    const md = merchantData.dimensions_cm;
    for (const axis of ['length', 'width', 'height']) {
      if (ed[axis] != null && md[axis] != null) {
        if (Math.abs(Number(ed[axis]) - Number(md[axis])) > 0.5) return false;
      }
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  validateGTIN,
  lookupCascade,
  upsertCatalogOnSave,
  // Exported for testing / admin use
  lookupOscbr,
  getOscbrToken,
  downloadAndStoreImage,
};
