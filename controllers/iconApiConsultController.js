/**
 * @fileoverview IconChat REST API — Consultas (Direção B)
 *
 * 9 endpoints GET para o bot IconChat consultar contexto do seller/cliente.
 * Autenticação via HMAC per-seller (req.iconSellerId).
 *
 * B1: getSellerProfile     — perfil público do seller + trust + is_open_now
 * B2: getCustomerByPhone   — histórico de um cliente por telefone
 * B3: getBooking           — detalhes de um agendamento
 * B4: getPendencia         — detalhes de uma pendência fiscal
 * B5: getSellerTeam        — equipe do seller (owner, managers, employees)
 * B6: getCustomerContext   — contexto agregado (orders+bookings+stays+pendências)
 * B7: getSellerServices    — serviços agendáveis do seller
 * B8: getServiceSlots      — slots disponíveis para uma data
 * B10: getPropertyAvailability — datas ocupadas/livres de um imóvel
 * B11: getPropertyDetail       — detalhes completos de um imóvel + reviews
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');
const { resolveByPhone } = require('../utils/iconPhoneResolver');
const trustPassportService = require('../services/trustPassportService');
const bookingService = require('../services/bookingService');
const propertyStayService = require('../services/propertyStayService');

const CTRL = 'iconApiConsultController';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Calcula se o seller está aberto agora com base em business_hours JSONB.
 * business_hours: { "1": { open: "08:00", close: "18:00" }, ... } (1=Mon..7=Sun)
 */
function _computeOpenStatus(businessHours) {
  if (!businessHours || typeof businessHours !== 'object') {
    return { is_open_now: null, closes_at: null };
  }

  // BRT = UTC-3
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const dayOfWeek = brt.getUTCDay(); // 0=Sun
  const dayKey = dayOfWeek === 0 ? '7' : String(dayOfWeek);
  const todayHours = businessHours[dayKey];

  if (!todayHours || !todayHours.open || !todayHours.close) {
    return { is_open_now: false, closes_at: null };
  }

  const [oh, om] = todayHours.open.split(':').map(Number);
  const [ch, cm] = todayHours.close.split(':').map(Number);
  const currentMinutes = brt.getUTCHours() * 60 + brt.getUTCMinutes();
  const openMinutes = oh * 60 + om;
  const closeMinutes = ch * 60 + cm;

  const isOpen = currentMinutes >= openMinutes && currentMinutes < closeMinutes;
  return {
    is_open_now: isOpen,
    closes_at: isOpen ? todayHours.close : null,
  };
}

// ---------------------------------------------------------------------------
// B1: GET /api/icon/sellers/:sellerId/profile
// ---------------------------------------------------------------------------

exports.getSellerProfile = async (req, res) => {
  try {
    const { sellerId } = req.params;

    if (sellerId !== req.iconSellerId) {
      return res.status(403).json({ error: 'seller_mismatch' });
    }

    const { data: seller, error } = await sb()
      .from('seller_profiles')
      .select(`
        id, user_id, business_name, trading_name, category, description,
        seller_subtype, business_type, business_hours,
        address_neighborhood, address_city,
        service_radius_km, fulfillment_types,
        avg_rating, total_reviews,
        billing_mode, plan_slug,
        google_rating, google_reviews_count, google_business_status,
        accepts_guest_orders, whatsapp, status
      `)
      .eq('id', sellerId)
      .maybeSingle();

    if (error) throw error;
    if (!seller) return res.status(404).json({ error: 'seller_not_found' });

    // Contagem de produtos ativos
    const { count: catalogCount } = await sb()
      .from('marketplace_products')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', sellerId)
      .eq('active', true);

    // Trust Passport público
    let trust = null;
    try {
      trust = await trustPassportService.getPublicPassport(seller.user_id);
    } catch { /* non-critical */ }

    const openStatus = _computeOpenStatus(seller.business_hours);

    res.set('Cache-Control', 'private, max-age=900');
    return res.json({
      success: true,
      data: {
        id: seller.id,
        business_name: seller.business_name,
        trading_name: seller.trading_name,
        category: seller.category,
        seller_subtype: seller.seller_subtype,
        business_type: seller.business_type,
        description: seller.description,
        address_neighborhood: seller.address_neighborhood,
        address_city: seller.address_city,
        service_radius_km: seller.service_radius_km,
        fulfillment_types: seller.fulfillment_types,
        avg_rating: seller.avg_rating,
        total_reviews: seller.total_reviews,
        plan_slug: seller.plan_slug,
        google_rating: seller.google_rating,
        google_reviews_count: seller.google_reviews_count,
        google_business_status: seller.google_business_status,
        accepts_guest_orders: seller.accepts_guest_orders,
        whatsapp: seller.whatsapp,
        status: seller.status,
        has_catalog: (catalogCount || 0) > 0,
        accepts_eloscoins: false,
        is_open_now: openStatus.is_open_now,
        closes_at: openStatus.closes_at,
        trust: trust ? {
          trust_level: trust.trust_level,
          level_name: trust.level_name,
          validators: trust.validators,
        } : null,
      },
    });
  } catch (err) {
    logger.error(`[${CTRL}] getSellerProfile error`, { error: err.message, sellerId: req.params.sellerId });
    return res.status(500).json({ error: 'internal_error' });
  }
};

