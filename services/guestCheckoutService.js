'use strict';

const crypto = require('crypto');
const { getSupabaseClient: sb } = require('../config/supabase');
const { logger } = require('../logger');
const asaasService = require('./asaasService');
const subscriptionService = require('./subscriptionService');
const { resolveStatusFlow } = require('./marketplaceService');
const variantService = require('./variantService');
const { geocodeAddress } = require('../utils/geocoding');

const LOG_TAG = 'GuestCheckoutService';

// ── Seller ID / handle resolver ──────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function _resolveSellerUuid(sellerIdOrHandle) {
  if (UUID_RE.test(sellerIdOrHandle)) return sellerIdOrHandle;
  const { data } = await sb()
    .from('seller_profiles')
    .select('id')
    .eq('username', sellerIdOrHandle)
    .neq('status', 'deleted')
    .single();
  if (!data) throw new Error('Loja não encontrada');
  return data.id;
}

// ── HMAC Helpers ─────────────────────────────────────────────────────────────

function _getSecret() {
  const secret = process.env.GUEST_ORDER_SECRET;
  if (!secret) throw new Error('GUEST_ORDER_SECRET env var not configured');
  return secret;
}

function generateGuestOrderToken(orderId) {
  return crypto.createHmac('sha256', _getSecret()).update(orderId).digest('hex');
}

function validateGuestOrderToken(orderId, token) {
  const expected = generateGuestOrderToken(orderId);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token || ''.padEnd(expected.length)));
}

// ── Payment methods by tier ──────────────────────────────────────────────────

function _getAvailablePaymentMethods(seller) {
  const plan = seller.plan_slug || 'lojista_basico';
  const isBrasileirinho = plan.startsWith('brasileirinho_');
  return isBrasileirinho ? ['pix', 'credit_card'] : ['pix'];
}

// ── Public read API ──────────────────────────────────────────────────────────

/**
 * Retorna dados públicos de um seller se ativo e aceita guest orders.
 */
async function getPublicSeller(sellerIdOrHandle) {
  const sellerId = await _resolveSellerUuid(sellerIdOrHandle);
  const supabase = sb();

  const { data, error } = await supabase
    .from('seller_profiles')
    .select(`
      id, username, business_name, trading_name, category, description,
      address_neighborhood, address_city, address_lat, address_lng,
      avg_rating, total_reviews,
      google_rating, google_reviews_count, google_business_name,
      google_url, google_business_status,
      fulfillment_types, business_hours, cover_image_url,
      seller_subtype, seller_subtype_custom, plan_slug, accepts_guest_orders, status,
      owner:user_id ( full_name, avatar_url )
    `)
    .eq('id', sellerId)
    .neq('status', 'deleted')
    .single();

  if (error || !data) throw new Error('Loja não encontrada');
  if (data.status !== 'active') throw new Error('Loja não está ativa');
  if (!data.accepts_guest_orders) throw new Error('Loja não aceita pedidos de visitantes');

  return {
    ...data,
    available_payment_methods: _getAvailablePaymentMethods(data),
  };
}

/**
 * Lista produtos ativos de um seller (público).
 * Suporta busca textual, filtro por categoria, faixa de preço e ordenação.
 *
 * @param {string} sellerId
 * @param {object} opts
 * @param {number}  opts.page       - Página (default 1)
 * @param {number}  opts.limit      - Limite por página (default 50)
 * @param {string}  opts.q          - Busca textual (ilike) em name e description
 * @param {string}  opts.category   - Filtro exato por categoria
 * @param {string}  opts.sort       - Ordenação: price_asc | price_desc | name_asc | newest (default)
 * @param {number}  opts.min_price  - Preço mínimo (inclusive)
 * @param {number}  opts.max_price  - Preço máximo (inclusive)
 */
async function listPublicProducts(sellerIdOrHandle, { page = 1, limit = 50, q, category, sort, min_price, max_price } = {}) {
  const sellerId = await _resolveSellerUuid(sellerIdOrHandle);
  const supabase = sb();
  const offset = (page - 1) * limit;

  let query = supabase
    .from('marketplace_products')
    .select('id, name, description, price_brl, images, category, product_type, listing_type, duration_minutes, fulfillment_types, active, seller_id, created_at, menu_category_id, variant_attributes', { count: 'exact' })
    .eq('seller_id', sellerId)
    .eq('active', true);

  // Text search — ilike on name OR description
  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    query = query.or(`name.ilike.${term},description.ilike.${term}`);
  }

  // Category exact match
  if (category && category.trim()) {
    query = query.eq('category', category.trim());
  }

  // Price range
  if (min_price != null && !isNaN(min_price)) {
    query = query.gte('price_brl', Number(min_price));
  }
  if (max_price != null && !isNaN(max_price)) {
    query = query.lte('price_brl', Number(max_price));
  }

  // Sort
  switch (sort) {
    case 'price_asc':
      query = query.order('price_brl', { ascending: true });
      break;
    case 'price_desc':
      query = query.order('price_brl', { ascending: false });
      break;
    case 'name_asc':
      query = query.order('name', { ascending: true });
      break;
    case 'newest':
    default:
      query = query.order('created_at', { ascending: false });
      break;
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);

  if (error) throw new Error(`Erro ao buscar produtos: ${error.message}`);

  // Enriquecer com dados de variantes (ELOS-BE-014)
  const products = data || [];
  const productsWithVariants = products.filter(p =>
    p.variant_attributes && Array.isArray(p.variant_attributes) && p.variant_attributes.length > 0
  );

  if (productsWithVariants.length > 0) {
    const productIdsWithVariants = productsWithVariants.map(p => p.id);
    const { data: allVariants } = await supabase
      .from('product_variants')
      .select('product_id, price_override, is_available, stock')
      .in('product_id', productIdsWithVariants)
      .eq('is_available', true)
      .gt('stock', 0);

    // Agrupar variantes por product_id
    const variantsByProduct = {};
    for (const v of allVariants || []) {
      if (!variantsByProduct[v.product_id]) variantsByProduct[v.product_id] = [];
      variantsByProduct[v.product_id].push(v);
    }

    for (const p of products) {
      const pVariants = variantsByProduct[p.id];
      if (pVariants && pVariants.length > 0) {
        const prices = pVariants.map(v =>
          v.price_override != null ? Number(v.price_override) : Number(p.price_brl)
        );
        p.has_variants = true;
        p.variant_price_range = { min: Math.min(...prices), max: Math.max(...prices) };
      } else {
        p.has_variants = !!p.variant_attributes?.length;
        p.variant_price_range = null;
      }
    }
  }

  return { products, total: count || 0, page, limit };
}

