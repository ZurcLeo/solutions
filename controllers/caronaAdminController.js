'use strict';

const Joi = require('joi');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');
const distanceService = require('../services/distanceService');
const { geocodeAddress } = require('../utils/geocoding');

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

const TAG = '[CaronaAdmin]';

// ── Listar todas as corridas (com filtros) ─────────────────────────────────────
async function listRides(req, res) {
  try {
    const schema = Joi.object({
      status: Joi.string().valid('open', 'full', 'departed', 'completed', 'cancelled', 'expired'),
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20),
      search: Joi.string().allow('').max(100),
      date_from: Joi.string().isoDate(),
      date_to: Joi.string().isoDate(),
    });
    const { value: params, error } = schema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.message });

    const { status, page, limit, search, date_from, date_to } = params;
    const offset = (page - 1) * limit;

    let query = sb()
      .from('carona_rides')
      .select(`
        *,
        driver:users!carona_rides_driver_id_fkey (id, full_name, avatar_url),
        driver_profile:carona_driver_profiles!carona_rides_driver_profile_id_fkey (
          vehicle_type, vehicle_model, vehicle_color, verification_status, average_rating
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (date_from) query = query.gte('departure_at', date_from);
    if (date_to) query = query.lte('departure_at', date_to);
    if (search) {
      query = query.or(`origin_city.ilike.%${search}%,dest_city.ilike.%${search}%`);
    }

    const { data, count, error: dbErr } = await query;
    if (dbErr) throw dbErr;

    res.json({ success: true, data, pagination: { page, limit, total: count } });
  } catch (err) {
    logger.error(`${TAG} listRides error`, { error: err.message });
    res.status(500).json({ success: false, message: 'Erro ao listar corridas' });
  }
}

// ── Detalhe de uma corrida (com passageiros) ───────────────────────────────────
async function getRideDetail(req, res) {
  try {
    const { rideId } = req.params;

    const { data: ride, error: rideErr } = await sb()
      .from('carona_rides')
      .select(`
        *,
        driver:users!carona_rides_driver_id_fkey (id, full_name, avatar_url),
        driver_profile:carona_driver_profiles!carona_rides_driver_profile_id_fkey (
          vehicle_type, vehicle_model, vehicle_color, vehicle_plate, verification_status, average_rating, total_rides
        )
      `)
      .eq('id', rideId)
      .single();

    if (rideErr || !ride) {
      return res.status(404).json({ success: false, message: 'Corrida nao encontrada' });
    }

    // Buscar passageiros (seats)
    const { data: seats } = await sb()
      .from('carona_seats')
      .select(`
        *,
        passenger:users!carona_seats_passenger_id_fkey (id, full_name, avatar_url)
      `)
      .eq('ride_id', rideId)
      .order('created_at', { ascending: true });

    res.json({ success: true, data: { ...ride, seats: seats || [] } });
  } catch (err) {
    logger.error(`${TAG} getRideDetail error`, { error: err.message });
    res.status(500).json({ success: false, message: 'Erro ao buscar detalhe' });
  }
}

// ── Stats resumo ────────────────────────────────────────────────────────────────
async function getStats(req, res) {
  try {
    const [
      { count: totalRides },
      { count: openRides },
      { count: departedRides },
      { count: completedRides },
      { count: cancelledRides },
      { count: totalDrivers },
      { count: pendingDrivers },
    ] = await Promise.all([
      sb().from('carona_rides').select('*', { count: 'exact', head: true }),
      sb().from('carona_rides').select('*', { count: 'exact', head: true }).eq('status', 'open'),
      sb().from('carona_rides').select('*', { count: 'exact', head: true }).eq('status', 'departed'),
      sb().from('carona_rides').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
      sb().from('carona_rides').select('*', { count: 'exact', head: true }).eq('status', 'cancelled'),
      sb().from('carona_rides').select('*', { count: 'exact', head: true }).in('status', ['open', 'full', 'departed', 'completed']),
      sb().from('carona_driver_profiles').select('*', { count: 'exact', head: true }).eq('verification_status', 'pending'),
    ]);

    // Total de seats (reservas) confirmadas
    const { count: totalSeats } = await sb()
      .from('carona_seats')
      .select('*', { count: 'exact', head: true })
      .in('status', ['confirmed', 'boarded', 'completed']);

    res.json({
      success: true,
      data: {
        totalRides: totalRides || 0,
        openRides: openRides || 0,
        departedRides: departedRides || 0,
        completedRides: completedRides || 0,
        cancelledRides: cancelledRides || 0,
        totalDrivers: totalDrivers || 0,
        pendingDrivers: pendingDrivers || 0,
        totalSeats: totalSeats || 0,
      },
    });
  } catch (err) {
    logger.error(`${TAG} getStats error`, { error: err.message });
    res.status(500).json({ success: false, message: 'Erro ao buscar stats' });
  }
}

// ── Listar motoristas ───────────────────────────────────────────────────────────
async function listDrivers(req, res) {
  try {
    const schema = Joi.object({
      status: Joi.string().valid('pending', 'verified', 'rejected', 'expired'),
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(50).default(20),
    });
    const { value: params, error } = schema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.message });

    const { status, page, limit } = params;
    const offset = (page - 1) * limit;

    let query = sb()
      .from('carona_driver_profiles')
      .select(`
        *,
        user:users!carona_driver_profiles_user_id_fkey (id, full_name, avatar_url)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('verification_status', status);

    const { data, count, error: dbErr } = await query;
    if (dbErr) throw dbErr;

    res.json({ success: true, data, pagination: { page, limit, total: count } });
  } catch (err) {
    logger.error(`${TAG} listDrivers error`, { error: err.message });
    res.status(500).json({ success: false, message: 'Erro ao listar motoristas' });
  }
}

