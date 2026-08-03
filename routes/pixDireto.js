const express = require('express');
const verifyToken = require('../middlewares/auth');
const { readLimit, writeLimit, bankingLimit } = require('../middlewares/rateLimiter');
const { receiptUpload, errorHandler } = require('../middlewares/upload.cjs');
const pixDiretoController = require('../controllers/pixDiretoController');

const router = express.Router();

// ── Escrita (contribuinte) ───────────────────────────────────────────────────

// Gerar QR PIX Direto
router.post(
  '/generate',
  verifyToken, bankingLimit,
  pixDiretoController.generatePixData
);

// Upload do comprovante
router.post(
  '/upload/:receiptId',
  verifyToken, bankingLimit, receiptUpload.single('receipt'),
  pixDiretoController.uploadReceipt
);

// ── Escrita (admin) ──────────────────────────────────────────────────────────

// Aprovar comprovante
router.post(
  '/approve/:receiptId',
  verifyToken, writeLimit,
  pixDiretoController.approveReceipt
);

// Rejeitar comprovante
router.post(
  '/reject/:receiptId',
  verifyToken, writeLimit,
  pixDiretoController.rejectReceipt
);

// Registrar pagamento em dinheiro (admin)
router.post(
  '/admin/register-cash',
  verifyToken, writeLimit,
  pixDiretoController.registerCashPayment
);

// ── Leitura ──────────────────────────────────────────────────────────────────

// Modos de pagamento disponíveis
router.get(
  '/modes/:caixinhaId',
  verifyToken, readLimit,
  pixDiretoController.getPaymentModes
);

// Lista comprovantes para admin
router.get(
  '/receipts/:caixinhaId',
  verifyToken, readLimit,
  pixDiretoController.listReceipts
);

// Comprovantes do contribuinte
router.get(
  '/my-receipts/:caixinhaId',
  verifyToken, readLimit,
  pixDiretoController.getMyReceipts
);

// Error handler do multer
router.use(errorHandler);

module.exports = router;
