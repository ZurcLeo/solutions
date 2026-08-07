'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { createClient }      = require('@supabase/supabase-js');
const { logger }             = require('../logger');
const gamificationService    = require('./gamificationService');
const trustPassportService   = require('./trustPassportService');
const subscriptionService    = require('./subscriptionService');
const distanceService        = require('./distanceService');
const { geocodeAddress }     = require('../utils/geocoding');
const socketManager          = require('../config/socket/socketManager');
const notificationDispatcher = require('./NotificationDispatcher');

const SERVICE = 'caronaService';

// ─── Constantes ────────────────────────────────────────────────────
const INSS_RATE_PER_KM    = 0.99;   // Teto INSS/Receita Federal (R$/km)
const PLATFORM_FEE_BRL    = 1.00;   // Taxa fixa para não-assinantes
const RATING_WINDOW_DAYS  = 7;
const MAX_SEATS            = 4;
const VALID_VEHICLE_TYPES  = ['carro', 'van', 'caminhonete'];
const MIN_TRUST_DRIVER     = 3;     // Trust Level mínimo para motoristas
const MIN_TRUST_PASSENGER  = 2;     // Trust Level mínimo para passageiros
const MAX_RECURRING_SPAWN  = 28;    // Máximo de child rides por recorrência
const LATE_CANCEL_WINDOW_HOURS = 2; // Cancelamento tardio: < 2h antes da partida
const LATE_CANCEL_TRUST_PENALTY = -1; // Penalidade Trust p/ cancelamento tardio de passageiro
const NO_SHOW_TRUST_PENALTY = -3;     // Penalidade Trust p/ no-show de passageiro

// ─── Helpers ───────────────────────────────────────────────────────
function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

let _sbService = null;
function sbService() {
  if (!_sbService) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados.');
    _sbService = createClient(url, key, { auth: { persistSession: false } });
  }
  return _sbService;
}

const asaasService = require('./asaasService');

function log(fn, msg, extra = {}) {
  logger.info(msg, { service: SERVICE, function: fn, ...extra });
}

function logWarn(fn, msg, extra = {}) {
  logger.warn(msg, { service: SERVICE, function: fn, ...extra });
}

function logError(fn, err, extra = {}) {
  logger.error(`Erro em ${fn}: ${err.message}`, {
    service: SERVICE, function: fn, error: err.message, ...extra,
  });
}

/**
 * Geocode via BrasilAPI (mesmo pattern do deliveryService)
 */
async function geocodeCep(cep) {
  if (!cep) return null;
  try {
    const clean = cep.replace(/\D/g, '');
    if (clean.length !== 8) return null;
    const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${clean}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.location?.coordinates?.longitude && data.location?.coordinates?.latitude) {
      return { lat: data.location.coordinates.latitude, lng: data.location.coordinates.longitude };
    }
    return null;
  } catch {
    return null;
  }
}


// ═══════════════════════════════════════════════════════════════════
// PERFIL DE MOTORISTA
// ═══════════════════════════════════════════════════════════════════

/**
 * Cadastra perfil de motorista com dados do veículo
 * Status inicial: pending (aguarda verificação admin)
 */