// ---------------------------------------------------------------------------
// B2: GET /api/icon/customers/by-phone/:phone?seller_id=<required>
// ---------------------------------------------------------------------------

exports.getCustomerByPhone = async (req, res) => {
  try {
    const { phone } = req.params;
    const sellerId = req.query.seller_id;

    if (!sellerId || sellerId !== req.iconSellerId) {
      return res.status(403).json({ error: 'seller_mismatch' });
    }

    const resolved = await resolveByPhone(phone);

    // ---------- Registered user ----------
    if (resolved.source === 'registered') {
      const userId = resolved.userId;

      const { data: user } = await sb()
        .from('users')
        .select('id, nome, telefone')
        .eq('id', userId)
        .maybeSingle();

      // Últimos 5 pedidos deste seller
      const { data: orders } = await sb()
        .from('marketplace_orders')
        .select('id, status, total_brl, created_at')
        .eq('buyer_id', userId)
        .eq('seller_id', sellerId)
        .order('created_at', { ascending: false })
        .limit(5);

      // Agendamentos futuros (via products do seller)
      const { data: bookings } = await sb()
        .from('service_bookings')
        .select(`
          id, status, scheduled_at,
          service:service_id (id, name, seller_id)
        `)
        .eq('client_id', userId)
        .in('status', ['pending', 'confirmed'])
        .gte('scheduled_at', new Date().toISOString());

      const sellerBookings = (bookings || []).filter(b => b.service?.seller_id === sellerId);

      // Pendências ativas
      const { data: pendencias } = await sb()
        .from('seller_client_pendencias')
        .select('id, titulo, tipo, status, prazo_legal')
        .eq('seller_id', sellerId)
        .in('status', ['aberta', 'em_andamento']);

      // Trust level
      let trustLevel = null;
      try {
        const passport = await trustPassportService.getPublicPassport(userId);
        trustLevel = passport?.trust_level || null;
      } catch { /* non-critical */ }

      res.set('Cache-Control', 'private, max-age=120');
      return res.json({
        success: true,
        data: {
          is_guest: false,
          name: user?.nome || null,
          phone: user?.telefone || null,
          trust_level: trustLevel,
          recent_orders: (orders || []).map(o => ({
            id: o.id,
            status: o.status,
            total_brl: o.total_brl,
            created_at: o.created_at,
          })),
          upcoming_bookings: sellerBookings.map(b => ({
            id: b.id,
            status: b.status,
            scheduled_at: b.scheduled_at,
            service_name: b.service?.name || null,
          })),
          active_pendencias: (pendencias || []).map(p => ({
            id: p.id,
            titulo: p.titulo,
            tipo: p.tipo,
            status: p.status,
            prazo_legal: p.prazo_legal,
          })),
        },
      });
    }

    // ---------- Guest buyer ----------
    if (resolved.source === 'guest') {
      const guestId = resolved.guestId;

      const { data: guest } = await sb()
        .from('guest_buyers')
        .select('id, full_name, phone')
        .eq('id', guestId)
        .maybeSingle();

      const { data: orders } = await sb()
        .from('marketplace_orders')
        .select('id, status, total_brl, created_at')
        .eq('guest_buyer_id', guestId)
        .eq('seller_id', sellerId)
        .order('created_at', { ascending: false })
        .limit(5);

      res.set('Cache-Control', 'private, max-age=120');
      return res.json({
        success: true,
        data: {
          is_guest: true,
          name: guest?.full_name || null,
          phone: guest?.phone || null,
          trust_level: null,
          recent_orders: (orders || []).map(o => ({
            id: o.id,
            status: o.status,
            total_brl: o.total_brl,
            created_at: o.created_at,
          })),
          upcoming_bookings: [],
          active_pendencias: [],
        },
      });
    }

    // ---------- Nenhum match ----------
    return res.status(404).json({ error: 'customer_not_found' });
  } catch (err) {
    logger.error(`[${CTRL}] getCustomerByPhone error`, { error: err.message, phone: req.params.phone });
    return res.status(500).json({ error: 'internal_error' });
  }
};

