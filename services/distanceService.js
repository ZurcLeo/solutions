/**
 * @fileoverview distanceService — Google Maps Distance Matrix API wrapper
 *
 * Fornece distâncias reais de estrada via Google Maps, substituindo Haversine × 1.3.
 * Fallback automático para Haversine × 1.3 se API indisponível.
 *
 * Cache in-memory LRU com TTL de 1h:
 *   - Origem (entregador, em movimento): arredondada a 2 decimais (~1.1km)
 *   - Destino (loja/comprador, fixo): arredondada a 4 decimais (~11m)
 *
 * Rate limits: Google Distance Matrix — 25.000 elements/mês (free tier).
 */

'use strict';

const { logger } = require('../logger');

const SERVICE = 'distanceService';
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora
const CACHE_MAX_SIZE = 500;
const SINGLE_TIMEOUT_MS = 5000;
const BATCH_TIMEOUT_MS = 8000;
const ROAD_FACTOR = 1.3;

// Cache LRU simples (Map preserva ordem de inserção)
const distanceCache = new Map();

/**
 * Chave de cache com precisão diferenciada:
 * - Origem: 2 decimais (~1.1km) — entregador se move
 * - Destino: 4 decimais (~11m) — posição fixa
 */
function _cacheKey(originLat, originLng, destLat, destLng) {
  const oLat = (Math.round(originLat * 100) / 100).toFixed(2);
  const oLng = (Math.round(originLng * 100) / 100).toFixed(2);
  const dLat = (Math.round(destLat * 10000) / 10000).toFixed(4);
  const dLng = (Math.round(destLng * 10000) / 10000).toFixed(4);
  return `${oLat},${oLng}>${dLat},${dLng}`;
}

function _getCached(key) {
  const entry = distanceCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    distanceCache.delete(key);
    return null;
  }
  return entry.value;
}

function _setCache(key, value) {
  if (distanceCache.size >= CACHE_MAX_SIZE) {
    const firstKey = distanceCache.keys().next().value;
    distanceCache.delete(firstKey);
  }
  distanceCache.set(key, { value, ts: Date.now() });
}

/**
 * Haversine puro — replica a função SQL para fallback.
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}

/**
 * Distância de estrada entre dois pontos.
 * Usa Google Maps Distance Matrix se disponível, senão Haversine × 1.3.
 *
 * @returns {{ distanceKm: number, durationMinutes: number, source: 'google_maps'|'haversine'|'default' }}
 */
async function getRoadDistance(originLat, originLng, destLat, destLng) {
  if (!originLat || !originLng || !destLat || !destLng) {
    return { distanceKm: null, durationMinutes: null, source: 'none' };
  }

  const key = _cacheKey(originLat, originLng, destLat, destLng);
  const cached = _getCached(key);
  if (cached) return cached;

  if (GOOGLE_MAPS_API_KEY) {
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
      url.searchParams.set('origins', `${originLat},${originLng}`);
      url.searchParams.set('destinations', `${destLat},${destLng}`);
      url.searchParams.set('mode', 'driving');
      url.searchParams.set('language', 'pt-BR');
      url.searchParams.set('key', GOOGLE_MAPS_API_KEY);

      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(SINGLE_TIMEOUT_MS) });
      const data = await res.json();

      if (data.status === 'OK' && data.rows?.[0]?.elements?.[0]?.status === 'OK') {
        const el = data.rows[0].elements[0];
        const result = {
          distanceKm: +(el.distance.value / 1000).toFixed(2),
          durationMinutes: Math.round(el.duration.value / 60),
          source: 'google_maps',
        };
        _setCache(key, result);
        return result;
      }

      logger.warn(`[${SERVICE}] Google Maps: sem rota`, {
        status: data.status,
        elementStatus: data.rows?.[0]?.elements?.[0]?.status,
        origin: `${originLat},${originLng}`,
        dest: `${destLat},${destLng}`,
      });
    } catch (err) {
      logger.warn(`[${SERVICE}] Google Maps fallback Haversine: ${err.message}`);
    }
  }

  // Fallback: Haversine × 1.3
  const h = haversineKm(originLat, originLng, destLat, destLng);
  const result = {
    distanceKm: +(h * ROAD_FACTOR).toFixed(2),
    durationMinutes: Math.round((h * ROAD_FACTOR) / 70 * 60) + 8,
    source: 'haversine',
  };
  _setCache(key, result);
  return result;
}

/**
 * Distâncias em batch: N origens → 1 destino (1 API call).
 * Ideal para matching: vários entregadores → mesma loja.
 *
 * @param {{ lat: number, lng: number }[]} origins
 * @param {{ lat: number, lng: number }} destination
 * @returns {Promise<{ distanceKm: number, durationMinutes: number, source: string }[]>}
 */
