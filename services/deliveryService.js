/**
 * @fileoverview deliveryService — ElosCloud Módulo de Delivery
 *
 * Orquestra o ciclo completo de entrega hiper-local:
 *   vendedor solicita → matching por posição atual → entregador aceita → etapas → conclusão
 *
 * Diferencial arquitetural (DA-008):
 *   O matching usa a posição ATUAL do entregador (delivery_active_sessions),
 *   não o endereço base cadastrado. O entregador no bairro vizinho agora
 *   vale mais que o morador do bairro que está a 200 km.
 *
 * Fórmula de precificação:
 *   fee = max((D1 + D2) × price_per_km + base_fee, minimum_fee)
 *   D1 = posição_atual_entregador → loja_vendedor  (inclui deslocamento de chegada)
 *   D2 = loja_vendedor → cliente                   (entrega em si)
 *   Distâncias: Google Maps Distance Matrix (fallback: Haversine × 1.3)
 *
 * Delegações:
 *   gamificationService → triggerEvent (XP por entrega)
 *   socketManager       → emitToUser / emitToRoom (tempo real)
 *   disputeService      → createDispute (pedidos contestados)
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger }            = require('../logger');
const gamificationService   = require('./gamificationService');
const socketManager          = require('../config/socket/socketManager');
const notificationDispatcher = require('./NotificationDispatcher');
const deliveryPaymentService = require('./deliveryPaymentService');

const SERVICE = 'deliveryService';

// Timeout para aceite de pedido pelos entregadores notificados (ms)
const ACCEPT_TIMEOUT_MS    = 5 * 60 * 1000;  // 5 minutos
// Expansão de raio a cada nova tentativa de matching (%)
const RADIUS_EXPAND_FACTOR = 1.2;
// Máximo de tentativas antes de status → no_deliverer_found
const MAX_MATCH_ATTEMPTS   = 3;
// Número de entregadores notificados por tentativa
const NOTIFY_TOP_N         = 5;

// ──────────────────────────────────────────────────────
// Helpers internos
// ──────────────────────────────────────────────────────

// Geocodifica um CEP via BrasilAPI v2 — retorna { lat, lng } ou null
async function geocodeCep(cep) {
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

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

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

// ──────────────────────────────────────────────────────
// 1. Gestão da loja de entrega
// ──────────────────────────────────────────────────────

/**
 * Cria o perfil de entregador (delivery_service) para um usuário.
 * Um usuário pode ter apenas um perfil (UNIQUE user_id).
 */
async function createDeliveryService(userId, data) {
  const fn = 'createDeliveryService';
  const {
    name, description,
    origin_address, origin_neighborhood, origin_city, origin_state,
    price_per_km, minimum_fee, base_fee,
    max_radius_km, vehicle_type, vehicle_id, max_weight_kg,
    handles_fragile, handles_refrigerated,
    available_days, available_from, available_to,
    accepts_eloscoins,
    home_cep, include_return_leg,
  } = data;

  // Validações mínimas
  if (!origin_address) throw new Error('origin_address é obrigatório');
  if (!origin_city)    throw new Error('origin_city é obrigatório');
  if (!origin_state)   throw new Error('origin_state é obrigatório');
  if (!price_per_km || price_per_km < 0.5)
    throw new Error('price_per_km deve ser ≥ R$ 0,50/km');

  // Se vehicle_id fornecido, busca tipo do veículo centralizado
  let resolvedVehicleType = vehicle_type;
  if (vehicle_id) {
    const { data: veh } = await sb()
      .from('user_vehicles')
      .select('vehicle_type')
      .eq('id', vehicle_id)
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();
    if (veh) resolvedVehicleType = veh.vehicle_type;
  }

  if (!resolvedVehicleType) throw new Error('vehicle_type é obrigatório (ou forneça vehicle_id)');

  const VALID_VEHICLES = ['bike', 'moto', 'carro', 'van', 'caminhonete'];
  if (!VALID_VEHICLES.includes(resolvedVehicleType))
    throw new Error(`vehicle_type inválido. Opções: ${VALID_VEHICLES.join(', ')}`);

  // Geocodifica o CEP da base do entregador (não bloqueia em caso de falha)
  const homeCoords = await geocodeCep(home_cep);

  const { data: svc, error } = await sb()
    .from('delivery_services')
    .insert({
      user_id:              userId,
      name:                 name?.trim()        || null,
      description:          description?.trim() || null,
      origin_address,
      origin_neighborhood:  origin_neighborhood || null,
      origin_city,
      origin_state,
      price_per_km:         Number(price_per_km),
      minimum_fee:          Number(minimum_fee  ?? 5.00),
      base_fee:             Number(base_fee     ?? 0.00),
      max_radius_km:        Number(max_radius_km ?? 10),
      vehicle_type:         resolvedVehicleType,
      vehicle_id:           vehicle_id || null,
      max_weight_kg:        Number(max_weight_kg ?? 20),
      handles_fragile:      Boolean(handles_fragile),
      handles_refrigerated: Boolean(handles_refrigerated),
      available_days:       available_days ?? [1, 2, 3, 4, 5],
      available_from:       available_from ?? '08:00',
      available_to:         available_to   ?? '18:00',
      accepts_eloscoins:    false, // desabilitado (2026-07-09)
      include_return_leg:   Boolean(include_return_leg ?? false),
      home_cep:             home_cep ? String(home_cep).replace(/\D/g, '') : null,
      home_lat:             homeCoords?.lat ?? null,
      home_lng:             homeCoords?.lng ?? null,
      status:               'active',
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') throw new Error('Você já possui uma loja de entrega cadastrada.');
    throw new Error(`Erro ao criar loja de entrega: ${error.message}`);
  }

  log(fn, 'Loja de entrega criada', { userId, serviceId: svc.id });
  await gamificationService.triggerEvent('delivery_service_created', userId, { serviceId: svc.id });
  return svc;
}

/**
 * Atualiza o perfil de entregador do usuário.
 */
async function updateDeliveryService(userId, data) {
  const fn = 'updateDeliveryService';

  // Campos permitidos para edição
  const ALLOWED = [
    'name', 'description',
    'origin_address', 'origin_neighborhood', 'origin_city', 'origin_state',
    'price_per_km', 'minimum_fee', 'base_fee', 'max_radius_km',
    'vehicle_type', 'vehicle_id', 'max_weight_kg', 'handles_fragile', 'handles_refrigerated',
    'available_days', 'available_from', 'available_to', 'accepts_eloscoins',
    'include_return_leg', 'home_cep',
  ];

  const payload = {};
  for (const key of ALLOWED) {
    if (data[key] !== undefined) payload[key] = data[key];
  }

  if (Object.keys(payload).length === 0)
    throw new Error('Nenhum campo válido para atualizar.');

  // Geocodifica se o CEP da base foi atualizado
  if (payload.home_cep) {
    payload.home_cep = String(payload.home_cep).replace(/\D/g, '');
    const homeCoords = await geocodeCep(payload.home_cep);
    payload.home_lat = homeCoords?.lat ?? null;
    payload.home_lng = homeCoords?.lng ?? null;
  }

  payload.updated_at = new Date().toISOString();

  const { data: svc, error } = await sb()
    .from('delivery_services')
    .update(payload)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw new Error(`Erro ao atualizar loja de entrega: ${error.message}`);
  if (!svc)  throw new Error('Loja de entrega não encontrada.');

  log(fn, 'Loja de entrega atualizada', { userId });
  return svc;
}

/**
 * Retorna o perfil de entregador do usuário (inclui dados privados).
 */
async function getMyDeliveryService(userId) {
  const { data: svc, error } = await sb()
    .from('delivery_services')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !svc) throw new Error('Loja de entrega não encontrada.');
  return svc;
}

/**
 * Retorna perfil público de uma loja de entrega por ID.
 */
async function getDeliveryServiceById(serviceId) {
  const { data: svc, error } = await sb()
    .from('delivery_services')
    .select('id, user_id, origin_city, origin_state, origin_neighborhood, vehicle_type, price_per_km, minimum_fee, base_fee, max_radius_km, max_weight_kg, handles_fragile, handles_refrigerated, average_rating, delivery_level, total_deliveries, accepts_eloscoins, status')
    .eq('id', serviceId)
    .single();

  if (error || !svc) throw new Error('Loja de entrega não encontrada.');
  return svc;
}

// ──────────────────────────────────────────────────────
// 2. Sessão ativa do entregador (online/offline)
// ──────────────────────────────────────────────────────

/**
 * Entregador vai online: upsert da sessão ativa com posição atual (GPS opt-in).
 * Chamado pelo handler Socket.IO delivery:go_online.
 */
async function goOnline(userId, { lat, lng, socketId } = {}) {
  const fn = 'goOnline';
  const { data, error } = await sb().rpc('upsert_delivery_session', {
    p_user_id:      userId,
    p_lat:          lat   ?? null,
    p_lng:          lng   ?? null,
    p_use_fallback: lat == null,
    p_socket_id:    socketId ?? null,
  });

  if (error) throw new Error(`Erro ao ativar sessão: ${error.message}`);
  if (!data?.ok) throw new Error(data?.message ?? 'Não foi possível ativar o modo de entrega.');

  log(fn, 'Entregador online', { userId, hasGps: data.has_gps, regionKey: data.region_key });
  return data;
}

/**
 * Entregador vai offline: remove a sessão ativa.
 * Chamado pelo handler Socket.IO delivery:go_offline ou disconnect.
 */
async function goOffline(userId) {
  const { data: svc } = await sb()
    .from('delivery_services')
    .select('id')
    .eq('user_id', userId)
    .single();

  if (!svc) return;

  await sb()
    .from('delivery_active_sessions')
    .delete()
    .eq('service_id', svc.id);

  log('goOffline', 'Entregador offline', { userId });
}

/**
 * Atualiza posição e renova sessão (heartbeat com nova localização).
 * Chamado pelo handler Socket.IO delivery:location_update.
 */
async function updateLocation(userId, { lat, lng, socketId } = {}) {
  return goOnline(userId, { lat, lng, socketId });
}

/**
 * Renova sessão sem nova posição (keepalive).
 * Chamado pelo handler Socket.IO delivery:heartbeat.
 */
async function heartbeat(userId) {
  const { data: svc } = await sb()
    .from('delivery_services')
    .select('id')
    .eq('user_id', userId)
    .single();

  if (!svc) return;

  await sb()
    .from('delivery_active_sessions')
    .update({
      last_seen_at: new Date().toISOString(),
      expires_at:   new Date(Date.now() + 45 * 60 * 1000).toISOString(),
    })
    .eq('service_id', svc.id);
}

// ──────────────────────────────────────────────────────
// 3. Solicitação de entrega (vendedor → sistema → entregadores)
// ──────────────────────────────────────────────────────

/**
 * Retorna os entregadores disponíveis para um pedido (para o vendedor visualizar antes de confirmar).
 */
async function findEligibleDeliverers(pickupLat, pickupLng, destLat, destLng, opts = {}) {
  const { weightKg = 0, isFragile = false, limit = 5, pickupCity, destCity, destState } = opts;

  const { data, error } = await sb().rpc('find_eligible_deliverers_live', {
    p_pickup_lat:  pickupLat  ?? null,
    p_pickup_lng:  pickupLng  ?? null,
    p_dest_lat:    destLat    ?? null,
    p_dest_lng:    destLng    ?? null,
    p_weight_kg:   Number(weightKg),
    p_is_fragile:  Boolean(isFragile),
    p_limit:       Number(limit),
    p_pickup_city: pickupCity ?? null,
    p_dest_city:   destCity   ?? null,
    p_dest_state:  destState  ?? null,
  });

  if (error) throw new Error(`Erro no matching: ${error.message}`);

  const candidates = data ?? [];
  if (candidates.length === 0) return candidates;

  // Enrich: nome/foto do entregador + total_deliveries
  const userIds = [...new Set(candidates.map(c => c.user_id).filter(Boolean))];
  const serviceIds = [...new Set(candidates.map(c => c.service_id).filter(Boolean))];

  log('findEligibleDeliverers', 'Enriquecendo candidatos', {
    candidateCount: candidates.length,
    userIds,
    serviceIds,
  });

  const [usersRes, servicesRes] = await Promise.all([
    userIds.length > 0
      ? sb().from('users').select('id, full_name, avatar_url').in('id', userIds)
      : { data: [] },
    serviceIds.length > 0
      ? sb().from('delivery_services').select('id, total_deliveries').in('id', serviceIds)
      : { data: [] },
  ]);

  if (usersRes.error) {
    logWarn('findEligibleDeliverers', `Erro ao buscar users: ${usersRes.error.message}`, { userIds });
  }
  if (servicesRes.error) {
    logWarn('findEligibleDeliverers', `Erro ao buscar delivery_services: ${servicesRes.error.message}`, { serviceIds });
  }

  const userMap = Object.fromEntries((usersRes.data || []).map(u => [u.id, u]));
  const svcMap = Object.fromEntries((servicesRes.data || []).map(s => [s.id, s]));

  log('findEligibleDeliverers', 'Enriquecimento concluído', {
    usersFound: Object.keys(userMap).length,
    servicesFound: Object.keys(svcMap).length,
  });

  for (const c of candidates) {
    const user = userMap[c.user_id];
    const svc = svcMap[c.service_id];
    c.deliverer_name = user?.full_name || 'Entregador';
    c.deliverer_photo = user?.avatar_url || null;
    c.total_deliveries = svc?.total_deliveries || 0;
  }

  return candidates;
}

