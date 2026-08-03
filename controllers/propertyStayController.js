'use strict';

const Joi                = require('joi');
const propertyStayService = require('../services/propertyStayService');
const icalSyncService     = require('../services/icalSyncService');
const { logger }         = require('../logger');

const SERVICE = 'propertyStayController';

function logError(fn, err, extra = {}) {
  logger.error(`Erro em ${fn}: ${err.message}`, {
    service: SERVICE, function: fn, error: err.message, ...extra,
  });
}

// ──────────────────────────────────────────────────────
// Schemas de validação
// ──────────────────────────────────────────────────────

const availabilitySchema = Joi.object({
  from: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  to:   Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
});

const createStaySchema = Joi.object({
  propertyId:      Joi.string().required(),
  checkIn:         Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  checkOut:        Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  guestsCount:     Joi.number().integer().min(1).max(50).default(1),
  specialRequests: Joi.string().max(500).optional().allow(''),
});

const confirmPaymentSchema = Joi.object({
  paymentIntentId: Joi.string().required(),
});

const cancelStaySchema = Joi.object({
  reason: Joi.string().max(300).optional().allow(''),
});

const blockDatesSchema = Joi.object({
  from:   Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  to:     Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  reason: Joi.string().valid('manutencao','uso_proprio','outro').default('outro'),
});

const reviewSchema = Joi.object({
  rating:  Joi.number().integer().min(1).max(5).required(),
  comment: Joi.string().max(600).optional().allow(''),
});

// ──────────────────────────────────────────────────────
// Controllers
// ──────────────────────────────────────────────────────

/**
 * GET /api/marketplace/imoveis/:propertyId/availability?from=&to=
 * Público — não requer auth.
 */
