const express = require('express');
const verifyToken = require('../middlewares/auth');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const bankAccountController = require('../controllers/bankAccountController');

const router = express.Router();

// Rota para obter contas bancárias
router.get('/:caixinhaId', verifyToken, readLimit, bankAccountController.getAllBankAccounts);

router.get('/:caixinhaId/history', readLimit, bankAccountController.getAccountHistory);

// Rota para criar uma nova conta bancária
router.post('/:caixinhaId/register', verifyToken, writeLimit, bankAccountController.createBankAccount);

router.post('/:accountId/validate', verifyToken, writeLimit, bankAccountController.activateBankAccount);

// Rota para atualizar uma conta bancária
router.put('/:id', verifyToken, writeLimit, bankAccountController.updateBankAccount);

// Rota para ativar uma conta bancária
router.patch('/:id/activate', verifyToken, readLimit, bankAccountController.activateBankAccount);

// Rota para deletar uma conta bancária
router.delete('/:id', verifyToken, readLimit, bankAccountController.deleteBankAccount);

module.exports = router;