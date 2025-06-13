const express = require('express');
const verifyToken = require('../middlewares/auth');
const { readLimit, writeLimit, bankingLimit } = require('../middlewares/rateLimiter');
const bankAccountController = require('../controllers/bankAccountController');
const paymentsController = require('../controllers/paymentsController');

const router = express.Router();

// Rota para obter contas bancárias
router.get('/:caixinhaId', verifyToken, bankingLimit, bankAccountController.getAllBankAccounts);

router.get('/:caixinhaId/history', verifyToken, bankingLimit, bankAccountController.getAccountHistory);

// Rota para criar uma nova conta bancária
router.post('/:caixinhaId/register', verifyToken, bankingLimit, bankAccountController.createBankAccount);

router.post('/:accountId/generate-validation-pix', verifyToken, bankingLimit, bankAccountController.generateValidationPix);

router.post('/:accountId/validate', verifyToken, bankingLimit, bankAccountController.validateAccount);

// Rota para atualizar uma conta bancária
router.put('/:id', verifyToken, writeLimit, bankAccountController.updateBankAccount);

// Rota para ativar uma conta bancária
router.patch('/:id/activate', verifyToken, readLimit, bankAccountController.activateBankAccount);

// Rota para deletar uma conta bancária
router.delete('/:id', verifyToken, readLimit, bankAccountController.deleteBankAccount);

// Rotas de pagamento - seguindo padrão /api/banking/payments/*
router.post('/payments/card', verifyToken, writeLimit, paymentsController.createCardPayment);
router.post('/payments/pix', verifyToken, writeLimit, paymentsController.createPixPayment);
router.get('/payments/status/:paymentId', verifyToken, readLimit, paymentsController.checkPixPaymentStatus);

module.exports = router;