const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscriptionController');
const verifyToken = require('../middlewares/auth');
const { requireSellerTeamAccess } = require('../middlewares/requireSellerTeamAccess');

/**
 * Checks can_manage_billing permission after requireSellerTeamAccess populates req.sellerContext.
 * Owners always pass (OWNER_PERMISSIONS includes can_manage_billing).
 * Team members need explicit can_manage_billing=true.
 */
const requireBillingPermission = (req, res, next) => {
  const ctx = req.sellerContext;
  if (!ctx) {
    return res.status(403).json({ code: 'SELLER_ACCESS_REQUIRED', message: 'Contexto de vendedor não encontrado.' });
  }
  if (ctx.role === 'owner') return next();
  if (ctx.permissions?.can_manage_billing === true) return next();
  return res.status(403).json({
    code: 'BILLING_PERMISSION_REQUIRED',
    message: 'Você não tem permissão para gerenciar cobranças e plano deste negócio.',
  });
};

// Catálogo de planos — público (sem auth)
router.get('/plans', subscriptionController.getPlans);

// Demais rotas exigem autenticação
router.use(verifyToken);

// Read endpoints — auth only (no billing permission needed)
router.get('/my', subscriptionController.getMy);
router.get('/recommend', subscriptionController.getRecommendation);
router.get('/billing-summary', subscriptionController.getBillingSummary);
router.get('/exemptions/my', subscriptionController.getMyExemptions);
router.get('/exemptions/sponsor', subscriptionController.getSponsorDashboard);
router.get('/addon', subscriptionController.getAddons);
router.get('/iconchat-usage', subscriptionController.getIconChatUsage);

// Mutation endpoints — require seller team access + can_manage_billing permission
router.post('/seller', requireSellerTeamAccess('employee'), requireBillingPermission, subscriptionController.createSeller);
router.patch('/billing-mode', requireSellerTeamAccess('employee'), requireBillingPermission, subscriptionController.updateBillingMode);
router.post('/cancel', requireSellerTeamAccess('employee'), requireBillingPermission, subscriptionController.cancel);
router.patch('/tier', requireSellerTeamAccess('employee'), requireBillingPermission, subscriptionController.changeTier);
router.post('/checkout', requireSellerTeamAccess('employee'), requireBillingPermission, subscriptionController.checkout);
router.post('/exemptions', subscriptionController.createExemption);
router.post('/addon', requireSellerTeamAccess('employee'), requireBillingPermission, subscriptionController.toggleAddon);

module.exports = router;