async function getRoadDistancesBatch(origins, destination) {
  if (!origins?.length || !destination?.lat || !destination?.lng) {
    return origins.map(() => ({ distanceKm: null, durationMinutes: null, source: 'none' }));
  }

  const results = new Array(origins.length);
  const uncachedIndices = [];

  for (let i = 0; i < origins.length; i++) {
    const o = origins[i];
    if (!o?.lat || !o?.lng) {
      results[i] = { distanceKm: null, durationMinutes: null, source: 'none' };
      continue;
    }
    const key = _cacheKey(o.lat, o.lng, destination.lat, destination.lng);
    const cached = _getCached(key);
    if (cached) {
      results[i] = cached;
    } else {
      uncachedIndices.push(i);
    }
  }

  if (uncachedIndices.length === 0) return results;

  // Batch Google Maps para entradas não-cacheadas
  if (GOOGLE_MAPS_API_KEY && uncachedIndices.length > 0) {
    try {
      const originsStr = uncachedIndices
        .map(i => `${origins[i].lat},${origins[i].lng}`)
        .join('|');

      const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
      url.searchParams.set('origins', originsStr);
      url.searchParams.set('destinations', `${destination.lat},${destination.lng}`);
      url.searchParams.set('mode', 'driving');
      url.searchParams.set('language', 'pt-BR');
      url.searchParams.set('key', GOOGLE_MAPS_API_KEY);

      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(BATCH_TIMEOUT_MS) });
      const data = await res.json();

      if (data.status === 'OK') {
        for (let j = 0; j < uncachedIndices.length; j++) {
          const idx = uncachedIndices[j];
          const el = data.rows?.[j]?.elements?.[0];
          if (el?.status === 'OK') {
            const r = {
              distanceKm: +(el.distance.value / 1000).toFixed(2),
              durationMinutes: Math.round(el.duration.value / 60),
              source: 'google_maps',
            };
            const key = _cacheKey(origins[idx].lat, origins[idx].lng, destination.lat, destination.lng);
            _setCache(key, r);
            results[idx] = r;
          }
        }
      }
    } catch (err) {
      logger.warn(`[${SERVICE}] Batch Google Maps fallback: ${err.message}`);
    }
  }

  // Preenche restantes com Haversine
  for (const idx of uncachedIndices) {
    if (!results[idx]) {
      const o = origins[idx];
      const h = haversineKm(o.lat, o.lng, destination.lat, destination.lng);
      const r = {
        distanceKm: +(h * ROAD_FACTOR).toFixed(2),
        durationMinutes: Math.round((h * ROAD_FACTOR) / 70 * 60) + 8,
        source: 'haversine',
      };
      const key = _cacheKey(o.lat, o.lng, destination.lat, destination.lng);
      _setCache(key, r);
      results[idx] = r;
    }
  }

  return results;
}

/**
 * Distância de estrada com paradas intermediárias (waypoints).
 * Usa Google Maps Directions API (não Distance Matrix, que não suporta waypoints).
 * Fallback: soma Haversine×1.3 por segmento.
 *
 * @param {{ lat: number, lng: number }} origin
 * @param {{ lat: number, lng: number }} destination
 * @param {{ lat: number, lng: number }[]} waypoints - paradas intermediárias (max 3)
 * @returns {{ distanceKm: number, durationMinutes: number, source: string, legDistances: number[] }}
 */
async function getRoadDistanceWithWaypoints(origin, destination, waypoints = []) {
  if (!origin?.lat || !origin?.lng || !destination?.lat || !destination?.lng) {
    return { distanceKm: null, durationMinutes: null, source: 'none', legDistances: [] };
  }

  // Sem waypoints → delegar para getRoadDistance (usa cache)
  if (!waypoints.length) {
    const r = await getRoadDistance(origin.lat, origin.lng, destination.lat, destination.lng);
    return { ...r, legDistances: r.distanceKm ? [r.distanceKm] : [] };
  }

  if (GOOGLE_MAPS_API_KEY) {
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
      url.searchParams.set('origin', `${origin.lat},${origin.lng}`);
      url.searchParams.set('destination', `${destination.lat},${destination.lng}`);
      url.searchParams.set('waypoints', waypoints.map(w => `${w.lat},${w.lng}`).join('|'));
      url.searchParams.set('mode', 'driving');
      url.searchParams.set('language', 'pt-BR');
      url.searchParams.set('key', GOOGLE_MAPS_API_KEY);

      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(SINGLE_TIMEOUT_MS) });
      const data = await res.json();

      if (data.status === 'OK' && data.routes?.[0]?.legs?.length) {
        const legs = data.routes[0].legs;
        let totalDistanceM = 0;
        let totalDurationS = 0;
        const legDistances = [];

        for (const leg of legs) {
          totalDistanceM += leg.distance.value;
          totalDurationS += leg.duration.value;
          legDistances.push(+(leg.distance.value / 1000).toFixed(2));
        }

        return {
          distanceKm: +(totalDistanceM / 1000).toFixed(2),
          durationMinutes: Math.round(totalDurationS / 60),
          source: 'google_maps',
          legDistances,
        };
      }

      logger.warn(`[${SERVICE}] Directions API: sem rota`, {
        status: data.status,
        origin: `${origin.lat},${origin.lng}`,
        dest: `${destination.lat},${destination.lng}`,
        waypoints: waypoints.length,
      });
    } catch (err) {
      logger.warn(`[${SERVICE}] Directions API fallback Haversine: ${err.message}`);
    }
  }

  // Fallback: soma Haversine × 1.3 por segmento
  const points = [origin, ...waypoints, destination];
  let totalKm = 0;
  const legDistances = [];
  for (let i = 0; i < points.length - 1; i++) {
    const segKm = haversineKm(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng) * ROAD_FACTOR;
    legDistances.push(+segKm.toFixed(2));
    totalKm += segKm;
  }

  return {
    distanceKm: +totalKm.toFixed(2),
    durationMinutes: Math.round(totalKm / 70 * 60) + 8,
    source: 'haversine',
    legDistances,
  };
}