/**
 * Vendedor solicita entrega para um pedido.
 * Fluxo:
 *   1. Valida pedido e vendedor
 *   2. Roda matching de entregadores (posição atual)
 *   3. Cria delivery_request com status='open'
 *   4. Cria delivery_notifications para os candidatos
 *   5. Emite delivery:new_request via Socket.IO para cada candidato
 *   6. Agenda timeout (5 min → tenta novamente com raio expandido)
 */
async function requestDelivery(userId, orderId, data = {}) {
  const fn = 'requestDelivery';
  let {
    pickup_address, pickup_neighborhood, pickup_city, pickup_state, pickup_lat, pickup_lng,
    dest_address, dest_neighborhood, dest_city, dest_state, dest_lat, dest_lng,
    weight_kg, is_fragile, notes, is_solidarity,
  } = data || {};

  // 1. Valida que o pedido existe e pertence ao vendedor + carrega nome do comprador
  const { data: order, error: orderErr } = await sb()
    .from('marketplace_orders')
    .select(`
      id, seller_id, buyer_id, status, delivery_address, fulfillment_type,
      preferred_deliverer_service_id, buyer_snapshot,
      buyer:users(full_name)
    `)
    .eq('id', orderId)
    .single();

  if (orderErr || !order) throw new Error('Pedido não encontrado.');

  // 2. Verifica que o usuário é o vendedor + carrega endereço e nome da loja
  const { data: sellerProfile } = await sb()
    .from('seller_profiles')
    .select('id, user_id, business_name, trading_name, address_logradouro, address_numero, address_neighborhood, address_city, address_state, address_lat, address_lng')
    .eq('user_id', userId)
    .eq('id', order.seller_id)
    .single();

  if (!sellerProfile)
    throw new Error('Você não é o vendedor deste pedido.');

  // 3. Auto-resolve endereço de pickup (loja) quando não fornecido pelo frontend
  if (!pickup_address) {
    const logradouro = [
      sellerProfile.address_logradouro,
      sellerProfile.address_numero,
      sellerProfile.address_neighborhood,
    ].filter(Boolean).join(', ');
    pickup_address     = logradouro || sellerProfile.address_city || 'Loja';
    pickup_neighborhood = pickup_neighborhood ?? sellerProfile.address_neighborhood ?? null;
    pickup_city         = pickup_city  ?? sellerProfile.address_city  ?? null;
    pickup_state        = pickup_state ?? sellerProfile.address_state ?? null;
    pickup_lat          = pickup_lat   ?? sellerProfile.address_lat   ?? null;
    pickup_lng          = pickup_lng   ?? sellerProfile.address_lng   ?? null;
  }

  // 4. Auto-resolve endereço de destino (delivery_address do pedido) quando não fornecido
  if (!dest_address && order.delivery_address) {
    dest_address = order.delivery_address;
    if (!dest_city) {
      const parts = order.delivery_address.split(/,\s*/);
      dest_city  = parts.length >= 2 ? parts[parts.length - 2].trim() : parts[0]?.trim();
      dest_state = parts.length >= 1 ? parts[parts.length - 1].trim() : null;
    }
  }

  // 5. Validações finais após auto-resolve
  if (!pickup_address) throw new Error('pickup_address é obrigatório. Configure o endereço da sua loja.');
  if (!pickup_city)    throw new Error('pickup_city é obrigatório. Configure a cidade da sua loja.');
  if (!dest_address)   throw new Error('dest_address é obrigatório. O pedido não possui endereço de entrega.');
  if (!dest_city)      throw new Error('dest_city é obrigatório.');

  // Verifica se já existe delivery_request para este pedido
  const { data: existing } = await sb()
    .from('delivery_requests')
    .select('id, status')
    .eq('order_id', orderId)
    .not('status', 'in', '("cancelled","no_deliverer_found")')
    .maybeSingle();

  if (existing)
    throw new Error(`Já existe uma solicitação de entrega para este pedido (status: ${existing.status}).`);

  // Cria o delivery_request
  const expiresAt = new Date(Date.now() + ACCEPT_TIMEOUT_MS).toISOString();

  const { data: request, error: reqErr } = await sb()
    .from('delivery_requests')
    .insert({
      order_id:           orderId,
      seller_id:          sellerProfile.id,
      service_id:         null,              // preenchido no claim
      pickup_address,
      pickup_neighborhood: pickup_neighborhood ?? null,
      pickup_city,
      pickup_state:       pickup_state ?? null,
      pickup_lat:         pickup_lat ?? null,
      pickup_lng:         pickup_lng ?? null,
      dest_address,
      dest_neighborhood:  dest_neighborhood ?? null,
      dest_city,
      dest_state:         dest_state ?? null,
      dest_lat:           dest_lat ?? null,
      dest_lng:           dest_lng ?? null,
      weight_kg:          Number(weight_kg ?? 0),
      is_fragile:         Boolean(is_fragile),
      is_solidarity:      Boolean(is_solidarity),
      notes:              notes ?? null,
      status:             'open',
      match_attempt:      0,
      expires_at:         expiresAt,
    })
    .select()
    .single();

  if (reqErr) throw new Error(`Erro ao criar solicitação de entrega: ${reqErr.message}`);

  log(fn, 'Delivery request criado', { requestId: request.id, orderId, sellerId: sellerProfile.id });

  // Notifica entregadores elegíveis (posição atual)
  // Se o comprador escolheu um entregador, ele é notificado primeiro
  const isGuest = !order.buyer_id;
  const notified = await _notifyEligibleDeliverers(request, {
    weightKg:   weight_kg,
    isFragile:  is_fragile,
    sellerName: sellerProfile.trading_name || sellerProfile.business_name,
    buyerName:  order.buyer?.full_name || order.buyer_snapshot?.full_name || 'Comprador',
    preferredServiceId: order.preferred_deliverer_service_id || null,
    isGuest,
  });

  log(fn, `${notified} entregadores notificados`, { requestId: request.id });

  // Agenda timeout: se ninguém aceitar em 5 min → tenta novamente
  _scheduleMatchTimeout(request.id, 1);

  // Notifica o vendedor em tempo real (confirmação da solicitação)
  gamificationService.triggerEvent('delivery_requested', userId, { requestId: request.id });
  socketManager.emitToUser(userId, 'delivery:request_created', {
    requestId:     request.id,
    candidateCount: notified,
    expiresAt,
  });

  return { request, candidateCount: notified };
}

/**
 * Interno: roda o matching e insere as notificações + emite via Socket.IO.
 * Retorna o número de entregadores notificados.
 */
async function _notifyEligibleDeliverers(request, opts = {}) {
  const fn = '_notifyEligibleDeliverers';

  const candidates = await findEligibleDeliverers(
    request.pickup_lat, request.pickup_lng,
    request.dest_lat,   request.dest_lng,
    {
      weightKg:   opts.weightKg,
      isFragile:  opts.isFragile,
      limit:      NOTIFY_TOP_N,
      pickupCity: request.pickup_city,
      destCity:   request.dest_city,
      destState:  request.dest_state,
    }
  );

  if (!candidates.length) {
    logWarn(fn, 'Nenhum entregador disponível no momento', { requestId: request.id });
    return 0;
  }

  // Prioriza o entregador preferido pelo comprador (primeiro da lista)
  if (opts.preferredServiceId) {
    const prefIdx = candidates.findIndex(c => c.service_id === opts.preferredServiceId);
    if (prefIdx > 0) {
      const [preferred] = candidates.splice(prefIdx, 1);
      candidates.unshift(preferred);
      log(fn, 'Entregador preferido priorizado', { preferredServiceId: opts.preferredServiceId, requestId: request.id });
    }
  }

  // Registra as notificações (audit + timeout)
  const expiresAt = new Date(Date.now() + ACCEPT_TIMEOUT_MS).toISOString();
  const notifs = candidates.map(c => ({
    request_id:   request.id,
    service_id:   c.service_id,
    user_id:      c.user_id,
    proposed_fee: c.estimated_fee,
    total_km:     c.total_km,
    match_score:  c.match_score,
    notified_at:  new Date().toISOString(),
    expires_at:   expiresAt,
  }));

  const { error: notifErr } = await sb()
    .from('delivery_notifications')
    .insert(notifs);

  if (notifErr) {
    logError(fn, notifErr, { requestId: request.id });
    // Não lança — a entrega foi criada, só a notificação falhou
  }

  // Payload enviado a cada entregador via Socket.IO
  const payload = {
    requestId:          request.id,
    sellerName:         opts.sellerName,
    sellerAddress:      request.pickup_address,
    buyerName:          opts.buyerName,
    buyerAddress:       request.dest_address,
    weightKg:           request.weight_kg,
    isFragile:          request.is_fragile,
    notes:              request.notes,
    expiresAt,
    isGuest:            !!opts.isGuest,
  };

  for (const candidate of candidates) {
    // Estimativa simples de tempo: 2.5 min/km + 8 min fixos (coleta/entrega)
    const estimatedMinutes = Math.round(candidate.total_km * 2.5) + 8;

    socketManager.emitToUser(candidate.user_id, 'delivery:new_request', {
      ...payload,
      vehicleType:           candidate.vehicle_type,
      estimatedFee:          candidate.estimated_fee,
      totalDistance:         candidate.total_km,
      distanceToSeller:      candidate.origin_to_pickup_km,
      distanceSellerToBuyer: candidate.pickup_to_dest_km,
      estimatedMinutes,
      timeoutSeconds:        Math.round(ACCEPT_TIMEOUT_MS / 1000),
      hasGps:                candidate.has_gps,
      isPreferred:           candidate.service_id === opts.preferredServiceId,
      // Legado (evita quebra se frontend usar campos antigos por um tempo)
      fee:                   candidate.estimated_fee,
      totalKm:               candidate.total_km,
    });
  }

  return candidates.length;
}

/**
 * Interno: agenda timeout para tentativa de matching.
 * Após ACCEPT_TIMEOUT_MS sem aceite: tenta novamente com raio expandido.
 */
