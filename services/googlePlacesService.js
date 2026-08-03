/**
 * @fileoverview googlePlacesService — Google Places API integration
 *
 * Vincula vendedores da ElosCloud a estabelecimentos do Google Places,
 * capturando rating, reviews e status para resolver cold start de reputação.
 *
 * Fluxo principal (auto-detect):
 *   1. getPlaceSuggestion(sellerId) → busca candidato pelo business_name + coords
 *   2. Seller confirma → confirmPlaceLink(sellerId, placeId)
 *   3. Sync periódico → syncSellerPlaceData(sellerId) atualiza rating/status
 *
 * Cache in-memory LRU com TTL de 24h para Place Details (dados mudam lentamente).
 * Usa mesma GOOGLE_MAPS_API_KEY do distanceService — Places API precisa estar
 * habilitada no Google Cloud Console.
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const SERVICE = 'googlePlacesService';
const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const TIMEOUT_MS = 5000;

// Cache LRU para Place Details (dados do Google mudam lentamente)
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas
const CACHE_MAX_SIZE = 500;
const detailsCache = new Map();

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase indisponível');
  return client;
}

// ──────────────────────────────────────────────────────
// Cache helpers
// ──────────────────────────────────────────────────────

function _getCached(key) {
  const entry = detailsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    detailsCache.delete(key);
    return null;
  }
  return entry.value;
}

function _setCache(key, value) {
  if (detailsCache.size >= CACHE_MAX_SIZE) {
    const firstKey = detailsCache.keys().next().value;
    detailsCache.delete(firstKey);
  }
  detailsCache.set(key, { value, ts: Date.now() });
}

// ──────────────────────────────────────────────────────
// Google Places API calls
// ──────────────────────────────────────────────────────

/**
 * Busca um estabelecimento pelo nome + localização.
 * Usa Find Place From Text com locationbias para priorizar resultados próximos.
 *
 * @param {string} businessName - Nome do negócio
 * @param {number} lat - Latitude do endereço do seller
 * @param {number} lng - Longitude do endereço do seller
 * @returns {object|null} Candidato mais provável: { placeId, name, address, rating, reviewsCount, businessStatus, types, photoReference }
 */
/**
 * Calcula distância em metros entre dois pontos (Haversine).
 */
function _haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Score de confiança do match (0-1). Baseado em:
 * - Distância geográfica (peso 60%)
 * - Similaridade de nome (peso 40%)
 */
function _matchConfidence(sellerName, candidateName, sellerLat, sellerLng, candidateLat, candidateLng) {
  // Distância: < 200m = 1.0, > 5km = 0.0
  let distScore = 1.0;
  if (candidateLat != null && candidateLng != null) {
    const dist = _haversineMeters(sellerLat, sellerLng, candidateLat, candidateLng);
    distScore = dist < 200 ? 1.0 : dist > 5000 ? 0.0 : 1.0 - (dist - 200) / 4800;
  }

  // Nome: proporção de palavras do seller que aparecem no candidato
  const normalize = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '');
  const sellerWords = normalize(sellerName).split(/\s+/).filter(w => w.length > 2);
  const candidateNorm = normalize(candidateName);
  const nameScore = sellerWords.length > 0
    ? sellerWords.filter(w => candidateNorm.includes(w)).length / sellerWords.length
    : 0;

  return +(distScore * 0.6 + nameScore * 0.4).toFixed(2);
}

