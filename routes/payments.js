const express = require('express');
const router = express.Router();
const paymentsController = require('../controllers/paymentsController');
const asaasController = require('../controllers/asaasController');
const verifyToken = require('../middlewares/auth');
const { isAdmin } = require('../middlewares/admin');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { logger } = require('../logger');

// Smart Security Middleware
const {
  velocityCheck,
  deviceCheck,
  transactionAnalysis,
  riskScoring,
  securityLogging
} = require('../middlewares/smartSecurity');

const requireVerifiedAction = require('../middlewares/requireVerifiedAction');

const ROUTE_NAME = 'payments';

// Middleware de log para todas as requisições
router.use((req, res, next) => {
  logger.info(`[ROUTE] Requisição recebida em ${ROUTE_NAME}`, {
    sreContext: req.sreContext || 'no-context'
  });
  next();
});

// ─── ElosCoins (Asaas) ──────────────────────────────────────────────────────

// REMOVED: POST /elocoins (legacy path with double-credit vulnerability)
// New purchases use /api/elcoin/checkout via eloCoinController (PIX-only, with dedup)

// Consultar status de pagamento Asaas
router.get('/status/:paymentId', verifyToken, readLimit, paymentsController.getPaymentStatus);

// Compras do usuário
router.get('/purchases', verifyToken, readLimit, paymentsController.getPurchases);

// Todas as compras (admin)
router.get('/all-purchases', verifyToken, readLimit, paymentsController.getAllPurchases);

// ─── Rotas Asaas (caixinhas, subcontas, saques) ─────────────────────────────

// Admin: criar subconta Asaas por caixinha
router.post('/asaas/subconta/create/:caixinhaId',
  verifyToken, isAdmin, writeLimit, asaasController.createSubconta
);

// Criar cobrança PIX para contribuição
router.post('/asaas/pix',
  verifyToken,
  requireVerifiedAction('pagamento_pix', {
    getEntityType: () => 'payment',
    getEntityId: (req) => req.body.paymentId || null,
  }),
  deviceCheck,
  velocityCheck('pix_payment'),
  transactionAnalysis,
  riskScoring,
  (req, res, next) => {
    if (req.securityContext?.riskProfile?.riskLevel === 'HIGH' ||
        req.securityContext?.riskProfile?.riskLevel === 'CRITICAL') {
      return res.status(202).json({
        message: 'Transação requer verificação adicional',
        requiresApproval: true,
        riskLevel: req.securityContext.riskProfile.riskLevel
      });
    }
    next();
  },
  securityLogging,
  asaasController.createPixCharge
);

// Consultar status de pagamento Asaas (rota alternativa)
router.get('/asaas/status/:paymentId',
  verifyToken, readLimit, asaasController.getPaymentStatus
);

// Consultar saldo virtual do membro na caixinha
router.get('/asaas/balance/:caixinhaId',
  verifyToken, readLimit, asaasController.getMemberBalance
);

// Estimar taxa de saque
router.get('/asaas/withdrawal/estimate',
  verifyToken, readLimit, asaasController.withdrawalEstimate
);

// Solicitar saque
router.post('/asaas/withdrawal/request',
  verifyToken,
  requireVerifiedAction('saque', {
    getEntityType: () => 'caixinha',
    getEntityId: (req) => req.body.caixinhaId || null,
  }),
  writeLimit,
  asaasController.requestWithdrawal
);

// Admin aprova saque
router.post('/asaas/withdrawal/approve',
  verifyToken, isAdmin,
  requireVerifiedAction('saque', {
    getEntityType: () => 'caixinha',
    getEntityId: (req) => req.body.caixinhaId || null,
  }),
  writeLimit,
  asaasController.approveWithdrawal
);

module.exports = router;