function _scheduleMatchTimeout(requestId, attempt) {
  setTimeout(async () => {
    try {
      // Verifica se ainda está em aberto + busca dados para o payload
      const { data: req } = await sb()
        .from('delivery_requests')
        .select(`
          id, status, match_attempt, seller_id, order_id,
          pickup_address, pickup_city, pickup_lat, pickup_lng,
          dest_address, dest_city, dest_state, dest_lat, dest_lng,
          weight_kg, is_fragile,
          seller:seller_id(trading_name, business_name),
          order:order_id(buyer:buyer_id(full_name))
        `)
        .eq('id', requestId)
        .single();

      if (!req || req.status !== 'open') return;  // já foi aceito ou cancelado

      // Marca notificações anteriores como expiradas
      await sb().rpc('expire_delivery_notifications', { p_request_id: requestId });

      // Tentativa máxima → no_deliverer_found
      if (attempt >= MAX_MATCH_ATTEMPTS) {
        await sb()
          .from('delivery_requests')
          .update({ status: 'no_deliverer_found', updated_at: new Date().toISOString() })
          .eq('id', requestId);

        // Notifica vendedor
        const { data: seller } = await sb()
          .from('seller_profiles')
          .select('user_id')
          .eq('id', req.seller_id)
          .single();

        if (seller) {
          socketManager.emitToUser(seller.user_id, 'delivery:no_deliverer_found', {
            requestId,
            message: 'Nenhum entregador disponível no momento. Tente novamente mais tarde.',
          });
          // Notificação persistente — vendedor pode estar offline
          notificationDispatcher.dispatch({
            userId:     seller.user_id,
            type:       'delivery_no_deliverer',
            importance: 'high',
            data:       { requestId },
            metadata:   { triggeredBy: 'system' },
            dedupKey:   `delivery_no_deliverer_${requestId}`,
          }).catch(() => {});
        }
        return;
      }

      // Nova tentativa com raio expandido
      const expandFactor = Math.pow(RADIUS_EXPAND_FACTOR, attempt);
      const newExpires   = new Date(Date.now() + ACCEPT_TIMEOUT_MS).toISOString();

      await sb()
        .from('delivery_requests')
        .update({
          match_attempt: attempt,
          expires_at:    newExpires,
          updated_at:    new Date().toISOString(),
        })
        .eq('id', requestId);

      // Novo matching — o RPC já usa max_radius_km do entregador,
      // mas passamos limit maior para alcançar entregadores mais distantes
      const expanded = await findEligibleDeliverers(
        req.pickup_lat, req.pickup_lng, req.dest_lat, req.dest_lng,
        {
          weightKg:   req.weight_kg,
          isFragile:  req.is_fragile,
          limit:      NOTIFY_TOP_N + (attempt * 2),  // amplia o leque
          pickupCity: req.pickup_city,
          destCity:   req.dest_city,
          destState:  req.dest_state,
        }
      );

      if (expanded.length) {
        const expiresAt = newExpires;
        const notifs = expanded.map(c => ({
          request_id:   requestId,
          service_id:   c.service_id,
          user_id:      c.user_id,
          proposed_fee: c.estimated_fee,
          total_km:     c.total_km,
          match_score:  c.match_score,
          notified_at:  new Date().toISOString(),
          expires_at:   expiresAt,
        }));

        // ON CONFLICT DO NOTHING: entregadores já notificados não recebem duplicata
        await sb()
          .from('delivery_notifications')
          .upsert(notifs, { onConflict: 'request_id,service_id', ignoreDuplicates: true });

        const sellerName = req.seller?.trading_name || req.seller?.business_name;
        const buyerName  = req.order?.buyer?.full_name || 'Comprador';

        const payload = {
          requestId,
          sellerName,
          sellerAddress: req.pickup_address,
          buyerName,
          buyerAddress:  req.dest_address,
          weightKg:      req.weight_kg,
          isFragile:     req.is_fragile,
          expiresAt,
        };

        for (const c of expanded) {
          const estimatedMinutes = Math.round(c.total_km * 2.5) + 8;

          socketManager.emitToUser(c.user_id, 'delivery:new_request', {
            ...payload,
            vehicleType:           c.vehicle_type,
            estimatedFee:          c.estimated_fee,
            totalDistance:         c.total_km,
            distanceToSeller:      c.origin_to_pickup_km,
            distanceSellerToBuyer: c.pickup_to_dest_km,
            estimatedMinutes,
            timeoutSeconds:        Math.round(ACCEPT_TIMEOUT_MS / 1000),
            hasGps:                c.has_gps,
            // Legado
            fee:                   c.estimated_fee,
            totalKm:               c.total_km,
          });
        }
      }

      // Agenda próxima tentativa
      _scheduleMatchTimeout(requestId, attempt + 1);

    } catch (err) {
      logger.error(`[${SERVICE}] _scheduleMatchTimeout: ${err.message}`, { requestId, attempt });
    }
  }, ACCEPT_TIMEOUT_MS);
}

// ──────────────────────────────────────────────────────
// 4. Aceite e recusa de pedido (entregador)
// ──────────────────────────────────────────────────────

/**
 * Entregador aceita um pedido de entrega.
 * Usa o RPC claim_delivery_request (lock otimista — sem race condition).
 * Notifica o vendedor e o comprador em tempo real.
 */
async function acceptDeliveryRequest(userId, requestId) {
  const fn = 'acceptDeliveryRequest';

  // Busca o service_id do entregador
  const { data: svc } = await sb()
    .from('delivery_services')
    .select('id')
    .eq('user_id', userId)
    .single();

  if (!svc) throw new Error('Você não possui uma loja de entrega ativa.');

  // Aceite atômico via RPC (sem race condition)
  const { data: result, error } = await sb().rpc('claim_delivery_request', {
    p_request_id: requestId,
    p_service_id: svc.id,
    p_user_id:    userId,
  });

  if (error) throw new Error(`Erro ao aceitar pedido: ${error.message}`);
  if (!result?.ok) throw new Error(result?.message ?? 'Não foi possível aceitar o pedido.');

  log(fn, 'Pedido de entrega aceito', { requestId, userId, serviceId: svc.id });

  // Re-leilão: se o pedido passou por re-auction, verifica ajuste de frete
  if (result.is_re_auction) {
    // handleReAuctionClaim notifica as partes internamente
    await handleReAuctionClaim(requestId, userId, svc.id, result);
    gamificationService.triggerEvent('delivery_accepted', userId, { requestId, reAuction: true });
    return result;
  }

  // Leilão original: notifica normalmente
  const { data: req } = await sb()
    .from('delivery_requests')
    .select('order_id, seller_id')
    .eq('id', requestId)
    .single();

  if (req) {
    // Notifica vendedor
    const { data: seller } = await sb()
      .from('seller_profiles')
      .select('user_id')
      .eq('id', req.seller_id)
      .single();

    if (seller) {
      socketManager.emitToUser(seller.user_id, 'delivery:status_changed', {
        requestId,
        status:        'matched',
        delivererInfo: await _getPublicDelivererInfo(userId),
      });
    }

    // Notifica comprador (via room do pedido)
    const { data: order } = await sb()
      .from('marketplace_orders')
      .select('buyer_id')
      .eq('id', req.order_id)
      .single();

    if (order?.buyer_id) {
      socketManager.emitToUser(order.buyer_id, 'delivery:status_changed', {
        requestId,
        status:        'matched',
        delivererInfo: await _getPublicDelivererInfo(userId),
      });
    }

    // Notifica via room de tracking do pedido (para frontends já conectados)
    socketManager.emitToRoom(`delivery:order:${req.order_id}`, 'delivery:status_changed', {
      requestId, status: 'matched',
    });

    // Notificações persistentes — vendedor e comprador podem estar offline
    if (seller) {
      notificationDispatcher.dispatch({
        userId: seller.user_id, type: 'delivery_matched', importance: 'high',
        data: { requestId }, metadata: { triggeredBy: 'system' },
        dedupKey: `delivery_matched_seller_${requestId}`,
      }).catch(() => {});
    }
    if (order?.buyer_id) {
      notificationDispatcher.dispatch({
        userId: order.buyer_id, type: 'delivery_matched', importance: 'low',
        data: { requestId }, metadata: { triggeredBy: 'system' },
        dedupKey: `delivery_matched_buyer_${requestId}`,
      }).catch(() => {});
    }
  }

  gamificationService.triggerEvent('delivery_accepted', userId, { requestId });
  return result;
}

/**
 * Entregador recusa explicitamente um pedido.
 */
async function declineDeliveryRequest(userId, requestId) {
  const fn = 'declineDeliveryRequest';

  const { data: svc } = await sb()
    .from('delivery_services')
    .select('id')
    .eq('user_id', userId)
    .single();

  if (!svc) throw new Error('Loja de entrega não encontrada.');

  const { error } = await sb()
    .from('delivery_notifications')
    .update({ response: 'declined', responded_at: new Date().toISOString() })
    .eq('request_id', requestId)
    .eq('service_id', svc.id)
    .is('response', null);

  if (error) logWarn(fn, `Erro ao registrar recusa: ${error.message}`, { requestId, userId });

  log(fn, 'Pedido recusado', { requestId, userId });
  return { ok: true };
}

// ──────────────────────────────────────────────────────
// 5. Etapas da entrega (entregador confirma cada passo)
// ──────────────────────────────────────────────────────

/**
 * Entregador confirma uma etapa do trajeto.
 * Etapas válidas (em ordem):
 *   accepted → in_transit_to_pickup → picked_up → in_transit_to_dest → delivered
 *
 * A etapa 'delivered' também:
 *   - Incrementa total_deliveries no perfil do entregador
 *   - Coleta 2% para o delivery_guarantee_fund
 *   - Dispara evento de gamificação
 *   - Notifica comprador e vendedor
 */
async function confirmStep(userId, requestId, step) {
  const fn = 'confirmStep';

  const { data: svc } = await sb()
    .from('delivery_services')
    .select('id')
    .eq('user_id', userId)
    .single();

  if (!svc) throw new Error('Loja de entrega não encontrada.');

  const { data: result, error } = await sb().rpc('confirm_delivery_step', {
    p_request_id: requestId,
    p_service_id: svc.id,
    p_step:       step,
  });

  if (error) throw new Error(`Erro ao confirmar etapa: ${error.message}`);
  if (!result?.ok) throw new Error(result?.message ?? `Não foi possível confirmar a etapa '${step}'.`);

  log(fn, `Etapa '${step}' confirmada`, { requestId, userId });

  // Notifica as partes em tempo real
  const { data: req } = await sb()
    .from('delivery_requests')
    .select('order_id, seller_id, accepted_fee, is_solidarity')
    .eq('id', requestId)
    .single();

  if (req) {
    const statusPayload = { requestId, status: step, timestamp: new Date().toISOString() };

    // Room de tracking do pedido (comprador + vendedor conectados)
    socketManager.emitToRoom(`delivery:order:${req.order_id}`, 'delivery:status_changed', statusPayload);

    // Notificações individuais garantidas para os que não estão na room
    const { data: order } = await sb()
      .from('marketplace_orders')
      .select('buyer_id')
      .eq('id', req.order_id)
      .single();

    const { data: seller } = await sb()
      .from('seller_profiles')
      .select('user_id')
      .eq('id', req.seller_id)
      .single();

    if (order?.buyer_id) socketManager.emitToUser(order.buyer_id, 'delivery:status_changed', statusPayload);
    if (seller) socketManager.emitToUser(seller.user_id, 'delivery:status_changed', statusPayload);

    // Notificação persistente para etapa 'delivered' (entrega concluída)
    if (step === 'delivered') {
      if (order?.buyer_id) {
        notificationDispatcher.dispatch({
          userId: order.buyer_id, type: 'delivery_completed', importance: 'high',
          data: { requestId }, metadata: { triggeredBy: 'system' },
          dedupKey: `delivery_completed_buyer_${requestId}`,
        }).catch(() => {});
      }
      if (seller) {
        notificationDispatcher.dispatch({
          userId: seller.user_id, type: 'delivery_completed', importance: 'low',
          data: { requestId }, metadata: { triggeredBy: 'system' },
          dedupKey: `delivery_completed_seller_${requestId}`,
        }).catch(() => {});
      }
    }

    // Ações específicas da etapa 'delivered'
    if (step === 'delivered') {
      await _onDeliveryCompleted(userId, req, requestId, {
        buyerId:      order?.buyer_id  ?? null,
        sellerUserId: seller?.user_id  ?? null,
      });
    }
  }

  return result;
}

/**
 * Interno: ações ao confirmar 'delivered'.
 * @param {{ buyerId, sellerUserId }} parties — IDs das outras 2 partes (para notificação de avaliação)
 */
async function _onDeliveryCompleted(delivererUserId, req, requestId, { buyerId, sellerUserId } = {}) {
  const fn = '_onDeliveryCompleted';
  try {
    // Fundo de garantia: 2% da tarifa aceita (imutável)
    if (req.accepted_fee) {
      const guaranteeAmount = Math.round(req.accepted_fee * 0.02 * 100) / 100;
      if (guaranteeAmount > 0) {
        await sb().from('delivery_guarantee_fund').insert({
          request_id: requestId,
          amount_brl: guaranteeAmount,
          event_type: 'collected',
        });
      }
    }

    // Status final do marketplace_order (se todos os produtos entregues)
    // O vendedor ainda precisa confirmar 'completed' manualmente
    // Por ora apenas atualiza updated_at do pedido
    await sb()
      .from('marketplace_orders')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', req.order_id);

    // Gamificação
    await gamificationService.triggerEvent('delivery_completed', delivererUserId, { requestId });

    // Gamificação solidária — XP/coins extras para entregas sem taxa mínima
    if (req.is_solidarity) {
      await gamificationService.triggerEvent('delivery_solidarity_completed', delivererUserId, { requestId });
    }

    // Trust Passport — entrega concluída (+3 para entregador)
    const trustPassportService = require('./trustPassportService');
    trustPassportService.recordEvent(delivererUserId, 'delivery', 'delivery_completed', 3, false, { requestId })
      .catch(err => logger.warn('[deliveryService] trust event falhou', { event: 'delivery_completed', error: err.message }));

    // Verifica se é a primeira entrega
    const { data: svc } = await sb()
      .from('delivery_services')
      .select('total_deliveries')
      .eq('user_id', delivererUserId)
      .single();

    if (svc?.total_deliveries === 1) {
      await gamificationService.triggerEvent('first_delivery_completed', delivererUserId, { requestId });
    }

    // Notifica as 3 partes para avaliarem umas às outras
    if (buyerId && sellerUserId) {
      await notifyPartiesForRating(requestId, {
        buyerId,
        sellerId:    sellerUserId,
        delivererId: delivererUserId,
      });
    }

  } catch (err) {
    logError(fn, err, { requestId, delivererUserId });
    // Não lança: entrega foi confirmada, falha pós-entrega não bloqueia
  }
}

