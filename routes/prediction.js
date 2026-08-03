'use strict';

// routes/prediction.js
// BOLAO-P2 — Sub-router do modulo Bolao de Previsoes
// Montado em games.js: router.use('/:gameId/prediction', ...)
// Prefixo final: /api/games/:gameId/prediction

const express = require('express');
const router  = express.Router({ mergeParams: true });

const verifyToken = require('../middlewares/auth');
const ctrl        = require('../controllers/predictionController');

// ──────────────────────────────────────────────────────
// Eventos (CRUD + resultado + contestacao)
// IMPORTANTE: /events/batch ANTES de /events/:eventId
// ──────────────────────────────────────────────────────

router.post('/events/batch',              verifyToken, ctrl.batchCreateEvents);
router.post('/events',                    verifyToken, ctrl.createEvent);
router.get('/events',                     verifyToken, ctrl.listEvents);
router.patch('/events/:eventId',          verifyToken, ctrl.updateEvent);
router.delete('/events/:eventId',         verifyToken, ctrl.deleteEvent);
router.post('/events/:eventId/result',    verifyToken, ctrl.confirmResult);
router.post('/events/:eventId/contest',   verifyToken, ctrl.contestResult);

// ──────────────────────────────────────────────────────
// Palpites (entries)
// ──────────────────────────────────────────────────────

router.post('/entries',                   verifyToken, ctrl.submitEntry);
router.get('/entries/me',                 verifyToken, ctrl.getMyEntries);
router.get('/events/:eventId/entries',   verifyToken, ctrl.getEventEntries);

// ──────────────────────────────────────────────────────
// Ranking e Apuracao
// ──────────────────────────────────────────────────────

router.get('/ranking',                    verifyToken, ctrl.getRanking);
router.post('/apurate',                   verifyToken, ctrl.apurate);

// ──────────────────────────────────────────────────────
// P3 — Seed Copa 2026
// ──────────────────────────────────────────────────────

router.post('/seed-copa2026',             verifyToken, ctrl.seedCopa2026);

module.exports = router;