async function registerDriver(userId, data) {
  const fn = 'registerDriver';
  const {
    vehicle_type, vehicle_model, vehicle_color, vehicle_year,
    vehicle_plate, vehicle_doc_url, vehicle_photo_url, cnh_url,
    vehicle_id,
  } = data;

  // Se vehicle_id fornecido, busca dados do veículo centralizado
  let resolvedType = vehicle_type;
  let resolvedModel = vehicle_model;
  let resolvedColor = vehicle_color;
  let resolvedYear = vehicle_year;
  let resolvedPlate = vehicle_plate;
  let resolvedDocUrl = vehicle_doc_url;
  let resolvedPhotoUrl = vehicle_photo_url;

  if (vehicle_id) {
    const { getSupabaseClient } = require('../config/supabase');
    const { data: veh } = await getSupabaseClient()
      .from('user_vehicles')
      .select('*')
      .eq('id', vehicle_id)
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();
    if (!veh) throw new Error('Veículo não encontrado. Cadastre um veículo em Configurações > Veículo.');
    resolvedType = veh.vehicle_type;
    resolvedModel = veh.model || resolvedModel;
    resolvedColor = veh.color || resolvedColor;
    resolvedYear = veh.year || resolvedYear;
    resolvedPlate = veh.plate || resolvedPlate;
    resolvedDocUrl = veh.vehicle_doc_url || resolvedDocUrl;
    resolvedPhotoUrl = veh.vehicle_photo_url || resolvedPhotoUrl;
  }

  if (!resolvedType) throw new Error('vehicle_type é obrigatório (ou forneça vehicle_id)');
  if (!resolvedPlate) throw new Error('vehicle_plate é obrigatório');
  if (!VALID_VEHICLE_TYPES.includes(resolvedType)) {
    throw new Error(`vehicle_type inválido. Opções: ${VALID_VEHICLE_TYPES.join(', ')}. Moto não é permitida para carona.`);
  }

  // Verifica Trust Level
  const passport = await trustPassportService.getPassport(userId);
  if ((passport?.trust_level ?? 1) < MIN_TRUST_DRIVER) {
    throw new Error(`Você precisa ser Vizinho de Confiança (Trust Level ${MIN_TRUST_DRIVER}) para oferecer caronas. Nível atual: ${passport?.trust_level ?? 1}.`);
  }

  const cleanPlate = resolvedPlate.toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Check for existing rejected profile — allow resubmission
  const { data: existing } = await sbService()
    .from('carona_driver_profiles')
    .select('id, verification_status')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing && existing.verification_status === 'rejected') {
    const { data: updated, error: updErr } = await sbService()
      .from('carona_driver_profiles')
      .update({
        vehicle_type: resolvedType,
        vehicle_model: resolvedModel,
        vehicle_color: resolvedColor || null,
        vehicle_year: resolvedYear || null,
        vehicle_plate: cleanPlate,
        vehicle_doc_url: resolvedDocUrl || null,
        vehicle_photo_url: resolvedPhotoUrl || null,
        vehicle_id: vehicle_id || null,
        cnh_url: cnh_url || null,
        verification_status: 'pending',
        verified_at: null,
        verified_by: null,
        rejection_reason: null,
        resubmitted_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single();

    if (updErr) throw new Error(`Erro ao reenviar perfil de motorista: ${updErr.message}`);

    log(fn, 'Perfil de motorista reenviado (pós-rejeição)', { userId, profileId: updated.id, vehicleType: resolvedType });
    return updated;
  }

  const { data: profile, error } = await sb()
    .from('carona_driver_profiles')
    .insert({
      user_id: userId,
      vehicle_type: resolvedType,
      vehicle_model: resolvedModel,
      vehicle_color: resolvedColor || null,
      vehicle_year: resolvedYear || null,
      vehicle_plate: cleanPlate,
      vehicle_doc_url: resolvedDocUrl || null,
      vehicle_photo_url: resolvedPhotoUrl || null,
      vehicle_id: vehicle_id || null,
      cnh_url: cnh_url || null,
      verification_status: 'pending',
    })
    .select()
    .single();

  if (error) {
    // Race condition: profile created between our check and insert
    if (error.code === '23505') {
      // Check if the conflicting profile is rejected — retry as update
      const { data: raceProfile } = await sbService()
        .from('carona_driver_profiles')
        .select('id, verification_status')
        .eq('user_id', userId)
        .maybeSingle();

      if (raceProfile?.verification_status === 'rejected') {
        const { data: retryUpdated, error: retryErr } = await sbService()
          .from('carona_driver_profiles')
          .update({
            vehicle_type: resolvedType,
            vehicle_model: resolvedModel,
            vehicle_color: resolvedColor || null,
            vehicle_year: resolvedYear || null,
            vehicle_plate: cleanPlate,
            vehicle_doc_url: resolvedDocUrl || null,
            vehicle_photo_url: resolvedPhotoUrl || null,
            vehicle_id: vehicle_id || null,
            cnh_url: cnh_url || null,
            verification_status: 'pending',
            verified_at: null,
            verified_by: null,
            rejection_reason: null,
            resubmitted_at: new Date().toISOString(),
          })
          .eq('id', raceProfile.id)
          .select()
          .single();

        if (retryErr) throw new Error(`Erro ao reenviar perfil de motorista: ${retryErr.message}`);

        log(fn, 'Perfil de motorista reenviado (race-condition recovery)', { userId, profileId: retryUpdated.id });
        return retryUpdated;
      }

      throw new Error('Você já possui um perfil de motorista cadastrado.');
    }
    throw new Error(`Erro ao cadastrar perfil de motorista: ${error.message}`);
  }

  log(fn, 'Perfil de motorista cadastrado', { userId, profileId: profile.id, vehicleType: resolvedType });
  return profile;
}

/**
 * Admin verifica veículo do motorista
 */
async function verifyDriver(adminId, profileId, approved, rejectionReason, expiresAt = null) {
  const fn = 'verifyDriver';

  // Detectar se eh re-verificacao (perfil ja foi verificado ou expirou antes)
  const { data: existing } = await sbService()
    .from('carona_driver_profiles')
    .select('verification_status')
    .eq('id', profileId)
    .single();

  const isReverification = existing &&
    (existing.verification_status === 'expired' || existing.verification_status === 'verified');

  const updates = approved
    ? {
        verification_status: 'verified',
        verified_at: new Date().toISOString(),
        verified_by: adminId,
        verification_expires_at: expiresAt || null,
        last_reverification_at: isReverification ? new Date().toISOString() : null,
        doc_expiry_notified_at: null, // Reset notificacao ao re-verificar
      }
    : { verification_status: 'rejected', rejection_reason: rejectionReason, verified_by: adminId };

  const { data: profile, error } = await sbService()
    .from('carona_driver_profiles')
    .update(updates)
    .eq('id', profileId)
    .select()
    .single();

  if (error) throw new Error(`Erro ao verificar motorista: ${error.message}`);

  log(fn, `Motorista ${approved ? 'verificado' : 'rejeitado'}`, {
    adminId, profileId, isReverification,
    expiresAt: expiresAt || 'sem validade',
  });

  // Notificar motorista
  notificationDispatcher.dispatch({
    userId: profile.user_id,
    type: approved ? 'carona_driver_verified' : 'carona_driver_rejected',
    importance: 'high',
    data: { profileId, status: profile.verification_status, reason: rejectionReason },
    metadata: { triggeredBy: 'admin' },
    dedupKey: `carona_verify_${profileId}`,
  }).catch(() => {});

  return profile;
}

/**
 * Busca perfil de motorista do usuário
 */
async function getDriverProfile(userId) {
  const { data, error } = await sb()
    .from('carona_driver_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Erro ao buscar perfil de motorista: ${error.message}`);
  }
  return data || null;
}


// ═══════════════════════════════════════════════════════════════════
// VIAGENS (RIDES)
// ═══════════════════════════════════════════════════════════════════

/**
 * Cria uma viagem de carona solidária
 * Gate: Trust Level 3+ E veículo verified
 */
async function createRide(driverId, data) {
  const fn = 'createRide';
  const {
    origin_address, origin_neighborhood, origin_city, origin_state, origin_cep,
    dest_address, dest_neighborhood, dest_city, dest_state, dest_cep,
    departure_at, total_seats, price_per_seat_brl,
    accepts_luggage, accepts_pets, smoking_allowed, notes,
    luggage_options, pet_options, conversation_level, music_level,
    required_trust_level, accepts_eloscoins,
    stops: rawStops,
  } = data;

  // Validações básicas
  if (!origin_address) throw new Error('origin_address é obrigatório');
  if (!origin_city) throw new Error('origin_city é obrigatório');
  if (!origin_state) throw new Error('origin_state é obrigatório');
  if (!dest_address) throw new Error('dest_address é obrigatório');
  if (!dest_city) throw new Error('dest_city é obrigatório');
  if (!dest_state) throw new Error('dest_state é obrigatório');
  if (!departure_at) throw new Error('departure_at é obrigatório');

  const depDate = new Date(departure_at);
  if (depDate <= new Date()) throw new Error('departure_at deve ser no futuro.');

  const seats = total_seats || 1;
  if (seats < 1 || seats > MAX_SEATS) throw new Error(`total_seats deve ser entre 1 e ${MAX_SEATS}.`);

  // Gate: perfil verificado
  const profile = await getDriverProfile(driverId);
  if (!profile) throw new Error('Você precisa cadastrar um perfil de motorista antes de oferecer caronas.');
  if (profile.verification_status !== 'verified') {
    throw new Error('Seu veículo ainda não foi verificado. Aguarde a aprovação do administrador.');
  }

  // Gate: verificacao nao expirada (CARONA-GAP-007)
  if (profile.verification_expires_at && new Date(profile.verification_expires_at) < new Date()) {
    // Auto-expirar o motorista
    await sbService().from('carona_driver_profiles')
      .update({ verification_status: 'expired' })
      .eq('user_id', driverId);
    throw Object.assign(
      new Error('Sua verificacao expirou. Atualize seus documentos para continuar oferecendo caronas.'),
      { status: 403 }
    );
  }

  // Gate: Trust Level
  const passport = await trustPassportService.getPassport(driverId);
  if ((passport?.trust_level ?? 1) < MIN_TRUST_DRIVER) {
    throw new Error(`Trust Level insuficiente. Mínimo: ${MIN_TRUST_DRIVER}. Atual: ${passport?.trust_level ?? 1}.`);
  }

  // Geocode: CEP (BrasilAPI) → fallback cidade (Google Geocoding)
  const originCoords = await geocodeCep(origin_cep);
  const destCoords = await geocodeCep(dest_cep);

  let origin_lat = data.origin_lat || originCoords?.lat || null;
  let origin_lng = data.origin_lng || originCoords?.lng || null;
  let dest_lat = data.dest_lat || destCoords?.lat || null;
  let dest_lng = data.dest_lng || destCoords?.lng || null;

  // Fallback: geocodificar por cidade se CEP não retornou coordenadas
  if (!origin_lat && origin_city) {
    const geo = await geocodeAddress(`${origin_city}, ${origin_state}, Brasil`).catch(() => null);
    if (geo) { origin_lat = geo.lat; origin_lng = geo.lng; }
  }
  if (!dest_lat && dest_city) {
    const geo = await geocodeAddress(`${dest_city}, ${dest_state}, Brasil`).catch(() => null);
    if (geo) { dest_lat = geo.lat; dest_lng = geo.lng; }
  }

  // ── Validar e geocodar paradas intermediárias (max 3) ────
  const stops = [];
  if (Array.isArray(rawStops) && rawStops.length > 0) {
    for (let i = 0; i < Math.min(rawStops.length, 3); i++) {
      const s = rawStops[i];
      if (!s.city && !s.address) continue;
      let sLat = s.lat || null;
      let sLng = s.lng || null;
      if (!sLat && s.cep) {
        const geo = await geocodeCep(s.cep);
        if (geo) { sLat = geo.lat; sLng = geo.lng; }
      }
      if (!sLat && s.city) {
        const geo = await geocodeAddress(`${s.city}, ${s.state || ''}, Brasil`).catch(() => null);
        if (geo) { sLat = geo.lat; sLng = geo.lng; }
      }
      stops.push({
        stop_order: i,
        address: s.address || s.city,
        neighborhood: s.neighborhood || null,
        city: s.city || null,
        state: s.state || null,
        cep: s.cep || null,
        lat: sLat,
        lng: sLng,
      });
    }
  }

  // Calcular distância, duração e pedágios (Routes API v2 com fallback)
  let route_km = null;
  let duration_minutes = null;
  let distance_source = 'haversine';
  let tollData = null; // { totalBrl, count } ou null

  if (origin_lat && origin_lng && dest_lat && dest_lng) {
    try {
      const validWaypoints = stops.filter(s => s.lat && s.lng).map(s => ({ lat: s.lat, lng: s.lng }));
      const dist = await distanceService.getRouteWithTolls(
        { lat: origin_lat, lng: origin_lng },
        { lat: dest_lat, lng: dest_lng },
        validWaypoints,
      );
      route_km = dist.distanceKm;
      duration_minutes = dist.durationMinutes;
      distance_source = dist.source;
      tollData = dist.tolls;
    } catch (distErr) {
      logWarn(fn, `Distância não calculada: ${distErr.message}`, { driverId });
    }
  }

  // Fallback Haversine se Routes API falhou
  if (!route_km && origin_lat && dest_lat) {
    if (stops.length > 0) {
      const points = [
        { lat: origin_lat, lng: origin_lng },
        ...stops.filter(s => s.lat && s.lng).map(s => ({ lat: s.lat, lng: s.lng })),
        { lat: dest_lat, lng: dest_lng },
      ];
      route_km = 0;
      for (let i = 0; i < points.length - 1; i++) {
        route_km += distanceService.haversineKm(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng) * 1.3;
      }
    } else {
      route_km = distanceService.haversineKm(origin_lat, origin_lng, dest_lat, dest_lng) * 1.3;
    }
    distance_source = 'haversine';
  }

  // Teto legal aplica APENAS sobre o preço base (pedágio é custo real, não lucro)
  let effectivePrice = price_per_seat_brl || 0;
  let legalCap = null;
  if (route_km && route_km > 0) {
    legalCap = Math.round(((route_km * INSS_RATE_PER_KM) / seats) * 100) / 100;
    effectivePrice = Math.min(effectivePrice, legalCap);
  }
  effectivePrice = Math.max(effectivePrice, 0);

  // Pedágio: motorista escolhe split ou absorb
  const toll_split_mode = data.toll_split_mode === 'split' ? 'split' : 'absorb';
  const has_tolls = !!(tollData && tollData.totalBrl > 0);
  const toll_total_brl = has_tolls ? tollData.totalBrl : null;
  const toll_per_seat_brl = has_tolls && toll_split_mode === 'split'
    ? Math.round((tollData.totalBrl / seats) * 100) / 100
    : null;

  // Estimated arrival
  const estimated_arrival = duration_minutes
    ? new Date(depDate.getTime() + duration_minutes * 60000).toISOString()
    : null;

  const { data: ride, error } = await sb()
    .from('carona_rides')
    .insert({
      driver_id: driverId,
      driver_profile_id: profile.id,
      origin_address, origin_neighborhood, origin_city, origin_state, origin_cep,
      origin_lat, origin_lng,
      dest_address, dest_neighborhood, dest_city, dest_state, dest_cep,
      dest_lat, dest_lng,
      departure_at: depDate.toISOString(),
      estimated_arrival,
      duration_minutes: duration_minutes ? Math.round(duration_minutes) : null,
      total_seats: seats,
      seats_available: seats,
      route_km: route_km ? Math.round(route_km * 100) / 100 : null,
      price_per_seat_brl: effectivePrice,
      legal_cap_brl: legalCap,
      distance_source,
      accepts_luggage: accepts_luggage || false,
      accepts_pets: accepts_pets || false,
      smoking_allowed: smoking_allowed || false,
      luggage_options: luggage_options || {},
      pet_options: pet_options || {},
      conversation_level: conversation_level != null ? Math.max(0, Math.min(100, Number(conversation_level))) : 50,
      music_level: music_level != null ? Math.max(0, Math.min(100, Number(music_level))) : 50,
      notes: notes || null,
      required_trust_level: required_trust_level || MIN_TRUST_PASSENGER,
      accepts_eloscoins: false, // desabilitado (2026-07-09)
      has_tolls,
      toll_total_brl,
      toll_per_seat_brl,
      toll_split_mode,
      status: 'open',
    })
    .select()
    .single();

  if (error) throw new Error(`Erro ao criar viagem: ${error.message}`);

  // Inserir paradas intermediárias
  if (stops.length > 0) {
    const stopRows = stops.map(s => ({ ...s, ride_id: ride.id }));
    const { error: stopsErr } = await sbService().from('carona_ride_stops').insert(stopRows);
    if (stopsErr) logWarn(fn, `Erro ao inserir paradas: ${stopsErr.message}`, { rideId: ride.id });
  }

  log(fn, 'Viagem criada', {
    driverId, rideId: ride.id, routeKm: route_km,
    price: effectivePrice, legalCap, seats, stops: stops.length,
    hasTolls: has_tolls, tollTotal: toll_total_brl, tollSplitMode: toll_split_mode,
  });

  gamificationService.triggerEvent('carona_ride_offered', driverId, { rideId: ride.id })
    .catch(err => logWarn(fn, `gamification falhou: ${err.message}`));

  ride.stops = stops;
  return ride;
}

/**
 * Busca caronas disponíveis (passageiro)
 * Fluxo:
 *   1. Se coordenadas vierem direto → RPC PostGIS search_caronas
 *   2. Se só cidade/estado → geocodifica via Google Geocoding → RPC PostGIS
 *   3. Se geocoding falhar → fallback por nome de cidade (query direta)
 */
async function searchRides(passengerId, params) {
  const fn = 'searchRides';
  let {
    pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
    pickup_city, pickup_state, dropoff_city, dropoff_state,
    departure_from, departure_to,
    corridor_km, vehicle_type, max_price, accepts_pets,
    min_seats, limit: queryLimit,
  } = params;

  const hasCoords = pickup_lat && pickup_lng && dropoff_lat && dropoff_lng;
  const hasCities = pickup_city && dropoff_city;

  if (!hasCoords && !hasCities) {
    throw new Error('Informe coordenadas ou cidades de embarque e desembarque.');
  }

  // ── Geocodificar cidades se coordenadas ausentes ─────────
  if (!hasCoords && hasCities) {
    const pickupQuery  = `${pickup_city}, ${pickup_state || 'Brasil'}`;
    const dropoffQuery = `${dropoff_city}, ${dropoff_state || 'Brasil'}`;

    const [pickupGeo, dropoffGeo] = await Promise.all([
      geocodeAddress(pickupQuery),
      geocodeAddress(dropoffQuery),
    ]);

    if (pickupGeo && dropoffGeo) {
      pickup_lat  = pickupGeo.lat;
      pickup_lng  = pickupGeo.lng;
      dropoff_lat = dropoffGeo.lat;
      dropoff_lng = dropoffGeo.lng;
      log(fn, 'Cidades geocodificadas com sucesso', {
        pickup: pickupQuery, dropoff: dropoffQuery,
        pickupGeo, dropoffGeo,
      });
    } else {
      // Geocoding falhou → fallback por nome de cidade
      log(fn, 'Geocoding indisponível, usando fallback por nome de cidade', { pickup_city, dropoff_city });
      return searchRidesByCityName(passengerId, params);
    }
  }

  // ── Busca por coordenadas (PostGIS RPC) ──────────────────
  const { data: results, error } = await sb().rpc('search_caronas', {
    p_pickup_lat:     Number(pickup_lat),
    p_pickup_lng:     Number(pickup_lng),
    p_dropoff_lat:    Number(dropoff_lat),
    p_dropoff_lng:    Number(dropoff_lng),
    p_departure_from: departure_from || new Date().toISOString(),
    p_departure_to:   departure_to || new Date(Date.now() + 30 * 86400000).toISOString(),
    p_corridor_km:    corridor_km ? Number(corridor_km) : 20.0,
    p_vehicle_type:   vehicle_type || null,
    p_max_price:      max_price ? Number(max_price) : null,
    p_accepts_pets:   accepts_pets != null ? accepts_pets : null,
    p_limit:          queryLimit ? Number(queryLimit) : 20,
  });

  if (error) throw new Error(`Erro na busca de caronas: ${error.message}`);
  log(fn, `Busca PostGIS retornou ${results?.length || 0} resultados`, { passengerId });

  // Normaliza ride_id → id para compatibilidade com frontend RideCard
  const normalized = (results || []).map(r => ({ ...r, id: r.ride_id }));

  // Anexar stop_cities por ride
  return _attachStopCities(normalized);
}

/**
 * Fallback: busca por nome de cidade (quando geocoding indisponível)
 */
async function searchRidesByCityName(passengerId, params) {
  const fn = 'searchRidesByCityName';
  const {
    pickup_city, pickup_state, dropoff_city, dropoff_state,
    departure_from, departure_to,
    vehicle_type, max_price, accepts_pets, min_seats, limit: queryLimit,
  } = params;

  let query = sb()
    .from('carona_rides')
    .select(`
      id,
      driver_id,
      driver:users!carona_rides_driver_id_fkey(full_name, avatar_url),
      driver_profile:carona_driver_profiles!carona_rides_driver_profile_id_fkey(vehicle_type, vehicle_model, average_rating, total_rides),
      origin_city, origin_neighborhood, origin_address,
      dest_city, dest_neighborhood, dest_address,
      departure_at, estimated_arrival,
      price_per_seat_brl, legal_cap_brl,
      seats_available, total_seats,
      route_km, duration_minutes, accepts_luggage, accepts_pets, smoking_allowed,
      luggage_options, pet_options, conversation_level, music_level, notes
    `)
    .eq('status', 'open')
    .gt('seats_available', 0)
    .ilike('origin_city', pickup_city)
    .ilike('dest_city', dropoff_city)
    .gte('departure_at', departure_from || new Date().toISOString())
    .lte('departure_at', departure_to || new Date(Date.now() + 30 * 86400000).toISOString())
    .order('departure_at', { ascending: true })
    .limit(queryLimit ? Number(queryLimit) : 20);

  if (pickup_state) query = query.ilike('origin_state', pickup_state);
  if (dropoff_state) query = query.ilike('dest_state', dropoff_state);
  if (max_price) query = query.lte('price_per_seat_brl', Number(max_price));
  if (accepts_pets != null) query = query.eq('accepts_pets', accepts_pets);
  if (min_seats) query = query.gte('seats_available', Number(min_seats));

  const { data: results, error } = await query;
  if (error) throw new Error(`Erro na busca de caronas: ${error.message}`);

  const normalized = (results || []).map(r => ({
    id:                 r.id,
    ride_id:            r.id,
    driver_id:          r.driver_id,
    driver_name:        r.driver?.full_name || null,
    driver_photo:       r.driver?.avatar_url || null,
    origin_city:        r.origin_city,
    origin_neighborhood:r.origin_neighborhood,
    origin_address:     r.origin_address,
    dest_city:          r.dest_city,
    dest_neighborhood:  r.dest_neighborhood,
    dest_address:       r.dest_address,
    departure_at:       r.departure_at,
    estimated_arrival:  r.estimated_arrival,
    price_per_seat_brl: r.price_per_seat_brl,
    legal_cap_brl:      r.legal_cap_brl,
    seats_available:    r.seats_available,
    total_seats:        r.total_seats,
    vehicle_type:       r.driver_profile?.vehicle_type || null,
    vehicle_model:      r.driver_profile?.vehicle_model || null,
    route_km:           r.route_km,
    duration_minutes:   r.duration_minutes,
    accepts_luggage:    r.accepts_luggage,
    accepts_pets:       r.accepts_pets,
    smoking_allowed:    r.smoking_allowed,
    luggage_options:    r.luggage_options || {},
    pet_options:        r.pet_options || {},
    conversation_level: r.conversation_level ?? 50,
    music_level:        r.music_level ?? 50,
    notes:              r.notes,
    driver_avg_rating:  r.driver_profile?.average_rating || 0,
    driver_total_rides: r.driver_profile?.total_rides || 0,
    pickup_detour_km:   null,
    dropoff_detour_km:  null,
    match_score:        null,
  }));

  log(fn, `Fallback por cidade retornou ${normalized.length} resultados`, { passengerId, pickup_city, dropoff_city });

  // Anexar stop_cities por ride
  return _attachStopCities(normalized);
}

/**
 * Busca cidades das paradas intermediárias para um array de rides
 * e anexa stop_cities em cada resultado.
 */
async function _attachStopCities(rides) {
  if (!rides?.length) return rides;

  const rideIds = rides.map(r => r.id || r.ride_id).filter(Boolean);
  if (!rideIds.length) return rides;

  const { data: allStops } = await sb()
    .from('carona_ride_stops')
    .select('ride_id, city, stop_order')
    .in('ride_id', rideIds)
    .order('stop_order', { ascending: true });

  if (!allStops?.length) {
    return rides.map(r => ({ ...r, stop_cities: [] }));
  }

  const stopsByRide = {};
  for (const s of allStops) {
    if (!stopsByRide[s.ride_id]) stopsByRide[s.ride_id] = [];
    if (s.city) stopsByRide[s.ride_id].push(s.city);
  }

  return rides.map(r => ({
    ...r,
    stop_cities: stopsByRide[r.id || r.ride_id] || [],
  }));
}

/**
 * Lista caronas adicionadas recentemente (aberta, partida futura)
 */
async function listRecentRides({ sort = 'recent', limit: queryLimit = 10 } = {}) {
  const fn = 'listRecentRides';

  let query = sb()
    .from('carona_rides')
    .select(`
      id,
      driver_id,
      driver:users!carona_rides_driver_id_fkey(full_name, avatar_url),
      driver_profile:carona_driver_profiles!carona_rides_driver_profile_id_fkey(vehicle_type, vehicle_model, average_rating, total_rides),
      origin_city, origin_neighborhood, origin_address, origin_state, origin_lat, origin_lng,
      dest_city, dest_neighborhood, dest_address, dest_state, dest_lat, dest_lng,
      departure_at, estimated_arrival,
      price_per_seat_brl, legal_cap_brl,
      seats_available, total_seats,
      route_km, duration_minutes, accepts_luggage, accepts_pets, smoking_allowed, notes,
      created_at
    `)
    .eq('status', 'open')
    .gt('seats_available', 0)
    .gte('departure_at', new Date().toISOString())
    .limit(queryLimit ? Number(queryLimit) : 10);

  // Ordenação
  if (sort === 'price') {
    query = query.order('price_per_seat_brl', { ascending: true, nullsFirst: true });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  const { data: results, error } = await query;
  if (error) throw new Error(`Erro ao listar caronas recentes: ${error.message}`);

  const normalized = (results || []).map(r => ({
    id:                 r.id,
    driver_id:          r.driver_id,
    driver_name:        r.driver?.full_name || null,
    driver_photo:       r.driver?.avatar_url || null,
    origin_city:        r.origin_city,
    origin_neighborhood:r.origin_neighborhood,
    origin_address:     r.origin_address,
    origin_lat:         r.origin_lat,
    origin_lng:         r.origin_lng,
    dest_city:          r.dest_city,
    dest_neighborhood:  r.dest_neighborhood,
    dest_address:       r.dest_address,
    dest_lat:           r.dest_lat,
    dest_lng:           r.dest_lng,
    departure_at:       r.departure_at,
    estimated_arrival:  r.estimated_arrival,
    price_per_seat_brl: r.price_per_seat_brl,
    legal_cap_brl:      r.legal_cap_brl,
    seats_available:    r.seats_available,
    total_seats:        r.total_seats,
    vehicle_type:       r.driver_profile?.vehicle_type || null,
    vehicle_model:      r.driver_profile?.vehicle_model || null,
    route_km:           r.route_km,
    duration_minutes:   r.duration_minutes,
    accepts_luggage:    r.accepts_luggage,
    accepts_pets:       r.accepts_pets,
    smoking_allowed:    r.smoking_allowed,
    luggage_options:    r.luggage_options || {},
    pet_options:        r.pet_options || {},
    conversation_level: r.conversation_level ?? 50,
    music_level:        r.music_level ?? 50,
    notes:              r.notes,
    driver_avg_rating:  r.driver_profile?.average_rating || 0,
    driver_total_rides: r.driver_profile?.total_rides || 0,
    average_rating:     r.driver_profile?.average_rating || 0,
    created_at:         r.created_at,
  }));

  log(fn, `Retornou ${normalized.length} caronas recentes`, { sort });
  return normalized;
}

/**
 * Detalhe de uma viagem
 */
async function getRideDetail(userId, rideId) {
  const fn = 'getRideDetail';

  const { data: ride, error } = await sb()
    .from('carona_rides')
    .select(`
      *,
      driver:users!carona_rides_driver_id_fkey(id, full_name, avatar_url),
      driver_profile:carona_driver_profiles!carona_rides_driver_profile_id_fkey(
        vehicle_type, vehicle_model, vehicle_color, average_rating, total_rides, verification_status
      )
    `)
    .eq('id', rideId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') throw new Error('Viagem não encontrada.'); // no rows
    logWarn(fn, `getRideDetail query error: ${error.message}`, { rideId, code: error.code });
    throw new Error('Viagem não encontrada.');
  }

  // Buscar seats confirmados (motorista vê todos, passageiro vê os seus)
  const isDriver = ride.driver_id === userId;

  let seatsQuery = sb()
    .from('carona_seats')
    .select(`
      id, passenger_id, pickup_address, pickup_city, dropoff_address, dropoff_city,
      status, amount_brl, platform_fee_brl, boarded_at, completed_at,
      seats_booked, is_pet_seat,
      passenger:users!carona_seats_passenger_id_fkey(id, full_name, avatar_url)
    `)
    .eq('ride_id', rideId)
    .not('status', 'in', '("cancelled_passenger","cancelled_driver")');

  if (!isDriver) {
    seatsQuery = seatsQuery.eq('passenger_id', userId);
  }

  const { data: seats } = await seatsQuery;

  // Flatten driver info para formato esperado pelo frontend
  const result = {
    ...ride,
    driver_name: ride.driver?.full_name || null,
    driver_avatar_url: ride.driver?.avatar_url || null,
  };
  delete result.driver; // remove nested object

  if (!isDriver) {
    const hasConfirmedSeat = seats?.some(s => s.passenger_id === userId);
    if (!hasConfirmedSeat) {
      delete result.driver_profile?.vehicle_plate;
    }
  }

  // Flatten passenger info em cada seat
  result.seats = (seats || []).map(s => ({
    ...s,
    passenger_name: s.passenger?.full_name || null,
    passenger_avatar_url: s.passenger?.avatar_url || null,
    passenger: undefined,
  }));

  // Buscar paradas intermediárias
  const { data: rideStops } = await sb()
    .from('carona_ride_stops')
    .select('id, stop_order, address, neighborhood, city, state, cep, lat, lng')
    .eq('ride_id', rideId)
    .order('stop_order', { ascending: true });

  result.stops = rideStops || [];
  return result;
}

/**
 * Atualiza viagem (pré-partida apenas)
 */
async function updateRide(driverId, rideId, updates) {
  const fn = 'updateRide';

  const { data: ride } = await sb()
    .from('carona_rides')
    .select('id, driver_id, status')
    .eq('id', rideId)
    .single();

  if (!ride) throw new Error('Viagem não encontrada.');
  if (ride.driver_id !== driverId) throw new Error('Você não é o motorista desta viagem.');
  if (!['open', 'full'].includes(ride.status)) throw new Error('Viagem não pode ser editada neste status.');

  // Campos editáveis
  const allowed = [
    'departure_at', 'notes', 'accepts_luggage', 'accepts_pets', 'smoking_allowed',
    'luggage_options', 'pet_options', 'conversation_level', 'music_level',
    'price_per_seat_brl', 'total_seats', 'toll_split_mode',
  ];
  const filtered = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) filtered[key] = updates[key];
  }

  const hasStopsUpdate = updates.stops !== undefined;
  if (Object.keys(filtered).length === 0 && !hasStopsUpdate) {
    throw new Error('Nenhum campo válido para atualizar.');
  }

  // Atualizar paradas intermediárias
  if (hasStopsUpdate) {
    // Deletar paradas existentes
    await sbService().from('carona_ride_stops').delete().eq('ride_id', rideId);

    const newStops = Array.isArray(updates.stops) ? updates.stops.slice(0, 3) : [];
    if (newStops.length > 0) {
      const stopRows = [];
      for (let i = 0; i < newStops.length; i++) {
        const s = newStops[i];
        if (!s.city && !s.address) continue;
        let sLat = s.lat || null;
        let sLng = s.lng || null;
        if (!sLat && s.cep) {
          const geo = await geocodeCep(s.cep);
          if (geo) { sLat = geo.lat; sLng = geo.lng; }
        }
        if (!sLat && s.city) {
          const geo = await geocodeAddress(`${s.city}, ${s.state || ''}, Brasil`).catch(() => null);
          if (geo) { sLat = geo.lat; sLng = geo.lng; }
        }
        stopRows.push({
          ride_id: rideId,
          stop_order: i,
          address: s.address || s.city,
          neighborhood: s.neighborhood || null,
          city: s.city || null,
          state: s.state || null,
          cep: s.cep || null,
          lat: sLat,
          lng: sLng,
        });
      }
      if (stopRows.length > 0) {
        await sbService().from('carona_ride_stops').insert(stopRows);
      }

      // Recalcular distância com novos waypoints
      const { data: fullRide } = await sb().from('carona_rides')
        .select('origin_lat, origin_lng, dest_lat, dest_lng, total_seats')
        .eq('id', rideId).single();

      if (fullRide?.origin_lat && fullRide?.dest_lat) {
        const validWaypoints = stopRows.filter(s => s.lat && s.lng).map(s => ({ lat: s.lat, lng: s.lng }));
        try {
          const dist = await distanceService.getRouteWithTolls(
            { lat: fullRide.origin_lat, lng: fullRide.origin_lng },
            { lat: fullRide.dest_lat, lng: fullRide.dest_lng },
            validWaypoints,
          );
          if (dist.distanceKm) {
            filtered.route_km = dist.distanceKm;
            filtered.duration_minutes = dist.durationMinutes;
            filtered.distance_source = dist.source;
            const seats = filtered.total_seats || fullRide.total_seats;
            filtered.legal_cap_brl = Math.round(((dist.distanceKm * INSS_RATE_PER_KM) / seats) * 100) / 100;
            if (filtered.price_per_seat_brl != null) {
              filtered.price_per_seat_brl = Math.min(filtered.price_per_seat_brl, filtered.legal_cap_brl);
            }
            filtered.estimated_arrival = dist.durationMinutes
              ? new Date(new Date(ride.departure_at || updates.departure_at).getTime() + dist.durationMinutes * 60000).toISOString()
              : null;
            // Recalcular pedágio
            const hasTolls = !!(dist.tolls && dist.tolls.totalBrl > 0);
            const splitMode = filtered.toll_split_mode || fullRide.toll_split_mode || 'absorb';
            filtered.has_tolls = hasTolls;
            filtered.toll_total_brl = hasTolls ? dist.tolls.totalBrl : null;
            filtered.toll_per_seat_brl = hasTolls && splitMode === 'split'
              ? Math.round((dist.tolls.totalBrl / seats) * 100) / 100 : null;
          }
        } catch (distErr) {
          logWarn(fn, `Recalc distância falhou: ${distErr.message}`, { rideId });
        }
      }
    } else {
      // Sem paradas — recalcular distância direta
      const { data: fullRide } = await sb().from('carona_rides')
        .select('origin_lat, origin_lng, dest_lat, dest_lng, total_seats, departure_at, toll_split_mode')
        .eq('id', rideId).single();

      if (fullRide?.origin_lat && fullRide?.dest_lat) {
        try {
          const dist = await distanceService.getRouteWithTolls(
            { lat: fullRide.origin_lat, lng: fullRide.origin_lng },
            { lat: fullRide.dest_lat, lng: fullRide.dest_lng },
            [],
          );
          if (dist.distanceKm) {
            filtered.route_km = dist.distanceKm;
            filtered.duration_minutes = dist.durationMinutes;
            filtered.distance_source = dist.source;
            const seats = filtered.total_seats || fullRide.total_seats;
            filtered.legal_cap_brl = Math.round(((dist.distanceKm * INSS_RATE_PER_KM) / seats) * 100) / 100;
            if (filtered.price_per_seat_brl != null) {
              filtered.price_per_seat_brl = Math.min(filtered.price_per_seat_brl, filtered.legal_cap_brl);
            }
            // Recalcular pedágio
            const hasTolls = !!(dist.tolls && dist.tolls.totalBrl > 0);
            const splitMode = filtered.toll_split_mode || fullRide.toll_split_mode || 'absorb';
            filtered.has_tolls = hasTolls;
            filtered.toll_total_brl = hasTolls ? dist.tolls.totalBrl : null;
            filtered.toll_per_seat_brl = hasTolls && splitMode === 'split'
              ? Math.round((dist.tolls.totalBrl / seats) * 100) / 100 : null;
          }
        } catch (distErr) {
          logWarn(fn, `Recalc distância falhou: ${distErr.message}`, { rideId });
        }
      }
    }
  }

  // Recalcular teto se preço mudou (sem update de stops)
  if (!hasStopsUpdate && filtered.price_per_seat_brl != null) {
    const { data: fullRide } = await sb().from('carona_rides').select('route_km, total_seats').eq('id', rideId).single();
    const seats = filtered.total_seats || fullRide.total_seats;
    if (fullRide.route_km) {
      const legalCap = Math.round(((fullRide.route_km * INSS_RATE_PER_KM) / seats) * 100) / 100;
      filtered.price_per_seat_brl = Math.min(filtered.price_per_seat_brl, legalCap);
      filtered.legal_cap_brl = legalCap;
    }
  }

  // Recalcular toll_per_seat_brl se toll_split_mode mudou (sem update de rota)
  if (!hasStopsUpdate && filtered.toll_split_mode) {
    const { data: fullRide } = await sb().from('carona_rides')
      .select('toll_total_brl, has_tolls, total_seats')
      .eq('id', rideId).single();
    if (fullRide?.has_tolls && fullRide.toll_total_brl) {
      const seats = filtered.total_seats || fullRide.total_seats;
      filtered.toll_per_seat_brl = filtered.toll_split_mode === 'split'
        ? Math.round((fullRide.toll_total_brl / seats) * 100) / 100
        : null;
    }
  }

  let updated;
  if (Object.keys(filtered).length > 0) {
    const { data: updatedData, error: updateError } = await sb()
      .from('carona_rides')
      .update(filtered)
      .eq('id', rideId)
      .select()
      .single();
    if (updateError) throw new Error(`Erro ao atualizar viagem: ${updateError.message}`);
    updated = updatedData;
  } else {
    const { data: refetch } = await sb().from('carona_rides').select().eq('id', rideId).single();
    updated = refetch;
  }

  log(fn, 'Viagem atualizada', { driverId, rideId, fields: Object.keys(filtered), stopsUpdated: hasStopsUpdate });

  // Notificar passageiros confirmados
  const { data: seats } = await sb()
    .from('carona_seats')
    .select('passenger_id')
    .eq('ride_id', rideId)
    .in('status', ['confirmed', 'pending_payment']);

  if (seats?.length) {
    for (const seat of seats) {
      socketManager.emitToUser(seat.passenger_id, 'carona:ride_updated', {
        rideId, changes: Object.keys(filtered),
      });
    }
  }

  return updated;
}