async function findPlaceByName(businessName, lat, lng) {
  const fn = 'findPlaceByName';

  if (!API_KEY) {
    logger.warn(`[${SERVICE}] GOOGLE_MAPS_API_KEY não configurada — Places API indisponível`);
    return null;
  }

  if (!businessName || lat == null || lng == null) {
    logger.warn(`[${SERVICE}].${fn}: parâmetros insuficientes`, { businessName, lat, lng });
    return null;
  }

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/place/findplacefromtext/json');
    url.searchParams.set('input', businessName);
    url.searchParams.set('inputtype', 'textquery');
    url.searchParams.set('fields', 'place_id,name,formatted_address,geometry,rating,user_ratings_total,business_status,photos,types');
    // Raio de 2km em vez de point (muito mais preciso para bairros pequenos)
    url.searchParams.set('locationbias', `circle:2000@${lat},${lng}`);
    url.searchParams.set('language', 'pt-BR');
    url.searchParams.set('key', API_KEY);

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const data = await res.json();

    if (data.status !== 'OK' || !data.candidates?.length) {
      logger.info(`[${SERVICE}].${fn}: nenhum candidato`, { businessName, status: data.status });
      return null;
    }

    const candidate = data.candidates[0];
    const candidateLat = candidate.geometry?.location?.lat;
    const candidateLng = candidate.geometry?.location?.lng;
    const confidence = _matchConfidence(businessName, candidate.name, lat, lng, candidateLat, candidateLng);

    const result = {
      placeId: candidate.place_id,
      name: candidate.name,
      address: candidate.formatted_address,
      lat: candidateLat,
      lng: candidateLng,
      rating: candidate.rating || null,
      reviewsCount: candidate.user_ratings_total || 0,
      businessStatus: candidate.business_status || 'OPERATIONAL',
      types: candidate.types || [],
      photoReference: candidate.photos?.[0]?.photo_reference || null,
      confidence,
    };

    logger.info(`[${SERVICE}].${fn}: candidato encontrado`, {
      businessName,
      googleName: result.name,
      placeId: result.placeId,
      rating: result.rating,
      confidence,
    });

    // Confiança muito baixa: não sugerir (evita match errado)
    if (confidence < 0.25) {
      logger.info(`[${SERVICE}].${fn}: confiança muito baixa, descartando`, { confidence, businessName, googleName: result.name });
      return null;
    }

    return result;
  } catch (err) {
    logger.warn(`[${SERVICE}].${fn}: erro na API — ${err.message}`, { businessName });
    return null;
  }
}

/**
 * Busca textual livre por estabelecimentos próximos a uma coordenada.
 * Retorna múltiplos candidatos para o seller escolher manualmente.
 *
 * @param {string} query - Texto de busca digitado pelo seller
 * @param {number} lat - Latitude de referência
 * @param {number} lng - Longitude de referência
 * @returns {Array} Lista de candidatos (até 5)
 */
async function searchPlaces(query, lat, lng) {
  const fn = 'searchPlaces';

  if (!API_KEY) return [];
  if (!query || query.length < 3 || lat == null || lng == null) return [];

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
    url.searchParams.set('query', query);
    url.searchParams.set('location', `${lat},${lng}`);
    url.searchParams.set('radius', '5000');
    url.searchParams.set('language', 'pt-BR');
    url.searchParams.set('key', API_KEY);

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const data = await res.json();

    if (data.status !== 'OK' || !data.results?.length) return [];

    return data.results.slice(0, 5).map(r => ({
      placeId: r.place_id,
      name: r.name,
      address: r.formatted_address,
      lat: r.geometry?.location?.lat,
      lng: r.geometry?.location?.lng,
      rating: r.rating || null,
      reviewsCount: r.user_ratings_total || 0,
      businessStatus: r.business_status || 'OPERATIONAL',
      photoReference: r.photos?.[0]?.photo_reference || null,
      photoUrl: getPhotoUrl(r.photos?.[0]?.photo_reference),
    }));
  } catch (err) {
    logger.warn(`[${SERVICE}].${fn}: erro — ${err.message}`, { query });
    return [];
  }
}

/**
 * Obtém detalhes completos de um estabelecimento pelo Place ID.
 * Resultado cacheado por 24h.
 *
 * @param {string} placeId - Google Places place_id
 * @returns {object|null} { name, rating, reviewsCount, address, url, businessStatus, openingHours, types, photoReference }
 */
