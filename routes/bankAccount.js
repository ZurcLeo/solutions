const express = require('express');
const verifyToken = require('../middlewares/auth');
const { readLimit, writeLimit, bankingLimit } = require('../middlewares/rateLimiter');
const bankAccountController = require('../controllers/bankAccountController');
const {
  validateCreateBankAccount,
  validateUpdateBankAccount,
  validateQueryBankAccount
} = require('../schemas/bankAccountSchema');
const requireVerifiedAction = require('../middlewares/requireVerifiedAction');
const { securityLogging } = require('../middlewares/smartSecurity');

const router = express.Router();

// Rota para obter contas bancárias
router.get('/:caixinhaId', verifyToken, bankingLimit, validateQueryBankAccount, bankAccountController.getAllBankAccounts);

router.get('/:caixinhaId/history', verifyToken, bankingLimit, bankAccountController.getAccountHistory);

// Rota para criar uma nova conta bancária
router.post('/:caixinhaId/register', verifyToken, bankingLimit, validateCreateBankAccount, bankAccountController.createBankAccount);

router.post('/:accountId/generate-validation-pix', verifyToken, bankingLimit, bankAccountController.generateValidationPix);

router.post('/:accountId/validate', verifyToken, bankingLimit, bankAccountController.validateAccount);

// Rota para atualizar uma conta bancária
router.put('/:id', verifyToken, writeLimit, validateUpdateBankAccount, bankAccountController.updateBankAccount);

// Rota para ativar uma conta bancária
router.patch('/:id/activate', verifyToken, readLimit, bankAccountController.activateBankAccount);

// Rota para deletar uma conta bancária
router.delete('/:id', verifyToken, readLimit, bankAccountController.deleteBankAccount);

// GAP-001: Transferência interna de saldo entre membros da caixinha
router.post('/transfer',
  verifyToken,
  requireVerifiedAction('pagamento_pix', {
    getEntityType: () => 'payment',
    getEntityId: (req) => req.body.caixinhaId || null,
  }),
  writeLimit,
  securityLogging,
  bankAccountController.transferFunds
);

// GAP-002: Cancelar transação pendente
router.post('/transaction/:id/cancel',
  verifyToken,
  writeLimit,
  bankAccountController.cancelTransaction
);

// Aplica método de pagamento global do usuário a uma caixinha
const userPaymentMethodController = require('../controllers/userPaymentMethodController');
router.post('/:caixinhaId/apply-user-method/:methodId', verifyToken, bankingLimit, userPaymentMethodController.applyToCaixinha);

module.exports = router;