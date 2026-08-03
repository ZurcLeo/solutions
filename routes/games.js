'use strict';

// routes/games.js
// JOGOS-BACK-006 — Rotas do módulo de Jogos
// Prefixo registrado em routesConfig.js: /api/games

const express = require('express');
const router  = express.Router();

const verifyToken   = require('../middlewares/auth');
const ctrl          = require('../controllers/gamesController');
const contestCtrl   = require('../controllers/contestController');
const { requireGames } = require('../middlewares/requireRegulatoryApproval');

// Gate regulatorio: todas as operacoes de jogos/bolao bloqueadas ate parecer juridico
router.use(requireGames);

// ──────────────────────────────────────────────────────
// Games — CRUD + status
// Todas as rotas exigem autenticação
// ──────────────────────────────────────────────────────

router.post('/',                      verifyToken, ctrl.createGame);
router.get('/',                       verifyToken, ctrl.listMyGames);

// IMPORTANTE: rotas estáticas ANTES de /:gameId para evitar conflito de parâmetro
router.get('/my-invites',             verifyToken, ctrl.getMyGameInvites);

router.get('/:gameId',                verifyToken, ctrl.getGame);
router.patch('/:gameId',              verifyToken, ctrl.updateGame);
router.delete('/:gameId',             verifyToken, ctrl.deleteGame);
router.patch('/:gameId/cancel',       verifyToken, ctrl.cancelGame);
router.patch('/:gameId/open',         verifyToken, ctrl.openGame);
router.patch('/:gameId/close',        verifyToken, ctrl.closeGame);
router.patch('/:gameId/associate',    verifyToken, ctrl.associateCaixinha);

// ──────────────────────────────────────────────────────
// Selection List
// ──────────────────────────────────────────────────────

// IMPORTANTE: rotas de batch e :itemId/claim devem vir antes de /:itemId
// para evitar conflito de parâmetro no Express
router.get('/:gameId/items',                   verifyToken, ctrl.listItems);
router.put('/:gameId/items',                   verifyToken, ctrl.replaceItems);
router.post('/:gameId/items/batch',            verifyToken, ctrl.addItemsBatch);
router.post('/:gameId/items',                  verifyToken, ctrl.addItem);
router.get('/:gameId/items/:itemId/suggestions', verifyToken, ctrl.getItemSuggestions);
router.post('/:gameId/items/:itemId/claim',    verifyToken, ctrl.claimItem);
router.delete('/:gameId/items/:itemId/claim',  verifyToken, ctrl.unclaimItem);

// ──────────────────────────────────────────────────────
// Secret Friend / Sorteio
// ──────────────────────────────────────────────────────

router.post('/:gameId/draw',                              verifyToken, ctrl.drawGame);
router.get('/:gameId/pair',                               verifyToken, ctrl.revealMyPair);
router.post('/:gameId/gift-proposal',                     verifyToken, ctrl.proposeGiftValue);
router.patch('/:gameId/gift-proposal/:targetUserId',      verifyToken, ctrl.respondGiftProposal);

// ──────────────────────────────────────────────────────
// Rifa (RAFFLE) — bilhetes
// JOGOS-BACK-003
// ──────────────────────────────────────────────────────

// IMPORTANTE: rotas estáticas (/initialize, /mine) antes de rotas dinâmicas (/buy)
router.post('/:gameId/raffle/initialize',      verifyToken, ctrl.initializeRaffleTickets);
router.post('/:gameId/raffle/tickets/buy',     verifyToken, ctrl.buyRaffleTicket);
router.get('/:gameId/raffle/tickets/mine',     verifyToken, ctrl.getMyRaffleTickets);
router.get('/:gameId/raffle/tickets',          verifyToken, ctrl.getRaffleTickets);

// ──────────────────────────────────────────────────────
// Bolao de Previsoes (PREDICTION) — BOLAO-P2
// ──────────────────────────────────────────────────────

router.use('/:gameId/prediction', require('./prediction'));

// ──────────────────────────────────────────────────────
// Concursos Colaborativos (CHALLENGE game_type)
// CONTEST-BACK-002
// ──────────────────────────────────────────────────────

// IMPORTANTE: rotas estáticas (/teams/:teamId/...) ANTES de /:gameId para evitar conflito
router.post('/teams/:teamId/join',                        verifyToken, contestCtrl.joinTeam);
router.delete('/teams/:teamId/leave',                     verifyToken, contestCtrl.leaveTeam);
router.get('/teams/:teamId',                              verifyToken, contestCtrl.getTeamDetails);
router.post('/challenges/:challengeId/submit',            verifyToken, contestCtrl.submitProof);
router.patch('/submissions/:submissionId/review',         verifyToken, contestCtrl.reviewSubmission);

router.post('/:gameId/teams',                             verifyToken, contestCtrl.createTeam);
router.get('/:gameId/teams',                              verifyToken, contestCtrl.listTeams);
router.post('/:gameId/challenges',                        verifyToken, contestCtrl.createChallenge);
router.get('/:gameId/challenges',                         verifyToken, contestCtrl.getContestChallenges);
router.get('/:gameId/submissions/pending',                verifyToken, contestCtrl.getPendingSubmissions);
router.get('/:gameId/leaderboard',                        verifyToken, contestCtrl.getLeaderboard);
router.post('/:gameId/leaderboard/refresh',               verifyToken, contestCtrl.refreshLeaderboard);

// ──────────────────────────────────────────────────────
// Participantes — convites
// ──────────────────────────────────────────────────────

router.post('/:gameId/invite-caixinha',                   verifyToken, ctrl.inviteCaixinhaMembers);
router.post('/:gameId/invites',                         verifyToken, ctrl.inviteParticipant);
router.post('/:gameId/respond-invite',                  verifyToken, ctrl.respondToGameInvite);
router.get('/:gameId/participants',                     verifyToken, ctrl.getParticipants);
router.post('/:gameId/leave',                           verifyToken, ctrl.leaveGame);
router.delete('/:gameId/participants/:targetUserId',    verifyToken, ctrl.removeParticipant);

module.exports = router;