async function getAvailability(req, res) {
  try {
    const { error, value } = availabilitySchema.validate(req.query);
    if (error) return res.status(400).json({ success: false, error: error.details[0].message });

    const { propertyId } = req.params;
    const busyDates = await propertyStayService.getAvailability(propertyId, value.from, value.to);

    return res.json({ success: true, data: busyDates });
  } catch (err) {
    logError('getAvailability', err, { propertyId: req.params.propertyId });
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/marketplace/imoveis/stay
 * Autenticado — hóspede cria reserva.
 */
async function createStay(req, res) {
  try {
    const { error, value } = createStaySchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, error: error.details[0].message });

    const guestId = req.user.uid;
    const result  = await propertyStayService.createStay(guestId, value);

    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    logError('createStay', err, { guestId: req.user?.uid });
    const status = err.message.includes('não encontrado') || err.message.includes('disponível') ? 422 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/marketplace/imoveis/stay/:id/confirm
 * Autenticado — confirma pagamento autorizado pelo Stripe.
 */
async function confirmStayPayment(req, res) {
  try {
    const { error, value } = confirmPaymentSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, error: error.details[0].message });

    const { id: stayId } = req.params;
    const stay = await propertyStayService.confirmStayPayment(stayId, value.paymentIntentId);

    return res.json({ success: true, data: stay });
  } catch (err) {
    logError('confirmStayPayment', err, { stayId: req.params.id });
    return res.status(422).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/marketplace/imoveis/stay/:id/cancel
 * Autenticado — guest ou host cancela.
 */
async function cancelStay(req, res) {
  try {
    const { error, value } = cancelStaySchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, error: error.details[0].message });

    const { id: stayId } = req.params;
    const userId = req.user.uid;
    const stay = await propertyStayService.cancelStay(userId, stayId, value.reason);

    return res.json({ success: true, data: stay });
  } catch (err) {
    logError('cancelStay', err, { stayId: req.params.id });
    const status = err.message.includes('autorizado') ? 403 : 422;
    return res.status(status).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/marketplace/imoveis/:propertyId/block
 * Autenticado — host bloqueia datas.
 */
async function blockDates(req, res) {
  try {
    const { error, value } = blockDatesSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, error: error.details[0].message });

    const { propertyId } = req.params;
    const sellerId = req.user.uid;
    const block = await propertyStayService.blockDates(sellerId, propertyId, value);

    return res.status(201).json({ success: true, data: block });
  } catch (err) {
    logError('blockDates', err, { propertyId: req.params.propertyId });
    const status = err.message.includes('autorizado') ? 403 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
}

/**
 * DELETE /api/marketplace/imoveis/block/:blockId
 * Autenticado — host remove bloqueio.
 */
async function unblockDates(req, res) {
  try {
    const { blockId } = req.params;
    const sellerId = req.user.uid;
    const result = await propertyStayService.unblockDates(sellerId, blockId);

    return res.json({ success: true, data: result });
  } catch (err) {
    logError('unblockDates', err, { blockId: req.params.blockId });
    const status = err.message.includes('autorizado') ? 403 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/marketplace/imoveis/stays/guest
 * Autenticado — hóspede lista suas estadias.
 */
async function getGuestStays(req, res) {
  try {
    const userId = req.user.uid;
    const { status } = req.query;
    const stays = await propertyStayService.getGuestStays(userId, status);

    return res.json({ success: true, data: stays, total: stays.length });
  } catch (err) {
    logError('getGuestStays', err, { userId: req.user?.uid });
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/marketplace/imoveis/stays/host
 * Autenticado — host lista estadias recebidas.
 */
async function getHostStays(req, res) {
  try {
    const sellerId = req.user.uid;
    const { status } = req.query;
    const stays = await propertyStayService.getHostStays(sellerId, status);

    return res.json({ success: true, data: stays, total: stays.length });
  } catch (err) {
    logError('getHostStays', err, { sellerId: req.user?.uid });
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/marketplace/imoveis/stay/:id/review
 * Autenticado — guest ou host avalia.
 */
async function submitReview(req, res) {
  try {
    const { error, value } = reviewSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, error: error.details[0].message });

    const { id: stayId } = req.params;
    const userId = req.user.uid;
    const review = await propertyStayService.submitReview(userId, stayId, value);

    return res.status(201).json({ success: true, data: review });
  } catch (err) {
    logError('submitReview', err, { stayId: req.params.id });
    const status = err.message.includes('autorizado') ? 403
      : err.message.includes('Já avaliou') ? 409
      : 422;
    return res.status(status).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/marketplace/imoveis/:propertyId/reviews
 * Público — lista reviews visíveis.
 */
async function getPropertyReviews(req, res) {
  try {
    const { propertyId } = req.params;
    const reviews = await propertyStayService.getPropertyReviews(propertyId);

    return res.json({ success: true, data: reviews, total: reviews.length });
  } catch (err) {
    logError('getPropertyReviews', err, { propertyId: req.params.propertyId });
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/marketplace/imoveis/stay/:id/complete
 * Autenticado — host marca estadia como concluída.
 */
async function completeStay(req, res) {
  try {
    const { id: stayId } = req.params;
    const sellerId = req.user.uid;
    const stay = await propertyStayService.completeStay(sellerId, stayId);

    return res.json({ success: true, data: stay });
  } catch (err) {
    logError('completeStay', err, { stayId: req.params.id });
    const status = err.message.includes('autorizado') ? 403 : 422;
    return res.status(status).json({ success: false, error: err.message });
  }
}

// ──────────────────────────────────────────────────────
// iCal Export — Calendário .ics
// ──────────────────────────────────────────────────────

/**
 * GET /api/marketplace/imoveis/:id/calendar.ics?token=xxx
 * Público — autenticação via token na query string (sem JWT).
 * Retorna text/calendar para consumo por Google Calendar, Airbnb, Booking.com, etc.
 */
async function getCalendarIcs(req, res) {
  try {
    const { id: productId } = req.params;
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ success: false, error: 'Parâmetro "token" é obrigatório.' });
    }

    const icsContent = await propertyStayService.generateIcalExport(productId, token);

    res.set({
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${productId}.ics"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    return res.send(icsContent);
  } catch (err) {
    logError('getCalendarIcs', err, { productId: req.params.id });
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/marketplace/imoveis/:id/ical-token
 * Autenticado — seller obtém (ou cria) seu token de exportação iCal.
 * Retorna o token e a URL completa do calendário .ics.
 */
async function getExportToken(req, res) {
  try {
    const { id: productId } = req.params;
    const userId = req.user.uid;
    const result = await propertyStayService.getOrCreateExportToken(userId, productId);

    return res.json({ success: true, data: result });
  } catch (err) {
    logError('getExportToken', err, { productId: req.params.id });
    const status = err.statusCode || (err.message.includes('autorizado') ? 403 : 500);
    return res.status(status).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/marketplace/imoveis/:id/ical-token/regenerate
 * Autenticado — seller regenera o token (invalida o antigo).
 * Retorna o novo token e a nova URL completa.
 */
async function regenerateExportToken(req, res) {
  try {
    const { id: productId } = req.params;
    const userId = req.user.uid;
    const result = await propertyStayService.regenerateExportToken(userId, productId);

    return res.json({ success: true, data: result });
  } catch (err) {
    logError('regenerateExportToken', err, { productId: req.params.id });
    const status = err.statusCode || (err.message.includes('autorizado') ? 403 : 500);
    return res.status(status).json({ success: false, error: err.message });
  }
}

// ──────────────────────────────────────────────────────
// iCal Sync — Importação de calendários externos
// ──────────────────────────────────────────────────────

const addIcalSourceSchema = Joi.object({
  sourceUrl:  Joi.string().uri({ scheme: 'https' }).required()
    .messages({ 'string.uriCustomScheme': 'A URL deve usar HTTPS.' }),
  sourceName: Joi.string().valid('airbnb', 'booking', 'vrbo', 'custom').required(),
});

/**
 * POST /api/marketplace/imoveis/:id/ical-sources
 * Autenticado — host adiciona fonte iCal externa.
 */
async function addIcalSource(req, res) {
  try {
    const { error, value } = addIcalSourceSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, error: error.details[0].message });

    const { id: productId } = req.params;
    const userId = req.user.uid;
    const source = await icalSyncService.addIcalSource(userId, productId, value);

    return res.status(201).json({ success: true, data: source });
  } catch (err) {
    logError('addIcalSource', err, { productId: req.params.id });
    const status = err.message.includes('autorizado') || err.message.includes('dono')
      ? 403
      : err.message.includes('ja esta cadastrada')
        ? 409
        : 422;
    return res.status(status).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/marketplace/imoveis/:id/ical-sources
 * Autenticado — host lista fontes iCal do imóvel.
 */
async function listIcalSources(req, res) {
  try {
    const { id: productId } = req.params;
    const userId = req.user.uid;
    const sources = await icalSyncService.listIcalSources(userId, productId);

    return res.json({ success: true, data: sources, total: sources.length });
  } catch (err) {
    logError('listIcalSources', err, { productId: req.params.id });
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * DELETE /api/marketplace/imoveis/ical-sources/:sourceId
 * Autenticado — host remove fonte iCal e bloqueios associados.
 */
async function removeIcalSource(req, res) {
  try {
    const { sourceId } = req.params;
    const userId = req.user.uid;
    const result = await icalSyncService.removeIcalSource(userId, sourceId);

    return res.json({ success: true, data: result });
  } catch (err) {
    logError('removeIcalSource', err, { sourceId: req.params.sourceId });
    const status = err.message.includes('autorizado') ? 403
      : err.message.includes('nao encontrada') ? 404
      : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/marketplace/imoveis/ical-sources/:sourceId/sync
 * Autenticado — host dispara sync manual de uma fonte iCal.
 */
async function syncIcalSource(req, res) {
  try {
    const { sourceId } = req.params;
    const userId = req.user.uid;

    // syncSingleSource usa sbService (bypass RLS), entao precisamos
    // verificar ownership aqui antes de permitir o sync manual.
    // Backend sb() tambem usa service_role, portanto verificacao manual.
    const { getSupabaseClient } = require('../config/supabase');
    const sbClient = getSupabaseClient();

    // Buscar a fonte e verificar que o seller_id pertence ao usuario
    const { data: source } = await sbClient
      .from('property_ical_sources')
      .select('id, seller_id')
      .eq('id', sourceId)
      .single();

    if (!source) {
      return res.status(404).json({ success: false, error: 'Fonte iCal nao encontrada.' });
    }

    // Resolver seller_profiles.id a partir do Firebase UID para ownership check
    const { data: sellerProfile } = await sbClient
      .from('seller_profiles')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (!sellerProfile || sellerProfile.id !== source.seller_id) {
      return res.status(403).json({ success: false, error: 'Nao autorizado a sincronizar esta fonte iCal.' });
    }

    const result = await icalSyncService.syncSingleSource(sourceId);

    return res.json({ success: true, data: result });
  } catch (err) {
    logError('syncIcalSource', err, { sourceId: req.params.sourceId });
    const status = err.message.includes('nao encontrada') ? 404
      : err.message.includes('desativada') ? 422
      : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
}

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
  getCalendarIcs,
  getExportToken,
  regenerateExportToken,
  addIcalSource,
  listIcalSources,
  removeIcalSource,
  syncIcalSource,
};