/**
 * Cancela viagem (motorista)
 * Cascata: cancela todos os seats, void Stripe holds
 */
async function cancelRide(driverId, rideId, reason) {
  const fn = 'cancelRide';

  const { data: ride } = await sb()
    .from('carona_rides')
    .select('id, driver_id, status, departure_at')
    .eq('id', rideId)
    .single();

  if (!ride) throw new Error('Viagem não encontrada.');
  if (ride.driver_id !== driverId) throw new Error('Você não é o motorista desta viagem.');
  if (['completed', 'cancelled', 'expired'].includes(ride.status)) {
    throw new Error('Viagem não pode ser cancelada neste status.');
  }

  // Cancela a viagem
  const { error } = await sb()
    .from('carona_rides')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason || null,
    })
    .eq('id', rideId);

  if (error) throw new Error(`Erro ao cancelar viagem: ${error.message}`);

  // Busca seats ativos para cancelar e void Stripe
  const { data: activeSeats } = await sb()
    .from('carona_seats')
    .select('id, passenger_id, payment_intent_id, payment_status, status')
    .eq('ride_id', rideId)
    .in('status', ['pending_payment', 'confirmed']);

  if (activeSeats?.length) {
    for (const seat of activeSeats) {
      // Cancelar seat
      await sb()
        .from('carona_seats')
        .update({
          status: 'cancelled_driver',
          cancellation_reason: reason || 'Motorista cancelou a viagem',
          cancelled_at: new Date().toISOString(),
        })
        .eq('id', seat.id);

      // Void Asaas hold (refund em AUTHORIZED = void)
      if (seat.payment_intent_id && seat.payment_status === 'authorized') {
        try {
          await asaasService.refundPayment(seat.payment_intent_id);
          await _recordBillingEvent(seat.id, rideId, seat.passenger_id, 'void', 0, 0);
          log(fn, 'Asaas hold cancelado', { seatId: seat.id, paymentId: seat.payment_intent_id });
        } catch (voidErr) {
          logError(fn, voidErr, { seatId: seat.id, severity: 'HIGH' });
        }
      }

      // Notificar passageiro
      socketManager.emitToUser(seat.passenger_id, 'carona:ride_cancelled', {
        rideId, reason: reason || 'Motorista cancelou',
      });

      notificationDispatcher.dispatch({
        userId: seat.passenger_id,
        type: 'carona_ride_cancelled',
        importance: 'high',
        data: { rideId, reason },
        metadata: { triggeredBy: 'driver' },
        dedupKey: `carona_cancelled_${seat.id}`,
      }).catch(() => {});
    }
  }

  // Trust event negativo se cancelou perto da partida (< 2h)
  const hoursUntilDeparture = (new Date(ride.departure_at) - Date.now()) / 3600000;
  if (hoursUntilDeparture < 2 && activeSeats?.length > 0) {
    trustPassportService.recordEvent(driverId, 'mobility', 'ride_cancelled_driver', -3, true, { rideId })
      .catch(err => logWarn(fn, `trust event falhou: ${err.message}`));
  }

  log(fn, 'Viagem cancelada', { driverId, rideId, seatsAffected: activeSeats?.length || 0 });
  return { cancelled: true, seatsAffected: activeSeats?.length || 0 };
}