// ---------------------------------------------------------------------------
// B3: GET /api/icon/bookings/:bookingId
// ---------------------------------------------------------------------------

exports.getBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;

    const { data: booking, error } = await sb()
      .from('service_bookings')
      .select(`
        id, status, scheduled_at, duration_minutes, notes,
        client_id, provider_id, payment_status,
        cancellation_policy, created_at, updated_at,
        service:service_id (id, name, seller_id, advance_cancel_hours)
      `)
      .eq('id', bookingId)
      .maybeSingle();

    if (error) throw error;

    if (!booking || booking.service?.seller_id !== req.iconSellerId) {
      return res.status(404).json({ error: 'booking_not_found' });
    }

    const now = new Date();
    const scheduledAt = new Date(booking.scheduled_at);
    const advanceHours = booking.service?.advance_cancel_hours || 24;
    const cancelDeadline = new Date(scheduledAt.getTime() - advanceHours * 60 * 60 * 1000);
    const canCancel = ['pending', 'confirmed'].includes(booking.status) && scheduledAt > now;

    return res.json({
      success: true,
      data: {
        id: booking.id,
        status: booking.status,
        scheduled_at: booking.scheduled_at,
        duration_minutes: booking.duration_minutes,
        notes: booking.notes,
        client_id: booking.client_id,
        provider_id: booking.provider_id,
        payment_status: booking.payment_status,
        cancellation_policy: booking.cancellation_policy,
        created_at: booking.created_at,
        updated_at: booking.updated_at,
        service_name: booking.service?.name || null,
        can_cancel: canCancel,
        cancel_deadline: cancelDeadline.toISOString(),
      },
    });
  } catch (err) {
    logger.error(`[${CTRL}] getBooking error`, { error: err.message, bookingId: req.params.bookingId });
    return res.status(500).json({ error: 'internal_error' });
  }
};

// ---------------------------------------------------------------------------
// B4: GET /api/icon/pendencias/:pendenciaId
// ---------------------------------------------------------------------------

