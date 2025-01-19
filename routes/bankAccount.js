const express = require('express');
const verifyToken = require('../middlewares/auth');
const rateLimiterMiddleware = require('../middlewares/rateLimiter');
const bankAccountController = require('../controllers/bankAccountController');

const router = express.Router();

// Rota para obter contas bancárias
router.get('/:caixinhaId', verifyToken, rateLimiterMiddleware.rateLimiter, bankAccountController.getAllBankAccounts);

router.get('/:caixinhaId/history', verifyToken, rateLimiterMiddleware.rateLimiter, bankAccountController.getAccountHistory);

// Rota para criar uma nova conta bancária
router.post('/:caixinhaId/register', verifyToken, rateLimiterMiddleware.rateLimiter, bankAccountController.createBankAccount);

router.post('/:accountId/validate', verifyToken, rateLimiterMiddleware.rateLimiter, bankAccountController.activateBankAccount);

// Rota para atualizar uma conta bancária
router.put('/:id', verifyToken, rateLimiterMiddleware.rateLimiter, bankAccountController.updateBankAccount);

// Rota para ativar uma conta bancária
router.patch('/:id/activate', verifyToken, rateLimiterMiddleware.rateLimiter, bankAccountController.activateBankAccount);

// Rota para deletar uma conta bancária
router.delete('/:id', verifyToken, rateLimiterMiddleware.rateLimiter, bankAccountController.deleteBankAccount);

module.exports = router;