// ═══════════════════════════════════════════════════════════════════
// RESERVA DE VAGAS (SEATS)
// ═══════════════════════════════════════════════════════════════════

/**
 * Reserva vaga em carona
 * Stripe manual capture: hold ao reservar
 */
async function bookSeat(passengerId, rideId, data) {
  const fn = 'bookSeat';
  const {
    pickup_address, pickup_city, pickup_lat, pickup_lng,
    dropoff_address, dropoff_city, dropoff_lat, dropoff_lng,
    pickup_neighborhood, dropoff_neighborhood,
    pet_extra_seat,
  } = data;

  if (!pickup_address) throw new Error('pickup_address é obrigatório.');
  if (!pickup_city) throw new Error('pickup_city é obrigatório.');
  if (!dropoff_address) throw new Error('dropoff_address é obrigatório.');
  if (!dropoff_city) throw new Error('dropoff_city é obrigatório.');

  // Busca ride
  const { data: ride } = await sb()
    .from('carona_rides')
    .select('*, driver_profile:carona_driver_profiles!carona_rides_driver_profile_id_fkey(vehicle_model)')
    .eq('id', rideId)
    .single();

  if (!ride) throw new Error('Viagem não encontrada.');
  if (ride.status !== 'open') throw new Error('Esta viagem não está aceitando passageiros.');
  if (ride.driver_id === passengerId) throw new Error('Motorista não pode reservar vaga na própria viagem.');

  // Pet extra seat: validar que a carona aceita e que há vagas suficientes
  const isPetSeat = !!pet_extra_seat && ride.pet_options?.extra_seat;
  const seatsCount = isPetSeat ? 2 : 1;

  if (isPetSeat && ride.seats_available < 2) {
    throw new Error('Vagas insuficientes para reserva com pet (necessário 2 vagas).');
  }

  // Trust gate passageiro
  const passport = await trustPassportService.getPassport(passengerId);
  if ((passport?.trust_level ?? 1) < (ride.required_trust_level || MIN_TRUST_PASSENGER)) {
    throw new Error(`Trust Level insuficiente. Mínimo: ${ride.required_trust_level}. Atual: ${passport?.trust_level ?? 1}.`);
  }

  // Reserva atômica via RPC (p_seats_count para pet extra seat)
  const { data: bookResult, error: bookErr } = await sb().rpc('book_carona_seat', {
    p_ride_id: rideId,
    p_passenger_id: passengerId,
    p_seats_count: seatsCount,
  });

  if (bookErr) throw new Error(`Erro ao reservar vaga: ${bookErr.message}`);
  if (!bookResult?.success) throw new Error(bookResult?.message || 'Não foi possível reservar a vaga.');

  // Determinar taxa da plataforma
  const sub = await subscriptionService.getActiveSubscription(passengerId);
  const platformFee = (sub && sub.status === 'active') ? 0.00 : PLATFORM_FEE_BRL;
  const seatPrice = ride.price_per_seat_brl * seatsCount; // 2× preço para pet extra seat
  const totalAmount = seatPrice + platformFee;

  // Calcular desvio do segmento
  let segmentKm = null;
  if (pickup_lat && pickup_lng && dropoff_lat && dropoff_lng && ride.route_km) {
    const pickupDetour = distanceService.haversineKm(ride.origin_lat, ride.origin_lng, pickup_lat, pickup_lng)
      + distanceService.haversineKm(pickup_lat, pickup_lng, ride.dest_lat, ride.dest_lng) - ride.route_km;
    segmentKm = Math.max(0, Math.round(pickupDetour * 100) / 100);
  }

  // Criar seat row
  const { data: seat, error: seatErr } = await sb()
    .from('carona_seats')
    .insert({
      ride_id: rideId,
      passenger_id: passengerId,
      pickup_address, pickup_neighborhood: pickup_neighborhood || null,
      pickup_city, pickup_lat: pickup_lat || null, pickup_lng: pickup_lng || null,
      dropoff_address, dropoff_neighborhood: dropoff_neighborhood || null,
      dropoff_city, dropoff_lat: dropoff_lat || null, dropoff_lng: dropoff_lng || null,
      segment_km: segmentKm,
      amount_brl: seatPrice,
      platform_fee_brl: platformFee,
      seats_booked: seatsCount,
      is_pet_seat: isPetSeat,
      status: 'pending_payment',
    })
    .select()
    .single();

  if (seatErr) {
    // Rollback: devolver vaga(s)
    await sb().rpc('release_carona_seat', { p_ride_id: rideId, p_seats_count: seatsCount });
    throw new Error(`Erro ao criar reserva: ${seatErr.message}`);
  }

  // Asaas authorizeOnly (hold)
  let paymentId = null;
  try {
    const customer = await asaasService.createCustomer({
      name: `Passageiro ${passengerId}`,
      externalReference: passengerId,
    });

    const result = await asaasService.authorizeCardPayment({
      customerId: customer.id,
      value: totalAmount,
      description: `Carona Solidária: ${ride.origin_city} → ${ride.dest_city}`,
      externalReference: `carona_seat:${seat.id}`,
    });

    paymentId = result.paymentId;

    await sbService()
      .from('carona_seats')
      .update({ payment_intent_id: paymentId })
      .eq('id', seat.id);

    log(fn, 'Asaas hold criado', { seatId: seat.id, paymentId });
  } catch (paymentErr) {
    logError(fn, paymentErr, { seatId: seat.id });
    // Rollback seat e vaga(s)
    await sb().from('carona_seats').update({ status: 'cancelled_passenger', cancellation_reason: 'payment_init_failed' }).eq('id', seat.id);
    await sb().rpc('release_carona_seat', { p_ride_id: rideId, p_seats_count: seatsCount });
    throw new Error(`Erro ao inicializar pagamento: ${paymentErr.message}`);
  }

  // Billing event
  await _recordBillingEvent(
    seat.id, rideId, passengerId,
    platformFee > 0 ? 'fee_charged' : 'fee_waived_subscriber',
    totalAmount, platformFee,
  );

  // Notificar motorista (realtime + push)
  socketManager.emitToUser(ride.driver_id, 'carona:seat_booked', {
    rideId, seatId: seat.id, passengerId,
    pickupCity: pickup_city, dropoffCity: dropoff_city,
  });
  notificationDispatcher.dispatch({
    userId: ride.driver_id,
    type: 'carona_seat_booked',
    importance: 'high',
    data: { rideId, seatId: seat.id },
    dedupKey: `carona_seat_booked_${seat.id}`,
  }).catch(() => {});

  gamificationService.triggerEvent('carona_seat_booked', passengerId, { rideId, seatId: seat.id })
    .catch(err => logWarn(fn, `gamification falhou: ${err.message}`));

  // Fire-and-forget: create conversation between driver and passenger via system message
  try {
    const MessageService = require('./messageService');
    const departureStr = new Date(ride.departure_at).toLocaleDateString('pt-BR');
    MessageService.createMessage({
      sender: passengerId,
      recipient: ride.driver_id,
      content: `Reserva confirmada para ${ride.origin_city} \u2192 ${ride.dest_city} em ${departureStr}`,
      type: 'system',
    }).catch(err => logWarn(fn, `Failed to create ride conversation message: ${err.message}`, { rideId }));
  } catch (err) {
    logWarn(fn, `Failed to create ride conversation message: ${err.message}`, { rideId });
  }

  log(fn, 'Vaga reservada', { passengerId, rideId, seatId: seat.id, amount: totalAmount });
  return { seat, paymentId };
}