exports.getPendencia = async (req, res) => {
  try {
    const { pendenciaId } = req.params;

    const { data: pendencia, error } = await sb()
      .from('seller_client_pendencias')
      .select(`
        id, titulo, descricao, tipo, status,
        prazo_legal, ciencia_registrada_em,
        concluida_em, metadata, created_at, updated_at
      `)
      .eq('id', pendenciaId)
      .eq('seller_id', req.iconSellerId)
      .maybeSingle();

    if (error) throw error;
    if (!pendencia) return res.status(404).json({ error: 'pendencia_not_found' });

    const diasRestantes = pendencia.prazo_legal
      ? Math.ceil((new Date(pendencia.prazo_legal).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : null;

    return res.json({
      success: true,
      data: {
        id: pendencia.id,
        titulo: pendencia.titulo,
        descricao: pendencia.descricao,
        tipo: pendencia.tipo,
        status: pendencia.status,
        prazo_legal: pendencia.prazo_legal,
        dias_restantes: diasRestantes,
        ciencia_registrada_em: pendencia.ciencia_registrada_em,
        concluida_em: pendencia.concluida_em,
        valor: pendencia.metadata?.valor || null,
        created_at: pendencia.created_at,
        updated_at: pendencia.updated_at,
      },
    });
  } catch (err) {
    logger.error(`[${CTRL}] getPendencia error`, { error: err.message, pendenciaId: req.params.pendenciaId });
    return res.status(500).json({ error: 'internal_error' });
  }
};

// ---------------------------------------------------------------------------
// B5: GET /api/icon/sellers/:sellerId/team
// ---------------------------------------------------------------------------

exports.getSellerTeam = async (req, res) => {
  try {
    const { sellerId } = req.params;

    if (sellerId !== req.iconSellerId) {
      return res.status(403).json({ error: 'seller_mismatch' });
    }

    const { data: members, error } = await sb()
      .from('seller_team_members')
      .select(`
        user_id, role, status, permissions, joined_at,
        users:user_id (id, full_name, email, avatar_url)
      `)
      .eq('seller_id', sellerId)
      .in('status', ['active', 'pending'])
      .order('role', { ascending: false })
      .order('joined_at', { ascending: true });

    if (error) throw error;

    res.set('Cache-Control', 'private, max-age=300');
    return res.json({
      success: true,
      data: (members || []).map(m => ({
        user_id: m.user_id,
        name: m.users?.full_name || null,
        email: m.users?.email || null,
        avatar_url: m.users?.avatar_url || null,
        role: m.role,
        status: m.status,
        permissions: m.permissions || {},
        joined_at: m.joined_at,
      })),
    });
  } catch (err) {
    logger.error(`[${CTRL}] getSellerTeam error`, { error: err.message, sellerId: req.params.sellerId });
    return res.status(500).json({ error: 'internal_error' });
  }
};

// ---------------------------------------------------------------------------
// B6: GET /api/icon/sellers/:sellerId/customer-context?phone={E.164}
// ---------------------------------------------------------------------------

/**
 * Mascara telefone: "+5511987654321" → "+55119****4321"
 */
function _maskPhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return phone;
  // Format: +{DDI}{DDD}{first}****{last4}
  const ddi = digits.startsWith('55') ? '+55' : '+';
  const rest = digits.startsWith('55') ? digits.slice(2) : digits;
  const ddd = rest.slice(0, 2);
  const first = rest.slice(2, 3);
  const last4 = rest.slice(-4);
  return `${ddi}${ddd}${first}****${last4}`;
}

/**
 * Gera shortId a partir de UUID: primeiros 8 chars uppercase.
 */
function _shortId(id) {
  if (!id) return null;
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}

/**
 * Formata items JSONB como resumo textual: "2x Marmita fit + 1x Suco laranja"
 */
function _buildItemsSummary(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items.map(i => `${i.qty || 1}x ${i.name}`).join(' + ');
}

exports.getCustomerContext = async (req, res) => {
  try {
    const { sellerId } = req.params;
    const phone = req.query.phone;

    if (sellerId !== req.iconSellerId) {
      return res.status(403).json({ error: 'seller_mismatch' });
    }

    if (!phone) {
      return res.status(400).json({ error: 'phone_required' });
    }

    const resolved = await resolveByPhone(phone);

    // ─── Caso 2: telefone não encontrado ──────────────────
    if (!resolved.source) {
      return res.status(404).json({ error: 'customer_not_found' });
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // ─── Registered user ──────────────────────────────────
    if (resolved.source === 'registered') {
      const userId = resolved.userId;

      // Queries em paralelo para SLA < 2s
      const [userRes, sellerRes, ordersRes, bookingsRes, pendenciasRes, staysRes] = await Promise.all([
        sb().from('users').select('id, nome, telefone').eq('id', userId).maybeSingle(),
        sb().from('seller_profiles').select('business_name, whatsapp').eq('id', sellerId).maybeSingle(),
        sb().from('marketplace_orders')
          .select('id, status, total_brl, created_at, fulfillment_type, items, payment_url')
          .eq('buyer_id', userId)
          .eq('seller_id', sellerId)
          .gte('created_at', thirtyDaysAgo)
          .order('created_at', { ascending: false })
          .limit(10),
        sb().from('service_bookings')
          .select(`
            id, status, scheduled_at, duration_minutes, payment_status,
            service:service_id (id, name, seller_id),
            provider:provider_id (full_name)
          `)
          .eq('client_id', userId)
          .in('status', ['pending', 'confirmed'])
          .gte('scheduled_at', now.toISOString())
          .lte('scheduled_at', thirtyDaysAhead)
          .order('scheduled_at', { ascending: true })
          .limit(10),
        sb().from('seller_client_pendencias')
          .select('id, titulo, status, prazo_legal, metadata')
          .eq('seller_id', sellerId)
          .in('status', ['aberta', 'em_andamento', 'vencida'])
          .order('prazo_legal', { ascending: true })
          .limit(10),
        sb().from('property_stays')
          .select(`
            id, check_in_date, check_out_date, nights, guests_count,
            total_brl, status, payment_status,
            property:property_id (id, name)
          `)
          .eq('guest_id', userId)
          .eq('seller_id', sellerId)
          .not('status', 'in', '("cancelled_guest","cancelled_host")')
          .gte('check_out_date', now.toISOString().slice(0, 10))
          .order('check_in_date', { ascending: true })
          .limit(10),
      ]);

      const user = userRes.data;
      const sellerProfile = sellerRes.data;
      const orders = ordersRes.data || [];
      const allBookings = bookingsRes.data || [];
      const pendencias = pendenciasRes.data || [];
      const stays = staysRes.data || [];

      // Filtrar bookings que pertencem a serviços deste seller
      const sellerBookings = allBookings.filter(b => b.service?.seller_id === sellerId);

      res.set('Cache-Control', 'private, max-age=60');
      return res.json({
        seller: {
          name: sellerProfile?.business_name || null,
          publicContact: sellerProfile?.whatsapp || null,
        },
        customer: {
          name: user?.nome || null,
          phoneMasked: _maskPhone(user?.telefone || phone),
        },
        orders: orders.map(o => ({
          id: o.id,
          shortId: _shortId(o.id),
          status: o.status,
          total: Number(o.total_brl),
          createdAt: o.created_at,
          deliveryType: o.fulfillment_type || 'pickup',
          itemsSummary: _buildItemsSummary(o.items),
          paymentUrl: o.status === 'pending' || o.status === 'awaiting_payment' ? o.payment_url : null,
        })),
        agendamentos: sellerBookings.map(b => ({
          id: b.id,
          shortId: `AG-${_shortId(b.id)}`,
          servico: b.service?.name || null,
          scheduledAt: b.scheduled_at,
          status: b.status,
          durationMinutes: b.duration_minutes || null,
          providerName: b.provider?.full_name || null,
          paymentStatus: b.payment_status || null,
        })),
        stays: stays.map(s => ({
          id: s.id,
          shortId: `ST-${_shortId(s.id)}`,
          propertyName: s.property?.name || null,
          checkIn: s.check_in_date,
          checkOut: s.check_out_date,
          nights: s.nights,
          guestsCount: s.guests_count,
          total: Number(s.total_brl),
          status: s.status,
          paymentStatus: s.payment_status,
        })),
        pendencias: pendencias.map(p => ({
          id: p.id,
          shortId: `PND-${_shortId(p.id)}`,
          descricao: p.titulo,
          valor: p.metadata?.valor ? Number(p.metadata.valor) : null,
          dueDate: p.prazo_legal ? p.prazo_legal.slice(0, 10) : null,
          status: p.status,
        })),
      });
    }

    // ─── Guest buyer ──────────────────────────────────────
    if (resolved.source === 'guest') {
      const guestId = resolved.guestId;

      const [guestRes, guestSellerRes, ordersRes] = await Promise.all([
        sb().from('guest_buyers').select('id, full_name, phone').eq('id', guestId).maybeSingle(),
        sb().from('seller_profiles').select('business_name, whatsapp').eq('id', sellerId).maybeSingle(),
        sb().from('marketplace_orders')
          .select('id, status, total_brl, created_at, fulfillment_type, items, payment_url')
          .eq('guest_buyer_id', guestId)
          .eq('seller_id', sellerId)
          .gte('created_at', thirtyDaysAgo)
          .order('created_at', { ascending: false })
          .limit(10),
      ]);

      const guest = guestRes.data;
      const guestSeller = guestSellerRes.data;
      const orders = ordersRes.data || [];

      res.set('Cache-Control', 'private, max-age=60');
      return res.json({
        seller: {
          name: guestSeller?.business_name || null,
          publicContact: guestSeller?.whatsapp || null,
        },
        customer: {
          name: guest?.full_name || null,
          phoneMasked: _maskPhone(guest?.phone || phone),
        },
        orders: orders.map(o => ({
          id: o.id,
          shortId: _shortId(o.id),
          status: o.status,
          total: Number(o.total_brl),
          createdAt: o.created_at,
          deliveryType: o.fulfillment_type || 'pickup',
          itemsSummary: _buildItemsSummary(o.items),
          paymentUrl: o.status === 'pending' || o.status === 'awaiting_payment' ? o.payment_url : null,
        })),
        agendamentos: [],
        stays: [],
        pendencias: [],
      });
    }

    // Fallback (não deveria chegar aqui)
    return res.status(404).json({ error: 'customer_not_found' });
  } catch (err) {
    logger.error(`[${CTRL}] getCustomerContext error`, { error: err.message, sellerId: req.params.sellerId });
    return res.status(500).json({ error: 'internal_error' });
  }
};

// ---------------------------------------------------------------------------
// B7: GET /api/icon/sellers/:sellerId/services
// ---------------------------------------------------------------------------

exports.getSellerServices = async (req, res) => {
  try {
    const { sellerId } = req.params;

    if (sellerId !== req.iconSellerId) {
      return res.status(403).json({ error: 'seller_mismatch' });
    }

    const { data: services, error } = await sb()
      .from('marketplace_products')
      .select(`
        id, name, description, price_brl, duration_minutes,
        cancellation_policy, service_mode, images, active
      `)
      .eq('seller_id', sellerId)
      .eq('product_type', 'service')
      .not('duration_minutes', 'is', null)
      .eq('active', true)
      .order('name', { ascending: true });

    if (error) throw error;

    res.set('Cache-Control', 'private, max-age=300');
    return res.json({
      success: true,
      data: (services || []).map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        priceBrl: Number(s.price_brl),
        durationMinutes: s.duration_minutes,
        serviceMode: s.service_mode,
        cancellationPolicy: s.cancellation_policy,
        imageUrl: Array.isArray(s.images) && s.images.length > 0 ? s.images[0] : null,
      })),
    });
  } catch (err) {
    logger.error(`[${CTRL}] getSellerServices error`, { error: err.message, sellerId: req.params.sellerId });
    return res.status(500).json({ error: 'internal_error' });
  }
};