/**
 * Lista categorias de produto de um seller (público).
 * Retorna apenas categorias ativas, ordenadas por sort_order.
 */
async function listPublicMenuCategories(sellerIdOrHandle) {
  const sellerId = await _resolveSellerUuid(sellerIdOrHandle);
  const { data, error } = await sb()
    .from('menu_categories')
    .select('id, name, sort_order')
    .eq('seller_id', sellerId)
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if (error) throw new Error(`Erro ao buscar categorias: ${error.message}`);
  return data || [];
}

/**
 * Detalhe de um produto com modifiers (público).
 */
async function getPublicProduct(sellerIdOrHandle, productId) {
  const sellerId = await _resolveSellerUuid(sellerIdOrHandle);
  const supabase = sb();

  const { data: product, error } = await supabase
    .from('marketplace_products')
    .select('*')
    .eq('id', productId)
    .eq('seller_id', sellerId)
    .eq('active', true)
    .single();

  if (error || !product) throw new Error('Produto não encontrado');

  // Buscar modifiers
  const { data: modifiers } = await supabase
    .from('product_modifiers')
    .select('*')
    .eq('product_id', productId)
    .eq('active', true)
    .order('sort_order', { ascending: true });

  // Buscar variantes disponíveis (ELOS-BE-014)
  let variants = [];
  const hasVariants = product.variant_attributes && Array.isArray(product.variant_attributes) && product.variant_attributes.length > 0;
  if (hasVariants) {
    const { data: variantData } = await supabase
      .from('product_variants')
      .select('id, attributes, sku, stock, price_override, image_url, is_available')
      .eq('product_id', productId)
      .eq('is_available', true)
      .gt('stock', 0)
      .order('sort_order', { ascending: true });
    variants = variantData || [];
  }

  return { ...product, modifiers: modifiers || [], variants };
}

// ── Geocoding helpers (fallback chain) ───────────────────────────────────────

/**
 * BrasilAPI CEP v2 — retorna { lat, lng } ou null.
 * Muitos CEPs retornam coordinates vazio; nesse caso retorna null.
 */