/**
 * Confirma pagamento do seat (chamado após Asaas confirma authorization)
 */
async function confirmSeatPayment(seatId, paymentIntentId) {
  const fn = 'confirmSeatPayment';

  const { error } = await sbService()
    .from('carona_seats')
    .update({ payment_status: 'authorized', status: 'confirmed' })
    .eq('id', seatId)
    .eq('payment_intent_id', paymentIntentId);

  if (error) throw new Error(`Erro ao confirmar pagamento: ${error.message}`);
  log(fn, 'Pagamento autorizado', { seatId, paymentIntentId });
}

/**
 * Passageiro cancela reserva
 */
async function cancelSeat(passengerId, seatId) {
  const fn = 'cancelSeat';

  const { data: seat } = await sb()
    .from('carona_seats')
    .select('id, ride_id, passenger_id, payment_intent_id, payment_status, status, seats_booked')
    .eq('id', seatId)
    .single();

  if (!seat) throw new Error('Reserva não encontrada.');
  if (seat.passenger_id !== passengerId) throw new Error('Você não é o passageiro desta reserva.');
  if (['completed', 'cancelled_passenger', 'cancelled_driver'].includes(seat.status)) {
    throw new Error('Reserva não pode ser cancelada neste status.');
  }

  // Verificar se é cancelamento tardio (< 2h antes da partida)
  const { data: ride } = await sb()
    .from('carona_rides')
    .select('driver_id, departure_at, origin_city, dest_city')
    .eq('id', seat.ride_id)
    .single();

  const hoursUntilDeparture = ride?.departure_at
    ? (new Date(ride.departure_at) - Date.now()) / 3600000
    : Infinity;
  const isLateCancellation = hoursUntilDeparture < LATE_CANCEL_WINDOW_HOURS;

  // Cancelar seat
  await sb()
    .from('carona_seats')
    .update({
      status: 'cancelled_passenger',
      cancelled_at: new Date().toISOString(),
    })
    .eq('id', seatId);

  // Void Asaas hold (sempre reembolsa — penalidade é social, não financeira)
  if (seat.payment_intent_id && seat.payment_status === 'authorized') {
    try {
      await asaasService.refundPayment(seat.payment_intent_id);
      await _recordBillingEvent(seatId, seat.ride_id, passengerId, 'void', 0, 0);
    } catch (voidErr) {
      logError(fn, voidErr, { seatId, severity: 'HIGH' });
    }
  }

  // Penalidade Trust para cancelamento tardio (fire-and-forget)
  if (isLateCancellation) {
    trustPassportService.recordEvent(
      passengerId, 'mobility', 'ride_cancelled_passenger_late',
      LATE_CANCEL_TRUST_PENALTY, true,
      { seatId, rideId: seat.ride_id, hoursUntilDeparture: Math.max(0, hoursUntilDeparture).toFixed(1) },
    ).catch(err => logWarn(fn, `trust event falhou: ${err.message}`));

    _recordBillingEvent(seatId, seat.ride_id, passengerId, 'late_cancel_penalty', 0, 0)
      .catch(() => {});

    log(fn, 'Cancelamento tardio — Trust penalty aplicado', {
      passengerId, seatId, rideId: seat.ride_id,
      hoursUntilDeparture: hoursUntilDeparture.toFixed(1),
    });
  }

  // Devolver vaga(s) — seats_booked pode ser 2 para pet extra seat
  await sb().rpc('release_carona_seat', { p_ride_id: seat.ride_id, p_seats_count: seat.seats_booked || 1 });

  // Notificar waitlist (fire-and-forget) — CARONA-GAP-005
  setImmediate(() => {
    _notifyWaitlist(seat.ride_id, ride).catch(() => {});
  });

  // Notificar motorista (realtime + push)
  if (ride) {
    socketManager.emitToUser(ride.driver_id, 'carona:seat_cancelled', {
      rideId: seat.ride_id, seatId, passengerId, isLateCancellation,
    });
    notificationDispatcher.dispatch({
      userId: ride.driver_id,
      type: 'carona_seat_cancelled',
      importance: 'high',
      data: { rideId: seat.ride_id, seatId, isLateCancellation },
      dedupKey: `carona_seat_cancelled_${seatId}`,
    }).catch(() => {});
  }

  log(fn, 'Reserva cancelada', { passengerId, seatId, rideId: seat.ride_id, isLateCancellation });
  return { cancelled: true, isLateCancellation };
}


// ═══════════════════════════════════════════════════════════════════
// FLUXO DA VIAGEM (CHECK-IN, EMBARQUE, DESEMBARQUE)
// ═══════════════════════════════════════════════════════════════════

/**
 * Motorista faz check-in: viagem parte
 * Captura pagamentos de todos os seats confirmados
 */