async function getPlaceDetails(placeId) {
  const fn = 'getPlaceDetails';

  if (!placeId) throw new Error('placeId é obrigatório');

  // Check cache
  const cached = _getCached(`details:${placeId}`);
  if (cached) return cached;

  if (!API_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY não configurada');
  }

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
    url.searchParams.set('place_id', placeId);
    url.searchParams.set('fields', 'name,rating,user_ratings_total,formatted_address,url,business_status,opening_hours,types,photos');
    url.searchParams.set('language', 'pt-BR');
    url.searchParams.set('key', API_KEY);

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const data = await res.json();

    if (data.status !== 'OK' || !data.result) {
      logger.warn(`[${SERVICE}].${fn}: Place Details falhou`, { placeId, status: data.status });
      return null;
    }

    const r = data.result;
    const details = {
      name: r.name,
      rating: r.rating || null,
      reviewsCount: r.user_ratings_total || 0,
      address: r.formatted_address,
      url: r.url || null,
      businessStatus: r.business_status || 'OPERATIONAL',
      openingHours: r.opening_hours || null,
      types: r.types || [],
      photoReference: r.photos?.[0]?.photo_reference || null,
    };

    _setCache(`details:${placeId}`, details);
    return details;
  } catch (err) {
    logger.error(`[${SERVICE}].${fn}: erro — ${err.message}`, { placeId });
    throw err;
  }
}

/**
 * Gera URL de foto do Google Places (proxy via Google).
 * @param {string} photoReference - Referência retornada pela Places API
 * @param {number} maxWidth - Largura máxima (default 400px)
 * @returns {string|null} URL da foto ou null
 */
