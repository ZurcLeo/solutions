'use strict';

/**
 * routes/agenda.js — AGENDA-003: User & Seller agenda endpoints.
 *
 * Seller routes: /api/agenda/seller/*  (requireSellerTeamAccess)
 * User routes:   /api/agenda/user/*    (requireAuth)
 */

const express = require('express');
const router = express.Router();

const verifyToken = require('../middlewares/auth');
const { requireSellerTeamAccess } = require('../middlewares/requireSellerTeamAccess');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const agendaController = require('../controllers/agendaController');

// ── Seller agenda (requires seller team access) ─────────────────────────────

router.get(   '/seller/tasks',      verifyToken, requireSellerTeamAccess('employee'), readLimit,  agendaController.getSellerTasks);
router.post(  '/seller/tasks',      verifyToken, requireSellerTeamAccess('manager'),  writeLimit, agendaController.createSellerTask);
router.patch( '/seller/tasks/:id',  verifyToken, requireSellerTeamAccess('manager'),  writeLimit, agendaController.updateSellerTask);
router.get(   '/seller/timeline',   verifyToken, requireSellerTeamAccess('employee'), readLimit,  agendaController.getSellerTimeline);

// ── User agenda (authenticated) ─────────────────────────────────────────────

router.get(   '/user/tasks',        verifyToken, readLimit, agendaController.getMyTasks);
router.get(   '/user/timeline',     verifyToken, readLimit, agendaController.getMyTimeline);

module.exports = router;