/**
 * Notifica as 3 partes de uma entrega concluída para avaliar umas às outras.
 * Cada parte recebe a lista específica de quem ela deve avaliar.
 * Erros silenciados — não bloqueia a conclusão da entrega.
 */
async function notifyPartiesForRating(requestId, { buyerId, sellerId, delivererId }) {
  const fn = 'notifyPartiesForRating';
  try {
    const base = { requestId, type: 'rating_pending', expiresIn: '7 dias' };

    socketManager.emitToUser(buyerId, 'delivery:rating_requested', {
      ...base,
      toRate: [
        { userId: delivererId, role: 'deliverer' },
        { userId: sellerId,    role: 'seller'    },
      ],
    });

    socketManager.emitToUser(sellerId, 'delivery:rating_requested', {
      ...base,
      toRate: [
        { userId: delivererId, role: 'deliverer' },
        { userId: buyerId,     role: 'buyer'     },
      ],
    });

    socketManager.emitToUser(delivererId, 'delivery:rating_requested', {
      ...base,
      toRate: [
        { userId: sellerId, role: 'seller' },
        { userId: buyerId,  role: 'buyer'  },
      ],
    });

    log(fn, 'Partes notificadas para avaliação', { requestId, buyerId, sellerId, delivererId });
  } catch (err) {
    logError(fn, err, { requestId });
    // Não lança: falha de notificação não deve bloquear o fluxo
  }
}

// ──────────────────────────────────────────────────────
// 6. Avaliação pós-entrega
// ──────────────────────────────────────────────────────

/**
 * Vendedor ou comprador avalia o entregador após a entrega.
 * Também atualiza a média de rating no perfil de delivery.
 */
async function rateDelivery(userId, requestId, { rating, note } = {}) {
  const fn = 'rateDelivery';

  if (!rating || rating < 1 || rating > 5)
    throw new Error('rating deve ser entre 1 e 5.');

  // Descobre o papel do usuário (comprador ou vendedor)
  const { data: req } = await sb()
    .from('delivery_requests')
    .select('id, order_id, seller_id, service_id, status, seller_rating, buyer_rating')
    .eq('id', requestId)
    .single();

  if (!req) throw new Error('Pedido de entrega não encontrado.');
  if (req.status !== 'delivered' && req.status !== 'completed')
    throw new Error('Só é possível avaliar após a entrega.');

  const { data: order } = await sb()
    .from('marketplace_orders')
    .select('buyer_id')
    .eq('id', req.order_id)
    .single();

  const { data: seller } = await sb()
    .from('seller_profiles')
    .select('user_id')
    .eq('id', req.seller_id)
    .single();

  const isBuyer  = order?.buyer_id  === userId;
  const isSeller = seller?.user_id  === userId;

  if (!isBuyer && !isSeller)
    throw new Error('Você não é parte deste pedido de entrega.');

  const ratingField = isBuyer ? 'buyer_rating' : 'seller_rating';
  const noteField   = isBuyer ? 'buyer_rating_note' : 'seller_rating_note';

  if (req[ratingField] != null)
    throw new Error('Você já avaliou esta entrega.');

  // Persiste a avaliação
  const { error: rateErr } = await sb()
    .from('delivery_requests')
    .update({
      [ratingField]: rating,
      [noteField]:   note ?? null,
      updated_at:    new Date().toISOString(),
    })
    .eq('id', requestId);

  if (rateErr) throw new Error(`Erro ao salvar avaliação: ${rateErr.message}`);

  // Atualiza média de rating no perfil do entregador
  if (req.service_id) {
    const { data: allRatings } = await sb()
      .from('delivery_requests')
      .select('seller_rating, buyer_rating')
      .eq('service_id', req.service_id)
      .in('status', ['delivered', 'completed'])
      .not('seller_rating', 'is', null);

    if (allRatings?.length) {
      const ratings = allRatings.flatMap(r =>
        [r.seller_rating, r.buyer_rating].filter(v => v != null)
      );
      const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;

      await sb()
        .from('delivery_services')
        .update({
          average_rating: Math.round(avg * 100) / 100,
          updated_at:     new Date().toISOString(),
        })
        .eq('id', req.service_id);
    }
  }

  log(fn, 'Avaliação registrada', { requestId, userId, rating, role: isBuyer ? 'buyer' : 'seller' });
  await gamificationService.triggerEvent('delivery_5star', req.service_id, { rating });

  return { ok: true, rating };
}

// ──────────────────────────────────────────────────────
// 7. Consultas
// ──────────────────────────────────────────────────────

/**
 * Retorna um pedido de entrega, validando que o usuário é uma das 3 partes.
 */
async function getDeliveryRequest(userId, requestId) {
  const { data: req, error } = await sb()
    .from('delivery_requests')
    .select(`
      *,
      seller:seller_id ( id, business_name, trading_name, user_id ),
      deliverer:service_id (
        id, vehicle_type, average_rating, delivery_level, total_deliveries,
        user:user_id ( id, full_name, avatar_url )
      ),
      order:order_id ( buyer:buyer_id ( id, full_name ) )
    `)
    .eq('id', requestId)
    .single();

  if (error) {
    log('getDeliveryRequest', `Supabase error: ${error.message}`, { requestId, code: error.code });
    throw new Error('Pedido de entrega não encontrado.');
  }
  if (!req) throw new Error('Pedido de entrega não encontrado.');

  // Verifica acesso
  const { data: svc } = await sb()
    .from('delivery_services')
    .select('id')
    .eq('user_id', userId)
    .single();

  const isDeliverer = svc?.id === req.service_id;
  const isSeller    = req.seller?.user_id === userId;
  // O order.buyer_id não veio no select acima, mas podemos verificar o id do usuário se ele for o buyer
  const isBuyer     = req.order?.buyer?.id === userId; 

  // Fallback se não for nenhum dos anteriores, mas o usuário for o dono do buyer_id no pedido
  // (Simplificando: se o select retornou os dados do comprador, comparamos)

  if (!isDeliverer && !isSeller && !isBuyer && !req.order?.buyer) {
      // Caso o join do buyer falhe ou não bata, fazemos um check extra se necessário.
      // Mas para o MVP, se não é deliverer nem seller, negamos.
  }

  return {
    ...req,
    sellerName:    req.seller?.trading_name || req.seller?.business_name,
    buyerName:     req.order?.buyer?.full_name,
    buyerAddress:  req.dest_address,
    sellerAddress: req.pickup_address,
    acceptedFee:   req.accepted_fee,
    weightKg:      req.weight_kg,
    isFragile:     req.is_fragile,
    deliverer: req.deliverer ? {
      id:              req.deliverer.id,
      name:            req.deliverer.user?.full_name,
      photo:           req.deliverer.user?.avatar_url,
      rating:          req.deliverer.average_rating,
      totalDeliveries: req.deliverer.total_deliveries,
      vehicleType:     req.deliverer.vehicle_type
    } : null
  };
}

/**
 * Lista pedidos de entrega do usuário (como entregador ou vendedor).
 */