function getPhotoUrl(photoReference, maxWidth = 400) {
  if (!photoReference || !API_KEY) return null;
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${photoReference}&key=${API_KEY}`;
}

// ──────────────────────────────────────────────────────
// Business logic — vinculação seller ↔ Place
// ──────────────────────────────────────────────────────

/**
 * Busca sugestão de Place para um seller baseado no endereço cadastrado.
 * Fluxo auto-detect: retorna o candidato mais provável para confirmação.
 *
 * @param {string} userId - ID do usuário (seller)
 * @returns {object} { suggestion: {...} | null, sellerName, alreadyLinked }
 */
async function getPlaceSuggestion(userId) {
  const fn = 'getPlaceSuggestion';

  // Buscar perfil do seller
  const { data: seller, error } = await sb()
    .from('seller_profiles')
    .select('id, business_name, trading_name, address_lat, address_lng, address_city, google_place_id')
    .eq('user_id', userId)
    .neq('status', 'deleted')
    .single();

  if (error || !seller) {
    throw new Error('Perfil de vendedor não encontrado');
  }

  // Já vinculado
  if (seller.google_place_id) {
    const details = await getPlaceDetails(seller.google_place_id);
    return {
      suggestion: details ? { ...details, placeId: seller.google_place_id, photoUrl: getPhotoUrl(details.photoReference) } : null,
      sellerName: seller.business_name,
      alreadyLinked: true,
    };
  }

  // Precisa de coordenadas para busca
  if (seller.address_lat == null || seller.address_lng == null) {
    logger.info(`[${SERVICE}].${fn}: seller sem coordenadas, sem sugestão`, { userId });
    return { suggestion: null, sellerName: seller.business_name, alreadyLinked: false };
  }

  // Buscar no Google Places
  const searchName = seller.trading_name || seller.business_name;
  const candidate = await findPlaceByName(
    `${searchName} ${seller.address_city || ''}`.trim(),
    seller.address_lat,
    seller.address_lng,
  );

  if (!candidate) {
    return { suggestion: null, sellerName: seller.business_name, alreadyLinked: false };
  }

  return {
    suggestion: {
      ...candidate,
      photoUrl: getPhotoUrl(candidate.photoReference),
    },
    sellerName: seller.business_name,
    alreadyLinked: false,
  };
}

/**
 * Seller confirma vinculação com um Place ID.
 * Busca detalhes atualizados e persiste no perfil.
 *
 * @param {string} userId - ID do usuário (seller)
 * @param {string} placeId - Google Places place_id
 * @param {string} linkedBy - 'auto_confirm' | 'manual_search' | 'admin'
 * @returns {object} Dados do Google Places persistidos
 */
async function confirmPlaceLink(userId, placeId, linkedBy = 'auto_confirm') {
  const fn = 'confirmPlaceLink';

  if (!placeId) throw new Error('placeId é obrigatório');

  // Verificar se place_id já está vinculado a outro seller
  const { data: existing } = await sb()
    .from('seller_profiles')
    .select('id, user_id, business_name')
    .eq('google_place_id', placeId)
    .single();

  if (existing && existing.user_id !== userId) {
    throw new Error('Este estabelecimento já está vinculado a outro vendedor');
  }

  // Buscar detalhes atualizados
  const details = await getPlaceDetails(placeId);
  if (!details) {
    throw new Error('Não foi possível obter detalhes do estabelecimento');
  }

  const now = new Date().toISOString();
  const updateData = {
    google_place_id: placeId,
    google_rating: details.rating,
    google_reviews_count: details.reviewsCount,
    google_business_name: details.name,
    google_url: details.url,
    google_business_status: details.businessStatus,
    google_photo_reference: details.photoReference,
    google_opening_hours: details.openingHours || null,
    google_is_open_now: details.openingHours?.open_now ?? null,
    google_places_synced_at: now,
    google_place_linked_at: now,
    google_place_linked_by: linkedBy,
  };

  const { data, error } = await sb()
    .from('seller_profiles')
    .update(updateData)
    .eq('user_id', userId)
    .neq('status', 'deleted')
    .select('id, google_place_id, google_rating, google_reviews_count, google_business_name, google_url, google_business_status, google_opening_hours, google_is_open_now, google_place_linked_at')
    .single();

  if (error) {
    logger.error(`[${SERVICE}].${fn}: falha ao persistir`, { userId, placeId, error: error.message });
    throw new Error('Erro ao vincular estabelecimento');
  }

  logger.info(`[${SERVICE}].${fn}: vinculado com sucesso`, {
    userId,
    placeId,
    googleName: details.name,
    rating: details.rating,
    reviewsCount: details.reviewsCount,
    linkedBy,
  });

  // Trust Passport event (fire-and-forget) — será conectado no GP-3
  _fireTrustEvent(userId, details).catch(() => {});

  return data;
}

/**
 * Seller remove vinculação com Google Places.
 * @param {string} userId - ID do usuário (seller)
 */
async function unlinkPlace(userId) {
  const fn = 'unlinkPlace';

  const { error } = await sb()
    .from('seller_profiles')
    .update({
      google_place_id: null,
      google_rating: null,
      google_reviews_count: 0,
      google_business_name: null,
      google_url: null,
      google_business_status: null,
      google_photo_reference: null,
      google_opening_hours: null,
      google_is_open_now: null,
      google_places_synced_at: null,
      google_place_linked_at: null,
      google_place_linked_by: null,
    })
    .eq('user_id', userId)
    .neq('status', 'deleted');

  if (error) {
    logger.error(`[${SERVICE}].${fn}: falha ao desvincular`, { userId, error: error.message });
    throw new Error('Erro ao desvincular estabelecimento');
  }

  logger.info(`[${SERVICE}].${fn}: desvinculado`, { userId });
  return { success: true };
}

/**
 * Re-sincroniza dados do Google Places para um seller já vinculado.
 * Chamado pelo job periódico (GP-5) ou manualmente.
 *
 * @param {string} sellerId - ID do seller_profile
 * @returns {object|null} Dados atualizados ou null se não vinculado
 */
async function syncSellerPlaceData(sellerId) {
  const fn = 'syncSellerPlaceData';

  const { data: seller, error } = await sb()
    .from('seller_profiles')
    .select('id, user_id, google_place_id, google_business_status')
    .eq('id', sellerId)
    .single();

  if (error || !seller || !seller.google_place_id) return null;

  // Invalidar cache para forçar refresh
  detailsCache.delete(`details:${seller.google_place_id}`);

  const details = await getPlaceDetails(seller.google_place_id);
  if (!details) {
    logger.warn(`[${SERVICE}].${fn}: Place Details indisponível`, { sellerId, placeId: seller.google_place_id });
    return null;
  }

  const { error: updateError } = await sb()
    .from('seller_profiles')
    .update({
      google_rating: details.rating,
      google_reviews_count: details.reviewsCount,
      google_business_name: details.name,
      google_url: details.url,
      google_business_status: details.businessStatus,
      google_photo_reference: details.photoReference,
      google_opening_hours: details.openingHours || null,
      google_is_open_now: details.openingHours?.open_now ?? null,
      google_places_synced_at: new Date().toISOString(),
    })
    .eq('id', sellerId);

  if (updateError) {
    logger.error(`[${SERVICE}].${fn}: falha ao atualizar`, { sellerId, error: updateError.message });
    return null;
  }

  // Alerta de mudança de status do estabelecimento
  const oldStatus = seller.google_business_status;
  const newStatus = details.businessStatus;
  if (oldStatus && oldStatus !== newStatus &&
      (newStatus === 'CLOSED_PERMANENTLY' || newStatus === 'CLOSED_TEMPORARILY')) {
    const NotificationDispatcher = require('./NotificationDispatcher');
    NotificationDispatcher.dispatch({
      userId: seller.user_id,
      type: 'google_place_status_changed',
      importance: 'high',
      data: {
        oldStatus,
        newStatus,
        businessName: details.name,
      },
      metadata: { triggeredBy: 'system' },
    }).catch(() => {});
  }

  logger.info(`[${SERVICE}].${fn}: sync concluído`, {
    sellerId,
    rating: details.rating,
    reviewsCount: details.reviewsCount,
    status: details.businessStatus,
  });

  return details;
}

/**
 * Batch sync — atualiza todos os sellers com Places vinculado.
 * Respeita rate limits com delay entre chamadas.
 *
 * @param {object} options - { limit, delayMs }
 * @returns {object} { synced, failed, skipped }
 */
async function batchSyncPlaces({ limit = 50, delayMs = 200 } = {}) {
  const fn = 'batchSyncPlaces';

  const { data: sellers, error } = await sb()
    .from('seller_profiles')
    .select('id')
    .not('google_place_id', 'is', null)
    .order('google_places_synced_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error || !sellers?.length) {
    return { synced: 0, failed: 0, skipped: 0 };
  }

  let synced = 0, failed = 0;

  for (const seller of sellers) {
    try {
      const result = await syncSellerPlaceData(seller.id);
      if (result) synced++;
      else failed++;
    } catch {
      failed++;
    }

    // Rate limiting — 200ms entre chamadas (~5 req/s)
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
  }

  logger.info(`[${SERVICE}].${fn}: batch concluído`, { synced, failed, total: sellers.length });
  return { synced, failed, skipped: sellers.length - synced - failed };
}

// ──────────────────────────────────────────────────────
// Trust Passport + Gamification hooks
// ──────────────────────────────────────────────────────

async function _fireTrustEvent(userId, details) {
  try {
    const trustPassportService = require('./trustPassportService');
    if (!trustPassportService?.recordEvent) return;

    let impact = 0;
    if (details.rating >= 4.5 && details.reviewsCount >= 100) impact = 5;
    else if (details.rating >= 4.0 && details.reviewsCount >= 50) impact = 3;
    else if (details.rating >= 3.5 && details.reviewsCount >= 20) impact = 1;

    if (impact > 0) {
      await trustPassportService.recordEvent(
        userId,
        'external',
        'external_place_verified',
        impact,
        false,
        {
          google_rating: details.rating,
          google_reviews_count: details.reviewsCount,
          google_business_name: details.name,
        },
      );
    }

    // Gamification: verify_google_business (Lei do Time)
    const gamificationService = require('./gamificationService');
    if (gamificationService?.triggerEvent) {
      gamificationService.triggerEvent('google_place_verified', userId, {
        google_rating: details.rating,
        google_reviews_count: details.reviewsCount,
      }).catch(() => {});
    }
  } catch (err) {
    logger.warn(`[${SERVICE}] _fireTrustEvent ignorado: ${err.message}`, { userId });
  }
}

// ──────────────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────────────

module.exports = {
  // Google Places API primitives
  findPlaceByName,
  getPlaceDetails,
  getPhotoUrl,
  searchPlaces,
  // Seller ↔ Place business logic
  getPlaceSuggestion,
  confirmPlaceLink,
  unlinkPlace,
  syncSellerPlaceData,
  batchSyncPlaces,
};
