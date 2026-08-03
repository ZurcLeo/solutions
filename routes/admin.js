const express = require('express');
const router  = express.Router();
const adminController     = require('../controllers/adminController');
const stickerAdminController = require('../controllers/stickerAdminController');
const seloAdminController = require('../controllers/seloAdminController');
const kycAdminController  = require('../controllers/kycAdminController');
const endorsementAdminController = require('../controllers/endorsementAdminController');
const deliveryAdminController = require('../controllers/deliveryAdminController');
const suspensionController   = require('../controllers/suspensionController');
const webhookAdminController = require('../controllers/webhookAdminController');
const marketplaceAdminController = require('../controllers/marketplaceAdminController');
const caronaAdminController = require('../controllers/caronaAdminController');
const { _runOnce: runIcalSync } = require('../config/jobs/icalSyncJob');
const verifyToken         = require('../middlewares/auth');
const { checkPermission, checkRole } = require('../middlewares/rbac');
const { readLimit, writeLimit }  = require('../middlewares/rateLimiter');
const { upload } = require('../middlewares/upload.cjs');

router.use(verifyToken);

const requireAdmin = checkRole('admin');

// --- Admin Unified Search (ADM-002b) ---
const adminSearchController = require('../controllers/adminSearchController');
router.get('/search', readLimit, requireAdmin, adminSearchController.unifiedSearch);

// --- Admin User Search & Detail ---
const adminUserController = require('../controllers/adminUserController');
router.get('/users/search', readLimit, requireAdmin, adminUserController.searchUsers);
router.get('/users/:userId/detail', readLimit, requireAdmin, adminUserController.getUserDetail);

// PATCH /api/admin/users/:userId/moderation
// Requer permissão de gerenciamento de tickets (inclui admins)
router.patch(
  '/users/:userId/moderation',
  writeLimit,
  checkPermission('support:manage_tickets'),
  adminController.applyUserModeration
);

// --- Admin Stickers Routes ---

// Criar sticker
router.post(
  '/stickers',
  writeLimit,
  requireAdmin,
  stickerAdminController.createSticker
);

// Editar sticker
router.patch(
  '/stickers/:id',
  writeLimit,
  requireAdmin,
  stickerAdminController.updateSticker
);

// Ativar/Desativar sticker
router.patch(
  '/stickers/:id/toggle',
  writeLimit,
  requireAdmin,
  stickerAdminController.toggleSticker
);

// Upload imagem do sticker
router.post(
  '/stickers/:id/image',
  writeLimit,
  requireAdmin,
  upload.single('image'),
  stickerAdminController.uploadImage
);

// --- Admin Selos Routes ---

// Listar catálogo completo (com inativos)
router.get(
  '/selos',
  readLimit,
  requireAdmin,
  seloAdminController.getAllSelos
);

// Criar novo selo
router.post(
  '/selos',
  writeLimit,
  requireAdmin,
  seloAdminController.createSelo
);

// Editar selo
router.patch(
  '/selos/:id',
  writeLimit,
  requireAdmin,
  seloAdminController.updateSelo
);

// Ativar/Desativar selo
router.patch(
  '/selos/:id/toggle',
  writeLimit,
  requireAdmin,
  seloAdminController.toggleSelo
);

// Upload ícone do selo
router.post(
  '/selos/:id/image',
  writeLimit,
  requireAdmin,
  upload.single('image'),
  seloAdminController.uploadImage
);

// Listar portadores de um selo (paginado)
router.get(
  '/selos/:id/holders',
  readLimit,
  requireAdmin,
  seloAdminController.getSeloHolders
);

// Conceder selo manualmente a um usuário
router.post(
  '/users/:userId/selos',
  writeLimit,
  requireAdmin,
  seloAdminController.grantSeloToUser
);

// Revogar selo de um usuário (:seloId = user_selos.id)
router.delete(
  '/users/:userId/selos/:seloId',
  writeLimit,
  requireAdmin,
  seloAdminController.revokeSeloFromUser
);

// --- Admin KYC Routes ---

// Listar verificações KYC aguardando aprovação manual
router.get(
  '/kyc/pending',
  readLimit,
  requireAdmin,
  kycAdminController.getPending
);

