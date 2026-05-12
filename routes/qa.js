const express    = require('express');
const router     = express.Router();
const qaAuth     = require('../middlewares/qaAuth');
const qaCtrl     = require('../controllers/qaController');

/**
 * QA Orchestrator routes
 *
 * Endpoints protegidos por qaAuth (requerem header x-qa-token):
 *   POST /api/qa/run          — dispara novo run de QA
 *   GET  /api/qa/runs         — lista runs recentes
 *   GET  /api/qa/runs/:runId  — detalhes de um run específico
 *
 * Endpoint público (sem auth):
 *   GET  /api/qa/health       — healthScore atual da plataforma (para status page)
 */

// Público — sem auth
router.get('/health', qaCtrl.getHealth);

// Protegidos por qaAuth
router.post('/run',          qaAuth, qaCtrl.triggerRun);
router.post('/seed-balance', qaAuth, qaCtrl.seedBalance);
router.get('/runs',          qaAuth, qaCtrl.listRuns);
router.get('/runs/:runId',   qaAuth, qaCtrl.getRunDetail);

// Autofix management
router.get('/autofix-pending',                    qaAuth, qaCtrl.listAutofixPending);
router.post('/autofix-pending/:id/approve',       qaAuth, qaCtrl.approveAutofix);
router.post('/autofix-pending/:id/refine',        qaAuth, qaCtrl.refineAutofix);
router.delete('/autofix-pending/:id',             qaAuth, qaCtrl.rejectAutofix);

// IA Cache
router.get('/interpretation-cache/:hash', qaAuth, qaCtrl.getInterpretationCache);

// Notification Jobs
router.get('/notification-jobs', qaAuth, qaCtrl.listNotificationJobs);

// SRE Telemetry & Self-Healing logs
router.get('/sre-logs', qaAuth, qaCtrl.getSreLogs);

module.exports = router;