async function _geocodeCepBrasil(cep) {
  if (!cep) return null;
  const raw = String(cep).replace(/\D/g, '');
  if (raw.length !== 8) return null;
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${raw}`);
    if (!res.ok) return null;
    const data = await res.json();
    const coords = data?.location?.coordinates;
    if (!coords?.latitude || !coords?.longitude) return null;
    return { lat: Number(coords.latitude), lng: Number(coords.longitude) };
  } catch {
    return null;
  }
}

/**
 * Nominatim/OpenStreetMap — geocoding grátis, sem API key.
 * Rate limit: 1 req/s (uso pontual em checkout, não em batch).
 */
async function _geocodeNominatim(addressString) {
  if (!addressString) return null;
  try {
    const params = new URLSearchParams({
      q: addressString,
      format: 'json',
      countrycodes: 'br',
      limit: '1',
    });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { 'User-Agent': 'ElosCloud/1.0 (delivery-estimate)' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.length || !data[0]?.lat || !data[0]?.lon) return null;
    logger.info('[GuestCheckoutService] Endereço geocodificado via Nominatim', {
      address: addressString.substring(0, 60),
      lat: data[0].lat,
      lng: data[0].lon,
    });
    return { lat: Number(data[0].lat), lng: Number(data[0].lon) };
  } catch {
    return null;
  }
}

// ── Delivery estimate for guests ─────────────────────────────────────────────

/**
 * Busca entregadores disponíveis e preços para um endereço de entrega guest.
 * Cadeia de resolução de coordenadas:
 *   1. lat/lng diretos (BrasilAPI CEP no frontend)
 *   2. BrasilAPI CEP v2 no backend (retry — caso frontend não tenha recebido coords)
 *   3. Nominatim/OpenStreetMap (endereço textual, grátis, sem API key)
 *   4. Google Geocoding (endereço textual, requer GOOGLE_MAPS_API_KEY)
 */
async function estimateDeliveryForGuest(sellerIdOrHandle, { lat, lng, address, city, state, cep } = {}) {
  const sellerId = await _resolveSellerUuid(sellerIdOrHandle);
  const fn = 'estimateDeliveryForGuest';
  const supabase = sb();

  // 1. Carrega seller com coordenadas
  const { data: seller, error: sellerErr } = await supabase
    .from('seller_profiles')
    .select('id, address_lat, address_lng, address_city, address_state, status, accepts_guest_orders')
    .eq('id', sellerId)
    .single();

  if (sellerErr || !seller) throw new Error('Loja não encontrada');
  if (seller.status !== 'active') throw new Error('Loja não está ativa');
  if (!seller.accepts_guest_orders) throw new Error('Loja não aceita pedidos de visitantes');
  if (!seller.address_lat || !seller.address_lng) {
    throw new Error('Loja sem coordenadas cadastradas — delivery indisponível');
  }

  // 2. Resolve coordenadas — cadeia de fallback
  let coords = null;

  // 2a. Coordenadas diretas (BrasilAPI no frontend retornou lat/lng)
  if (lat && lng) {
    coords = { lat: Number(lat), lng: Number(lng) };
  }

  // 2b. BrasilAPI CEP v2 no backend (retry — muitos CEPs retornam coords vazio no frontend)
  if (!coords && cep) {
    coords = await _geocodeCepBrasil(cep);
  }

  // 2c. Nominatim/OpenStreetMap — grátis, sem API key
  if (!coords && address) {
    coords = await _geocodeNominatim(address);
  }

  // 2d. Google Geocoding — requer GOOGLE_MAPS_API_KEY
  if (!coords && address) {
    coords = await geocodeAddress(address);
  }

  if (!coords) {
    logger.warn(`[${fn}] Todas as tentativas de geocoding falharam`, { cep, address: address?.substring(0, 60) });
    return { available: false, reason: 'geocoding_failed', candidates: [] };
  }

  // 3. Busca entregadores disponíveis
  const deliveryService = require('./deliveryService');
  const candidates = await deliveryService.findEligibleDeliverers(
    seller.address_lat, seller.address_lng,
    coords.lat, coords.lng,
    {
      weightKg: 0,
      isFragile: false,
      limit: 10,
      pickupCity: seller.address_city,
      destCity: city || null,
      destState: state || seller.address_state,
    }
  );

  if (!candidates.length) {
    return { available: false, reason: 'no_deliverers', delivery_lat: coords.lat, delivery_lng: coords.lng, candidates: [] };
  }

  // 4. Retorna lista sanitizada (sem user_id/photo — privacidade)
  const sanitized = candidates.map(c => ({
    service_id: c.service_id,
    vehicle_type: c.vehicle_type,
    estimated_fee: c.estimated_fee,
    deliverer_name: c.deliverer_name || 'Entregador',
    eta_minutes: Math.round(c.total_km * 2.5) + 8,
    distance_km: +(c.pickup_to_dest_km || c.total_km || 0).toFixed(1),
  }));

  logger.info(`[${fn}] ${sanitized.length} candidatos encontrados`, { sellerId, destLat: coords.lat, destLng: coords.lng });

  return {
    available: true,
    delivery_lat: coords.lat,
    delivery_lng: coords.lng,
    candidates: sanitized,
  };
}

// ── Guest order creation ─────────────────────────────────────────────────────

/**
 * Cria pedido para guest buyer.
 * Fluxo: valida seller → valida items → upsert guest_buyer → insert order → retorna token.
 */
async function createGuestOrder(sellerIdOrHandle, {
  items, guest, fulfillment_type = 'pickup', delivery_address,
  delivery_fee: requestedDeliveryFee, delivery_lat, delivery_lng,
  preferred_deliverer_service_id,
  // Shipping nacional (SHIP-W2)
  shipping_service_id, shipping_fee, shipping_postal_code,
}) {
  const sellerId = await _resolveSellerUuid(sellerIdOrHandle);
  const fn = 'createGuestOrder';
  const supabase = sb();

  // 1. Valida seller
  const { data: seller, error: sellerErr } = await supabase
    .from('seller_profiles')
    .select('id, user_id, status, category, accepts_guest_orders, plan_slug, max_coins_per_order, coins_discount_rate, guarantee_fund_mode')
    .eq('id', sellerId)
    .single();

  if (sellerErr || !seller) throw new Error('Vendedor não encontrado');
  if (seller.status !== 'active') throw new Error('Vendedor não está ativo');
  if (!seller.accepts_guest_orders) throw new Error('Vendedor não aceita pedidos de visitantes');

  // Verifica bloqueio por inadimplência
  const isBlocked = await subscriptionService.isSellerBlocked(seller.user_id);
  if (isBlocked) throw new Error('Vendedor com pendências financeiras');

  // 2. Valida e calcula totais dos items (lógica replicada de _calculateOrderTotals)
  if (!items?.length) throw new Error('items não pode ser vazio');

  const productIds = items.map(i => i.product_id);
  const { data: products, error: prodErr } = await supabase
    .from('marketplace_products')
    .select('id, name, price_brl, active, seller_id, variant_attributes')
    .in('id', productIds);

  if (prodErr) throw new Error(`Erro ao buscar produtos: ${prodErr.message}`);

  const productMap = {};
  for (const p of products || []) {
    if (!p.active) throw new Error(`Produto "${p.name}" não está disponível`);
    if (p.seller_id !== sellerId) throw new Error(`Produto "${p.name}" não pertence a este vendedor`);
    productMap[p.id] = p;
  }

  // Buscar variantes referenciadas (ELOS-BE-014)
  const variantIds = items.map(i => i.variant_id).filter(Boolean);
  const variantMap = {};
  if (variantIds.length > 0) {
    const { data: variants, error: vErr } = await supabase
      .from('product_variants')
      .select('id, product_id, attributes, price_override, is_available, stock')
      .in('id', variantIds);
    if (vErr) throw new Error(`Erro ao buscar variantes: ${vErr.message}`);
    for (const v of variants || []) { variantMap[v.id] = v; }
  }

  const orderItems = items.map(i => {
    const p = productMap[i.product_id];
    if (!p) throw new Error(`Produto ${i.product_id} não encontrado`);
    const qty = Math.max(1, parseInt(i.qty) || 1);

    // Validação de variante (ELOS-BE-014)
    const hasVariants = p.variant_attributes && Array.isArray(p.variant_attributes) && p.variant_attributes.length > 0;
    if (hasVariants && !i.variant_id) {
      throw new Error(`Produto "${p.name}" possui variantes — variant_id é obrigatório`);
    }
    if (!hasVariants && i.variant_id) {
      throw new Error(`Produto "${p.name}" não possui variantes — variant_id deve ser omitido`);
    }

    const item = { product_id: p.id, name: p.name, qty, unit_price_brl: Number(p.price_brl) };

    if (i.variant_id) {
      const v = variantMap[i.variant_id];
      if (!v) throw new Error(`Variante ${i.variant_id} não encontrada`);
      if (v.product_id !== p.id) throw new Error(`Variante ${i.variant_id} não pertence ao produto "${p.name}"`);
      if (!v.is_available) throw new Error(`Variante ${i.variant_id} não está disponível`);
      item.unit_price_brl = v.price_override != null ? Number(v.price_override) : Number(p.price_brl);
      item.variant_id = v.id;
      item.variant_attributes = v.attributes;
    }

    return item;
  });

  const subtotal_brl = +orderItems.reduce((sum, i) => sum + i.unit_price_brl * i.qty, 0).toFixed(2);

  // Guest: no coins, no guarantee fund
  const coins_discount_brl = 0;
  const guarantee_fee_brl = 0;

  // Delivery fee: validate if provided (local_delivery), otherwise 0 (pickup)
  let delivery_fee = 0;
  if (fulfillment_type === 'local_delivery' && requestedDeliveryFee > 0) {
    delivery_fee = +Number(requestedDeliveryFee).toFixed(2);
    if (delivery_fee > 500) throw new Error('Frete acima do limite permitido');
  }

  // Shipping nacional (SHIP-W2): validação + freight_mode
  let validatedShippingFee = 0;
  let shippingQuoteData = null;
  let shippingEstimatedDays = null;
  if (fulfillment_type === 'shipping') {
    // 1. Seller shipping config
    const { data: shippingConfig } = await supabase
      .from('seller_shipping_config')
      .select('*')
      .eq('seller_id', sellerId)
      .maybeSingle();

    if (!shippingConfig?.accepts_national_shipping) {
      throw new Error('Vendedor não aceita envio nacional por transportadora');
    }
    if (!shipping_service_id) throw new Error('shipping_service_id é obrigatório para envio nacional');
    if (!shipping_postal_code) throw new Error('shipping_postal_code (CEP destino) é obrigatório para envio nacional');
    if (!delivery_address) throw new Error('delivery_address é obrigatório para envio nacional');

    // 2. Validate product dimensions
    const shippingProductIds = items.map(i => i.product_id);
    const { data: shippingProducts } = await supabase
      .from('marketplace_products')
      .select('id, name, weight_kg, dimensions_cm, product_type')
      .in('id', shippingProductIds);

    for (const p of (shippingProducts || [])) {
      if (p.product_type !== 'physical_product') {
        throw new Error(`Produto "${p.name}" não é elegível para envio por transportadora`);
      }
      if (!p.dimensions_cm?.width || !p.dimensions_cm?.height || !p.dimensions_cm?.length) {
        throw new Error(`Produto "${p.name}" não tem dimensões cadastradas para envio`);
      }
    }

    // 3. Validate fee via ME (±10% tolerance)
    const meProducts = (shippingProducts || []).map(p => {
      const item = items.find(i => i.product_id === p.id);
      return {
        id: p.id,
        width: p.dimensions_cm.width,
        height: p.dimensions_cm.height,
        length: p.dimensions_cm.length,
        weight: p.weight_kg,
        insurance_value: 0,
        quantity: item?.qty || 1,
      };
    });

    try {
      const melhorEnvioService = require('./melhorEnvioService');
      const quotes = await melhorEnvioService.calculateShipping(
        shippingConfig.origin_postal_code,
        shipping_postal_code,
        meProducts,
        String(shipping_service_id)
      );

      const selectedQuote = quotes.find(q => q.serviceId === shipping_service_id);
      if (!selectedQuote) {
        throw new Error(`Serviço de frete ${shipping_service_id} não disponível para esta rota`);
      }

      const serverFee = parseFloat(selectedQuote.customPrice || selectedQuote.price);
      const clientFee = Number(shipping_fee);
      const tolerance = 0.10;

      if (clientFee < serverFee * (1 - tolerance) || clientFee > serverFee * (1 + tolerance)) {
        const err = new Error(`Valor do frete diverge do calculado (esperado: R$${serverFee.toFixed(2)}, recebido: R$${clientFee.toFixed(2)})`);
        err.code = 'SHIPPING_FEE_MISMATCH';
        throw err;
      }
      validatedShippingFee = serverFee;
      shippingQuoteData = selectedQuote;
      shippingEstimatedDays = selectedQuote.deliveryDays || null;
    } catch (meErr) {
      if (meErr.code === 'SHIPPING_FEE_MISMATCH') throw meErr;
      logger.warn(`[${fn}] ME validation failed, degraded mode`, { error: meErr.message });
      if (Number(shipping_fee) >= 5 && Number(shipping_fee) <= 500) {
        validatedShippingFee = Number(shipping_fee);
      } else {
        throw new Error('Não foi possível validar o frete. Tente novamente.');
      }
    }

    // 4. Apply freight_mode (unified — same policy for local + shipping)
    const { data: sellerProfile } = await supabase
      .from('seller_profiles')
      .select('freight_mode, freight_split_ratio')
      .eq('id', sellerId)
      .single();

    const freightMode = sellerProfile?.freight_mode || 'buyer_pays';
    const splitRatio = sellerProfile?.freight_split_ratio ?? 1.0;

    const { data: freightCalc } = await supabase.rpc('calculate_buyer_freight', {
      p_accepted_fee: validatedShippingFee,
      p_freight_mode: freightMode,
      p_split_ratio: splitRatio,
    });

    delivery_fee = freightCalc?.buyer_freight ?? validatedShippingFee;
  }

  const total_brl = +Math.max(0, subtotal_brl + delivery_fee + guarantee_fee_brl - coins_discount_brl).toFixed(2);

  // Comissão
  const commissionInfo = await subscriptionService.getCommissionRate(seller.user_id, { context: 'guest_order' });
  const commission_brl = +(total_brl * commissionInfo.rate).toFixed(2);

  // 3. Upsert guest_buyer por email
  if (!guest?.full_name || !guest?.email || !guest?.phone) {
    throw new Error('Nome, email e telefone são obrigatórios para visitante');
  }

  const normalizedEmail = guest.email.toLowerCase().trim();
  const normalizedPhone = guest.phone.replace(/\D/g, '');

  // Busca guest_buyer existente por email (functional index lower(email))
  const { data: existing } = await supabase
    .from('guest_buyers')
    .select('id')
    .ilike('email', normalizedEmail)
    .single();

  let guestBuyerId;
  if (existing) {
    // Atualiza nome/telefone do guest existente
    await supabase
      .from('guest_buyers')
      .update({ full_name: guest.full_name, phone: normalizedPhone })
      .eq('id', existing.id);
    guestBuyerId = existing.id;
  } else {
    // Insere novo guest_buyer
    const { data: newGuest, error: insertErr } = await supabase
      .from('guest_buyers')
      .insert({ full_name: guest.full_name, email: normalizedEmail, phone: normalizedPhone })
      .select('id')
      .single();

    if (insertErr) {
      logger.error(`[${fn}] Erro ao inserir guest_buyer`, { error: insertErr.message });
      throw new Error('Erro ao registrar dados do visitante');
    }
    guestBuyerId = newGuest.id;
  }

  // 4. Buyer snapshot (guest version)
  const buyer_snapshot = {
    full_name: guest.full_name,
    email: guest.email,
    phone: guest.phone,
    is_guest: true,
  };

  // 5. Insert order
  // [007] Resolve status flow
  const resolvedFulfillment = fulfillment_type || 'pickup';
  const statusFlow = resolveStatusFlow(seller.category, resolvedFulfillment);

  const { data: order, error: orderErr } = await supabase
    .from('marketplace_orders')
    .insert({
      buyer_id: null,
      guest_buyer_id: guestBuyerId,
      seller_id: sellerId,
      items: orderItems,
      subtotal_brl,
      coins_used: 0,
      coins_discount_brl,
      delivery_fee,
      guarantee_fee_brl,
      guarantee_fund_mode: 'none',
      total_brl,
      commission_brl,
      payment_method: null,
      status: 'pending',
      status_flow: statusFlow,
      fulfillment_type: resolvedFulfillment,
      ...((fulfillment_type === 'local_delivery' || fulfillment_type === 'shipping') && delivery_address && { delivery_address }),
      ...(fulfillment_type === 'local_delivery' && delivery_lat && { delivery_lat }),
      ...(fulfillment_type === 'local_delivery' && delivery_lng && { delivery_lng }),
      ...(preferred_deliverer_service_id && { preferred_deliverer_service_id }),
      buyer_snapshot,
    })
    .select('id')
    .single();

  if (orderErr) {
    logger.error(`[${fn}] Erro ao criar pedido guest`, { error: orderErr.message });
    throw new Error('Erro ao criar pedido');
  }

  // 5b. Decrementar estoque de variantes atomicamente (ELOS-BE-014)
  const variantStockItems = orderItems
    .filter(i => i.variant_id)
    .map(i => ({ variant_id: i.variant_id, qty: i.qty }));

  if (variantStockItems.length > 0) {
    try {
      await variantService.decrementStock(variantStockItems);
    } catch (stockErr) {
      // Compensação: cancela pedido recém-criado
      await supabase
        .from('marketplace_orders')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', order.id);

      logger.error(`[${fn}] Variant stock decrement failed`, { orderId: order.id, error: stockErr.message });
      const err = new Error(`Estoque insuficiente: ${stockErr.message}`);
      err.code = 'STOCK_INSUFFICIENT';
      throw err;
    }
  }

  // 5c. Create shipping_orders record for shipping orders (SHIP-W2)
  if (fulfillment_type === 'shipping' && validatedShippingFee > 0) {
    try {
      const SERVICE_NAMES = { 1: 'PAC', 2: 'SEDEX', 3: '.Package', 4: '.Com', 17: 'Mini Envios' };
      const CARRIER_NAMES = { 1: 'Correios', 2: 'Correios', 3: 'JadLog', 4: 'JadLog', 17: 'Correios' };

      await supabase.from('shipping_orders').insert({
        order_id: order.id,
        me_service_id: shipping_service_id,
        carrier_name: CARRIER_NAMES[shipping_service_id] || 'Desconhecido',
        service_name: SERVICE_NAMES[shipping_service_id] || 'Desconhecido',
        status: 'quoted',
        quoted_price: validatedShippingFee,
        shipping_fee: delivery_fee,
        estimated_days: shippingEstimatedDays,
        me_raw_response: shippingQuoteData,
      });
    } catch (shErr) {
      logger.error(`[${fn}] shipping_orders insert failed`, { orderId: order.id, error: shErr.message });
    }
  }

  // 6. Gerar token HMAC e salvar
  const guestOrderToken = generateGuestOrderToken(order.id);
  await supabase
    .from('marketplace_orders')
    .update({ guest_order_token: guestOrderToken })
    .eq('id', order.id);

  logger.info(`[${fn}] Guest order criado`, {
    orderId: order.id, sellerId, guestBuyerId, total_brl,
  });

  return {
    order: { id: order.id, total_brl, subtotal_brl, items: orderItems, status: 'pending' },
    guestOrderToken,
  };
}

// ── Guest payment initiation ─────────────────────────────────────────────────

/**
 * Inicia pagamento para pedido guest (PIX ou cartão).
 */
async function initiateGuestPayment(orderId, token, { payment_method, card_data }) {
  const fn = 'initiateGuestPayment';
  const supabase = sb();

  // 1. Validar token HMAC
  if (!validateGuestOrderToken(orderId, token)) {
    throw new Error('Token de pedido inválido');
  }

  // 2. Buscar pedido
  const { data: order, error } = await supabase
    .from('marketplace_orders')
    .select('*, seller:seller_id ( id, user_id, plan_slug, business_name )')
    .eq('id', orderId)
    .single();

  if (error || !order) throw new Error('Pedido não encontrado');
  if (order.buyer_id !== null) throw new Error('Este não é um pedido de visitante');
  if (order.status !== 'pending') throw new Error('Pedido não está pendente de pagamento');

  // 3. Buscar guest_buyer
  const { data: guestBuyer } = await supabase
    .from('guest_buyers')
    .select('id, full_name, email, phone')
    .eq('id', order.guest_buyer_id)
    .single();

  if (!guestBuyer) throw new Error('Dados do visitante não encontrados');

  // 4. Validar payment_method pelo tier do seller
  const availableMethods = _getAvailablePaymentMethods(order.seller);
  if (!availableMethods.includes(payment_method)) {
    throw new Error(`Método de pagamento "${payment_method}" não disponível para este vendedor`);
  }

  // 5. Criar/buscar customer Asaas
  const asaasCustomer = await asaasService.createCustomer({
    name: guestBuyer.full_name,
    email: guestBuyer.email,
    phone: guestBuyer.phone,
    externalReference: `guest_${guestBuyer.id}`,
  });

  const externalReference = `marketplace_order_${orderId}`;

  // 6. Processar pagamento
  let paymentResult;

  if (payment_method === 'pix') {
    const pixCharge = await asaasService.createPixCharge({
      customerId: asaasCustomer.id,
      value: order.total_brl,
      description: `Pedido #${orderId.substring(0, 8)} - ${order.seller.business_name}`,
      externalReference,
    });

    paymentResult = {
      method: 'pix',
      pixCopiaECola: pixCharge.pixCopiaECola,
      encodedImage: pixCharge.encodedImage,
      expiresAt: pixCharge.expirationDate,
      paymentId: pixCharge.id,
    };

    // Salvar dados PIX no pedido
    await supabase
      .from('marketplace_orders')
      .update({
        payment_method: 'pix',
        payment_id: pixCharge.id,
        payment_url: pixCharge.invoiceUrl || null,
      })
      .eq('id', orderId);

  } else if (payment_method === 'credit_card') {
    if (!card_data) throw new Error('Dados do cartão são obrigatórios');

    const cardCharge = await asaasService.createCardCharge({
      customerId: asaasCustomer.id,
      value: order.total_brl,
      description: `Pedido #${orderId.substring(0, 8)} - ${order.seller.business_name}`,
      externalReference,
      creditCard: {
        holderName: card_data.holderName,
        number: card_data.number,
        expiryMonth: card_data.expiryMonth,
        expiryYear: card_data.expiryYear,
        ccv: card_data.ccv,
      },
      creditCardHolderInfo: {
        name: guestBuyer.full_name,
        email: guestBuyer.email,
        phone: guestBuyer.phone,
        postalCode: card_data.postalCode || '00000000',
      },
    });

    paymentResult = {
      method: 'credit_card',
      cardStatus: cardCharge.status,
      paymentId: cardCharge.paymentId,
    };

    // Se confirmação imediata, marcar como pago
    const paidStatuses = ['CONFIRMED', 'RECEIVED'];
    const newStatus = paidStatuses.includes(cardCharge.status) ? 'paid' : 'pending';

    await supabase
      .from('marketplace_orders')
      .update({
        payment_method: 'credit_card',
        payment_id: cardCharge.paymentId,
        payment_url: cardCharge.invoiceUrl || null,
        ...(newStatus === 'paid' && { status: 'paid' }),
      })
      .eq('id', orderId);

    // Notificar seller se pagamento já confirmado
    if (newStatus === 'paid') {
      _notifySellerNewOrder(order, guestBuyer);

      // GST-024: notify guest buyer via email (fire-and-forget)
      _notifyGuestBuyerEmail(order, 'paid');

      // Auto-trigger delivery for local_delivery orders
      if (order.fulfillment_type === 'local_delivery') {
        const { autoTriggerDelivery } = require('./marketplaceService');
        setImmediate(() => autoTriggerDelivery(order, order.seller).catch(err =>
          logger.warn(`[${fn}] Auto-delivery failed`, { orderId, error: err.message })
        ));
      }

      // Auto-trigger shipping for shipping orders (SHIP-W2)
      if (order.fulfillment_type === 'shipping') {
        const { autoTriggerShipping } = require('./marketplaceService');
        setImmediate(() => autoTriggerShipping(order).catch(err =>
          logger.warn(`[${fn}] Auto-shipping failed`, { orderId, error: err.message })
        ));
      }

      // ── Unified Ledger (W3): record instant card payment ───────────
      setImmediate(async () => {
        try {
          const ledger = require('./unifiedLedgerService');
          const { getSupabaseClient } = require('../config/supabase');

          // Idempotency check
          const existingCheck = await getSupabaseClient()
            .from('ledger_entries')
            .select('id')
            .eq('source_type', 'marketplace_order')
            .eq('source_id', orderId)
            .limit(1);

          if (existingCheck.data && existingCheck.data.length > 0) {
            logger.info(`[${LOG_TAG}] Ledger entries already exist for order ${orderId} — skipping`, {
              service: LOG_TAG, action: 'LEDGER_IDEMPOTENT_SKIP', orderId,
            });
            return;
          }

          const sellerUserId = order.seller?.user_id;
          if (!sellerUserId) return;

          const sellerAccountId = await ledger.ensureAccount('user', sellerUserId);
          const platformAccountId = ledger.PLATFORM_ACCOUNT_ID;
          const totalBrl = Number(order.total_brl);
          const commissionBrl = Number(order.commission_brl) || 0;
          const sellerAmount = +(totalBrl - commissionBrl).toFixed(2);

          if (sellerAmount > 0) {
            await ledger.recordTransaction([
              {
                accountId: sellerAccountId, amountBrl: sellerAmount, status: 'pending',
                sourceType: 'marketplace_order', sourceId: orderId,
                description: `Venda marketplace — pedido ${orderId.substring(0, 8)}`,
                asaasRef: cardCharge.paymentId || null,
              },
              {
                accountId: platformAccountId, amountBrl: -sellerAmount, status: 'pending',
                sourceType: 'marketplace_order', sourceId: orderId,
                description: `Repasse seller — pedido ${orderId.substring(0, 8)}`,
                asaasRef: cardCharge.paymentId || null,
              },
            ]);
          }

          if (commissionBrl > 0) {
            await ledger.recordTransaction([
              {
                accountId: platformAccountId, amountBrl: commissionBrl, status: 'pending',
                sourceType: 'marketplace_order', sourceId: orderId,
                description: `Comissao plataforma — pedido ${orderId.substring(0, 8)}`,
                asaasRef: cardCharge.paymentId || null,
              },
              {
                accountId: sellerAccountId, amountBrl: -commissionBrl, status: 'pending',
                sourceType: 'marketplace_order', sourceId: orderId,
                description: `Taxa comissao — pedido ${orderId.substring(0, 8)}`,
                asaasRef: cardCharge.paymentId || null,
              },
            ]);
          }

          logger.info(`[${LOG_TAG}] Ledger recorded for guest card order`, {
            service: LOG_TAG, action: 'LEDGER_RECORD_OK',
            orderId, sellerUserId, totalBrl, commissionBrl, sellerAmount,
          });
        } catch (ledgerErr) {
          logger.error('Ledger recording failed (non-blocking)', {
            service: LOG_TAG, action: 'LEDGER_RECORD_FAILED', severity: 'CRITICAL',
            orderId, error: ledgerErr.message,
          });
        }
      });
    }

  } else {
    throw new Error(`Método de pagamento "${payment_method}" não suportado`);
  }

  logger.info(`[${fn}] Guest payment initiated`, {
    orderId, paymentMethod: payment_method, paymentId: paymentResult.paymentId,
  });

  return { order: { id: orderId, status: order.status }, payment: paymentResult };
}