// Aprovar verificação KYC
router.post(
  '/kyc/:verificationId/approve',
  writeLimit,
  requireAdmin,
  kycAdminController.approve
);

// Rejeitar verificação KYC (com motivo)
router.post(
  '/kyc/:verificationId/reject',
  writeLimit,
  requireAdmin,
  kycAdminController.reject
);

// Obter signed URLs de mídia para verificação de documento KYC (1h TTL)
router.get(
  '/kyc/:verificationId/media',
  readLimit,
  requireAdmin,
  kycAdminController.getMedia
);

// --- Admin Endorsement Routes ---

// Buscar usuários para endorsar
router.get(
  '/endorsements/search',
  readLimit,
  requireAdmin,
  endorsementAdminController.searchUsers
);

// Listar endorsements ativos (Claude Suporte)
router.get(
  '/endorsements',
  readLimit,
  requireAdmin,
  endorsementAdminController.listEndorsements
);

// Endorsar usuário (via Claude Suporte)
router.post(
  '/endorsements',
  writeLimit,
  requireAdmin,
  endorsementAdminController.endorseUser
);

// Revogar endorsement
router.post(
  '/endorsements/:id/revoke',
  writeLimit,
  requireAdmin,
  endorsementAdminController.revokeEndorsement
);

// --- Admin Delivery Routes ---

// Listar delivery requests travados (hold_manual, failed_no_deliverer, no_deliverer_found)
router.get(
  '/delivery/stuck',
  readLimit,
  requireAdmin,
  deliveryAdminController.listStuck
);

// Detalhes de um delivery request específico
router.get(
  '/delivery/:requestId',
  readLimit,
  requireAdmin,
  deliveryAdminController.getDetail
);

// Admin resolve delivery request (cancel/retry)
router.post(
  '/delivery/:requestId/resolve',
  writeLimit,
  requireAdmin,
  deliveryAdminController.resolve
);

// Admin resolve pagamento de ajuste de frete
router.post(
  '/delivery/:requestId/resolve-payment',
  writeLimit,
  requireAdmin,
  deliveryAdminController.resolvePayment
);

// --- Admin Suspension Routes ---

// Suspender usuário
router.post(
  '/suspensions/users',
  writeLimit,
  requireAdmin,
  suspensionController.suspendUser
);

// Levantar suspensão de usuário
router.post(
  '/suspensions/users/:suspensionId/lift',
  writeLimit,
  requireAdmin,
  suspensionController.liftSuspension
);

// Listar suspensões de usuários (paginada)
router.get(
  '/suspensions/users',
  readLimit,
  requireAdmin,
  suspensionController.listSuspensions
);

// Histórico de suspensões de um usuário
router.get(
  '/suspensions/users/:userId/history',
  readLimit,
  requireAdmin,
  suspensionController.getUserHistory
);

// Suspender seller
router.post(
  '/suspensions/sellers',
  writeLimit,
  requireAdmin,
  suspensionController.suspendSeller
);

// Reativar seller suspenso
router.post(
  '/suspensions/sellers/:sellerId/reactivate',
  writeLimit,
  requireAdmin,
  suspensionController.reactivateSeller
);

// Listar sellers suspensos
router.get(
  '/suspensions/sellers',
  readLimit,
  requireAdmin,
  suspensionController.listSuspendedSellers
);

// --- Admin Webhook DLQ + Subscriptions ---

// Stats de delivery (count por status)
router.get(
  '/webhooks/stats',
  readLimit,
  requireAdmin,
  webhookAdminController.getWebhookStats
);

// Listar webhooks abandonados (DLQ)
router.get(
  '/webhooks/abandoned',
  readLimit,
  requireAdmin,
  webhookAdminController.listAbandoned
);

// Replay webhook abandonado
router.post(
  '/webhooks/:deliveryLogId/replay',
  writeLimit,
  requireAdmin,
  webhookAdminController.replayEvent
);

// Criar subscription (provisioning)
router.post(
  '/webhooks/subscriptions',
  writeLimit,
  requireAdmin,
  webhookAdminController.createSubscription
);

// Listar subscriptions
router.get(
  '/webhooks/subscriptions',
  readLimit,
  requireAdmin,
  webhookAdminController.listSubscriptions
);

