'use strict';

const { logger } = require('../logger');

const LOG_TAG = 'geocoding';

/**
 * Geocodifica endereço via Google Geocoding API.
 * Retorna { lat, lng } ou null se falhar.
 */
async function geocodeAddress(addressString) {
  if (!addressString) return null;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    logger.warn(`[${LOG_TAG}] GOOGLE_MAPS_API_KEY não configurada — geocoding indisponível`);
    return null;
  }
  try {
    const params = new URLSearchParams({
      address: addressString,
      key: apiKey,
      region: 'br',
      language: 'pt-BR',
    });
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 'OK' || !data.results?.length) return null;
    const loc = data.results[0].geometry?.location;
    if (!loc?.lat || !loc?.lng) return null;
    logger.info(`[${LOG_TAG}] Endereço geocodificado`, {
      address: addressString.substring(0, 60),
      lat: loc.lat,
      lng: loc.lng,
    });
    return { lat: Number(loc.lat), lng: Number(loc.lng) };
  } catch (err) {
    logger.warn(`[${LOG_TAG}] geocodeAddress falhou: ${err.message}`);
    return null;
  }
}

module.exports = { geocodeAddress };