// ---------------------------------------------------------------------------
// B8: GET /api/icon/sellers/:sellerId/services/:serviceId/slots?date=YYYY-MM-DD
// ---------------------------------------------------------------------------

exports.getServiceSlots = async (req, res) => {
  try {
    const { sellerId, serviceId } = req.params;
    const { date } = req.query;

    if (sellerId !== req.iconSellerId) {
      return res.status(403).json({ error: 'seller_mismatch' });
    }

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'invalid_date', details: 'Query param date must be YYYY-MM-DD' });
    }

    // Verificar que o serviço pertence a este seller
    const { data: service, error: svcErr } = await sb()
      .from('marketplace_products')
      .select('id, name, duration_minutes, seller_id')
      .eq('id', serviceId)
      .eq('active', true)
      .not('duration_minutes', 'is', null)
      .maybeSingle();

    if (svcErr) throw svcErr;

    if (!service || service.seller_id !== sellerId) {
      return res.status(404).json({ error: 'service_not_found' });
    }

    // Reutiliza bookingService — NÃO duplicar lógica de slots
    const slots = await bookingService.getAvailableSlots(serviceId, date);

    res.set('Cache-Control', 'private, max-age=60');
    return res.json({
      success: true,
      data: {
        serviceId: service.id,
        serviceName: service.name,
        date,
        slots: (slots || []).map(s => ({
          start: s.slot_start,
          end: s.slot_end,
          available: s.available,
        })),
      },
    });
  } catch (err) {
    logger.error(`[${CTRL}] getServiceSlots error`, { error: err.message, serviceId: req.params.serviceId });
    return res.status(500).json({ error: 'internal_error' });
  }
};