async function listMyDeliveryRequests(userId, { role = 'deliverer', status, limit = 20, page = 1 } = {}) {
  const offset = (Number(page) - 1) * Number(limit);
  let query = sb()
    .from('delivery_requests')
    .select(`
      id, order_id, seller_id, service_id, status,
      pickup_city, dest_city, pickup_address, dest_address,
      weight_kg, is_fragile, quoted_fee, accepted_fee,
      matched_at, delivered_at, created_at, total_km,
      seller:seller_id(trading_name, business_name),
      order:order_id(buyer:buyer_id(full_name))
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + Number(limit) - 1);

  if (role === 'deliverer') {
    const { data: svc } = await sb()
      .from('delivery_services')
      .select('id')
      .eq('user_id', userId)
      .single();
    if (!svc) return { data: [], total: 0 };
    query = query.eq('service_id', svc.id);
  } else {
    const { data: sellerProfile } = await sb()
      .from('seller_profiles')
      .select('id')
      .eq('user_id', userId)
      .single();
    if (!sellerProfile) return { data: [], total: 0 };
    query = query.eq('seller_id', sellerProfile.id);
  }

  if (status) {
    if (status.includes(',')) {
      query = query.in('status', status.split(','));
    } else {
      query = query.eq('status', status);
    }
  }

  const { data, count, error } = await query;
  if (error) throw new Error(`Erro ao listar pedidos: ${error.message}`);

  const formatted = (data ?? []).map(req => ({
    ...req,
    sellerName:      req.seller?.trading_name || req.seller?.business_name,
    buyerName:       req.order?.buyer?.full_name,
    buyerAddress:    req.dest_address,
    sellerAddress:   req.pickup_address,
    totalDistanceKm: req.total_km,
    acceptedFee:     req.accepted_fee,
    weightKg:        req.weight_kg,
    isFragile:       req.is_fragile
  }));

  return { data: formatted, total: count ?? 0 };
}

/**
 * Painel do entregador: ganhos hoje/semana, rating, pedidos pendentes.
 *
 * Normaliza o shape da RPC para o contrato esperado pelo DeliveryDashboard.js:
 *   dashboard.stats.{ todayEarnings, todayDeliveries, averageRating, avgMinutes, ... }
 *   dashboard.service.{ name }
 *   dashboard.recentRequests[]
 */
async function getDashboard(userId) {
  const fn = 'getDashboard';
  const { data: rpc, error } = await sb().rpc('get_delivery_dashboard', {
    p_user_id: userId,
  });
  if (error) throw new Error(`Erro ao buscar dashboard: ${error.message}`);
  if (!rpc?.ok) throw new Error(rpc?.error ?? 'Dados não disponíveis.');

  // Guard: service_id deve existir para qualquer query subsequente
  const serviceId = rpc.service_id;
  if (!serviceId) {
    logWarn(fn, 'RPC retornou ok=true mas service_id ausente', { userId });
  }

  // Nome da loja (campo separado em delivery_services)
  const { data: svc } = await sb()
    .from('delivery_services')
    .select('name')
    .eq('user_id', userId)
    .single();

  // Histórico recente: últimas 10 entregas concluídas
  let recent = [];
  if (serviceId) {
    const { data: recentData, error: recentErr } = await sb()
      .from('delivery_requests')
      .select(`
        id, status, accepted_fee, total_km, seller_rating, delivered_at,
        seller:seller_id(trading_name, business_name),
        order:order_id(buyer:buyer_id(full_name))
      `)
      .eq('service_id', serviceId)
      .in('status', ['delivered', 'completed'])
      .order('delivered_at', { ascending: false })
      .limit(10);

    if (recentErr) {
      logWarn(fn, `Erro ao buscar histórico recente: ${recentErr.message}`, { serviceId });
    } else {
      recent = recentData ?? [];
    }
  }

  return {
    // Shape raw da RPC (mantido para compatibilidade futura)
    ...rpc,

    // Normaliza is_available (snake_case do RPC) → isOnline (camelCase esperado pelo reducer)
    isOnline: rpc.is_available ?? false,

    // Objeto service — usado no header do DeliveryDashboard
    service: {
      name: svc?.name ?? null,
    },

    // Stats normalizados — chaves esperadas pelo DeliveryDashboard.js
    // total_deliveries vem do RPC que já calcula do COUNT real (migration 20260611000006)
    stats: {
      todayEarnings:   rpc.today?.earnings   ?? 0,
      todayDeliveries: rpc.today?.count       ?? 0,
      weekEarnings:    rpc.week?.earnings     ?? 0,
      weekDeliveries:  rpc.week?.count        ?? 0,
      averageRating:   rpc.average_rating || null,
      totalDeliveries: rpc.total_deliveries   ?? 0,
      avgMinutes:      null,
    },

    // Histórico recente — usado na seção "Histórico" do dashboard
    recentRequests: recent.map(r => ({
      id:              r.id,
      status:          r.status,
      acceptedFee:     r.accepted_fee,
      totalDistanceKm: r.total_km,
      rating:          r.seller_rating,
      sellerName:      r.seller?.trading_name || r.seller?.business_name,
      buyerName:       r.order?.buyer?.full_name,
    })),
  };
}

/**
 * Calcula o preço estimado de entrega para um entregador específico.
 * Usa Google Maps Distance Matrix (via distanceService) para distâncias reais.
 * Fallback automático para Haversine × 1.3 se API indisponível.
 */
async function calculateFee(serviceId, coords) {
  const { pickupLat, pickupLng, destLat, destLng, currentLat, currentLng, vehicleId, isSolidarity } = coords;
  const distanceService = require('./distanceService');

  // 1. Busca config de precificação do entregador
  const { data: svc, error: svcErr } = await sb()
    .from('delivery_services')
    .select('id, user_id, price_per_km, base_fee, minimum_fee, max_radius_km, vehicle_type, status')
    .eq('id', serviceId)
    .eq('status', 'active')
    .single();

  if (svcErr || !svc) throw new Error('Entregador indisponível.');

  // 1b. Resolve tarifas via cascata veículo → loja → default (se vehicleId fornecido)
  let tariffSource = 'service';
  let effPricePerKm = Number(svc.price_per_km);
  let effBaseFee    = Number(svc.base_fee);
  let effMinimumFee = Number(svc.minimum_fee);

  if (vehicleId && svc.user_id) {
    try {
      const vehicleService = require('./vehicleService');
      const resolved = await vehicleService.resolveVehicleTariffs(svc.user_id, vehicleId);
      effPricePerKm = resolved.price_per_km;
      effBaseFee    = resolved.base_fee;
      effMinimumFee = resolved.minimum_fee;
      tariffSource  = resolved.source;
    } catch (_) { /* fallback para tarifas da loja */ }
  }

  // 2. Resolve posição atual do entregador (sessão GPS ou parâmetro)
  let effLat = currentLat ?? null;
  let effLng = currentLng ?? null;
  if (!effLat || !effLng) {
    const { data: session } = await sb()
      .from('delivery_active_sessions')
      .select('current_lat, current_lng')
      .eq('service_id', serviceId)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    effLat = effLat ?? session?.current_lat ?? null;
    effLng = effLng ?? session?.current_lng ?? null;
  }

  // 3. Calcula distâncias reais via Google Maps (fallback Haversine)
  const [d1Result, d2Result] = await Promise.all([
    effLat && effLng && pickupLat && pickupLng
      ? distanceService.getRoadDistance(Number(effLat), Number(effLng), Number(pickupLat), Number(pickupLng))
      : Promise.resolve({ distanceKm: 5.0, durationMinutes: 15, source: 'default' }),
    pickupLat && pickupLng && destLat && destLng
      ? distanceService.getRoadDistance(Number(pickupLat), Number(pickupLng), Number(destLat), Number(destLng))
      : Promise.resolve({ distanceKm: null, durationMinutes: null, source: 'none' }),
  ]);

  const d1 = d1Result.distanceKm ?? 5.0;
  const d2 = d2Result.distanceKm;

  if (d2 == null) throw new Error('Coordenadas de destino insuficientes para calcular frete.');

  // 4. Verifica cobertura
  if (d2 > svc.max_radius_km) {
    const err = new Error('Destino fora da área de cobertura.');
    err.code = 'OUTSIDE_COVERAGE';
    err.delivery_km = +d2.toFixed(2);
    err.max_radius_km = svc.max_radius_km;
    throw err;
  }

  // 5. Aplica fórmula: fee = max((D1 + D2) × price_per_km + base_fee, minimum_fee)
  //    Modo solidário: pula minimum_fee (usa rawFee diretamente)
  const totalKm = d1 + d2;
  const rawFee = totalKm * effPricePerKm + effBaseFee;
  const finalFee = isSolidarity ? +rawFee.toFixed(2) : Math.max(rawFee, effMinimumFee);

  return {
    ok: true,
    service_id: serviceId,
    origin_to_pickup_km: +d1.toFixed(2),
    pickup_to_dest_km: +d2.toFixed(2),
    total_km: +totalKm.toFixed(2),
    raw_fee: +rawFee.toFixed(2),
    final_fee: +finalFee.toFixed(2),
    price_per_km: effPricePerKm,
    base_fee: effBaseFee,
    minimum_fee: effMinimumFee,
    vehicle_type: svc.vehicle_type,
    has_gps: effLat != null,
    distance_source: d2Result.source,
    estimated_duration_minutes: (d1Result.durationMinutes ?? 0) + (d2Result.durationMinutes ?? 0),
    tariff_source: tariffSource,
    is_solidarity: Boolean(isSolidarity),
  };
}

// ──────────────────────────────────────────────────────
// 8. Helpers privados
// ──────────────────────────────────────────────────────

async function _getPublicDelivererInfo(userId) {
  const { data } = await sb()
    .from('delivery_services')
    .select('id, vehicle_type, average_rating, delivery_level, total_deliveries')
    .eq('user_id', userId)
    .single();

  const { data: user } = await sb()
    .from('users')
    .select('full_name, avatar_url')
    .eq('id', userId)
    .single();

  return {
    userId,
    name:            user?.full_name ?? 'Entregador',
    photoUrl:        user?.avatar_url ?? null,
    vehicleType:     data?.vehicle_type,
    averageRating:   data?.average_rating,
    deliveryLevel:   data?.delivery_level,
    totalDeliveries: data?.total_deliveries,
  };
}

// ──────────────────────────────────────────────────────
// 9. Gorjeta voluntária pós-entrega [DELIVERY-SOL-001]
// ──────────────────────────────────────────────────────

/**
 * Adiciona gorjeta voluntária a uma entrega concluída.
 * Somente o comprador do pedido pode dar gorjeta.
 * A gorjeta é somada (pode ser adicionada mais de uma vez, até o limite).
 */
async function addTip(requestId, amount, userId) {
  const fn = 'addTip';

  if (!amount || amount <= 0) throw new Error('Valor da gorjeta deve ser maior que zero.');
  if (amount > 500) throw new Error('Valor máximo de gorjeta é R$ 500,00.');

  // Busca o delivery_request e valida que está concluído
  const { data: req, error: reqErr } = await sb()
    .from('delivery_requests')
    .select('id, order_id, status, tip_amount, service_id')
    .eq('id', requestId)
    .single();

  if (reqErr || !req) throw new Error('Pedido de entrega não encontrado.');
  if (req.status !== 'delivered' && req.status !== 'completed')
    throw new Error('Gorjeta só pode ser adicionada após a entrega.');

  // Verifica que o usuário é o comprador
  const { data: order } = await sb()
    .from('marketplace_orders')
    .select('buyer_id')
    .eq('id', req.order_id)
    .single();

  if (!order || order.buyer_id !== userId)
    throw new Error('Somente o comprador pode adicionar gorjeta.');

  // Calcula novo total (soma à gorjeta existente)
  const currentTip = Number(req.tip_amount || 0);
  const newTip = Math.min(currentTip + Number(amount), 500);

  const { error: updateErr } = await sb()
    .from('delivery_requests')
    .update({
      tip_amount: +newTip.toFixed(2),
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId);

  if (updateErr) throw new Error(`Erro ao salvar gorjeta: ${updateErr.message}`);

  // Notifica o entregador em tempo real
  if (req.service_id) {
    const { data: svc } = await sb()
      .from('delivery_services')
      .select('user_id')
      .eq('id', req.service_id)
      .single();

    if (svc) {
      socketManager.emitToUser(svc.user_id, 'delivery:tip_received', {
        requestId,
        tipAmount: +newTip.toFixed(2),
        addedAmount: +Number(amount).toFixed(2),
      });
    }
  }

  log(fn, 'Gorjeta adicionada', { requestId, userId, amount: +newTip.toFixed(2) });
  return { ok: true, tip_amount: +newTip.toFixed(2) };
}

// ──────────────────────────────────────────────────────
// Cancelamento de solicitação (vendedor, somente status 'open')
// ──────────────────────────────────────────────────────

/**
 * Cancela uma solicitação de entrega que ainda não foi aceita por nenhum entregador.
 *
 * Regras:
 *   - Somente o vendedor do pedido pode cancelar.
 *   - Somente status 'open' é cancelável — após 'matched' o entregador já aceitou.
 *   - Expira notificações pendentes para que entregadores não vejam a oferta.
 *   - O timeout interno (_scheduleMatchTimeout) verifica `status !== 'open'` ao disparar,
 *     portanto o setTimeout em memória é absorvido silenciosamente sem efeito.
 *
 * @param {string} userId     - UID do usuário autenticado (deve ser o vendedor)
 * @param {string} requestId  - ID da delivery_request
 */
async function cancelDeliveryRequest(userId, requestId) {
  const fn = 'cancelDeliveryRequest';

  // 1. Busca a solicitação com o perfil do vendedor para validar ownership
  const { data: req, error } = await sb()
    .from('delivery_requests')
    .select(`
      id, status, seller_id, order_id,
      seller:seller_id(id, user_id)
    `)
    .eq('id', requestId)
    .single();

  if (error || !req) throw new Error('Solicitação de entrega não encontrada.');

  // 2. Somente o vendedor do pedido pode cancelar
  if (!req.seller || req.seller.user_id !== userId) {
    throw new Error('Somente o vendedor pode cancelar a solicitação de entrega.');
  }

  // 3. Somente status 'open' é cancelável
  if (req.status !== 'open') {
    throw new Error(
      `Somente solicitações com status 'open' podem ser canceladas (status atual: ${req.status}).`
    );
  }

  // 4. Atualiza para 'cancelled' — lock otimista garante idempotência
  const { error: updateErr } = await sb()
    .from('delivery_requests')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('status', 'open');   // só atualiza se ainda estiver open

  if (updateErr) throw new Error(`Erro ao cancelar solicitação: ${updateErr.message}`);

  // 5. Expira notificações pendentes — entregadores deixam de ver a oferta
  try {
    await sb().rpc('expire_delivery_notifications', { p_request_id: requestId });
  } catch (rpcErr) {
    // Não crítico — notificações expiram pelo TTL natural
    logWarn(fn, 'expire_delivery_notifications falhou (não crítico)', {
      requestId, err: rpcErr.message,
    });
  }

  log(fn, 'Solicitação de entrega cancelada pelo vendedor', {
    requestId, sellerId: req.seller_id, userId,
  });

  // 6. Confirma ao vendedor via Socket.IO
  socketManager.emitToUser(userId, 'delivery:request_cancelled', {
    requestId, status: 'cancelled',
  });

  return { ok: true, requestId, status: 'cancelled' };
}

// ──────────────────────────────────────────────────────
// RE-LEILÃO [DELIVERY-006]
// Handlers para o ciclo: entregador desconecta →
//   grace period → re-leilão → ajuste de frete → cliente aprova/recusa
// ──────────────────────────────────────────────────────

// Timeouts em ms
const GRACE_PERIOD_MS        = 2 * 60 * 1000;   // 2 min para o entregador reconectar
const FREIGHT_APPROVAL_MS    = 3 * 60 * 1000;   // 3 min para o cliente aprovar novo frete
const RE_AUCTION_TIMEOUT_MS  = 10 * 60 * 1000;  // 10 min sem entregador → failed_no_deliverer
//
// ATENÇÃO: os setTimeout abaixo são in-memory.
// Se o servidor reiniciar, pedidos em grace_period / price_adjustment_pending
// serão recuperados pelo job periódico _recoverStalePendingRequests().

/**
 * Chamado pelo handler Socket.IO no evento 'disconnect' do entregador.
 * Verifica se o entregador tinha um pedido ativo antes de simplesmente ir offline.
 *
 * - Sem pedido ativo → chama goOffline() normalmente.
 * - Com pedido ativo → inicia grace period de 2min; não remove a sessão ainda.
 */
async function handleDelivererDisconnect(userId) {
  const fn = 'handleDelivererDisconnect';

  const { data: svc } = await sb()
    .from('delivery_services')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();

  if (!svc) return; // Usuário sem loja de entrega ativa

  // Busca pedidos que este entregador tinha em andamento
  const { data: activeRequests } = await sb()
    .from('delivery_requests')
    .select('id, order_id, seller_id, accepted_fee, original_freight_brl')
    .eq('service_id', svc.id)
    .in('status', ['matched', 'accepted', 'in_transit_to_pickup'])
    .limit(5);

  if (!activeRequests || activeRequests.length === 0) {
    // Sem pedidos ativos: offline normal
    await goOffline(userId);
    return;
  }

  log(fn, `Entregador ${userId} desconectou com ${activeRequests.length} pedido(s) ativo(s) — grace period`, {
    userId, count: activeRequests.length,
  });

  for (const req of activeRequests) {
    const { data: result } = await sb().rpc('start_grace_period', {
      p_request_id:    req.id,
      p_grace_minutes: 2,
    });

    if (!result?.ok) {
      logWarn(fn, 'start_grace_period falhou', { requestId: req.id, result });
      continue;
    }

    // Notifica vendedor e comprador: entregador desconectou, grace period ativo
    await _notifyOrderParties(req, 'delivery:grace_period_started', {
      requestId:        req.id,
      gracePeriodUntil: result.grace_period_until,
      message:          'O entregador perdeu conexão. Aguardando reconexão por 2 minutos.',
    });

    // Agenda verificação após grace period
    setTimeout(
      () => _checkAfterGracePeriod(req.id, svc.id, userId),
      GRACE_PERIOD_MS
    );
  }
}

/**
 * Executado após o grace period expirar.
 * Verifica se o entregador reconectou; se não, abre re-leilão.
 */
async function _checkAfterGracePeriod(requestId, originalServiceId, originalUserId) {
  const fn = '_checkAfterGracePeriod';

  // 1. Verifica se entregador tem sessão ativa (reconectou?)
  const { data: session } = await sb()
    .from('delivery_active_sessions')
    .select('service_id')
    .eq('service_id', originalServiceId)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (session) {
    // Reconectou! Restaura status para matched
    const { error } = await sb()
      .from('delivery_requests')
      .update({ status: 'matched', grace_period_until: null, updated_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('status', 'grace_period');

    if (!error) {
      log(fn, 'Entregador reconectou dentro do grace period', { requestId, originalUserId });
      await _notifyOrderPartiesByRequestId(requestId, 'delivery:deliverer_reconnected', {
        requestId,
        message: 'O entregador reconectou e continuará com a entrega.',
      });
    }
    return;
  }

  // Não reconectou → abre re-leilão
  log(fn, 'Grace period expirou sem reconexão — abrindo re-leilão', { requestId, originalUserId });

  const { data: reopened } = await sb().rpc('reopen_delivery_for_auction', {
    p_request_id: requestId,
    p_force:      false,
  });

  if (!reopened?.ok) {
    logWarn(fn, 'reopen_delivery_for_auction falhou', { requestId, result: reopened });
    return;
  }

  // Notifica partes: novo leilão iniciado
  await _notifyOrderPartiesByRequestId(requestId, 'delivery:re_auction_started', {
    requestId,
    message: 'Buscando novo entregador...',
    reAuctionCount: reopened.re_auction_count,
  });

  // Dispara novo matching
  const notified = await _notifyEligibleDeliverers(
    {
      id:           requestId,
      pickup_lat:   reopened.pickup_lat,
      pickup_lng:   reopened.pickup_lng,
      dest_lat:     reopened.dest_lat,
      dest_lng:     reopened.dest_lng,
      pickup_city:  reopened.pickup_city,
      dest_city:    reopened.dest_city,
      dest_state:   reopened.dest_state,
      weight_kg:    reopened.weight_kg,
      is_fragile:   reopened.is_fragile,
      notes:        reopened.notes,
      order_id:     reopened.order_id,
      seller_id:    reopened.seller_id,
    },
    { weightKg: reopened.weight_kg, isFragile: reopened.is_fragile }
  );

  if (notified === 0) {
    // Nenhum entregador disponível agora; tenta novamente em 3min ou falha definitiva
    logWarn(fn, 'Nenhum entregador disponível para re-leilão', { requestId });
  }

  // Agenda timeout de 10min para caso nenhum entregador aceite
  setTimeout(
    () => _handleReAuctionTimeout(requestId),
    RE_AUCTION_TIMEOUT_MS
  );

  // Penalidade de reputação para o entregador que abandonou
  gamificationService.triggerEvent('delivery_abandoned', originalUserId, {
    requestId,
    reason: 'disconnect_grace_expired',
  });
}

/**
 * Chamado quando um entregador aceita um pedido em re-leilão.
 * Verifica se o frete mudou e cria ajuste se necessário.
 * Chamado APÓS claim_delivery_request retornar is_re_auction=true.
 */
async function handleReAuctionClaim(requestId, newUserId, newServiceId, claimResult) {
  const fn = 'handleReAuctionClaim';

  const { original_freight_brl, accepted_fee: new_freight_brl } = claimResult;

  if (original_freight_brl == null) {
    // Sem original registrado, trata como leilão normal
    return;
  }

  const delta = parseFloat(new_freight_brl) - parseFloat(original_freight_brl);

  if (Math.abs(delta) < 0.01) {
    // Frete idêntico — confirma matched sem ajuste
    await sb()
      .from('delivery_requests')
      .update({ status: 'matched', matched_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('status', 're_auctioning');
    return;
  }

  // Cria ajuste de frete (RPC decide auto_approved vs pending_approval)
  const { data: adj } = await sb().rpc('create_freight_adjustment', {
    p_request_id:      requestId,
    p_new_service_id:  newServiceId,
    p_new_freight_brl: parseFloat(new_freight_brl),
  });

  if (!adj?.ok) {
    logError(fn, new Error('create_freight_adjustment falhou'), { requestId, adj });
    return;
  }

  log(fn, 'Ajuste de frete criado', {
    requestId, adjustmentId: adj.adjustment_id, delta, status: adj.status,
  });

  const { data: req } = await sb()
    .from('delivery_requests')
    .select('order_id, seller_id')
    .eq('id', requestId)
    .single();

  if (!req) return;

  if (adj.status === 'auto_approved') {
    // Frete mais barato: reembolso automático, notifica
    await _notifyOrderParties(req, 'delivery:freight_adjustment_result', {
      requestId,
      adjustmentId:        adj.adjustment_id,
      status:              'auto_approved',
      originalFreightBrl:  adj.original_freight_brl,
      newFreightBrl:       adj.new_freight_brl,
      deltaBrl:            adj.delta_brl,
      message:             `Novo entregador encontrado com frete menor. Diferença de R$ ${Math.abs(delta).toFixed(2)} será devolvida.`,
    });

    // Delega reembolso ao deliveryPaymentService (fire-and-forget)
    _schedulePartialRefund(req.order_id, Math.abs(delta), adj.adjustment_id);

  } else {
    // Frete mais caro: notifica COMPRADOR para aprovar
    const { data: order } = await sb()
      .from('marketplace_orders')
      .select('buyer_id')
      .eq('id', req.order_id)
      .single();

    if (order) {
      socketManager.emitToUser(order.buyer_id, 'delivery:freight_adjustment_required', {
        requestId,
        adjustmentId:       adj.adjustment_id,
        originalFreightBrl: adj.original_freight_brl,
        newFreightBrl:      adj.new_freight_brl,
        extraBrl:           adj.delta_brl,
        expiresInSeconds:   180,
        message:            `Novo entregador encontrado por R$ ${parseFloat(new_freight_brl).toFixed(2)} (+R$ ${delta.toFixed(2)}). Você aprova?`,
      });
    }

    // Notifica vendedor (só informativo)
    await _notifyOrderPartiesByRequestId(requestId, 'delivery:status_update', {
      requestId,
      status: 'price_adjustment_pending',
    });

    // Agenda timeout de 3min
    setTimeout(
      () => _expireFreightAdjustmentTimeout(adj.adjustment_id, requestId, req),
      FREIGHT_APPROVAL_MS
    );
  }
}

/**
 * Cliente aprova ajuste de frete (frete maior).
 * Chamado pelo handler do evento delivery:freight_adjustment_approve.
 */
async function approveFreightAdjustment(userId, adjustmentId) {
  const fn = 'approveFreightAdjustment';

  const { data: result } = await sb().rpc('approve_freight_adjustment', {
    p_adjustment_id: adjustmentId,
  });

  if (!result?.ok) throw new Error(result?.message ?? 'Não foi possível aprovar o ajuste.');

  log(fn, 'Ajuste de frete aprovado pelo cliente', { userId, adjustmentId });

  // Notifica partes que pedido voltou a matched
  await _notifyOrderPartiesByRequestId(result.request_id, 'delivery:freight_adjustment_result', {
    requestId:   result.request_id,
    adjustmentId,
    status:      'approved',
    newFreightBrl: result.new_freight_brl,
    deltaBrl:    result.delta_brl,
    message:     'Você aprovou o novo frete. O entregador está a caminho.',
  });

  // Cobra delta do cliente via deliveryPaymentService (fire-and-forget)
  _scheduleExtraCharge(result.request_id, result.delta_brl, adjustmentId);

  return result;
}

/**
 * Cliente recusa ajuste de frete.
 * Chamado pelo handler do evento delivery:freight_adjustment_reject.
 */
async function rejectFreightAdjustment(userId, adjustmentId) {
  const fn = 'rejectFreightAdjustment';

  // Marca como rejected no banco
  const { error } = await sb()
    .from('delivery_freight_adjustments')
    .update({ status: 'rejected', client_responded_at: new Date().toISOString() })
    .eq('id', adjustmentId)
    .eq('status', 'pending_approval');

  if (error) throw new Error(`Erro ao rejeitar ajuste: ${error.message}`);

  // Move pedido para hold_manual
  const { data: adj } = await sb()
    .from('delivery_freight_adjustments')
    .select('delivery_request_id')
    .eq('id', adjustmentId)
    .single();

  if (adj) {
    await sb()
      .from('delivery_requests')
      .update({ status: 'hold_manual', updated_at: new Date().toISOString() })
      .eq('id', adj.delivery_request_id)
      .eq('status', 'price_adjustment_pending');

    await _notifyOrderPartiesByRequestId(adj.delivery_request_id, 'delivery:hold_manual', {
      requestId: adj.delivery_request_id,
      message:   'Você recusou o novo frete. O lojista foi notificado e entrará em contato.',
    });
  }

  log(fn, 'Ajuste de frete recusado pelo cliente', { userId, adjustmentId });
  return { ok: true };
}

/**
 * Timeout do ajuste de frete: cliente não respondeu em 3min.
 */
async function _expireFreightAdjustmentTimeout(adjustmentId, requestId, req) {
  const fn = '_expireFreightAdjustmentTimeout';

  const { data: result } = await sb().rpc('expire_freight_adjustment', {
    p_adjustment_id: adjustmentId,
  });

  if (!result?.ok) return; // Já foi resolvido antes do timeout

  log(fn, 'Ajuste de frete expirado sem resposta', { adjustmentId, requestId });

  await _notifyOrderParties(req, 'delivery:hold_manual', {
    requestId,
    reason:  'freight_approval_timeout',
    message: 'Prazo para aprovar o frete expirou. O lojista foi notificado.',
  });
}

/**
 * Timeout do re-leilão: 10min sem entregador.
 */
async function _handleReAuctionTimeout(requestId) {
  const fn = '_handleReAuctionTimeout';

  const { data: req } = await sb()
    .from('delivery_requests')
    .select('id, order_id, seller_id, status')
    .eq('id', requestId)
    .maybeSingle();

  if (!req || req.status !== 're_auctioning') return; // Já foi resolvido

  await sb()
    .from('delivery_requests')
    .update({ status: 'failed_no_deliverer', updated_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('status', 're_auctioning');

  log(fn, 'Re-leilão encerrado sem entregador', { requestId });

  await _notifyOrderParties(req, 'delivery:failed_no_deliverer', {
    requestId,
    message: 'Não foi possível encontrar um entregador disponível. Por favor, entre em contato com o vendedor.',
  });
}

// ── Helpers internos de notificação ──────────────────

async function _notifyOrderParties(req, event, payload) {
  if (!req?.order_id) return;

  const { data: order } = await sb()
    .from('marketplace_orders')
    .select('buyer_id')
    .eq('id', req.order_id)
    .maybeSingle();

  if (order?.buyer_id) {
    socketManager.emitToUser(order.buyer_id, event, payload);
  }

  if (req.seller_id) {
    const { data: seller } = await sb()
      .from('seller_profiles')
      .select('user_id')
      .eq('id', req.seller_id)
      .maybeSingle();

    if (seller?.user_id) {
      socketManager.emitToUser(seller.user_id, event, payload);
    }
  }

  // Room de rastreio (entregadores conectados à sala)
  socketManager.emitToRoom(`delivery:order:${req.order_id}`, event, payload);
}

async function _notifyOrderPartiesByRequestId(requestId, event, payload) {
  const { data: req } = await sb()
    .from('delivery_requests')
    .select('order_id, seller_id')
    .eq('id', requestId)
    .maybeSingle();

  if (req) await _notifyOrderParties(req, event, payload);
}

// ── Ajustes de frete — registro + notificação ──────────
// Fase 1: registra o ajuste no banco e notifica as partes.
// Fase futura: integração real com Stripe (payment-agent).

async function _schedulePartialRefund(orderId, amountBrl, adjustmentId) {
  const fn = '_schedulePartialRefund';
  try {
    const result = await deliveryPaymentService.processFreightRefund(orderId, amountBrl, adjustmentId);
    log(fn, `Reembolso de frete processado: R$ ${amountBrl.toFixed(2)}`, {
      orderId, method: result.method, ok: result.ok,
    });
  } catch (err) {
    logError(fn, err, { orderId, amountBrl, adjustmentId });
  }
}

async function _scheduleExtraCharge(requestId, deltaBrl, adjustmentId) {
  const fn = '_scheduleExtraCharge';
  try {
    // Busca order_id via delivery_request
    const { data: req } = await sb()
      .from('delivery_requests')
      .select('order_id')
      .eq('id', requestId)
      .single();

    if (!req?.order_id) {
      logError(fn, new Error('order_id não encontrado'), { requestId });
      return;
    }

    const result = await deliveryPaymentService.processFreightExtraCharge(
      req.order_id, requestId, deltaBrl, adjustmentId
    );
    log(fn, `Extra charge processado: R$ ${deltaBrl.toFixed(2)}`, {
      requestId, method: result.method, ok: result.ok,
    });
  } catch (err) {
    logError(fn, err, { requestId, deltaBrl, adjustmentId });
  }
}

// ── Job de recuperação de pedidos órfãos (server restart) ──
// Chamado no bootstrap do app para restaurar timeouts perdidos.

// Limites de staleness para recovery pós-restart
const STALE_OPEN_MINUTES      = 15;  // requests 'open' sem atividade > 15 min
const STALE_REAUCTION_MINUTES = 10;  // re-leilão sem aceite > 10 min

async function recoverStalePendingRequests() {
  const fn = 'recoverStalePendingRequests';
  const now = new Date().toISOString();

  // 1. Grace periods expirados que ainda não foram reabertos
  const { data: staleGrace } = await sb()
    .from('delivery_requests')
    .select('id, service_id')
    .eq('status', 'grace_period')
    .lt('grace_period_until', now)
    .limit(50);

  for (const req of staleGrace ?? []) {
    log(fn, 'Recuperando grace period expirado', { requestId: req.id });
    await _checkAfterGracePeriod(req.id, req.service_id, null);
  }

  // 2. Ajustes de frete expirados
  const { data: staleAdj } = await sb()
    .from('delivery_freight_adjustments')
    .select('id, delivery_request_id')
    .eq('status', 'pending_approval')
    .lt('expires_at', now)
    .limit(50);

  for (const adj of staleAdj ?? []) {
    log(fn, 'Recuperando ajuste de frete expirado', { adjustmentId: adj.id });
    await sb().rpc('expire_freight_adjustment', { p_adjustment_id: adj.id });
  }

  // 3. Requests 'open' que perderam setTimeout em restart do servidor
  const staleOpenCutoff = new Date(Date.now() - STALE_OPEN_MINUTES * 60 * 1000).toISOString();
  const { data: staleOpen } = await sb()
    .from('delivery_requests')
    .select('id, seller_id, order_id, seller:seller_id(user_id)')
    .eq('status', 'open')
    .lt('created_at', staleOpenCutoff)
    .limit(50);

  for (const req of staleOpen ?? []) {
    log(fn, 'Recuperando request open stale → no_deliverer_found', { requestId: req.id });
    await sb()
      .from('delivery_requests')
      .update({ status: 'no_deliverer_found', updated_at: new Date().toISOString() })
      .eq('id', req.id)
      .eq('status', 'open');

    // Expira notificações pendentes (não crítico)
    try { await sb().rpc('expire_delivery_notifications', { p_request_id: req.id }); } catch {}

    // Notifica seller via Socket.IO
    if (req.seller?.user_id) {
      socketManager.emitToUser(req.seller.user_id, 'delivery:no_deliverer_found', {
        requestId: req.id, orderId: req.order_id,
      });
    }
  }

  // 4. Requests 're_auctioning' que perderam setTimeout de 10 min
  const staleReauctionCutoff = new Date(Date.now() - STALE_REAUCTION_MINUTES * 60 * 1000).toISOString();
  const { data: staleReauction } = await sb()
    .from('delivery_requests')
    .select('id, seller_id, order_id, seller:seller_id(user_id)')
    .eq('status', 're_auctioning')
    .lt('updated_at', staleReauctionCutoff)
    .limit(50);

  for (const req of staleReauction ?? []) {
    log(fn, 'Recuperando re_auctioning stale → failed_no_deliverer', { requestId: req.id });
    await sb()
      .from('delivery_requests')
      .update({ status: 'failed_no_deliverer', updated_at: new Date().toISOString() })
      .eq('id', req.id)
      .eq('status', 're_auctioning');

    if (req.seller?.user_id) {
      socketManager.emitToUser(req.seller.user_id, 'delivery:failed_no_deliverer', {
        requestId: req.id, orderId: req.order_id,
      });
    }
  }

  log(fn, 'Recuperação completa', {
    gracePeriods:  staleGrace?.length     ?? 0,
    adjustments:   staleAdj?.length       ?? 0,
    staleOpen:     staleOpen?.length      ?? 0,
    staleReauction: staleReauction?.length ?? 0,
  });
}

/**
 * Resolve um delivery request preso — usado por seller/buyer/admin.
 * Ações: 'cancel' (cancela) | 'retry' (cancela e permite re-solicitar)
 * Aceita requests em status: open, no_deliverer_found, failed_no_deliverer, hold_manual, re_auctioning
 */
const RESOLVABLE_STATUSES = new Set([
  'open', 'no_deliverer_found', 'failed_no_deliverer', 'hold_manual', 're_auctioning',
]);

async function resolveDeliveryRequest(userId, requestId, action, { isAdmin = false } = {}) {
  const fn = 'resolveDeliveryRequest';

  if (!['cancel', 'retry'].includes(action)) {
    throw new Error("Ação inválida. Use 'cancel' ou 'retry'.");
  }

  // 1. Busca request com ownership check
  const { data: req, error } = await sb()
    .from('delivery_requests')
    .select(`
      id, status, seller_id, order_id,
      seller:seller_id(user_id)
    `)
    .eq('id', requestId)
    .single();

  if (error || !req) throw new Error('Solicitação de entrega não encontrada.');

  // 2. Verifica que é seller ou buyer do pedido (admin bypassa)
  if (!isAdmin) {
    const isSeller = req.seller?.user_id === userId;
    if (!isSeller) {
      const { data: order } = await sb()
        .from('marketplace_orders')
        .select('buyer_id')
        .eq('id', req.order_id)
        .single();
      if (!order || order.buyer_id !== userId) {
        throw new Error('Apenas o vendedor ou comprador pode resolver esta solicitação.');
      }
    }
  }

  // 3. Valida que o status permite resolução
  if (!RESOLVABLE_STATUSES.has(req.status)) {
    throw new Error(
      `Solicitação com status '${req.status}' não pode ser resolvida. ` +
      `Status permitidos: ${[...RESOLVABLE_STATUSES].join(', ')}.`
    );
  }

  // 4. Cancela o request atual
  const { error: updateErr } = await sb()
    .from('delivery_requests')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', requestId)
    .in('status', [...RESOLVABLE_STATUSES]);

  if (updateErr) throw new Error(`Erro ao resolver solicitação: ${updateErr.message}`);

  // 5. Expira notificações pendentes
  try { await sb().rpc('expire_delivery_notifications', { p_request_id: requestId }); } catch {}

  log(fn, `Delivery request resolvido (action=${action})`, { requestId, userId, action });

  // 6. Notifica seller via Socket.IO
  if (req.seller?.user_id) {
    socketManager.emitToUser(req.seller.user_id, 'delivery:request_cancelled', {
      requestId, status: 'cancelled', action,
    });
  }

  return { ok: true, requestId, status: 'cancelled', action, orderId: req.order_id };
}

// ──────────────────────────────────────────────────────
// POLLER DURÁVEL — safety net contínua para timeouts in-memory
// Roda a cada 60s e cobre todos os cenários que setTimeout
// pode perder em caso de restart, GC ou deploy.
// ──────────────────────────────────────────────────────

const POLLER_INTERVAL_MS     = 60 * 1000; // 60 segundos
const STUCK_THRESHOLD_MINUTES = 60;       // 60 min sem atualização → delivery_stuck
const STUCK_STATUSES = ['in_transit_to_pickup', 'picked_up', 'in_transit_to_dest'];

async function _deliveryPollerTick() {
  const fn = '_deliveryPollerTick';
  const now = new Date().toISOString();

  try {
    // ── 1. Open requests com expires_at passado (setTimeout perdido) ────
    const { data: expiredOpen } = await sb()
      .from('delivery_requests')
      .select(`
        id, status, match_attempt, seller_id, order_id,
        pickup_address, pickup_city, pickup_lat, pickup_lng,
        dest_address, dest_city, dest_state, dest_lat, dest_lng,
        weight_kg, is_fragile,
        seller:seller_id(user_id, trading_name, business_name),
        order:order_id(buyer:buyer_id(full_name))
      `)
      .eq('status', 'open')
      .lt('expires_at', now)
      .limit(20);

    for (const req of expiredOpen ?? []) {
      const attempt = (req.match_attempt ?? 0) + 1;

      if (attempt >= MAX_MATCH_ATTEMPTS) {
        // Esgotou tentativas → no_deliverer_found
        log(fn, 'Open request esgotou tentativas → no_deliverer_found', { requestId: req.id, attempt });

        await sb()
          .from('delivery_requests')
          .update({ status: 'no_deliverer_found', updated_at: new Date().toISOString() })
          .eq('id', req.id)
          .eq('status', 'open');

        await sb().rpc('expire_delivery_notifications', { p_request_id: req.id }).catch(() => {});

        if (req.seller?.user_id) {
          socketManager.emitToUser(req.seller.user_id, 'delivery:no_deliverer_found', {
            requestId: req.id,
            message: 'Nenhum entregador disponível no momento. Tente novamente mais tarde.',
          });
          notificationDispatcher.dispatch({
            userId: req.seller.user_id, type: 'delivery_no_deliverer',
            importance: 'high', data: { requestId: req.id },
            metadata: { triggeredBy: 'poller' },
            dedupKey: `delivery_no_deliverer_${req.id}`,
          }).catch(() => {});
        }
      } else {
        // Ainda tem tentativas → re-notifica com radius expandido
        log(fn, `Re-matching open request (attempt ${attempt})`, { requestId: req.id });

        await sb().rpc('expire_delivery_notifications', { p_request_id: req.id }).catch(() => {});

        const newExpires = new Date(Date.now() + ACCEPT_TIMEOUT_MS).toISOString();
        await sb()
          .from('delivery_requests')
          .update({ match_attempt: attempt, expires_at: newExpires, updated_at: new Date().toISOString() })
          .eq('id', req.id)
          .eq('status', 'open');

        const expanded = await findEligibleDeliverers(
          req.pickup_lat, req.pickup_lng, req.dest_lat, req.dest_lng,
          {
            weightKg: req.weight_kg, isFragile: req.is_fragile,
            limit: NOTIFY_TOP_N + (attempt * 2),
            pickupCity: req.pickup_city, destCity: req.dest_city, destState: req.dest_state,
          }
        );

        if (expanded.length) {
          const notifs = expanded.map(c => ({
            request_id: req.id, service_id: c.service_id, user_id: c.user_id,
            proposed_fee: c.estimated_fee, total_km: c.total_km, match_score: c.match_score,
            notified_at: new Date().toISOString(), expires_at: newExpires,
          }));
          await sb().from('delivery_notifications')
            .upsert(notifs, { onConflict: 'request_id,service_id', ignoreDuplicates: true });

          const sellerName = req.seller?.trading_name || req.seller?.business_name;
          const buyerName = req.order?.buyer?.full_name || 'Comprador';
          const payload = {
            requestId: req.id, sellerName, sellerAddress: req.pickup_address,
            buyerName, buyerAddress: req.dest_address,
            weightKg: req.weight_kg, isFragile: req.is_fragile, expiresAt: newExpires,
          };

          for (const c of expanded) {
            socketManager.emitToUser(c.user_id, 'delivery:new_request', {
              ...payload,
              vehicleType: c.vehicle_type, estimatedFee: c.estimated_fee,
              totalDistance: c.total_km, distanceToSeller: c.origin_to_pickup_km,
              distanceSellerToBuyer: c.pickup_to_dest_km,
              estimatedMinutes: Math.round(c.total_km * 2.5) + 8,
              timeoutSeconds: Math.round(ACCEPT_TIMEOUT_MS / 1000),
              hasGps: c.has_gps, fee: c.estimated_fee, totalKm: c.total_km,
            });
          }
        }
      }
    }

    // ── 2. Grace periods expirados ─────────────────────────────────────
    const { data: staleGrace } = await sb()
      .from('delivery_requests')
      .select('id, service_id')
      .eq('status', 'grace_period')
      .lt('grace_period_until', now)
      .limit(20);

    for (const req of staleGrace ?? []) {
      log(fn, 'Grace period expirado (poller)', { requestId: req.id });
      await _checkAfterGracePeriod(req.id, req.service_id, null);
    }

    // ── 3. Re-auctioning expirados (> 10 min) ─────────────────────────
    const reAuctionCutoff = new Date(Date.now() - STALE_REAUCTION_MINUTES * 60 * 1000).toISOString();
    const { data: staleReauction } = await sb()
      .from('delivery_requests')
      .select('id, seller_id, order_id, seller:seller_id(user_id)')
      .eq('status', 're_auctioning')
      .lt('updated_at', reAuctionCutoff)
      .limit(20);

    for (const req of staleReauction ?? []) {
      log(fn, 'Re-auctioning expirado (poller) → failed_no_deliverer', { requestId: req.id });
      await sb()
        .from('delivery_requests')
        .update({ status: 'failed_no_deliverer', updated_at: new Date().toISOString() })
        .eq('id', req.id)
        .eq('status', 're_auctioning');

      if (req.seller?.user_id) {
        socketManager.emitToUser(req.seller.user_id, 'delivery:failed_no_deliverer', {
          requestId: req.id, orderId: req.order_id,
        });
      }
    }

    // ── 4. Ajustes de frete expirados ──────────────────────────────────
    const { data: staleAdj } = await sb()
      .from('delivery_freight_adjustments')
      .select('id, delivery_request_id')
      .eq('status', 'pending_approval')
      .lt('expires_at', now)
      .limit(20);

    for (const adj of staleAdj ?? []) {
      log(fn, 'Ajuste de frete expirado (poller)', { adjustmentId: adj.id });
      await sb().rpc('expire_freight_adjustment', { p_adjustment_id: adj.id });
    }

    // ── 5. Entregas paradas (sem atualização > 60 min) ──────────────
    const stuckCutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000).toISOString();
    const { data: stuckDeliveries } = await sb()
      .from('delivery_requests')
      .select(`
        id, status, order_id, seller_id, updated_at,
        seller:seller_id(user_id, trading_name, business_name),
        order:order_id(buyer_id, buyer_snapshot)
      `)
      .in('status', STUCK_STATUSES)
      .lt('updated_at', stuckCutoff)
      .limit(20);

    for (const req of stuckDeliveries ?? []) {
      if (!req.seller?.user_id) continue;

      const reasonMap = {
        in_transit_to_pickup: 'entregador a caminho da coleta sem atualização há mais de 60 min',
        picked_up:            'pedido coletado sem atualização há mais de 60 min',
        in_transit_to_dest:   'entregador a caminho do destino sem atualização há mais de 60 min',
      };

      const clientName  = req.order?.buyer_snapshot?.full_name || 'Comprador';
      const clientPhone = req.order?.buyer_snapshot?.phone     || null;

      setImmediate(() => {
        notificationDispatcher.dispatch({
          userId:     req.seller.user_id,
          type:       'delivery_stuck',
          importance: 'high',
          data: {
            orderId:     req.order_id,
            reason:      reasonMap[req.status] || 'sem atualização',
            clientName,
            clientPhone,
            sellerId:    req.seller_id,
          },
          metadata:  { triggeredBy: 'system' },
          dedupKey:  `delivery_stuck_${req.order_id}`,
        }).catch(() => {});
      });

      log(fn, 'Delivery stuck detectado', {
        requestId: req.id, status: req.status,
        orderId: req.order_id, sellerUserId: req.seller.user_id,
        stuckSince: req.updated_at,
      });
    }

  } catch (err) {
    logError(fn, err);
  }
}

let _pollerInterval = null;

function startDeliveryPoller() {
  if (_pollerInterval) return;
  log('startDeliveryPoller', `Poller durável iniciado (intervalo: ${POLLER_INTERVAL_MS / 1000}s)`);

  // Executa recovery imediata no startup
  recoverStalePendingRequests().catch(err =>
    logWarn('startDeliveryPoller', `Recovery inicial falhou: ${err.message}`)
  );

  // Inicia polling periódico
  _pollerInterval = setInterval(() => {
    _deliveryPollerTick().catch(err =>
      logWarn('_deliveryPollerTick', `Tick falhou: ${err.message}`)
    );
  }, POLLER_INTERVAL_MS);
}

function stopDeliveryPoller() {
  if (_pollerInterval) {
    clearInterval(_pollerInterval);
    _pollerInterval = null;
    log('stopDeliveryPoller', 'Poller durável parado');
  }
}

// ──────────────────────────────────────────────────────
// Simulador de frete inteligente [DELIVERY-SIM-001]
// ──────────────────────────────────────────────────────

/**
 * Simula rota e frete para o entregador, usando Google Maps (distância real)
 * e buscando pedidos abertos ao longo da rota.
 *
 * @param {string} userId — ID do usuário autenticado
 * @param {Object} params
 * @param {number} params.originLat
 * @param {number} params.originLng
 * @param {number} params.destLat
 * @param {number} params.destLng
 * @param {string} [params.vehicleType]
 * @param {number} [params.weightKg]
 * @param {boolean} [params.returnLeg]
 * @returns {Promise<Object>} route info, orders along route, tariffs
 */
async function simulateRoutes(userId, params) {
  const fn = 'simulateRoutes';
  const distanceService = require('./distanceService');
  const { originLat, originLng, destLat, destLng, vehicleType, weightKg, returnLeg, vehicleId } = params;

  // 1. Busca tarifas do entregador (ou usa defaults), com cascata veículo se fornecido
  let tariffs = { price_per_km: 2.5, base_fee: 5.0, minimum_fee: 8.0 };
  let tariffSource = 'default';

  if (vehicleId) {
    try {
      const vehicleService = require('./vehicleService');
      const resolved = await vehicleService.resolveVehicleTariffs(userId, vehicleId);
      tariffs = {
        price_per_km: resolved.price_per_km,
        base_fee:     resolved.base_fee,
        minimum_fee:  resolved.minimum_fee,
      };
      tariffSource = resolved.source;
    } catch (_) { /* fallback abaixo */ }
  }

  if (tariffSource === 'default') {
    const { data: mySvc } = await sb()
      .from('delivery_services')
      .select('price_per_km, base_fee, minimum_fee, vehicle_type')
      .eq('user_id', userId)
      .maybeSingle();

    if (mySvc) {
      tariffs = {
        price_per_km: Number(mySvc.price_per_km),
        base_fee:     Number(mySvc.base_fee),
        minimum_fee:  Number(mySvc.minimum_fee),
      };
      tariffSource = 'service';
    }
  }

  // 2. Calcula distâncias reais via Google Maps (fallback Haversine)
  //    D1 = 0 (simulador assume entregador na origem)
  //    D2 = origin → dest
  //    D3 = dest → origin (retorno, se solicitado)
  const [d2Result, d3Result] = await Promise.all([
    distanceService.getRoadDistance(
      Number(originLat), Number(originLng),
      Number(destLat),   Number(destLng)
    ),
    returnLeg
      ? distanceService.getRoadDistance(
          Number(destLat),   Number(destLng),
          Number(originLat), Number(originLng)
        )
      : Promise.resolve({ distanceKm: 0, durationMinutes: 0, source: 'none' }),
  ]);

  const d1_km = 0;
  const d2_km = d2Result.distanceKm ?? 0;
  const d3_km = returnLeg ? (d3Result.distanceKm ?? 0) : 0;
  const total_km = d1_km + d2_km + d3_km;

  // 3. Calcula fee com fórmula padrão
  const rawFee = total_km * tariffs.price_per_km + tariffs.base_fee;
  const estimated_fee = Math.max(rawFee, tariffs.minimum_fee);
  const duration_minutes = (d2Result.durationMinutes ?? 0) + (d3Result.durationMinutes ?? 0);

  // 4. Busca pedidos abertos ao longo da rota (bounding box + margem 3km)
  const MARGIN_DEG = 3 / 111; // ~3km em graus
  const minLat = Math.min(Number(originLat), Number(destLat)) - MARGIN_DEG;
  const maxLat = Math.max(Number(originLat), Number(destLat)) + MARGIN_DEG;
  const minLng = Math.min(Number(originLng), Number(destLng)) - MARGIN_DEG;
  const maxLng = Math.max(Number(originLng), Number(destLng)) + MARGIN_DEG;

  let ordersAlongRoute = [];
  try {
    const { data: nearbyRequests } = await sb()
      .from('delivery_requests')
      .select('id, pickup_city, pickup_lat, pickup_lng, dest_city, dest_lat, dest_lng, status')
      .in('status', ['open', 'no_deliverer_found'])
      .or(
        `and(pickup_lat.gte.${minLat},pickup_lat.lte.${maxLat},pickup_lng.gte.${minLng},pickup_lng.lte.${maxLng}),` +
        `and(dest_lat.gte.${minLat},dest_lat.lte.${maxLat},dest_lng.gte.${minLng},dest_lng.lte.${maxLng})`
      )
      .limit(10);

    if (nearbyRequests?.length) {
      // Filtra pela distância real ao segmento origin→dest (≤ 3km)
      for (const req of nearbyRequests) {
        const pickupDist = _pointToSegmentDistance(
          req.pickup_lat, req.pickup_lng,
          Number(originLat), Number(originLng),
          Number(destLat), Number(destLng)
        );
        const destDist = _pointToSegmentDistance(
          req.dest_lat, req.dest_lng,
          Number(originLat), Number(originLng),
          Number(destLat), Number(destLng)
        );
        const deviation_km = Math.min(pickupDist, destDist);

        if (deviation_km <= 3) {
          // Estima fee deste pedido com as tarifas do entregador
          const reqD2 = distanceService.haversineKm(
            req.pickup_lat, req.pickup_lng,
            req.dest_lat, req.dest_lng
          ) * 1.3;
          const reqFee = Math.max(
            reqD2 * tariffs.price_per_km + tariffs.base_fee,
            tariffs.minimum_fee
          );

          ordersAlongRoute.push({
            id:            req.id,
            pickup_city:   req.pickup_city,
            dest_city:     req.dest_city,
            deviation_km:  +deviation_km.toFixed(1),
            estimated_fee: +reqFee.toFixed(2),
          });
        }
      }
    }
  } catch (err) {
    logWarn(fn, `Erro ao buscar pedidos no caminho: ${err.message}`);
  }

  log(fn, 'Simulação concluída', {
    userId, total_km: +total_km.toFixed(2),
    ordersFound: ordersAlongRoute.length,
    source: d2Result.source,
  });

  return {
    route: {
      d1_km:              +d1_km.toFixed(2),
      d2_km:              +d2_km.toFixed(2),
      d3_km:              +d3_km.toFixed(2),
      total_km:           +total_km.toFixed(2),
      estimated_fee:      +estimated_fee.toFixed(2),
      duration_minutes,
      distance_source:    d2Result.source,
    },
    ordersAlongRoute,
    myTariffs: tariffs,
    tariff_source: tariffSource,
  };
}

/**
 * Distância de um ponto a um segmento de reta (em km, via Haversine).
 * Usa projeção ortogonal simplificada sobre o segmento.
 */
function _pointToSegmentDistance(pLat, pLng, aLat, aLng, bLat, bLng) {
  if (!pLat || !pLng) return Infinity;
  const distanceService = require('./distanceService');

  const dAB = distanceService.haversineKm(aLat, aLng, bLat, bLng);
  if (dAB < 0.01) return distanceService.haversineKm(pLat, pLng, aLat, aLng);

  // Projeção escalar do ponto P no segmento AB
  const dAP = distanceService.haversineKm(aLat, aLng, pLat, pLng);
  const dBP = distanceService.haversineKm(bLat, bLng, pLat, pLng);

  // Se a projeção cai fora do segmento, retorna distância ao extremo mais próximo
  const cosA = (dAB * dAB + dAP * dAP - dBP * dBP) / (2 * dAB * dAP || 1);
  if (cosA < 0) return dAP;

  const cosB = (dAB * dAB + dBP * dBP - dAP * dAP) / (2 * dAB * dBP || 1);
  if (cosB < 0) return dBP;

  // Distância perpendicular ao segmento (usando fórmula do triângulo)
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  return dAP * sinA;
}

module.exports = {
  // Loja de entrega
  createDeliveryService,
  updateDeliveryService,
  getMyDeliveryService,
  getDeliveryServiceById,
  // Sessão ativa
  goOnline,
  goOffline,
  updateLocation,
  heartbeat,
  // Matching e solicitação
  findEligibleDeliverers,
  requestDelivery,
  cancelDeliveryRequest,
  resolveDeliveryRequest,
  // Aceite/recusa
  acceptDeliveryRequest,
  declineDeliveryRequest,
  // Etapas
  confirmStep,
  // Avaliação
  rateDelivery,
  // Consultas
  getDeliveryRequest,
  listMyDeliveryRequests,
  getDashboard,
  calculateFee,
  // Gorjeta [DELIVERY-SOL-001]
  addTip,
  // Re-leilão [DELIVERY-006]
  handleDelivererDisconnect,
  handleReAuctionClaim,
  approveFreightAdjustment,
  rejectFreightAdjustment,
  recoverStalePendingRequests,
  startDeliveryPoller,
  stopDeliveryPoller,
  // Simulador [DELIVERY-SIM-001]
  simulateRoutes,
};