async function driverCheckin(driverId, rideId) {
  const fn = 'driverCheckin';

  const { data: ride } = await sb()
    .from('carona_rides')
    .select('id, driver_id, status')
    .eq('id', rideId)
    .single();

  if (!ride) throw new Error('Viagem não encontrada.');
  if (ride.driver_id !== driverId) throw new Error('Você não é o motorista desta viagem.');
  if (!['open', 'full'].includes(ride.status)) throw new Error('Viagem não pode partir neste status.');

  // Verificar se tem pelo menos 1 passageiro confirmado
  const { data: confirmedSeats } = await sb()
    .from('carona_seats')
    .select('id, passenger_id, payment_intent_id, payment_status, amount_brl, platform_fee_brl')
    .eq('ride_id', rideId)
    .eq('status', 'confirmed');

  if (!confirmedSeats?.length) throw new Error('Nenhum passageiro confirmado. Não é possível partir.');

  // Marcar viagem como departed
  await sb()
    .from('carona_rides')
    .update({ status: 'departed', departed_at: new Date().toISOString() })
    .eq('id', rideId);

  // Capturar pagamentos de todos os seats confirmados (throttle 200ms entre chamadas)
  for (const seat of confirmedSeats) {
    if (seat.payment_intent_id && seat.payment_status === 'authorized') {
      try {
        await asaasService.captureAuthorizedPayment(seat.payment_intent_id);
        await sbService()
          .from('carona_seats')
          .update({ payment_status: 'captured' })
          .eq('id', seat.id);
        await _recordBillingEvent(seat.id, rideId, seat.passenger_id, 'capture', seat.amount_brl, seat.platform_fee_brl);
        log(fn, 'Pagamento capturado', { seatId: seat.id });
        // Throttle para evitar rate limit
        if (confirmedSeats.indexOf(seat) < confirmedSeats.length - 1) {
          await new Promise(r => setTimeout(r, 200));
        }
      } catch (captureErr) {
        logError(fn, captureErr, { seatId: seat.id, severity: 'HIGH' });
      }
    }
  }

  // Cancelar seats não confirmados (pending_payment)
  await sb()
    .from('carona_seats')
    .update({ status: 'cancelled_driver', cancellation_reason: 'Viagem partiu', cancelled_at: new Date().toISOString() })
    .eq('ride_id', rideId)
    .eq('status', 'pending_payment');

  // Notificar passageiros (realtime + push)
  for (const seat of confirmedSeats) {
    socketManager.emitToUser(seat.passenger_id, 'carona:ride_departed', { rideId });
    notificationDispatcher.dispatch({
      userId: seat.passenger_id,
      type: 'carona_ride_departed',
      importance: 'high',
      data: { rideId },
      dedupKey: `carona_departed_${rideId}_${seat.passenger_id}`,
    }).catch(() => {});
  }

  // Emitir para room da viagem
  socketManager.emitToRoom(`carona:ride:${rideId}`, 'carona:ride_departed', {
    rideId, departedAt: new Date().toISOString(),
  });

  log(fn, 'Viagem partiu', { driverId, rideId, passengersCount: confirmedSeats.length });
  return { departed: true, passengers: confirmedSeats.length };
}

/**
 * Passageiro embarca (check-in digital)
 */
async function passengerBoard(driverId, seatId, coords) {
  const fn = 'passengerBoard';

  const { data: seat } = await sb()
    .from('carona_seats')
    .select('id, ride_id, passenger_id, status')
    .eq('id', seatId)
    .single();

  if (!seat) throw new Error('Reserva não encontrada.');
  if (seat.status !== 'confirmed') throw new Error('Passageiro não está confirmado.');

  // Verificar que é o motorista da viagem
  const { data: ride } = await sb()
    .from('carona_rides')
    .select('driver_id, status')
    .eq('id', seat.ride_id)
    .single();

  if (!ride || ride.driver_id !== driverId) throw new Error('Você não é o motorista desta viagem.');
  if (ride.status !== 'departed') throw new Error('A viagem precisa estar em andamento para registrar embarque.');

  // Registrar checkin
  await sb().from('carona_checkins').insert({
    seat_id: seatId,
    ride_id: seat.ride_id,
    passenger_id: seat.passenger_id,
    event_type: 'boarded',
    lat: coords?.lat || null,
    lng: coords?.lng || null,
    device_time: coords?.device_time || null,
  });

  // Atualizar status do seat
  await sb()
    .from('carona_seats')
    .update({ status: 'boarded', boarded_at: new Date().toISOString() })
    .eq('id', seatId);

  socketManager.emitToRoom(`carona:ride:${seat.ride_id}`, 'carona:passenger_boarded', {
    rideId: seat.ride_id, seatId, passengerId: seat.passenger_id,
  });

  log(fn, 'Passageiro embarcou', { seatId, passengerId: seat.passenger_id });
  return { boarded: true };
}

/**
 * Passageiro desembarca (conclusão do assento)
 */
async function passengerAlight(driverId, seatId, coords) {
  const fn = 'passengerAlight';

  const { data: seat } = await sb()
    .from('carona_seats')
    .select('id, ride_id, passenger_id, status, amount_brl')
    .eq('id', seatId)
    .single();

  if (!seat) throw new Error('Reserva não encontrada.');
  if (seat.status !== 'boarded') throw new Error('Passageiro precisa ter embarcado.');

  const { data: ride } = await sb()
    .from('carona_rides')
    .select('driver_id')
    .eq('id', seat.ride_id)
    .single();

  if (!ride || ride.driver_id !== driverId) throw new Error('Você não é o motorista desta viagem.');

  // Registrar checkin (alighted)
  await sb().from('carona_checkins').insert({
    seat_id: seatId,
    ride_id: seat.ride_id,
    passenger_id: seat.passenger_id,
    event_type: 'alighted',
    lat: coords?.lat || null,
    lng: coords?.lng || null,
    device_time: coords?.device_time || null,
  });

  // Completar seat
  await sb()
    .from('carona_seats')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', seatId);

  socketManager.emitToRoom(`carona:ride:${seat.ride_id}`, 'carona:passenger_alighted', {
    rideId: seat.ride_id, seatId, passengerId: seat.passenger_id,
  });

  // Trust events (fire-and-forget)
  trustPassportService.recordEvent(driverId, 'mobility', 'ride_completed_driver', 3, false, { rideId: seat.ride_id, seatId })
    .catch(err => logWarn(fn, `trust event falhou: ${err.message}`));
  trustPassportService.recordEvent(seat.passenger_id, 'mobility', 'ride_completed_passenger', 2, false, { rideId: seat.ride_id, seatId })
    .catch(err => logWarn(fn, `trust event falhou: ${err.message}`));

  // Gamification
  gamificationService.triggerEvent('carona_ride_completed_driver', driverId, { rideId: seat.ride_id, seatId })
    .catch(err => logWarn(fn, `gamification falhou: ${err.message}`));

  // Solicitar avaliação (passageiro e motorista — realtime + push)
  socketManager.emitToUser(seat.passenger_id, 'carona:rating_requested', {
    rideId: seat.ride_id, seatId, ratedId: driverId, ratedRole: 'driver',
  });
  notificationDispatcher.dispatch({
    userId: seat.passenger_id,
    type: 'carona_rating_requested',
    importance: 'low',
    data: { rideId: seat.ride_id, seatId },
    dedupKey: `carona_rating_req_${seatId}_${seat.passenger_id}`,
  }).catch(() => {});

  socketManager.emitToUser(driverId, 'carona:rating_requested', {
    rideId: seat.ride_id, seatId, ratedId: seat.passenger_id, ratedRole: 'passenger',
  });
  notificationDispatcher.dispatch({
    userId: driverId,
    type: 'carona_rating_requested',
    importance: 'low',
    data: { rideId: seat.ride_id, seatId },
    dedupKey: `carona_rating_req_${seatId}_${driverId}`,
  }).catch(() => {});

  // Verificar se todos os seats da viagem estão completos
  await _checkRideCompletion(seat.ride_id, driverId);

  log(fn, 'Passageiro desembarcou', { seatId, passengerId: seat.passenger_id });
  return { completed: true };
}


// ═══════════════════════════════════════════════════════════════════
// AVALIAÇÕES
// ═══════════════════════════════════════════════════════════════════

/**
 * Submete avaliação bilateral (via RPC)
 */
async function submitRating(userId, seatId, data) {
  const fn = 'submitRating';
  const { rated_id, rated_role, score, comment, tags, anonymous } = data;

  // Buscar ride_id do seat
  const { data: seat } = await sb()
    .from('carona_seats')
    .select('ride_id')
    .eq('id', seatId)
    .single();

  if (!seat) throw new Error('Reserva não encontrada.');

  const { data: result, error } = await sb().rpc('submit_carona_rating', {
    p_ride_id: seat.ride_id,
    p_seat_id: seatId,
    p_rated_id: rated_id,
    p_rated_role: rated_role,
    p_score: score,
    p_comment: comment || null,
    p_tags: tags || null,
    p_anonymous: anonymous || false,
  });

  if (error) throw new Error(`Erro ao submeter avaliação: ${error.message}`);
  if (!result?.success) throw new Error(result?.message || 'Não foi possível submeter a avaliação.');

  // Trust event para 5 estrelas
  if (score === 5) {
    trustPassportService.recordEvent(rated_id, 'mobility', 'ride_rated_5star', 3, false, {
      rideId: seat.ride_id, seatId, score, ratedRole: rated_role,
    }).catch(err => logWarn(fn, `trust event falhou: ${err.message}`));

    gamificationService.triggerEvent('carona_received_5star', rated_id, { rideId: seat.ride_id, seatId })
      .catch(err => logWarn(fn, `gamification falhou: ${err.message}`));
  }

  // Notificar avaliado (realtime + push)
  socketManager.emitToUser(rated_id, 'carona:rating_received', {
    rideId: seat.ride_id, seatId, score, raterRole: rated_role === 'driver' ? 'passenger' : 'driver',
  });
  notificationDispatcher.dispatch({
    userId: rated_id,
    type: 'carona_rating_received',
    importance: 'low',
    data: { rideId: seat.ride_id, seatId },
    dedupKey: `carona_rating_rcv_${seatId}_${rated_id}`,
  }).catch(() => {});

  log(fn, 'Avaliação submetida', { userId, seatId, ratedId: rated_id, score });
  return result;
}


// ═══════════════════════════════════════════════════════════════════
// CONSULTAS (LISTAGENS)
// ═══════════════════════════════════════════════════════════════════

