'use strict';

const express    = require('express');
const router     = express.Router();
const verifyToken = require('../middlewares/auth');
const ctrl = require('../controllers/propertyStayController');

// ──────────────────────────────────────────────────────
// Rotas de Temporada — Sistema de Reservas Airbnb-style
//
// Prefixo: /api/marketplace/imoveis  (registrado em routesConfig.js)
// ──────────────────────────────────────────────────────

// Rotas públicas (sem auth)
router.get('/:id/calendar.ics',         ctrl.getCalendarIcs);     // iCal export — validado por token na query
router.get('/:propertyId/availability', ctrl.getAvailability);
router.get('/:propertyId/reviews',      ctrl.getPropertyReviews);

// Rotas do hóspede
router.post('/stay',                   verifyToken, ctrl.createStay);
router.post('/stay/:id/confirm',       verifyToken, ctrl.confirmStayPayment);
router.post('/stay/:id/cancel',        verifyToken, ctrl.cancelStay);
router.post('/stay/:id/review',        verifyToken, ctrl.submitReview);
router.get('/stays/guest',             verifyToken, ctrl.getGuestStays);

// Rotas do host
router.post('/:propertyId/block',      verifyToken, ctrl.blockDates);
router.delete('/block/:blockId',       verifyToken, ctrl.unblockDates);
router.get('/stays/host',              verifyToken, ctrl.getHostStays);
router.post('/stay/:id/complete',      verifyToken, ctrl.completeStay);

// iCal — gerenciamento de token de exportação (host only)
router.get('/:id/ical-token',              verifyToken, ctrl.getExportToken);
router.post('/:id/ical-token/regenerate',  verifyToken, ctrl.regenerateExportToken);

// iCal Sync — importação de calendários externos (host only)
router.post('/:id/ical-sources',                    verifyToken, ctrl.addIcalSource);
router.get('/:id/ical-sources',                     verifyToken, ctrl.listIcalSources);
router.delete('/ical-sources/:sourceId',            verifyToken, ctrl.removeIcalSource);
router.post('/ical-sources/:sourceId/sync',         verifyToken, ctrl.syncIcalSource);

module.exports = router;
