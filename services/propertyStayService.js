/**
 * @fileoverview propertyStayService — ElosCloud Sistema de Temporada
 *
 * Gerencia o ciclo completo de reservas Airbnb-style para imóveis
 * com listing_type = 'temporada':
 *   hóspede solicita → pagamento hold Stripe → host confirma →
 *   estadia ativa → concluída → avaliação bidirecional
 *
 * Máquina de estados (property_stays.status):
 *   pending_payment → confirmed → active → completed (caminho feliz)
 *   pending_payment → cancelled_guest (desistência antes do pagamento)
 *   confirmed       → cancelled_guest | cancelled_host
 *   confirmed       → disputed        (contestação → disputa-agent)
 *
 * Pagamento (Stripe manual capture, mesmo padrão de bookingPaymentService):
 *   Criação: PaymentIntent capture_method=manual
 *   Confirmação: payment_status = 'authorized'
 *   Check-out: capture (payment_status = 'captured')
 *   Cancelamento com hold: void (payment_status = 'voided')
 *
 * Delegações:
 *   gamificationService → triggerEvent (Lei do Time)
 *   socketManager       → notificações realtime
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { createClient }      = require('@supabase/supabase-js');
const { logger }            = require('../logger');
const gamificationService   = require('./gamificationService');
const socketManager          = require('../config/socket/socketManager');
const notificationDispatcher = require('./NotificationDispatcher');

const crypto = require('crypto');

const SERVICE = 'propertyStayService';

// ──────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

/** Supabase com service_role para bypass de RLS em operações de pagamento */
function sbService() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados.');
  return createClient(url, key, { auth: { persistSession: false } });
}

function log(fn, msg, extra = {}) {
  logger.info(msg, { service: SERVICE, function: fn, ...extra });
}

function logError(fn, err, extra = {}) {
  logger.error(`Erro em ${fn}: ${err.message}`, {
    service: SERVICE, function: fn, error: err.message, ...extra,
  });
}

const asaasService = require('./asaasService');

/**
 * Garante que o usuário tem um customer no Asaas.
 * Cria se não existir (usando userId como externalReference).
 */
async function _ensureAsaasCustomer(userId) {
  return asaasService.createCustomer({
    name: `User ${userId}`,
    externalReference: userId,
  });
}

// ──────────────────────────────────────────────────────
// Helper: resolve seller_profiles.id a partir do Firebase UID
// seller_profiles.user_id = Firebase UID (TEXT)
// seller_profiles.id      = UUID da loja (TEXT PK)
// A comparação owner check usa o id da loja, NÃO o Firebase UID.
// ──────────────────────────────────────────────────────

async function getSellerProfileId(firebaseUid) {
  if (!firebaseUid) return null;
  const { data } = await sb()
    .from('seller_profiles')
    .select('id')
    .eq('user_id', firebaseUid)
    .single();
  return data?.id ?? null;
}

// ──────────────────────────────────────────────────────
// 1. Disponibilidade
// ──────────────────────────────────────────────────────

/**
 * Retorna todas as datas ocupadas de um imóvel em um período.
 * Consolida stays confirmadas + bloqueios manuais via RPC.
 *
 * @param {string} propertyId
 * @param {string} from - 'YYYY-MM-DD'
 * @param {string} to   - 'YYYY-MM-DD'
 * @returns {Array<{ busy_date: string, reason: 'stay'|'blocked' }>}
 */
async function getAvailability(propertyId, from, to) {
  const fn = 'getAvailability';
  if (!propertyId || !from || !to) throw new Error('propertyId, from e to são obrigatórios.');

  const { data, error } = await sb()
    .rpc('get_property_busy_dates', {
      p_property_id: propertyId,
      p_from: from,
      p_to: to,
    });

  if (error) {
    logError(fn, error, { propertyId, from, to });
    throw new Error(`Erro ao buscar disponibilidade: ${error.message}`);
  }

  return data ?? [];
}

// ──────────────────────────────────────────────────────
// 2. Criar estadia (reserva + PaymentIntent)
// ──────────────────────────────────────────────────────

/**
 * Cria uma reserva de temporada e um PaymentIntent Stripe em hold.
 *
 * @param {string} guestId
 * @param {object} data
 * @param {string} data.propertyId
 * @param {string} data.checkIn   - 'YYYY-MM-DD'
 * @param {string} data.checkOut  - 'YYYY-MM-DD'
 * @param {number} data.guestsCount
 * @param {string} [data.specialRequests]
 * @returns {{ stay: object, paymentId: string }}
 */