// ── Cancelar corrida (admin) ────────────────────────────────────────────────────
async function adminCancelRide(req, res) {
  try {
    const { rideId } = req.params;
    const { reason } = req.body || {};

    const { data, error: dbErr } = await sb()
      .from('carona_rides')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason || 'Cancelado pelo administrador',
        updated_at: new Date().toISOString(),
      })
      .eq('id', rideId)
      .in('status', ['open', 'full'])
      .select()
      .single();

    if (dbErr || !data) {
      return res.status(400).json({ success: false, message: 'Corrida nao pode ser cancelada (status invalido ou nao encontrada)' });
    }

    logger.info(`${TAG} Admin cancelled ride`, { rideId, adminId: req.user.uid, reason });
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`${TAG} adminCancelRide error`, { error: err.message });
    res.status(500).json({ success: false, message: 'Erro ao cancelar corrida' });
  }
}

// ── Criar corrida teste (admin) ─────────────────────────────────────────────────
async function createTestRide(req, res) {
  try {
    const schema = Joi.object({
      origin_address: Joi.string().allow('').max(200),
      origin_neighborhood: Joi.string().allow('').max(100),
      origin_city: Joi.string().required(),
      origin_state: Joi.string().max(2).required(),
      origin_cep: Joi.string().allow('').max(10),
      origin_lat: Joi.number().min(-90).max(90).allow(null),
      origin_lng: Joi.number().min(-180).max(180).allow(null),
      dest_address: Joi.string().allow('').max(200),
      dest_neighborhood: Joi.string().allow('').max(100),
      dest_city: Joi.string().required(),
      dest_state: Joi.string().max(2).required(),
      dest_cep: Joi.string().allow('').max(10),
      dest_lat: Joi.number().min(-90).max(90).allow(null),
      dest_lng: Joi.number().min(-180).max(180).allow(null),
      departure_at: Joi.string().isoDate().required(),
      total_seats: Joi.number().integer().min(1).max(4).default(3),
      price_per_seat_brl: Joi.number().min(0).default(0),
      notes: Joi.string().allow('').max(500),
    });

    const { value: body, error } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.message });

    // Usar o admin como driver — verificar se tem driver profile, senão criar
    const adminId = req.user.uid;

    let { data: profile } = await sb()
      .from('carona_driver_profiles')
      .select('id')
      .eq('user_id', adminId)
      .maybeSingle();

    if (!profile) {
      const { data: newProfile, error: profErr } = await sb()
        .from('carona_driver_profiles')
        .insert({
          user_id: adminId,
          vehicle_type: 'carro',
          vehicle_model: 'Teste Admin',
          vehicle_plate: 'TST0000',
          verification_status: 'verified',
          verified_at: new Date().toISOString(),
          verified_by: adminId,
        })
        .select()
        .single();
      if (profErr) throw profErr;
      profile = newProfile;
    }

    // ── Coordenadas: prioriza frontend (client-side geocoding) ─────
    let origin_lat = body.origin_lat || null;
    let origin_lng = body.origin_lng || null;
    let dest_lat = body.dest_lat || null;
    let dest_lng = body.dest_lng || null;
    let route_km = null, duration_minutes = null, distance_source = 'haversine';

    // Fallback: geocodificar server-side se frontend nao enviou coords
    if (!origin_lat || !dest_lat) {
      const originQuery = body.origin_cep
        ? body.origin_cep
        : `${body.origin_city}, ${body.origin_state}, Brasil`;
      const destQuery = body.dest_cep
        ? body.dest_cep
        : `${body.dest_city}, ${body.dest_state}, Brasil`;

      const [originCoords, destCoords] = await Promise.all([
        geocodeAddress(originQuery).catch(() => null),
        geocodeAddress(destQuery).catch(() => null),
      ]);

      if (!origin_lat && originCoords) { origin_lat = originCoords.lat; origin_lng = originCoords.lng; }
      if (!dest_lat && destCoords) { dest_lat = destCoords.lat; dest_lng = destCoords.lng; }
    }

    if (origin_lat && origin_lng && dest_lat && dest_lng) {
      try {
        const dist = await distanceService.getRoadDistance(origin_lat, origin_lng, dest_lat, dest_lng);
        route_km = dist.distanceKm;
        duration_minutes = dist.durationMinutes;
        distance_source = dist.source;
      } catch (distErr) {
        logger.warn(`${TAG} Distância não calculada: ${distErr.message}`);
      }
      // Fallback Haversine
      if (!route_km) {
        route_km = +(distanceService.haversineKm(origin_lat, origin_lng, dest_lat, dest_lng) * 1.3).toFixed(2);
        distance_source = 'haversine';
      }
    }

    const depDate = new Date(body.departure_at);
    const estimated_arrival = duration_minutes
      ? new Date(depDate.getTime() + duration_minutes * 60000).toISOString()
      : null;

    const { data: ride, error: rideErr } = await sb()
      .from('carona_rides')
      .insert({
        driver_id: adminId,
        driver_profile_id: profile.id,
        origin_address: body.origin_address || body.origin_city,
        origin_neighborhood: body.origin_neighborhood || null,
        origin_city: body.origin_city,
        origin_state: body.origin_state,
        origin_cep: body.origin_cep || null,
        origin_lat, origin_lng,
        dest_address: body.dest_address || body.dest_city,
        dest_neighborhood: body.dest_neighborhood || null,
        dest_city: body.dest_city,
        dest_state: body.dest_state,
        dest_cep: body.dest_cep || null,
        dest_lat, dest_lng,
        departure_at: body.departure_at,
        estimated_arrival,
        duration_minutes: duration_minutes ? Math.round(duration_minutes) : null,
        total_seats: body.total_seats,
        seats_available: body.total_seats,
        price_per_seat_brl: body.price_per_seat_brl,
        route_km: route_km ? Math.round(route_km * 100) / 100 : null,
        distance_source,
        notes: body.notes || '[TESTE] Corrida criada pelo admin',
      })
      .select()
      .single();

    if (rideErr) throw rideErr;

    logger.info(`${TAG} Admin created test ride`, { rideId: ride.id, adminId, route_km, distance_source });
    res.status(201).json({ success: true, data: ride });
  } catch (err) {
    logger.error(`${TAG} createTestRide error`, { error: err.message });
    res.status(500).json({ success: false, message: 'Erro ao criar corrida teste' });
  }
}

module.exports = {
  listRides,
  getRideDetail,
  getStats,
  listDrivers,
  adminCancelRide,
  createTestRide,
};