async function getMyRidesAsDriver(driverId, opts = {}) {
  const { status, limit = 20, offset = 0 } = opts;

  let query = sb()
    .from('carona_rides')
    .select('*, seats:carona_seats(id, passenger_id, status, pickup_city, dropoff_city)')
    .eq('driver_id', driverId)
    .order('departure_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw new Error(`Erro ao buscar viagens: ${error.message}`);
  return data || [];
}

async function getMyRidesAsPassenger(passengerId, opts = {}) {
  const { status, limit = 20, offset = 0 } = opts;

  let query = sb()
    .from('carona_seats')
    .select(`
      *,
      ride:carona_rides!carona_seats_ride_id_fkey(
        id, driver_id, origin_city, dest_city, departure_at, status, route_km,
        price_per_seat_brl, total_seats, seats_available,
        driver:users!carona_rides_driver_id_fkey(full_name, avatar_url),
        driver_profile:carona_driver_profiles!carona_rides_driver_profile_id_fkey(vehicle_type, vehicle_model, average_rating)
      )
    `)
    .eq('passenger_id', passengerId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw new Error(`Erro ao buscar reservas: ${error.message}`);

  // Flatten nested driver info para formato esperado pelo frontend
  return (data || []).map(seat => {
    const ride = seat.ride ? {
      ...seat.ride,
      driver_name: seat.ride.driver?.full_name || null,
      driver_avatar_url: seat.ride.driver?.avatar_url || null,
    } : seat.ride;
    if (ride) delete ride.driver;
    return { ...seat, ride };
  });
}

async function getDriverDashboard(driverId) {
  const { data, error } = await sb().rpc('get_driver_carona_dashboard', { p_user_id: driverId });
  if (error) throw new Error(`Erro ao buscar dashboard: ${error.message}`);
  return data;
}


// ═══════════════════════════════════════════════════════════════════
// RECORRÊNCIA
// ═══════════════════════════════════════════════════════════════════

/**
 * Cria viagem recorrente (parent + children para as próximas 4 semanas)
 */
async function createRecurringRide(driverId, data) {
  const fn = 'createRecurringRide';
  const { recurrence_rule, ...rideData } = data;

  if (!recurrence_rule?.days?.length) throw new Error('recurrence_rule.days é obrigatório.');
  if (!recurrence_rule.freq) recurrence_rule.freq = 'weekly';

  // Criar ride parent
  const parent = await createRide(driverId, {
    ...rideData,
    is_recurring: true,
    recurrence_rule,
  });

  // Spawn child rides (próximas 4 semanas)
  const children = await _spawnRecurringChildren(driverId, parent, recurrence_rule);

  log(fn, 'Viagem recorrente criada', { driverId, parentId: parent.id, children: children.length });
  return { parent, children };
}

/**
 * Gera child rides para recorrência
 */
async function _spawnRecurringChildren(driverId, parent, rule) {
  const fn = '_spawnRecurringChildren';
  const children = [];
  const baseDep = new Date(parent.departure_at);
  const until = rule.until ? new Date(rule.until) : new Date(Date.now() + 28 * 86400000);

  // Buscar paradas do parent UMA VEZ antes do loop
  const { data: parentStops } = await sb()
    .from('carona_ride_stops')
    .select('stop_order, address, neighborhood, city, state, cep, lat, lng')
    .eq('ride_id', parent.id)
    .order('stop_order', { ascending: true });

  for (let week = 1; week <= 4; week++) {
    for (const dayOfWeek of rule.days) {
      const childDep = _nextDayOfWeek(baseDep, dayOfWeek, week);
      if (childDep > until || childDep <= new Date()) continue;
      if (children.length >= MAX_RECURRING_SPAWN) break;

      try {
        const profile = await getDriverProfile(driverId);
        const { data: child, error } = await sb()
          .from('carona_rides')
          .insert({
            driver_id: driverId,
            driver_profile_id: profile.id,
            origin_address: parent.origin_address,
            origin_neighborhood: parent.origin_neighborhood,
            origin_city: parent.origin_city,
            origin_state: parent.origin_state,
            origin_cep: parent.origin_cep,
            origin_lat: parent.origin_lat,
            origin_lng: parent.origin_lng,
            dest_address: parent.dest_address,
            dest_neighborhood: parent.dest_neighborhood,
            dest_city: parent.dest_city,
            dest_state: parent.dest_state,
            dest_cep: parent.dest_cep,
            dest_lat: parent.dest_lat,
            dest_lng: parent.dest_lng,
            departure_at: childDep.toISOString(),
            estimated_arrival: parent.duration_minutes
              ? new Date(childDep.getTime() + parent.duration_minutes * 60000).toISOString()
              : null,
            duration_minutes: parent.duration_minutes,
            total_seats: parent.total_seats,
            seats_available: parent.total_seats,
            route_km: parent.route_km,
            price_per_seat_brl: parent.price_per_seat_brl,
            legal_cap_brl: parent.legal_cap_brl,
            distance_source: parent.distance_source,
            accepts_luggage: parent.accepts_luggage,
            accepts_pets: parent.accepts_pets,
            smoking_allowed: parent.smoking_allowed,
            luggage_options: parent.luggage_options || {},
            pet_options: parent.pet_options || {},
            conversation_level: parent.conversation_level ?? 50,
            music_level: parent.music_level ?? 50,
            notes: parent.notes,
            required_trust_level: parent.required_trust_level,
            accepts_eloscoins: parent.accepts_eloscoins,
            is_recurring: true,
            parent_ride_id: parent.id,
            status: 'open',
          })
          .select('id, departure_at')
          .single();

        if (!error && child) {
          // Copiar paradas do parent para o child
          if (parentStops?.length) {
            const childStopRows = parentStops.map(s => ({
              ride_id: child.id,
              stop_order: s.stop_order,
              address: s.address,
              neighborhood: s.neighborhood,
              city: s.city,
              state: s.state,
              cep: s.cep,
              lat: s.lat,
              lng: s.lng,
            }));
            await sbService().from('carona_ride_stops').insert(childStopRows)
              .catch(e => logWarn(fn, `Falha ao copiar paradas para child: ${e.message}`, { childId: child.id }));
          }
          children.push(child);
        }
      } catch (err) {
        logWarn(fn, `Falha ao spawnar child: ${err.message}`, { parentId: parent.id, week, dayOfWeek });
      }
    }
  }
  return children;
}

function _nextDayOfWeek(baseDate, targetDay, weeksAhead) {
  const d = new Date(baseDate);
  const currentDay = d.getDay();
  let daysToAdd = targetDay - currentDay;
  if (daysToAdd <= 0) daysToAdd += 7;
  daysToAdd += (weeksAhead - 1) * 7;
  d.setDate(d.getDate() + daysToAdd);
  return d;
}


// ═══════════════════════════════════════════════════════════════════
// EXPIRAÇÃO (CRON)
// ═══════════════════════════════════════════════════════════════════

/**
 * Expira viagens passadas e void Stripe holds
 */
async function expireStaleRides() {
  const fn = 'expireStaleRides';

  const { data: result, error } = await sbService().rpc('expire_stale_caronas');
  if (error) {
    logError(fn, error);
    return { expired: 0, voided: 0 };
  }

  const expired = result?.[0]?.expired_count || 0;
  const voided = result?.[0]?.voided_seats_count || 0;

  // Void Stripe holds para seats cancelados por expiração
  if (voided > 0) {
    const { data: cancelledSeats } = await sbService()
      .from('carona_seats')
      .select('id, ride_id, passenger_id, payment_intent_id, payment_status')
      .eq('status', 'cancelled_driver')
      .eq('payment_status', 'authorized')
      .not('payment_intent_id', 'is', null);

    if (cancelledSeats?.length) {
      for (const seat of cancelledSeats) {
        try {
          await asaasService.refundPayment(seat.payment_intent_id);
          await sbService()
            .from('carona_seats')
            .update({ payment_status: 'refunded' })
            .eq('id', seat.id);
          // Throttle para evitar rate limit
          if (cancelledSeats.indexOf(seat) < cancelledSeats.length - 1) {
            await new Promise(r => setTimeout(r, 200));
          }
        } catch (voidErr) {
          logError(fn, voidErr, { seatId: seat.id, severity: 'HIGH' });
        }
      }
    }
  }

  if (expired > 0 || voided > 0) {
    log(fn, `Expiração: ${expired} rides, ${voided} seats`, { expired, voided });
  }
  return { expired, voided };
}


// ═══════════════════════════════════════════════════════════════════
// HELPERS PRIVADOS
// ═══════════════════════════════════════════════════════════════════

/**
 * Verifica se todos os seats de uma viagem estão completos → marca ride como completed
 */
async function _checkRideCompletion(rideId, driverId) {
  const fn = '_checkRideCompletion';

  const { data: activeSeats } = await sb()
    .from('carona_seats')
    .select('id, status, passenger_id')
    .eq('ride_id', rideId)
    .in('status', ['confirmed', 'boarded']);

  if (!activeSeats?.length) {
    // Todos completed, cancelled ou no-show
    await sb()
      .from('carona_rides')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', rideId);

    // Atualizar stats do motorista
    await sbService().rpc('_update_driver_carona_rating', { p_driver_id: driverId });

    log(fn, 'Viagem concluída', { rideId });
    return;
  }

  // Se só restam seats 'confirmed' (nenhum 'boarded'), são no-shows
  const boardedSeats = activeSeats.filter(s => s.status === 'boarded');
  const confirmedSeats = activeSeats.filter(s => s.status === 'confirmed');

  if (boardedSeats.length === 0 && confirmedSeats.length > 0) {
    // Marcar confirmed restantes como no-show + trust penalty
    for (const seat of confirmedSeats) {
      await sb()
        .from('carona_seats')
        .update({ status: 'no_show', completed_at: new Date().toISOString() })
        .eq('id', seat.id);

      // Trust penalty por no-show (fire-and-forget)
      trustPassportService.recordEvent(
        seat.passenger_id, 'mobility', 'ride_no_show_passenger',
        NO_SHOW_TRUST_PENALTY, true,
        { seatId: seat.id, rideId },
      ).catch(err => logWarn(fn, `trust event no-show falhou: ${err.message}`));

      log(fn, 'No-show registrado', { seatId: seat.id, passengerId: seat.passenger_id, rideId });
    }

    // Agora sim: completar a viagem
    await sb()
      .from('carona_rides')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', rideId);

    await sbService().rpc('_update_driver_carona_rating', { p_driver_id: driverId });

    log(fn, 'Viagem concluída (com no-shows)', { rideId, noShows: confirmedSeats.length });
  }
}

/**
 * Registra evento de billing (append-only)
 */
async function _recordBillingEvent(seatId, rideId, passengerId, eventType, amountBrl, platformFeeBrl) {
  try {
    await sbService()
      .from('carona_billing_events')
      .insert({
        seat_id: seatId,
        ride_id: rideId,
        passenger_id: passengerId,
        event_type: eventType,
        amount_brl: amountBrl,
        platform_fee_brl: platformFeeBrl,
      });
  } catch (err) {
    logWarn('_recordBillingEvent', `Billing event falhou (non-blocking): ${err.message}`, { seatId });
  }
}


// ═══════════════════════════════════════════════════════════════════
// WAITLIST (CARONA-GAP-005)
// ═══════════════════════════════════════════════════════════════════

/**
 * Passageiro entra na fila de espera de uma carona lotada
 */
async function joinWaitlist(rideId, userId) {
  const fn = 'joinWaitlist';

  const { data: ride } = await sbService()
    .from('carona_rides')
    .select('id, status, driver_id')
    .eq('id', rideId)
    .single();

  if (!ride) throw Object.assign(new Error('Viagem não encontrada.'), { status: 404 });
  if (ride.status !== 'full') throw Object.assign(new Error('Viagem não está lotada. Você pode reservar diretamente.'), { status: 400 });
  if (ride.driver_id === userId) throw Object.assign(new Error('Você é o motorista desta viagem.'), { status: 400 });

  // Verificar se já tem assento ativo
  const { data: existingSeat } = await sbService()
    .from('carona_seats')
    .select('id')
    .eq('ride_id', rideId)
    .eq('passenger_id', userId)
    .in('status', ['pending_payment', 'confirmed', 'boarded'])
    .maybeSingle();

  if (existingSeat) throw Object.assign(new Error('Você já tem uma reserva ativa nesta viagem.'), { status: 400 });

  // Upsert na waitlist (ignora se já está na lista)
  const { data, error } = await sbService()
    .from('carona_waitlist')
    .upsert({ ride_id: rideId, user_id: userId }, { onConflict: 'ride_id,user_id', ignoreDuplicates: true })
    .select()
    .single();

  if (error) throw error;
  log(fn, 'User joined waitlist', { rideId, userId });
  return data;
}

/**
 * Passageiro sai da fila de espera
 */
async function leaveWaitlist(rideId, userId) {
  const fn = 'leaveWaitlist';

  const { error } = await sbService()
    .from('carona_waitlist')
    .delete()
    .eq('ride_id', rideId)
    .eq('user_id', userId);

  if (error) throw error;
  log(fn, 'User left waitlist', { rideId, userId });
  return { removed: true };
}

/**
 * Verifica se o passageiro está na fila de espera
 */
async function getWaitlistStatus(rideId, userId) {
  const { data } = await sbService()
    .from('carona_waitlist')
    .select('id, created_at')
    .eq('ride_id', rideId)
    .eq('user_id', userId)
    .maybeSingle();

  return { onWaitlist: !!data, entry: data };
}

/**
 * Notifica a waitlist quando uma vaga abre (fire-and-forget)
 * Chamado internamente após cancelSeat/release_carona_seat
 */
async function _notifyWaitlist(rideId, rideData) {
  const fn = '_notifyWaitlist';
  try {
    const { data: waitlistEntries } = await sbService()
      .from('carona_waitlist')
      .select('user_id')
      .eq('ride_id', rideId)
      .is('notified_at', null)
      .limit(10);

    if (!waitlistEntries?.length) return;

    for (const entry of waitlistEntries) {
      socketManager.emitToUser(entry.user_id, 'carona:waitlist_spot_available', { rideId });
      notificationDispatcher.dispatch({
        userId: entry.user_id,
        type: 'carona_waitlist_spot_available',
        data: {
          rideId,
          origin: rideData?.origin_city || '',
          dest: rideData?.dest_city || '',
        },
      }).catch(() => {});
    }

    // Marcar como notificados
    const userIds = waitlistEntries.map(e => e.user_id);
    await sbService()
      .from('carona_waitlist')
      .update({ notified_at: new Date().toISOString() })
      .eq('ride_id', rideId)
      .in('user_id', userIds);

    log(fn, 'Waitlist notified', { rideId, count: waitlistEntries.length });
  } catch (err) {
    logWarn(fn, `Failed to notify waitlist: ${err.message}`, { rideId });
  }
}


// ═══════════════════════════════════════════════════════════════════
// EXPIRACAO DE DOCUMENTOS (CARONA-GAP-007)
// ═══════════════════════════════════════════════════════════════════

/**
 * Cron job: verifica motoristas com documentos proximos de expirar (30d)
 * e auto-expira motoristas com documentos vencidos.
 * Dedup: notifica no maximo a cada 7 dias por motorista.
 */
async function checkDriverDocExpiry() {
  const fn = 'checkDriverDocExpiry';
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  try {
    // 1. Motoristas expirando nos proximos 30 dias (ainda verificados)
    const { data: expiring } = await sbService().from('carona_driver_profiles')
      .select('user_id, verification_expires_at, doc_expiry_notified_at')
      .eq('verification_status', 'verified')
      .not('verification_expires_at', 'is', null)
      .lte('verification_expires_at', in30Days.toISOString())
      .gt('verification_expires_at', now.toISOString());

    if (!expiring?.length && !await _hasExpiredDrivers(now)) {
      return { notified: 0, expired: 0 };
    }

    let notifiedCount = 0;

    if (expiring?.length) {
      for (const driver of expiring) {
        // Dedup: pular se notificado nos ultimos 7 dias
        if (driver.doc_expiry_notified_at) {
          const lastNotified = new Date(driver.doc_expiry_notified_at);
          if (now - lastNotified < 7 * 24 * 60 * 60 * 1000) continue;
        }

        const daysLeft = Math.ceil(
          (new Date(driver.verification_expires_at) - now) / (1000 * 60 * 60 * 24)
        );

        try {
          notificationDispatcher.dispatch({
            userId: driver.user_id,
            type: 'carona_doc_expiring',
            data: { daysLeft },
            importance: daysLeft <= 7 ? 'high' : 'medium',
          });

          socketManager.emitToUser(driver.user_id, 'carona:doc_expiring', { daysLeft });

          await sbService().from('carona_driver_profiles')
            .update({ doc_expiry_notified_at: now.toISOString() })
            .eq('user_id', driver.user_id);

          notifiedCount++;
        } catch (err) {
          logWarn(fn, `Falha ao notificar motorista ${driver.user_id}: ${err.message}`);
        }
      }
    }

    // 2. Auto-expirar motoristas com documentos vencidos
    const { data: expired } = await sbService().from('carona_driver_profiles')
      .update({ verification_status: 'expired' })
      .eq('verification_status', 'verified')
      .not('verification_expires_at', 'is', null)
      .lte('verification_expires_at', now.toISOString())
      .select('user_id');

    const expiredCount = expired?.length || 0;
    if (expiredCount > 0) {
      for (const driver of expired) {
        notificationDispatcher.dispatch({
          userId: driver.user_id,
          type: 'carona_doc_expired',
          data: {},
          importance: 'high',
        }).catch(() => {});
      }
      log(fn, `${expiredCount} verificacoes expiradas`);
    }

    log(fn, `Verificacao de validade: ${notifiedCount} notificados, ${expiredCount} expirados`);
    return { notified: notifiedCount, expired: expiredCount };
  } catch (err) {
    logError(fn, err);
    throw err;
  }
}

/** Helper: verifica se ha motoristas para expirar (evita query pesada quando nao ha ninguem expirando) */
async function _hasExpiredDrivers(now) {
  const { data } = await sbService().from('carona_driver_profiles')
    .select('user_id')
    .eq('verification_status', 'verified')
    .not('verification_expires_at', 'is', null)
    .lte('verification_expires_at', now.toISOString())
    .limit(1);
  return data?.length > 0;
}


// ═══════════════════════════════════════════════════════════════════
// SOS — BOTAO DE PANICO (CARONA-GAP-006)
// ═══════════════════════════════════════════════════════════════════

/**
 * Aciona SOS de emergencia durante uma viagem de carona.
 * - Valida que o usuario participa da viagem (motorista ou passageiro)
 * - Notifica contatos de emergencia do usuario
 * - Registra evento SOS no banco (audit trail)
 * - Alerta admin via ops-admin room
 * - Alerta a outra parte da viagem via Socket.IO
 */
async function triggerSOS(rideId, userId, coords) {
  const fn = 'triggerSOS';

  // 1. Validar que a viagem existe e esta ativa
  const { data: ride, error: rideErr } = await sbService()
    .from('carona_rides')
    .select('id, driver_id, status, origin_city, dest_city')
    .eq('id', rideId)
    .single();

  if (rideErr || !ride) {
    throw Object.assign(new Error('Viagem nao encontrada.'), { status: 404 });
  }

  if (!['departed', 'open', 'full'].includes(ride.status)) {
    throw Object.assign(
      new Error('SOS so pode ser acionado em viagens ativas.'),
      { status: 400 },
    );
  }

  // 2. Verificar que o usuario e motorista ou passageiro
  const isDriver = ride.driver_id === userId;
  let isPassenger = false;

  if (!isDriver) {
    const { data: seat } = await sbService()
      .from('carona_seats')
      .select('id')
      .eq('ride_id', rideId)
      .eq('passenger_id', userId)
      .in('status', ['confirmed', 'boarded'])
      .maybeSingle();
    isPassenger = !!seat;
  }

  if (!isDriver && !isPassenger) {
    throw Object.assign(
      new Error('Voce nao participa desta viagem.'),
      { status: 403 },
    );
  }

  // 3. Buscar contatos de emergencia do usuario
  const emergencyContactService = require('./emergencyContactService');
  const contacts = await emergencyContactService.getContacts(userId);

  // 4. Buscar dados do usuario para a mensagem
  const { data: user } = await sbService()
    .from('users')
    .select('full_name, phone_number')
    .eq('id', userId)
    .single();
  const userName = user?.full_name || 'Usuario';

  // 5. Notificar contatos (fire-and-forget)
  const notifiedContacts = [];
  for (const contact of contacts) {
    try {
      // Registrar como notificado (SMS/push real pode ser adicionado via Twilio/etc)
      notifiedContacts.push({
        name: contact.name,
        phone: contact.phone,
        notified_at: new Date().toISOString(),
      });
      log(fn, `SOS contato notificado: ${contact.name}`, { rideId, userId });
    } catch (err) {
      logWarn(fn, `Falha ao notificar contato ${contact.name}: ${err.message}`);
    }
  }

  // 6. Registrar evento SOS (audit trail imutavel)
  const { data: sosEvent, error: sosErr } = await sbService()
    .from('carona_sos_events')
    .insert({
      ride_id: rideId,
      user_id: userId,
      lat: coords?.lat || null,
      lng: coords?.lng || null,
      contacts_notified: notifiedContacts,
    })
    .select()
    .single();

  if (sosErr) logError(fn, sosErr, { rideId });

  // 7. Alertar admin via Socket.IO (ops-admin room)
  try {
    socketManager.emitToRoom('ops-admin', 'carona:sos_triggered', {
      sosId: sosEvent?.id,
      rideId,
      userId,
      userName,
      coords,
      ride: { origin: ride.origin_city, dest: ride.dest_city },
      timestamp: new Date().toISOString(),
    });
  } catch (socketErr) {
    logWarn(fn, `Falha ao emitir SOS para ops-admin: ${socketErr.message}`);
  }

  // 8. Alertar a outra parte da viagem
  try {
    if (!isDriver) {
      // Passageiro acionou — notificar motorista
      socketManager.emitToUser(ride.driver_id, 'carona:sos_alert', {
        rideId, triggeredBy: userName, coords,
      });
    } else {
      // Motorista acionou — notificar todos os passageiros ativos
      const { data: seats } = await sbService()
        .from('carona_seats')
        .select('passenger_id')
        .eq('ride_id', rideId)
        .in('status', ['confirmed', 'boarded']);

      for (const seat of (seats || [])) {
        socketManager.emitToUser(seat.passenger_id, 'carona:sos_alert', {
          rideId, triggeredBy: userName, coords,
        });
      }
    }
  } catch (socketErr) {
    logWarn(fn, `Falha ao emitir SOS alert: ${socketErr.message}`);
  }

  log(fn, 'SOS acionado', { rideId, userId, contactsNotified: notifiedContacts.length });
  return {
    sosId: sosEvent?.id,
    contactsNotified: notifiedContacts.length,
  };
}


// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// ESTIMATIVA DE ROTA (read-only, sem criar nada no banco)
// ═══════════════════════════════════════════════════════════════════

async function getRouteEstimate({ origin, destination, waypoints = [], totalSeats }) {
  if (!origin?.lat || !origin?.lng) throw new Error('origin é obrigatório (lat, lng)');
  if (!destination?.lat || !destination?.lng) throw new Error('destination é obrigatório (lat, lng)');

  const seats = Number(totalSeats) || 1;
  if (seats < 1 || seats > MAX_SEATS) throw new Error(`totalSeats deve ser entre 1 e ${MAX_SEATS}.`);

  const validWaypoints = (waypoints || []).filter(w => w?.lat && w?.lng);

  const routeData = await distanceService.getRouteWithTolls(
    origin, destination, validWaypoints,
  );

  const km = routeData.distanceKm;
  const legalCap = km ? Math.round(((km * INSS_RATE_PER_KM) / seats) * 100) / 100 : null;
  const suggestedPrice = legalCap ? Math.round(legalCap * 0.7 * 100) / 100 : null;

  return {
    km,
    durationMinutes: routeData.durationMinutes,
    legalCap,
    suggestedPrice,
    tolls: routeData.tolls, // { totalBrl, count } ou null
    source: routeData.source,
  };
}

module.exports = {
  // Perfil de motorista
  registerDriver,
  verifyDriver,
  getDriverProfile,

  // Estimativa de rota
  getRouteEstimate,

  // Viagens
  createRide,
  searchRides,
  getRideDetail,
  updateRide,
  cancelRide,

  // Reservas
  bookSeat,
  confirmSeatPayment,
  cancelSeat,

  // Fluxo da viagem
  driverCheckin,
  passengerBoard,
  passengerAlight,

  // Avaliações
  submitRating,

  // Consultas
  getMyRidesAsDriver,
  getMyRidesAsPassenger,
  getDriverDashboard,

  // Recorrência
  createRecurringRide,

  // Cron
  expireStaleRides,
  checkDriverDocExpiry,

  // Waitlist (CARONA-GAP-005)
  joinWaitlist,
  leaveWaitlist,
  getWaitlistStatus,

  // SOS (CARONA-GAP-006)
  triggerSOS,

  // Listagem recente
  listRecentRides,
};