async function createStay(guestId, data) {
  const fn = 'createStay';
  const { propertyId, checkIn, checkOut, guestsCount = 1, specialRequests } = data;

  if (!guestId || !propertyId || !checkIn || !checkOut) {
    throw new Error('guestId, propertyId, checkIn e checkOut são obrigatórios.');
  }

  // 1. Buscar produto e validar listing_type
  const { data: product, error: prodError } = await sb()
    .from('marketplace_products')
    .select('id, seller_id, price_brl, property_details, active, listing_type, property_status')
    .eq('id', propertyId)
    .single();

  if (prodError || !product) throw new Error('Imóvel não encontrado.');
  if (!product.active) throw new Error('Imóvel não está mais disponível.');
  if (product.listing_type !== 'temporada') throw new Error('Este imóvel não aceita reservas de temporada.');
  if (product.property_status !== 'disponivel') throw new Error('Imóvel não está disponível para reserva no momento.');

  // 2. Validar max_guests
  const maxGuests = product.property_details?.max_guests;
  if (maxGuests && guestsCount > maxGuests) {
    throw new Error(`Número máximo de hóspedes é ${maxGuests}.`);
  }

  // 3. Calcular noites e total
  const checkInDate  = new Date(checkIn);
  const checkOutDate = new Date(checkOut);
  const nights = Math.round((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
  if (nights < 1) throw new Error('A data de check-out deve ser após o check-in.');

  const minNights = product.property_details?.min_nights;
  if (minNights && nights < minNights) {
    throw new Error(`Mínimo de ${minNights} noite(s) para este imóvel.`);
  }

  const pricePerNight = Number(product.price_brl);
  const totalBrl      = Math.round(pricePerNight * nights * 100) / 100;

  // 4. Buscar seller_id do produto (texto)
  const sellerId = product.seller_id;

  // 5. Inserir stay com status pending_payment
  const { data: stay, error: stayError } = await sb()
    .from('property_stays')
    .insert({
      property_id:         propertyId,
      seller_id:           sellerId,
      guest_id:            guestId,
      check_in_date:       checkIn,
      check_out_date:      checkOut,
      guests_count:        guestsCount,
      price_per_night_brl: pricePerNight,
      total_brl:           totalBrl,
      status:              'pending_payment',
      payment_status:      'pending',
      special_requests:    specialRequests || null,
    })
    .select()
    .single();

  if (stayError) {
    // Erro de EXCLUDE = sobreposição de datas
    if (stayError.code === '23P01') {
      throw new Error('Essas datas já estão reservadas. Escolha outras datas.');
    }
    logError(fn, stayError, { propertyId, checkIn, checkOut });
    throw new Error(`Erro ao criar reserva: ${stayError.message}`);
  }

  // 6. Criar pagamento Asaas com authorizeOnly (hold)
  let paymentId = null;
  try {
    const customer = await _ensureAsaasCustomer(guestId);

    const result = await asaasService.authorizeCardPayment({
      customerId: customer.id,
      value: totalBrl,
      description: `Temporada: ${product.property_details?.name || propertyId} (${checkIn} → ${checkOut})`,
      externalReference: `stay:${stay.id}`,
    });

    paymentId = result.paymentId;

    // Atualiza payment_intent_id na stay (sem retrigger de RLS via service client)
    await sbService()
      .from('property_stays')
      .update({ payment_intent_id: paymentId })
      .eq('id', stay.id);

    stay.payment_intent_id = paymentId;

    log(fn, 'Pagamento Asaas criado (hold)', { stayId: stay.id, paymentId, totalBrl });
  } catch (paymentErr) {
    // Se Asaas falhar, cancela a stay para não bloquear as datas
    logError(fn, paymentErr, { stayId: stay.id });
    await sb()
      .from('property_stays')
      .update({ status: 'cancelled_guest', cancellation_reason: 'payment_init_failed' })
      .eq('id', stay.id);
    throw new Error(`Erro ao inicializar pagamento: ${paymentErr.message}`);
  }

  log(fn, 'Estadia criada', { stayId: stay.id, guestId, propertyId, nights, totalBrl });
  return { stay, paymentId };
}

// ──────────────────────────────────────────────────────
// 3. Confirmar pagamento
// ──────────────────────────────────────────────────────

/**
 * Confirma que o PaymentIntent foi autorizado pelo frontend.
 * Transiciona status → 'confirmed', payment_status → 'authorized'.
 */
async function confirmStayPayment(stayId, paymentIntentId) {
  const fn = 'confirmStayPayment';
  if (!stayId || !paymentIntentId) throw new Error('stayId e paymentIntentId são obrigatórios.');

  const { data: stay, error } = await sbService()
    .from('property_stays')
    .update({
      status:           'confirmed',
      payment_status:   'authorized',
      payment_intent_id: paymentIntentId,
    })
    .eq('id', stayId)
    .eq('status', 'pending_payment')
    .select()
    .single();

  if (error || !stay) {
    logError(fn, error || new Error('Stay não encontrada ou já confirmada'), { stayId });
    throw new Error('Não foi possível confirmar a reserva. Verifique se o pagamento foi processado.');
  }

  log(fn, 'Pagamento confirmado', { stayId, paymentIntentId });

  // Ledger: registrar lançamento para o host (fire-and-forget)
  _recordLedgerForStay({
    stayId,
    sellerProfileId: stay.seller_id,
    totalBrl: Number(stay.total_brl),
    paymentId: paymentIntentId,
  });

  // Notificação realtime para o host
  try {
    socketManager.emitToUser(stay.seller_id, 'stay:new_booking', {
      stayId,
      guestId: stay.guest_id,
      checkIn: stay.check_in_date,
      checkOut: stay.check_out_date,
    });
    // Notificação persistente (funciona offline)
    notificationDispatcher.dispatch({
      userId:     stay.seller_id,
      type:       'stay_new_booking',
      importance: 'high',
      data:       { stayId, guestId: stay.guest_id, checkIn: stay.check_in_date, checkOut: stay.check_out_date },
      metadata:   { triggeredBy: 'system' },
      dedupKey:   `stay_new_booking_${stayId}`,
    }).catch(() => {});
} catch { /* fire-and-forget */ }

  return stay;
}

// ──────────────────────────────────────────────────────
// 4. Cancelar estadia
// ──────────────────────────────────────────────────────

/**
 * Cancela uma estadia. Determina se o cancelador é guest ou host.
 * Faz void do Stripe se payment_status = 'authorized'.
 */
async function cancelStay(userId, stayId, reason) {
  const fn = 'cancelStay';
  if (!userId || !stayId) throw new Error('userId e stayId são obrigatórios.');

  const { data: stay, error: fetchError } = await sb()
    .from('property_stays')
    .select('*')
    .eq('id', stayId)
    .single();

  if (fetchError || !stay) throw new Error('Estadia não encontrada.');

  const CANCELLABLE = ['pending_payment', 'confirmed'];
  if (!CANCELLABLE.includes(stay.status)) {
    throw new Error(`Estadia com status '${stay.status}' não pode ser cancelada.`);
  }

  const isGuest  = stay.guest_id === userId;
  // seller_id na stay é seller_profiles.id (UUID), não o Firebase UID
  let isHost = false;
  if (!isGuest) {
    const sellerProfileId = await getSellerProfileId(userId);
    isHost = !!sellerProfileId && sellerProfileId === stay.seller_id;
  }

  if (!isGuest && !isHost) throw new Error('Não autorizado a cancelar esta estadia.');

  const newStatus = isGuest ? 'cancelled_guest' : 'cancelled_host';

  // Void do Asaas se havia hold (refund em AUTHORIZED = void)
  if (stay.payment_intent_id && stay.payment_status === 'authorized') {
    try {
      await asaasService.refundPayment(stay.payment_intent_id);
      log(fn, 'Asaas hold void', { stayId, paymentId: stay.payment_intent_id });
    } catch (voidErr) {
      logError(fn, voidErr, { stayId, context: 'void' });
      logger.error('FALHA ao dar void no Asaas durante cancelamento de estadia', {
        service: SERVICE, stayId, paymentId: stay.payment_intent_id, error: voidErr.message,
        severity: 'HIGH',
      });
    }
  }

  const { data: updated, error: updateError } = await sbService()
    .from('property_stays')
    .update({
      status:              newStatus,
      payment_status:      stay.payment_status === 'authorized' ? 'voided' : stay.payment_status,
      cancellation_reason: reason || null,
    })
    .eq('id', stayId)
    .select()
    .single();

  if (updateError) throw new Error(`Erro ao cancelar estadia: ${updateError.message}`);

  log(fn, 'Estadia cancelada', { stayId, newStatus, userId });

  // Ledger: reverter lançamentos se existirem (fire-and-forget)
  _reverseLedgerForStay(stayId, reason || `Cancelamento ${newStatus}`);

  // Notificação para a outra parte
  try {
    const notifyUserId = isGuest ? stay.seller_id : stay.guest_id;
    const cancelledBy  = isGuest ? 'guest' : 'host';
    socketManager.emitToUser(notifyUserId, 'stay:cancelled', { stayId, cancelledBy });
    // Notificação persistente
    notificationDispatcher.dispatch({
      userId:     notifyUserId,
      type:       'stay_cancelled',
      importance: 'high',
      data:       { stayId, cancelledBy },
      metadata:   { triggeredBy: userId },
      dedupKey:   `stay_cancelled_${stayId}`,
    }).catch(() => {});
  } catch { /* fire-and-forget */ }

  return updated;
}

// ──────────────────────────────────────────────────────
// 5. Bloqueio de datas pelo proprietário
// ──────────────────────────────────────────────────────

/**
 * Bloqueia um range de datas para um imóvel (host only).
 * @param {string} userId - Firebase UID do host autenticado
 */
async function blockDates(userId, propertyId, { from, to, reason = 'outro' }) {
  const fn = 'blockDates';
  if (!userId || !propertyId || !from || !to) {
    throw new Error('userId, propertyId, from e to são obrigatórios.');
  }

  // Resolve seller_profiles.id a partir do Firebase UID
  const sellerProfileId = await getSellerProfileId(userId);
  if (!sellerProfileId) throw new Error('Perfil de vendedor não encontrado para este usuário.');

  // Verifica ownership: marketplace_products.seller_id = seller_profiles.id (UUID)
  const { data: product } = await sb()
    .from('marketplace_products')
    .select('seller_id')
    .eq('id', propertyId)
    .single();

  if (!product || product.seller_id !== sellerProfileId) {
    throw new Error('Não autorizado: você não é o dono deste imóvel.');
  }

  const { data, error } = await sb()
    .from('property_blocked_dates')
    .insert({ property_id: propertyId, seller_id: sellerProfileId, blocked_from: from, blocked_to: to, reason })
    .select()
    .single();

  if (error) throw new Error(`Erro ao bloquear datas: ${error.message}`);

  log(fn, 'Datas bloqueadas', { sellerProfileId, propertyId, from, to });
  return data;
}

/**
 * Remove um bloqueio de datas (host only).
 * @param {string} userId - Firebase UID do host autenticado
 */
async function unblockDates(userId, blockId) {
  const fn = 'unblockDates';
  if (!userId || !blockId) throw new Error('userId e blockId são obrigatórios.');

  const sellerProfileId = await getSellerProfileId(userId);
  if (!sellerProfileId) throw new Error('Perfil de vendedor não encontrado.');

  const { error } = await sb()
    .from('property_blocked_dates')
    .delete()
    .eq('id', blockId)
    .eq('seller_id', sellerProfileId);

  if (error) throw new Error(`Erro ao remover bloqueio: ${error.message}`);

  log(fn, 'Bloqueio removido', { sellerProfileId, blockId });
  return { success: true };
}

// ──────────────────────────────────────────────────────
// 6. Listagem de estadias
// ──────────────────────────────────────────────────────

/**
 * Lista estadias de um hóspede, com dados do imóvel.
 */
async function getGuestStays(userId, status) {
  const fn = 'getGuestStays';
  if (!userId) throw new Error('userId é obrigatório.');

  let query = sb()
    .from('property_stays')
    .select(`
      *,
      marketplace_products(id, name, images, price_brl, property_details)
    `)
    .eq('guest_id', userId)
    .order('check_in_date', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) {
    logError(fn, error, { userId });
    throw new Error(`Erro ao buscar estadias: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Lista estadias recebidas por um host.
 * @param {string} userId - Firebase UID do host autenticado
 */
async function getHostStays(userId, status) {
  const fn = 'getHostStays';
  if (!userId) throw new Error('userId é obrigatório.');

  const sellerProfileId = await getSellerProfileId(userId);
  if (!sellerProfileId) return []; // sem perfil de vendedor → lista vazia

  let query = sb()
    .from('property_stays')
    .select(`
      *,
      marketplace_products(id, name, images)
    `)
    .eq('seller_id', sellerProfileId)
    .order('check_in_date', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) {
    logError(fn, error, { sellerProfileId });
    throw new Error(`Erro ao buscar estadias do host: ${error.message}`);
  }

  return data ?? [];
}

// ──────────────────────────────────────────────────────
// 7. Avaliações bidirecionais
// ──────────────────────────────────────────────────────

/**
 * Submete avaliação de uma estadia.
 * Determina automaticamente se é guest→property ou host→guest.
 * O trigger SQL revela ambas quando as duas forem submetidas.
 */
async function submitReview(userId, stayId, { rating, comment }) {
  const fn = 'submitReview';
  if (!userId || !stayId || !rating) throw new Error('userId, stayId e rating são obrigatórios.');
  if (rating < 1 || rating > 5) throw new Error('rating deve ser entre 1 e 5.');

  const { data: stay, error: stayError } = await sb()
    .from('property_stays')
    .select('id, guest_id, seller_id, status, guest_review_id, host_review_id')
    .eq('id', stayId)
    .single();

  if (stayError || !stay) throw new Error('Estadia não encontrada.');
  if (stay.status !== 'completed') throw new Error('Avaliações só são permitidas após a conclusão da estadia.');

  const isGuest = stay.guest_id  === userId;
  const isHost  = stay.seller_id === userId;

  if (!isGuest && !isHost) throw new Error('Não autorizado a avaliar esta estadia.');

  const reviewerType = isGuest ? 'guest' : 'host';

  // Verificar se já avaliou
  if (isGuest && stay.guest_review_id) throw new Error('Você já avaliou esta estadia.');
  if (isHost  && stay.host_review_id)  throw new Error('Você já avaliou esta estadia.');

  const { data: review, error: reviewError } = await sb()
    .from('property_stay_reviews')
    .insert({
      stay_id:       stayId,
      reviewer_id:   userId,
      reviewer_type: reviewerType,
      rating,
      comment:       comment || null,
    })
    .select()
    .single();

  if (reviewError) {
    if (reviewError.code === '23505') throw new Error('Você já avaliou esta estadia.');
    logError(fn, reviewError, { stayId, userId });
    throw new Error(`Erro ao submeter avaliação: ${reviewError.message}`);
  }

  // Atualiza FK na stay (guest_review_id ou host_review_id)
  const fkField = isGuest ? 'guest_review_id' : 'host_review_id';
  await sbService()
    .from('property_stays')
    .update({ [fkField]: review.id })
    .eq('id', stayId);

  log(fn, 'Avaliação submetida', { stayId, userId, reviewerType, rating });

  // Gamificação — Lei do Time
  try {
    await gamificationService.triggerEvent('review_given', userId, { stayId, reviewerType });
  } catch { /* fire-and-forget */ }

  // Trust Passport — avaliação de estadia (impacto baseado na nota)
  try {
    const trustPassportService = require('./trustPassportService');
    const impact = rating >= 4 ? 2 : rating >= 3 ? 1 : -2;
    const isNeg = impact < 0;
    // Quem recebe a avaliação é o outro lado da relação
    const ratedUserId = reviewerType === 'guest' ? stay.seller_id : stay.guest_id;
    trustPassportService.recordEvent(ratedUserId, 'stays', 'stay_review_received', impact, isNeg, {
      stayId, rating, reviewerType,
    }).catch(() => {});
  } catch { /* fire-and-forget */ }

  return review;
}

/**
 * Retorna reviews visíveis de um imóvel (is_visible = true).
 * Inclui dados básicos do hóspede via stay.
 */
async function getPropertyReviews(propertyId) {
  const fn = 'getPropertyReviews';
  if (!propertyId) throw new Error('propertyId é obrigatório.');

  const { data, error } = await sb()
    .from('property_stay_reviews')
    .select(`
      *,
      property_stays!inner(
        property_id,
        check_in_date,
        check_out_date,
        guest_id
      )
    `)
    .eq('property_stays.property_id', propertyId)
    .eq('is_visible', true)
    .eq('reviewer_type', 'guest')
    .order('created_at', { ascending: false });

  if (error) {
    logError(fn, error, { propertyId });
    throw new Error(`Erro ao buscar avaliações: ${error.message}`);
  }

  return data ?? [];
}

// ──────────────────────────────────────────────────────
// 8. Completar estadia (charge + gamificação)
// ──────────────────────────────────────────────────────

/**
 * Marca estadia como 'completed' e captura o pagamento Stripe.
 * Só o host pode completar; backend também pode chamar via job.
 * @param {string} userId - Firebase UID do host autenticado
 */
async function completeStay(userId, stayId) {
  const fn = 'completeStay';
  if (!userId || !stayId) throw new Error('userId e stayId são obrigatórios.');

  const sellerProfileId = await getSellerProfileId(userId);
  if (!sellerProfileId) throw new Error('Perfil de vendedor não encontrado.');

  const { data: stay } = await sb()
    .from('property_stays')
    .select('*')
    .eq('id', stayId)
    .eq('seller_id', sellerProfileId)
    .single();

  if (!stay) throw new Error('Estadia não encontrada ou não autorizado.');
  if (stay.status !== 'active') throw new Error(`Só é possível completar estadias com status 'active'. Status atual: '${stay.status}'.`);

  // Capturar pagamento Asaas — condicionar DB update ao sucesso
  let captureOk = false;
  if (stay.payment_intent_id && stay.payment_status === 'authorized') {
    try {
      await asaasService.captureAuthorizedPayment(stay.payment_intent_id);
      captureOk = true;
    } catch (captureErr) {
      logError(fn, captureErr, { stayId, context: 'capture' });
      logger.error('FALHA ao capturar pagamento Asaas após conclusão de estadia', {
        service: SERVICE, stayId, paymentId: stay.payment_intent_id, error: captureErr.message,
        severity: 'HIGH',
      });
    }
  } else {
    // Sem hold pendente — apenas marcar como completed
    captureOk = true;
  }

  const { data: updated, error } = await sbService()
    .from('property_stays')
    .update({
      status: 'completed',
      payment_status: captureOk ? 'captured' : stay.payment_status,
    })
    .eq('id', stayId)
    .select()
    .single();

  if (error) throw new Error(`Erro ao completar estadia: ${error.message}`);

  log(fn, 'Estadia concluída', { stayId, sellerProfileId });

  // Ledger: promover lançamentos de pending → available (fire-and-forget)
  _promoteLedgerForStay(stayId);

  // Gamificação — Lei do Time (usa userId = Firebase UID do host)
  try {
    await gamificationService.triggerEvent('stay_completed', stay.guest_id, { stayId });
    await gamificationService.triggerEvent('stay_hosted',    userId,        { stayId });
  } catch { /* fire-and-forget */ }

  // Trust Passport — estadia concluída (+3 hóspede, +3 host)
  try {
    const trustPassportService = require('./trustPassportService');
    trustPassportService.recordEvent(stay.guest_id, 'stays', 'stay_completed', 3, false, { stayId }).catch(() => {});
    trustPassportService.recordEvent(userId, 'stays', 'stay_hosted', 3, false, { stayId }).catch(() => {});
  } catch { /* fire-and-forget */ }

  // Notificações realtime
  try {
    socketManager.emitToUser(stay.guest_id, 'stay:completed', { stayId });
    // Notificação persistente
    notificationDispatcher.dispatch({
      userId:     stay.guest_id,
      type:       'stay_completed',
      importance: 'high',
      data:       { stayId },
      metadata:   { triggeredBy: userId },
      dedupKey:   `stay_completed_${stayId}`,
    }).catch(() => {});
  } catch { /* fire-and-forget */ }

  return updated;
}

// ──────────────────────────────────────────────────────
// 9. iCal Export (RFC 5545)
// ──────────────────────────────────────────────────────

/**
 * Formata Date ou string 'YYYY-MM-DD' para 'YYYYMMDD' (VALUE=DATE, sem horário).
 * @param {string|Date} d
 * @returns {string}
 */
function formatIcalDate(d) {
  if (typeof d === 'string') return d.replace(/-/g, '');
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Escapa texto para campos iCal (RFC 5545 §3.3.11).
 * Backslash, ponto-e-vírgula, vírgula e newlines.
 */
function escapeIcalText(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Gera a string .ics completa para um imóvel.
 * Endpoint público — validação por token, sem JWT.
 *
 * @param {string} productId - ID do imóvel
 * @param {string} token - ical_export_token enviado via query string
 * @returns {string} conteúdo .ics (text/calendar)
 */
async function generateIcalExport(productId, token) {
  const fn = 'generateIcalExport';
  if (!productId || !token) throw new Error('productId e token são obrigatórios.');

  // 1. Validar token — service role para bypass de RLS (rota pública)
  const { data: product, error: prodError } = await sbService()
    .from('marketplace_products')
    .select('id, name, ical_export_token')
    .eq('id', productId)
    .single();

  if (prodError || !product) {
    logger.warn('[icalExport] Produto não encontrado para export', { service: SERVICE, function: fn, productId });
    const err = new Error('Imóvel não encontrado.');
    err.statusCode = 404;
    throw err;
  }

  if (!product.ical_export_token || product.ical_export_token !== token) {
    logger.warn('[icalExport] Token inválido para export', { service: SERVICE, function: fn, productId });
    const err = new Error('Token de exportação inválido ou expirado.');
    err.statusCode = 403;
    throw err;
  }

  // 2. Buscar reservas confirmadas/ativas
  const { data: stays, error: staysError } = await sbService()
    .from('property_stays')
    .select('id, check_in_date, check_out_date, status, guests_count')
    .eq('property_id', productId)
    .in('status', ['confirmed', 'active']);

  if (staysError) {
    logError(fn, staysError, { productId });
    throw new Error(`Erro ao buscar reservas: ${staysError.message}`);
  }

  // 3. Buscar datas bloqueadas
  const { data: blocks, error: blocksError } = await sbService()
    .from('property_blocked_dates')
    .select('id, blocked_from, blocked_to, reason')
    .eq('property_id', productId);

  if (blocksError) {
    logError(fn, blocksError, { productId });
    throw new Error(`Erro ao buscar bloqueios: ${blocksError.message}`);
  }

  // 4. Gerar string .ics (RFC 5545)
  const now = new Date();
  const dtstamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const productName = escapeIcalText(product.name || 'Imóvel');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ElosCloud//Temporada//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${productName} - ElosCloud`,
  ];

  // VEVENTs para reservas
  for (const stay of (stays || [])) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${stay.id}@eloscloud.com`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${formatIcalDate(stay.check_in_date)}`,
      `DTEND;VALUE=DATE:${formatIcalDate(stay.check_out_date)}`,
      `SUMMARY:Reserva (${stay.guests_count || 1} hóspede${(stay.guests_count || 1) > 1 ? 's' : ''})`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }

  // VEVENTs para bloqueios
  for (const block of (blocks || [])) {
    const reasonLabel = block.reason === 'manutencao' ? 'Manutenção'
      : block.reason === 'uso_proprio' ? 'Uso próprio'
      : block.reason === 'ical_sync' ? 'Sync externo'
      : 'Bloqueado';
    lines.push(
      'BEGIN:VEVENT',
      `UID:block-${block.id}@eloscloud.com`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${formatIcalDate(block.blocked_from)}`,
      `DTEND;VALUE=DATE:${formatIcalDate(block.blocked_to)}`,
      `SUMMARY:${escapeIcalText(reasonLabel)}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');

  log(fn, '[icalExport] Calendário exportado', {
    productId,
    staysCount: (stays || []).length,
    blocksCount: (blocks || []).length,
  });

  return lines.join('\r\n');
}

/**
 * Retorna o token de exportação iCal existente ou cria um novo.
 * Somente o seller dono do imóvel pode acessar.
 *
 * @param {string} userId - Firebase UID do host autenticado
 * @param {string} productId - ID do imóvel
 * @returns {{ token: string, url: string }}
 */
async function getOrCreateExportToken(userId, productId) {
  const fn = 'getOrCreateExportToken';
  if (!userId || !productId) throw new Error('userId e productId são obrigatórios.');

  // Verificar ownership
  const sellerProfileId = await getSellerProfileId(userId);
  if (!sellerProfileId) throw new Error('Perfil de vendedor não encontrado para este usuário.');

  const { data: product, error: prodError } = await sb()
    .from('marketplace_products')
    .select('id, seller_id, ical_export_token')
    .eq('id', productId)
    .single();

  if (prodError || !product) throw new Error('Imóvel não encontrado.');
  if (product.seller_id !== sellerProfileId) {
    const err = new Error('Não autorizado: você não é o dono deste imóvel.');
    err.statusCode = 403;
    throw err;
  }

  // Se token já existe, retornar
  if (product.ical_export_token) {
    log(fn, '[icalExport] Token existente retornado', { productId });
    return {
      token: product.ical_export_token,
      url: `${process.env.BACKEND_URL || 'https://eloscloud-api.fly.dev'}/api/marketplace/imoveis/${productId}/calendar.ics?token=${product.ical_export_token}`,
    };
  }

  // Gerar novo token
  const token = crypto.randomBytes(32).toString('hex');
  const { error: updateError } = await sbService()
    .from('marketplace_products')
    .update({ ical_export_token: token })
    .eq('id', productId);

  if (updateError) {
    logError(fn, updateError, { productId });
    throw new Error(`Erro ao gerar token de exportação: ${updateError.message}`);
  }

  log(fn, '[icalExport] Novo token gerado', { productId });
  return {
    token,
    url: `${process.env.BACKEND_URL || 'https://eloscloud-api.fly.dev'}/api/marketplace/imoveis/${productId}/calendar.ics?token=${token}`,
  };
}

/**
 * Regenera (invalida o antigo e cria novo) token de exportação iCal.
 * Somente o seller dono do imóvel pode acessar.
 *
 * @param {string} userId - Firebase UID do host autenticado
 * @param {string} productId - ID do imóvel
 * @returns {{ token: string, url: string }}
 */
async function regenerateExportToken(userId, productId) {
  const fn = 'regenerateExportToken';
  if (!userId || !productId) throw new Error('userId e productId são obrigatórios.');

  // Verificar ownership
  const sellerProfileId = await getSellerProfileId(userId);
  if (!sellerProfileId) throw new Error('Perfil de vendedor não encontrado para este usuário.');

  const { data: product, error: prodError } = await sb()
    .from('marketplace_products')
    .select('id, seller_id')
    .eq('id', productId)
    .single();

  if (prodError || !product) throw new Error('Imóvel não encontrado.');
  if (product.seller_id !== sellerProfileId) {
    const err = new Error('Não autorizado: você não é o dono deste imóvel.');
    err.statusCode = 403;
    throw err;
  }

  // Gerar novo token (sobrescreve o antigo, invalidando URLs anteriores)
  const token = crypto.randomBytes(32).toString('hex');
  const { error: updateError } = await sbService()
    .from('marketplace_products')
    .update({ ical_export_token: token })
    .eq('id', productId);

  if (updateError) {
    logError(fn, updateError, { productId });
    throw new Error(`Erro ao regenerar token de exportação: ${updateError.message}`);
  }

  log(fn, '[icalExport] Token regenerado (antigo invalidado)', { productId });
  return {
    token,
    url: `${process.env.BACKEND_URL || 'https://eloscloud-api.fly.dev'}/api/marketplace/imoveis/${productId}/calendar.ics?token=${token}`,
  };
}

// ──────────────────────────────────────────────────────
// LEDGER UNIFICADO (W4 — partidas dobradas BRL)
// ──────────────────────────────────────────────────────

/**
 * Resolve o Firebase UID (user_id) a partir de seller_profiles.id.
 * @param {string} sellerProfileId - seller_profiles.id (UUID)
 * @returns {Promise<string|null>} Firebase UID
 */
async function _resolveSellerUserId(sellerProfileId) {
  if (!sellerProfileId) return null;
  const { data } = await sb()
    .from('seller_profiles')
    .select('user_id')
    .eq('id', sellerProfileId)
    .single();
  return data?.user_id ?? null;
}

/**
 * Registra lançamentos no ledger para uma estadia de temporada.
 * Partidas dobradas: host recebe total_brl, plataforma debita total_brl.
 * Sem comissão visível no fluxo atual — plataforma pode adicionar depois.
 * Fire-and-forget — erros nunca bloqueiam o fluxo principal.
 *
 * @param {object} params
 * @param {string} params.stayId
 * @param {string} params.sellerProfileId - seller_profiles.id (UUID)
 * @param {number} params.totalBrl
 * @param {string} [params.paymentId]
 */
async function _recordLedgerForStay({ stayId, sellerProfileId, totalBrl, paymentId }) {
  try {
    const ledger = require('./unifiedLedgerService');

    // Idempotency check
    const existingCheck = await sb()
      .from('ledger_entries')
      .select('id')
      .eq('source_type', 'property_stay')
      .eq('source_id', stayId)
      .limit(1);

    if (existingCheck.data && existingCheck.data.length > 0) {
      log('_recordLedgerForStay', 'Ledger entries already exist — skipping', {
        action: 'LEDGER_IDEMPOTENT_SKIP', stayId,
      });
      return;
    }

    // Resolve seller_profiles.id → Firebase UID
    const hostUserId = await _resolveSellerUserId(sellerProfileId);
    if (!hostUserId) {
      logger.warn('[propertyStayService] Cannot resolve host user_id for ledger', {
        service: SERVICE, action: 'LEDGER_NO_HOST_USER', sellerProfileId, stayId,
      });
      return;
    }

    const hostAccountId = await ledger.ensureAccount('user', hostUserId);
    const platformAccountId = ledger.PLATFORM_ACCOUNT_ID;

    // Transaction: host receives total (no commission in current flow)
    if (totalBrl > 0) {
      await ledger.recordTransaction([
        {
          accountId:   hostAccountId,
          amountBrl:   totalBrl,
          status:      'pending',
          sourceType:  'property_stay',
          sourceId:    stayId,
          description: `Temporada — estadia ${stayId.substring(0, 8)}`,
          asaasRef:    paymentId || null,
        },
        {
          accountId:   platformAccountId,
          amountBrl:   -totalBrl,
          status:      'pending',
          sourceType:  'property_stay',
          sourceId:    stayId,
          description: `Repasse host — estadia ${stayId.substring(0, 8)}`,
          asaasRef:    paymentId || null,
        },
      ]);
    }

    log('_recordLedgerForStay', 'Ledger recorded for property stay', {
      action: 'LEDGER_RECORD_OK', stayId, hostUserId, totalBrl,
    });
  } catch (ledgerErr) {
    logger.error('Ledger recording failed (non-blocking)', {
      service: SERVICE,
      action: 'LEDGER_RECORD_FAILED',
      severity: 'CRITICAL',
      stayId,
      error: ledgerErr.message,
    });
  }
}

/**
 * Promove lançamentos de pending → available para uma estadia.
 * Fire-and-forget.
 */
async function _promoteLedgerForStay(stayId) {
  try {
    const ledger = require('./unifiedLedgerService');
    const promoted = await ledger.promoteToAvailable('property_stay', stayId);
    if (promoted > 0) {
      log('_promoteLedgerForStay', 'Ledger entries promoted to available', {
        action: 'LEDGER_PROMOTE_OK', stayId, promoted,
      });
    }
  } catch (ledgerErr) {
    logger.error('Ledger promotion failed (non-blocking)', {
      service: SERVICE,
      action: 'LEDGER_PROMOTE_FAILED',
      severity: 'CRITICAL',
      stayId,
      error: ledgerErr.message,
    });
  }
}

/**
 * Reverte lançamentos do ledger para uma estadia cancelada.
 * Fire-and-forget.
 */
async function _reverseLedgerForStay(stayId, reason) {
  try {
    const ledger = require('./unifiedLedgerService');

    const { data: entries, error } = await sb()
      .from('ledger_entries')
      .select('transaction_id')
      .eq('source_type', 'property_stay')
      .eq('source_id', stayId)
      .is('reversed_by', null);

    if (error) throw error;
    if (!entries || entries.length === 0) {
      log('_reverseLedgerForStay', 'No ledger entries to reverse', {
        action: 'LEDGER_REVERSE_SKIP', stayId,
      });
      return;
    }

    const txnIds = [...new Set(entries.map(e => e.transaction_id))];
    for (const txnId of txnIds) {
      await ledger.reverseTransaction(txnId, reason);
    }

    log('_reverseLedgerForStay', 'Ledger entries reversed', {
      action: 'LEDGER_REVERSE_OK', stayId, transactionsReversed: txnIds.length, reason,
    });
  } catch (ledgerErr) {
    logger.error('Ledger reversal failed (non-blocking)', {
      service: SERVICE,
      action: 'LEDGER_REVERSE_FAILED',
      severity: 'CRITICAL',
      stayId, reason,
      error: ledgerErr.message,
    });
  }
}

// ──────────────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────────────
module.exports = {
  getAvailability,
  createStay,
  confirmStayPayment,
  cancelStay,
  blockDates,
  unblockDates,
  getGuestStays,
  getHostStays,
  submitReview,
  getPropertyReviews,
  completeStay,
  generateIcalExport,
  getOrCreateExportToken,
  regenerateExportToken,
};