// ---------------------------------------------------------------------------
// B10: GET /api/icon/sellers/:sellerId/properties/:propertyId/availability?from=&to=
// ---------------------------------------------------------------------------

exports.getPropertyAvailability = async (req, res) => {
  try {
    const { sellerId, propertyId } = req.params;
    const { from, to } = req.query;

    if (sellerId !== req.iconSellerId) {
      return res.status(403).json({ error: 'seller_mismatch' });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!from || !to || !dateRegex.test(from) || !dateRegex.test(to)) {
      return res.status(400).json({ error: 'invalid_dates', details: 'Query params from and to must be YYYY-MM-DD' });
    }

    // Verificar que o imóvel pertence a este seller
    const { data: property, error: propErr } = await sb()
      .from('marketplace_products')
      .select('id, name, seller_id, listing_type, price_brl, property_details')
      .eq('id', propertyId)
      .eq('active', true)
      .maybeSingle();

    if (propErr) throw propErr;

    if (!property || property.seller_id !== sellerId) {
      return res.status(404).json({ error: 'property_not_found' });
    }

    // Reutiliza propertyStayService — NÃO duplicar lógica de busy dates
    const busyDates = await propertyStayService.getAvailability(propertyId, from, to);

    res.set('Cache-Control', 'private, max-age=120');
    return res.json({
      success: true,
      data: {
        propertyId: property.id,
        propertyName: property.name,
        pricePerNight: property.price_brl ? Number(property.price_brl) : null,
        maxGuests: property.property_details?.max_guests || null,
        minNights: property.property_details?.min_nights || null,
        from,
        to,
        busyDates: (busyDates || []).map(d => ({
          date: d.busy_date,
          reason: d.reason,
        })),
      },
    });
  } catch (err) {
    logger.error(`[${CTRL}] getPropertyAvailability error`, { error: err.message, propertyId: req.params.propertyId });
    return res.status(500).json({ error: 'internal_error' });
  }
};

