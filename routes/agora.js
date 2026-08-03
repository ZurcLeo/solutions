'use strict';

const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/auth');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { logger } = require('../logger');
const ctrl = require('../controllers/agoraController');

const ROUTE_NAME = 'agora';

router.use((req, res, next) => {
  logger.info(`[ROUTE] ${ROUTE_NAME}`, { path: req.path, method: req.method });
  next();
});

// ── Regiões (geolocalização + admin CRUD + public read) ──
router.get('/regioes/por-cep',   verifyToken, readLimit,  ctrl.getRegiaoByCep);
router.get('/regioes/por-gps',   verifyToken, readLimit,  ctrl.getRegiaoByGps);
router.get('/regioes',           verifyToken, readLimit,  ctrl.listRegioes);
router.post('/regioes',          verifyToken, writeLimit, ctrl.createRegiao);
router.patch('/regioes/:id',     verifyToken, writeLimit, ctrl.updateRegiao);
router.get('/regioes/:id/log',   verifyToken, readLimit,  ctrl.getRegiaoLog);

// ── Classificação IA (preview antes de criar relato) ──
router.post('/classificar',      verifyToken, writeLimit, ctrl.classifyPreview);

// ── Relatos ──
router.get('/relatos',                        verifyToken, readLimit,  ctrl.listRelatos);
router.get('/relatos/:id',                    verifyToken, readLimit,  ctrl.getRelato);
router.post('/relatos',                       verifyToken, writeLimit, ctrl.createRelato);
router.post('/relatos/:id/assinar',           verifyToken, writeLimit, ctrl.signRelato);
router.get('/relatos/:id/assinei',            verifyToken, readLimit,  ctrl.hasUserSigned);
router.get('/relatos/:id/manifesto',          verifyToken, readLimit,  ctrl.getManifesto);
router.patch('/relatos/:id/encaminhamento',   verifyToken, writeLimit, ctrl.registerEncaminhamento);
router.patch('/relatos/:id/resolucao',        verifyToken, writeLimit, ctrl.registerResolucao);

// ── Moderação ──
router.get('/moderacao/fila',                 verifyToken, readLimit,  ctrl.getModerationQueue);
router.patch('/relatos/:id/moderar',          verifyToken, writeLimit, ctrl.moderateRelato);
router.patch('/relatos/:id/override',         verifyToken, writeLimit, ctrl.overrideModeration);

// ── Enquetes ──
router.get('/enquetes',                       verifyToken, readLimit,  ctrl.listEnquetes);
router.get('/enquetes/:id',                   verifyToken, readLimit,  ctrl.getEnquete);
router.post('/enquetes',                      verifyToken, writeLimit, ctrl.createEnquete);
router.post('/enquetes/:id/votar',            verifyToken, writeLimit, ctrl.voteEnquete);
router.get('/enquetes/:id/votei',             verifyToken, readLimit,  ctrl.hasVotedEnquete);
router.get('/enquetes/:id/resultados',        verifyToken, readLimit,  ctrl.getEnqueteResults);
router.patch('/enquetes/:id/encerrar',        verifyToken, writeLimit, ctrl.closeEnquete);

// ── Informativos ──
router.get('/informativos',                   verifyToken, readLimit,  ctrl.listInformativos);
router.get('/informativos/:id',               verifyToken, readLimit,  ctrl.getInformativo);
router.post('/informativos',                  verifyToken, writeLimit, ctrl.createInformativo);
router.patch('/informativos/:id/publicar',    verifyToken, writeLimit, ctrl.publishInformativo);
router.patch('/informativos/:id/arquivar',    verifyToken, writeLimit, ctrl.archiveInformativo);
router.post('/informativos/:id/votar',        verifyToken, writeLimit, ctrl.voteInformativo);
router.post('/informativos/:id/like',         verifyToken, writeLimit, ctrl.toggleInformativoLike);
router.get('/informativos/:id/liked',         verifyToken, readLimit,  ctrl.hasUserLikedInformativo);

// ── Stats/Feed ──
router.get('/stats/:regiaoId',                verifyToken, readLimit,  ctrl.getStats);
router.get('/feed/:regiaoId',                 verifyToken, readLimit,  ctrl.getFeed);

module.exports = router;
