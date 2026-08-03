'use strict';

/**
 * Rotas de Integracao Mercado Livre — ElosCloud
 *
 * Base: /api/integrations/ml
 *
 * OAuth:
 *   GET  /api/integrations/ml/connect     — gera URL de autorizacao OAuth ML
 *   GET  /api/integrations/ml/callback    — callback do redirect ML (sem auth)
 *
 * Status:
 *   GET  /api/integrations/ml/status      — status da conexao ML do seller
 *   POST /api/integrations/ml/disconnect  — desconecta conta ML
 */

const router = require('express').Router();
const verifyToken = require('../middlewares/auth');
const { requireSellerTeamAccess } = require('../middlewares/requireSellerTeamAccess');
const { mlOAuthLimit, mlWebhookLimit, readLimit, writeLimit } = require('../middlewares/rateLimiter');
const mlCtrl = require('../controllers/mlIntegrationController');

// Rotas autenticadas (seller context obrigatorio)
router.get('/connect',    verifyToken, requireSellerTeamAccess(), mlOAuthLimit, mlCtrl.connect);
router.get('/status',     verifyToken, requireSellerTeamAccess(), readLimit, mlCtrl.getStatus);
router.post('/disconnect', verifyToken, requireSellerTeamAccess(), writeLimit, mlCtrl.disconnect);

// Sync / Catalogo ML
router.post('/import',    verifyToken, requireSellerTeamAccess(), writeLimit, mlCtrl.importCatalog);
router.get('/products',   verifyToken, requireSellerTeamAccess(), readLimit, mlCtrl.listMlProducts);

// Callback OAuth — SEM auth (redirect do ML, browser do vendedor)
router.get('/callback', mlOAuthLimit, mlCtrl.callback);

// Webhook ML — SEM auth (chamado pelo servidor do ML)
router.post('/webhook', mlWebhookLimit, mlCtrl.handleWebhook);

module.exports = router;
