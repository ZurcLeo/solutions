/**
 * @fileoverview Rotas de KYC Social Comunitário (Círculo de Confiança).
 * @module routes/kycSocial
 *
 * Base path: /api/kyc-social
 * Todas as rotas requerem autenticação (verifyToken).
 *
 * Épico: SOCIAL-KYC
 */

const express    = require('express');
const router     = express.Router();
const verifyToken    = require('../middlewares/auth');
const { isAdmin }    = require('../middlewares/admin');
const ctrl           = require('../controllers/kycSocialController');

// Autenticação obrigatória em todas as rotas
router.use(verifyToken);

// ─── Solicitações de verificação ──────────────────────────────────────────────

// Solicitar verificação social (Nível 3+ obrigatório)
router.post('/request', ctrl.requestVerification);

// Consultar a própria solicitação
router.get('/my-request', ctrl.getMyRequest);

// Ver solicitação para validação — Interface Cega (LGPD)
router.get('/requests/:requestId', ctrl.getRequestForValidation);

// Validar identidade de um vizinho (Nível 5+ obrigatório)
router.post('/requests/:requestId/validate', ctrl.validateIdentity);

// ─── Vínculo de Padrinho (Lastro do Padrinho) ─────────────────────────────────

// Romper vínculo proativamente (isenta o padrinho da penalidade de reputação)
router.post('/bonds/:protegeId/break', ctrl.breakGodfatherBond);

// ─── Admin ────────────────────────────────────────────────────────────────────

// Limpar fotos expiradas do Storage e nulificar URLs (LGPD — SOCIAL-KYC-004)
router.post('/admin/cleanup-expired-photos', isAdmin, ctrl.cleanupExpiredPhotos);

module.exports = router;