// ---------------------------------------------------------------------------
// B11: GET /api/icon/sellers/:sellerId/properties/:propertyId/detail
// ---------------------------------------------------------------------------

exports.getPropertyDetail = async (req, res) => {
  try {
    const { sellerId, propertyId } = req.params;

    if (sellerId !== req.iconSellerId) {
      return res.status(403).json({ error: 'seller_mismatch' });
    }

    const { data: property, error: propErr } = await sb()
      .from('marketplace_products')
      .select('id, name, description, price_brl, images, active, listing_type, property_details, created_at')
      .eq('id', propertyId)
      .eq('seller_id', sellerId)
      .eq('active', true)
      .maybeSingle();

    if (propErr) throw propErr;

    if (!property) {
      return res.status(404).json({ error: 'property_not_found' });
    }

    // Reutiliza propertyStayService — NÃO duplicar query de reviews
    let reviews = [];
    try {
      reviews = await propertyStayService.getPropertyReviews(propertyId);
    } catch (revErr) {
      logger.warn(`[${CTRL}] getPropertyDetail: reviews failed`, { error: revErr.message });
    }

    const avgRating = reviews.length > 0
      ? +(reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length).toFixed(1)
      : null;

    res.set('Cache-Control', 'private, max-age=300');
    return res.json({
      success: true,
      data: {
        propertyId: property.id,
        name: property.name,
        description: property.description,
        pricePerNight: property.price_brl ? Number(property.price_brl) : null,
        images: property.images || [],
        listingType: property.listing_type,
        maxGuests: property.property_details?.max_guests || null,
        minNights: property.property_details?.min_nights || null,
        amenities: property.property_details?.amenities || [],
        checkInTime: property.property_details?.check_in_time || null,
        checkOutTime: property.property_details?.check_out_time || null,
        reviews: {
          count: reviews.length,
          avgRating,
          recent: reviews.slice(0, 3).map(r => ({
            rating: r.rating,
            comment: r.comment,
            createdAt: r.created_at,
          })),
        },
      },
    });
  } catch (err) {
    logger.error(`[${CTRL}] getPropertyDetail error`, { error: err.message, propertyId: req.params.propertyId });
    return res.status(500).json({ error: 'internal_error' });
  }
};

/**
 * B9: GET /api/icon/sellers/:sellerId/agenda?from=&to=
 * Returns seller agenda (ops_tasks + service_bookings) for date range.
 */
exports.getSellerAgenda = async (req, res) => {
  try {
    const { sellerId } = req.params;
    if (sellerId !== req.iconSellerId) {
      return res.status(403).json({ error: 'seller_mismatch' });
    }

    const agendaService = require('../services/agendaService');
    const data = await agendaService.getUnifiedSellerTimeline(
      sellerId, req.query.from, req.query.to
    );

    res.set('Cache-Control', 'private, max-age=60');
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] getSellerAgenda error`, { error: err.message, sellerId: req.params.sellerId });
    return res.status(500).json({ error: 'internal_error' });
  }
};