// ── Guest order status ───────────────────────────────────────────────────────

/**
 * Retorna status do pedido guest (público, protegido por HMAC token).
 */
async function getGuestOrderStatus(orderId, token) {
  if (!validateGuestOrderToken(orderId, token)) {
    throw new Error('Token de pedido inválido');
  }

  const supabase = sb();

  const { data: order, error } = await supabase
    .from('marketplace_orders')
    .select(`
      id, status, items, subtotal_brl, total_brl, delivery_fee,
      payment_method, buyer_snapshot, created_at, updated_at,
      seller:seller_id ( business_name, trading_name, category, address_neighborhood, address_city )
    `)
    .eq('id', orderId)
    .single();

  if (error || !order) throw new Error('Pedido não encontrado');
  if (order.buyer_id) throw new Error('Este não é um pedido de visitante');

  return order;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * GST-024: Envia email de status para guest buyer (fire-and-forget).
 * Delegação para notifyGuestBuyer de marketplaceService (evita duplicar lógica).
 */
function _notifyGuestBuyerEmail(order, status) {
  setImmediate(async () => {
    try {
      // Resolve email from buyer_snapshot (primary) or guest_buyers table (fallback)
      let guestEmail = order.buyer_snapshot?.email;
      let guestName  = order.buyer_snapshot?.full_name || 'Visitante';

      if (!guestEmail && order.guest_buyer_id) {
        const { data: gb } = await sb()
          .from('guest_buyers')
          .select('email, full_name')
          .eq('id', order.guest_buyer_id)
          .maybeSingle();
        guestEmail = gb?.email;
        guestName  = gb?.full_name || guestName;
      }

      if (!guestEmail) {
        logger.warn(`[${LOG_TAG}] _notifyGuestBuyerEmail: sem email para pedido ${order.id}`);
        return;
      }

      const siteUrl     = process.env.SITE_URL || process.env.FRONTEND_URL || 'https://eloscloud.com';
      const trackingUrl = `${siteUrl}/pedido/${order.id}?token=${order.guest_order_token}`;

      const { STATUS_CONFIG } = require('../templates/emails/guestOrderStatus');
      const cfg     = STATUS_CONFIG[status] || STATUS_CONFIG.paid;
      const subject = `${cfg.subject} — ElosCloud`;

      const sellerName = order.seller?.business_name
        || order.seller?.trading_name
        || '';

      const emailService = require('./emailService');
      await emailService.sendEmail({
        to:           guestEmail,
        subject,
        templateType: 'guest_order_status',
        data: {
          guestName,
          orderId:     order.id,
          status,
          items:       order.items || [],
          totalBrl:    order.total_brl || 0,
          deliveryFee: order.delivery_fee || 0,
          trackingUrl,
          sellerName,
        },
      });

      logger.info(`[${LOG_TAG}] Guest buyer email "${status}" enviado`, {
        orderId: order.id, to: guestEmail,
      });
    } catch (err) {
      logger.warn(`[${LOG_TAG}] _notifyGuestBuyerEmail falhou`, {
        orderId: order.id, status, error: err.message,
      });
    }
  });
}

function _notifySellerNewOrder(order, guestBuyer) {
  setImmediate(async () => {
    try {
      const NotificationDispatcher = require('./NotificationDispatcher');
      const socketManager = require('../config/socket/socketManager');

      if (order.seller?.user_id) {
        socketManager.emitToUser(order.seller.user_id, 'marketplace:new_order_paid', { orderId: order.id });

        NotificationDispatcher.dispatch({
          userId: order.seller.user_id,
          type: 'marketplace_new_order',
          importance: 'high',
          data: {
            orderId: order.id,
            guestName: guestBuyer.full_name,
            isGuest: true,
            sellerId: order.seller_id || order.seller?.id,
            clientName: guestBuyer.full_name,
            clientPhone: guestBuyer.phone,
          },
          dedupKey: `marketplace_new_order_seller_${order.id}`,
          metadata: { triggeredBy: 'system' },
        }).catch(() => {});
      }
    } catch (err) {
      logger.warn('Guest order seller notification failed', { orderId: order.id, error: err.message });
    }
  });
}

module.exports = {
  getPublicSeller,
  listPublicProducts,
  listPublicMenuCategories,
  getPublicProduct,
  estimateDeliveryForGuest,
  createGuestOrder,
  initiateGuestPayment,
  getGuestOrderStatus,
  generateGuestOrderToken,
  validateGuestOrderToken,
};