// Admin confirma configuração no IconChat (ativa a integração)
router.patch(
  '/webhooks/subscriptions/:id/confirm',
  writeLimit,
  requireAdmin,
  webhookAdminController.confirmSubscription
);

// Toggle subscription ativa/inativa
router.patch(
  '/webhooks/subscriptions/:id/toggle',
  writeLimit,
  requireAdmin,
  webhookAdminController.toggleSubscription
);

// Retry franchise setup (billing enforcement) for a subscription
router.post(
  '/webhooks/subscriptions/:id/retry-franchise',
  writeLimit,
  requireAdmin,
  webhookAdminController.retryFranchise
);

// --- Admin Marketplace Orders ---

// Listar pedidos parados (>24h sem progresso)
router.get(
  '/marketplace/orders',
  readLimit,
  requireAdmin,
  marketplaceAdminController.listStuckOrders
);

// Cancelar pedido parado
router.post(
  '/marketplace/orders/:orderId/cancel',
  writeLimit,
  requireAdmin,
  marketplaceAdminController.cancelOrder
);

// --- Admin iCal Sync ---

// POST /api/admin/ical-sync/run — trigger manual de sync de calendarios iCal
router.post(
  '/ical-sync/run',
  writeLimit,
  requireAdmin,
  async (req, res) => {
    try {
      const result = await runIcalSync();
      return res.json({ success: true, data: result });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

// --- Admin Integration Tests ---
const adminTestController = require('../controllers/adminTestController');

// ML Test Users
router.post(  '/tests/ml/test-user',             writeLimit, requireAdmin, adminTestController.createMlTestUser);
router.get(   '/tests/ml/test-users',             readLimit,  requireAdmin, adminTestController.listMlTestUsers);
router.patch( '/tests/ml/test-users/:id/expire',  writeLimit, requireAdmin, adminTestController.expireMlTestUser);
router.get(   '/tests/ml/connected-sellers',      readLimit,  requireAdmin, adminTestController.listConnectedSellers);
router.get(   '/tests/ml/auth-url',              readLimit,  requireAdmin, adminTestController.getMlAdminAuthUrl);
router.post(  '/tests/ml/exchange-token',         writeLimit, requireAdmin, adminTestController.exchangeMlToken);

// IconChat Test Utilities
router.post(  '/tests/iconchat/hmac',             writeLimit, requireAdmin, adminTestController.generateIconChatHmac);
router.get(   '/tests/iconchat/action-log',       readLimit,  requireAdmin, adminTestController.getIconChatActionLog);
router.get(   '/tests/iconchat/webhook-log',      readLimit,  requireAdmin, adminTestController.getWebhookDeliveryLog);

// Melhor Envio Test Utilities
router.post(  '/tests/melhorenvio/quote',          writeLimit, requireAdmin, adminTestController.getMelhorEnvioQuote);
router.get(   '/tests/melhorenvio/app-settings',   readLimit,  requireAdmin, adminTestController.getMelhorEnvioAppSettings);
router.get(   '/tests/melhorenvio/balance',        readLimit,  requireAdmin, adminTestController.getMelhorEnvioBalance);
router.post(  '/tests/melhorenvio/test-cart',       writeLimit, requireAdmin, adminTestController.testMelhorEnvioCart);
router.get(   '/tests/melhorenvio/stores',          readLimit,  requireAdmin, adminTestController.listMelhorEnvioStores);
router.post(  '/tests/melhorenvio/store',           writeLimit, requireAdmin, adminTestController.registerMelhorEnvioStore);

// --- Admin Negócios (Sellers / Plans / Exemptions) ---
const businessAdminController = require('../controllers/businessAdminController');

router.get('/negocios/sellers', readLimit, requireAdmin, businessAdminController.listSellers);
router.get('/negocios/sellers/:id', readLimit, requireAdmin, businessAdminController.getSellerDetail);
router.patch('/negocios/sellers/:id/commission', writeLimit, requireAdmin, businessAdminController.updateCommission);
router.patch('/negocios/sellers/:id/plan', writeLimit, requireAdmin, businessAdminController.assignPlan);
router.get('/negocios/plans', readLimit, requireAdmin, businessAdminController.listPlans);
router.post('/negocios/plans', writeLimit, requireAdmin, businessAdminController.createPlan);
router.patch('/negocios/plans/:slug', writeLimit, requireAdmin, businessAdminController.updatePlan);
router.patch('/negocios/plans/:slug/toggle', writeLimit, requireAdmin, businessAdminController.togglePlan);
router.get('/negocios/exemptions', readLimit, requireAdmin, businessAdminController.listExemptions);
router.post('/negocios/exemptions', writeLimit, requireAdmin, businessAdminController.createExemption);
router.patch('/negocios/exemptions/:id/revoke', writeLimit, requireAdmin, businessAdminController.revokeExemption);
router.get('/negocios/addons', readLimit, requireAdmin, businessAdminController.listAddons);
router.post('/negocios/addons', writeLimit, requireAdmin, businessAdminController.activateAddon);
router.patch('/negocios/addons/:id', writeLimit, requireAdmin, businessAdminController.updateAddon);
router.patch('/negocios/addons/:id/deactivate', writeLimit, requireAdmin, businessAdminController.deactivateAddon);

// --- Admin Communications (Notificações, Emails, OTP) ---
const adminCommController = require('../controllers/adminCommunicationsController');

router.get('/communications/stats',                    readLimit,  requireAdmin, adminCommController.getStats);
router.get('/communications/report',                   readLimit,  requireAdmin, adminCommController.getReport);
router.get('/communications/notifications',            readLimit,  requireAdmin, adminCommController.listNotifications);
router.get('/communications/notifications/:id/preview', readLimit, requireAdmin, adminCommController.previewNotification);
router.get('/communications/emails',                   readLimit,  requireAdmin, adminCommController.listEmails);
router.get('/communications/emails/:id/preview',       readLimit,  requireAdmin, adminCommController.previewEmail);
router.get('/communications/otps',                     readLimit,  requireAdmin, adminCommController.listOtps);
router.post('/communications/emit-notification',       writeLimit, requireAdmin, adminCommController.emitNotification);
router.post('/communications/emit-email',              writeLimit, requireAdmin, adminCommController.emitEmail);

// --- Admin Operations Panel (Kanban, Metrics, Notifications) ---
const opsController = require('../controllers/opsController');

// Stages
router.get(   '/ops/stages',             readLimit,  requireAdmin, opsController.listStages);
router.post(  '/ops/stages',             writeLimit, requireAdmin, opsController.createStage);
router.patch( '/ops/stages/:id',         writeLimit, requireAdmin, opsController.updateStage);
router.delete('/ops/stages/:id',         writeLimit, requireAdmin, opsController.deleteStage);

// Tasks
router.get(   '/ops/tasks',              readLimit,  requireAdmin, opsController.listTasks);
router.get(   '/ops/tasks/:id',          readLimit,  requireAdmin, opsController.getTask);
router.post(  '/ops/tasks',              writeLimit, requireAdmin, opsController.createTask);
router.patch( '/ops/tasks/:id',          writeLimit, requireAdmin, opsController.updateTask);
router.patch( '/ops/tasks/:id/move',     writeLimit, requireAdmin, opsController.moveTask);
router.patch( '/ops/tasks/:id/assign',   writeLimit, requireAdmin, opsController.assignTask);
router.post(  '/ops/tasks/:id/comments', writeLimit, requireAdmin, opsController.addComment);
router.patch( '/ops/tasks/:id/archive',  writeLimit, requireAdmin, opsController.archiveTask);
router.patch( '/ops/tasks/:id/unarchive',writeLimit, requireAdmin, opsController.unarchiveTask);
router.get(   '/ops/tasks/:id/activity', readLimit,  requireAdmin, opsController.getActivityLog);

// Task Links
router.post(  '/ops/tasks/:id/links',          writeLimit, requireAdmin, opsController.addTaskLink);
router.get(   '/ops/tasks/:id/links',          readLimit,  requireAdmin, opsController.getTaskLinks);
router.delete('/ops/tasks/:id/links/:linkId',  writeLimit, requireAdmin, opsController.removeTaskLink);

// Ticket Search (for linking)
router.get(   '/ops/tickets/search',            readLimit,  requireAdmin, opsController.searchTickets);

// Metrics
router.get(   '/ops/metrics/live',                readLimit, requireAdmin, opsController.getLiveMetrics);
router.get(   '/ops/metrics/history',             readLimit, requireAdmin, opsController.getMetricsHistory);
router.get(   '/ops/metrics/seller/:sellerId',    readLimit, requireAdmin, opsController.getSellerMetrics);

// Notification channels
router.get(   '/ops/notifications',               readLimit,  requireAdmin, opsController.listNotifChannels);
router.post(  '/ops/notifications',               writeLimit, requireAdmin, opsController.createNotifChannel);
router.patch( '/ops/notifications/:id/toggle',    writeLimit, requireAdmin, opsController.toggleNotifChannel);
router.post(  '/ops/notifications/:id/test',     writeLimit, requireAdmin, opsController.testNotifChannel);

// Agent presence (REST fallback — primary source is Socket.IO)
router.get(   '/ops/agents/presence',             readLimit,  requireAdmin, opsController.getAgentPresence);

// Substages
router.get(   '/ops/stages/:stageId/substages',   readLimit,  requireAdmin, opsController.listSubstages);
router.post(  '/ops/stages/:stageId/substages',   writeLimit, requireAdmin, opsController.createSubstage);
router.patch( '/ops/substages/:id',               writeLimit, requireAdmin, opsController.updateSubstage);
router.delete('/ops/substages/:id',               writeLimit, requireAdmin, opsController.deleteSubstage);

// Agenda / Timeline
router.get(   '/ops/timeline',                    readLimit,  requireAdmin, opsController.getUnifiedTimeline);
router.get(   '/ops/agenda/tasks',                readLimit,  requireAdmin, opsController.listAgendaTasks);
router.patch( '/ops/tasks/:id/reschedule',         writeLimit, requireAdmin, opsController.rescheduleTask);
router.post(  '/ops/tasks/:id/documents',          writeLimit, requireAdmin, opsController.attachDocument);
router.delete('/ops/tasks/:id/documents/:index',   writeLimit, requireAdmin, opsController.removeDocument);
router.patch( '/ops/tasks/:id/substage',           writeLimit, requireAdmin, opsController.moveSubstage);

// --- AUTH-PL-006: Password Transition (Admin) ---
const authController = require('../controllers/authController');
router.post('/auth/password-transition/start', writeLimit, requireAdmin, authController.startPasswordTransition);
router.get( '/auth/password-transition/stats', readLimit,  requireAdmin, authController.getPasswordTransitionStats);

// --- Admin IP Blacklist Management ---
const { listLocalBlacklist, removeFromLocalBlacklist } = require('../utils/securityUtils');

router.get('/blacklist', readLimit, requireAdmin, async (req, res) => {
  try {
    const entries = await listLocalBlacklist();
    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list blacklist' });
  }
});

router.delete('/blacklist/:id', writeLimit, requireAdmin, async (req, res) => {
  try {
    const removed = await removeFromLocalBlacklist(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Entry not found' });
    res.json({ success: true, message: `Removed ${req.params.id} from blacklist` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove from blacklist' });
  }
});

// --- Admin Carona (Mobilidade) ---
router.get('/carona/stats',              readLimit,  requireAdmin, caronaAdminController.getStats);
router.get('/carona/rides',              readLimit,  requireAdmin, caronaAdminController.listRides);
router.get('/carona/rides/:rideId',      readLimit,  requireAdmin, caronaAdminController.getRideDetail);
router.get('/carona/drivers',            readLimit,  requireAdmin, caronaAdminController.listDrivers);
router.post('/carona/rides/:rideId/cancel', writeLimit, requireAdmin, caronaAdminController.adminCancelRide);
router.post('/carona/rides/test',        writeLimit, requireAdmin, caronaAdminController.createTestRide);

// --- Admin Billing Events (ADM-S03) ---
const billingEventsAdminController = require('../controllers/billingEventsAdminController');

router.get('/eventos-de-cobranca',         readLimit, requireAdmin, billingEventsAdminController.listBillingEvents);
router.get('/eventos-de-cobranca/summary', readLimit, requireAdmin, billingEventsAdminController.getBillingEventsSummary);

module.exports = router;
