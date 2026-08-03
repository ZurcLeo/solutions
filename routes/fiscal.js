'use strict';

const express = require('express');
const router  = express.Router();
const verifyToken = require('../middlewares/auth');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { healthCheck } = require('../middlewares/healthMiddleware');
const { requireSellerTeamAccess } = require('../middlewares/requireSellerTeamAccess');
const { upload } = require('../middlewares/upload.cjs');
const ctrl = require('../controllers/fiscalController');
const { logger } = require('../logger');

const ROUTE_NAME = 'fiscal';
router.use(healthCheck(ROUTE_NAME));

router.use((req, res, next) => {
  logger.info(`[ROUTE] ${ROUTE_NAME}`, { method: req.method, path: req.path });
  next();
});

// ──────────────────────────────────────────────────────
// Busca de usuário (para vincular cliente)
// GET /api/fiscal/users/search?email=...
// ──────────────────────────────────────────────────────
router.get('/users/search', verifyToken, readLimit, ctrl.searchUser);

// ──────────────────────────────────────────────────────
// Carteira de clientes (seller team, min: employee)
// ──────────────────────────────────────────────────────
router.get('/clients',              verifyToken, requireSellerTeamAccess('employee'), readLimit,  ctrl.listClients);
router.post('/clients',             verifyToken, requireSellerTeamAccess('employee'), writeLimit, ctrl.createClient);
router.get('/clients/:clientId',    verifyToken, requireSellerTeamAccess('employee'), readLimit,  ctrl.getClient);
router.patch('/clients/:clientId',  verifyToken, requireSellerTeamAccess('employee'), writeLimit, ctrl.updateClient);
router.delete('/clients/:clientId', verifyToken, requireSellerTeamAccess('employee'), writeLimit, ctrl.archiveClient);

// ──────────────────────────────────────────────────────
// Pendências (seller team)
// ──────────────────────────────────────────────────────
router.get('/clients/:clientId/pendencias',  verifyToken, requireSellerTeamAccess('employee'), readLimit,  ctrl.listClientPendencias);
router.post('/clients/:clientId/pendencias', verifyToken, requireSellerTeamAccess('employee'), writeLimit, ctrl.createPendencia);
router.get('/pendencias',                    verifyToken, requireSellerTeamAccess('employee'), readLimit,  ctrl.listAllPendencias);
router.patch('/pendencias/:id',              verifyToken, requireSellerTeamAccess('employee'), writeLimit, ctrl.updatePendencia);
router.post('/pendencias/:id/concluir',      verifyToken, requireSellerTeamAccess('employee'), writeLimit, ctrl.resolvePendencia);
router.get('/pendencias/:id/historico',      verifyToken, requireSellerTeamAccess('employee'), readLimit,  ctrl.getPendenciaHistorico);

// ──────────────────────────────────────────────────────
// Painel do cliente (D3) — auth como cliente
// ──────────────────────────────────────────────────────
router.get('/my-pendencias', verifyToken, readLimit, ctrl.getMyPendencias);

// ──────────────────────────────────────────────────────
// Attachments
// ──────────────────────────────────────────────────────
router.post('/bookings/:bookingId/attachments',   verifyToken, writeLimit, upload.single('file'), ctrl.uploadAttachment);
router.get('/bookings/:bookingId/attachments',     verifyToken, readLimit,  ctrl.listAttachments);
router.delete('/attachments/:attachmentId',        verifyToken, writeLimit, ctrl.deleteAttachment);
router.get('/attachments/:attachmentId/url',       verifyToken, readLimit,  ctrl.getAttachmentUrl);

module.exports = router;