/**
 * Rota com pedágios via Google Routes API v2.
 * Retorna distância, duração, e informação de pedágios na rota.
 * Fallback: getRoadDistanceWithWaypoints (sem pedágio).
 *
 * @param {{ lat: number, lng: number }} origin
 * @param {{ lat: number, lng: number }} destination
 * @param {{ lat: number, lng: number }[]} waypoints
 * @param {string} vehicleType - 'carro'|'van'|'caminhonete'
 * @returns {{ distanceKm, durationMinutes, source, tolls: { totalBrl, count }|null, legDistances[] }}
 */
async function getRouteWithTolls(origin, destination, waypoints = [], vehicleType = 'carro') {
  if (!origin?.lat || !origin?.lng || !destination?.lat || !destination?.lng) {
    return { distanceKm: null, durationMinutes: null, source: 'none', tolls: null, legDistances: [] };
  }

  if (!GOOGLE_MAPS_API_KEY) {
    const fallback = await getRoadDistanceWithWaypoints(origin, destination, waypoints);
    return { ...fallback, tolls: null };
  }

  try {
    const body = {
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
      travelMode: 'DRIVE',
      extraComputations: ['TOLLS'],
      routeModifiers: {
        vehicleInfo: { emissionType: 'GASOLINE' },
      },
    };

    if (waypoints.length > 0) {
      body.intermediates = waypoints.map(w => ({
        location: { latLng: { latitude: w.lat, longitude: w.lng } },
      }));
    }

    const fieldMask = [
      'routes.distanceMeters',
      'routes.duration',
      'routes.travelAdvisory.tollInfo',
      'routes.legs.distanceMeters',
      'routes.legs.duration',
    ].join(',');

    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SINGLE_TIMEOUT_MS),
    });

    const data = await res.json();
    const route = data.routes?.[0];

    if (!route) {
      logger.warn(`[${SERVICE}] Routes API v2: sem rota`, { origin, destination });
      const fallback = await getRoadDistanceWithWaypoints(origin, destination, waypoints);
      return { ...fallback, tolls: null };
    }

    const distanceKm = +(route.distanceMeters / 1000).toFixed(2);
    const durationSec = parseInt(route.duration?.replace('s', '') || '0', 10);
    const durationMinutes = Math.round(durationSec / 60);

    // Extrair pedágios
    let tolls = null;
    const tollInfo = route.travelAdvisory?.tollInfo;
    logger.info(`[${SERVICE}] Routes API v2 tollInfo raw`, {
      hasTollInfo: !!tollInfo,
      estimatedPrice: tollInfo?.estimatedPrice || null,
      origin: `${origin.lat},${origin.lng}`,
      dest: `${destination.lat},${destination.lng}`,
    });
    if (tollInfo?.estimatedPrice?.length > 0) {
      let totalBrl = 0;
      for (const price of tollInfo.estimatedPrice) {
        if (price.currencyCode === 'BRL') {
          totalBrl += parseFloat(price.units || '0') + parseFloat(price.nanos || 0) / 1e9;
        }
      }
      if (totalBrl > 0) {
        tolls = {
          totalBrl: Math.round(totalBrl * 100) / 100,
        };
      }
    }

    // Leg distances
    const legDistances = (route.legs || []).map(leg =>
      +(leg.distanceMeters / 1000).toFixed(2)
    );

    const result = { distanceKm, durationMinutes, source: 'google_routes_v2', tolls, legDistances };

    // Cache using same key pattern
    const key = _cacheKey(origin.lat, origin.lng, destination.lat, destination.lng);
    _setCache(key, { distanceKm, durationMinutes, source: 'google_routes_v2' });

    return result;
  } catch (err) {
    logger.warn(`[${SERVICE}] Routes API v2 fallback: ${err.message}`);
    const fallback = await getRoadDistanceWithWaypoints(origin, destination, waypoints);
    return { ...fallback, tolls: null };
  }
}

module.exports = {
  getRoadDistance,
  getRoadDistancesBatch,
  getRoadDistanceWithWaypoints,
  getRouteWithTolls,
  haversineKm,
};
