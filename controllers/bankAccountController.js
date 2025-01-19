const BankAccount = require('../models/BankAccount');
const { checkPaymentStatus } = require('../services/paymentService');
const { logger } = require('../logger');

/**
 * Registra uma nova conta bancária para uma caixinha.
 */
exports.createBankAccount = async (req, res) => {
    const { accountNumber, bankCode,  accountHolder, pixKeyType, pixKey, accountType, bankName, agency } = req.body;
    const adminId = req.user.uid;
    const caixinhaId = req.params.caixinhaId;

  logger.info('Iniciando registro de conta bancária', {
    controller: 'BankAccountController',
    method: 'createBankAccount',
    adminId,
    caixinhaId,
  });

  if (!accountHolder || !pixKeyType || !pixKey || !accountType || !bankName || !adminId || !accountNumber || !bankCode || !agency) {
    return res.status(400).json({ message: 'Dados obrigatórios estão faltando.' });
  }

  try {
    const newAccount = await BankAccount.create({
      adminId,
      caixinhaId,
      accountNumber,
      bankCode,
      bankName,
      accountType,
      accountHolder,
      pixKeyType,
      pixKey,
      agency,
      status: 'pendente', // A conta começa como pendente até validação
    });

    logger.info('Conta bancária registrada com sucesso', {
      controller: 'BankAccountController',
      method: 'createBankAccount',
      adminId,
      caixinhaId,
      accountId: newAccount.id,
    });

    res.status(201).json({ message: 'Conta registrada com sucesso.', account: newAccount });
  } catch (error) {
    logger.error('Erro ao registrar conta bancária', {
      controller: 'BankAccountController',
      method: 'createBankAccount',
      adminId,
      caixinhaId,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({ message: 'Erro ao registrar conta.', error: error.message });
  }
};

/**
 * Valida uma conta bancária com base em uma transação PIX.
 */
exports.validateAccount = async (req, res) => {
  const { transactionId, amount } = req.body;
  const adminId = req.user.id;

  logger.info('Iniciando validação de conta bancária', {
    controller: 'BankAccountController',
    method: 'validateAccount',
    adminId,
    transactionId,
    amount,
  });

  try {
    const isValid = await checkPaymentStatus(transactionId, amount);
    if (!isValid) throw new Error('Validação falhou.');

    const updatedAccount = await BankAccount.update(
      { adminId, status: 'pendente' },
      { status: 'validada' },
      { new: true }
    );

    if (!updatedAccount) throw new Error('Conta pendente não encontrada.');

    logger.info('Conta bancária validada com sucesso', {
      controller: 'BankAccountController',
      method: 'validateAccount',
      adminId,
      accountId: updatedAccount.id,
    });

    res.status(200).json({ message: 'Conta validada com sucesso.', account: updatedAccount });
  } catch (error) {
    logger.error('Erro ao validar conta bancária', {
      controller: 'BankAccountController',
      method: 'validateAccount',
      adminId,
      transactionId,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({ message: 'Erro ao validar conta.', error: error.message });
  }
};

/**
 * Obtém o histórico de contas bancárias associadas a uma caixinha.
 */
exports.getAccountHistory = async (req, res) => {

  const { caixinhaId } = req.params;
  const adminId = req.user.uid;

  logger.info('Iniciando busca de histórico de contas bancárias', {
    controller: 'BankAccountController',
    method: 'getAccountHistory',
    adminId,
    caixinhaId,
  });

  try {
    const history = await BankAccount.find(adminId, { caixinhaId });

    logger.info('Histórico de contas bancárias recuperado com sucesso', {
      controller: 'BankAccountController',
      method: 'getAccountHistory',
      caixinhaId,
      count: history.length,
    });
    const activeAccounts = history.filter((history) => history.isActive);
    const status = activeAccounts.length > 0 ? 'validada' : 'pendente';

    res.status(200).json({
      status,
      history: history, 
    });
    } catch (error) {
    logger.error('Erro ao buscar histórico de contas bancárias', {
      controller: 'BankAccountController',
      method: 'getAccountHistory',
      caixinhaId,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({ message: 'Erro ao buscar histórico.', error: error.message });
  }
};

/**
 * Atualiza os dados de uma conta bancária existente.
 */
exports.updateBankAccount = async (req, res) => {
  const { id } = req.params;
  const { accountNumber, bankCode } = req.body;

  logger.info('Iniciando atualização de conta bancária', {
    controller: 'BankAccountController',
    method: 'updateBankAccount',
    accountId: id,
  });

  try {
    const updatedAccount = await BankAccount.findByIdAndUpdate(
      id,
      { accountNumber, bankCode, status: 'pendente' }, // Define como pendente para revalidação
      { new: true }
    );

    if (!updatedAccount) throw new Error('Conta não encontrada.');

    logger.info('Conta bancária atualizada com sucesso', {
      controller: 'BankAccountController',
      method: 'updateBankAccount',
      accountId: updatedAccount.id,
    });

    res.status(200).json({ message: 'Conta atualizada com sucesso.', account: updatedAccount });
  } catch (error) {
    logger.error('Erro ao atualizar conta bancária', {
      controller: 'BankAccountController',
      method: 'updateBankAccount',
      accountId: id,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({ message: 'Erro ao atualizar conta.', error: error.message });
  }
};

/**
 * Ativa uma conta bancária específica.
 */
exports.activateBankAccount = async (req, res) => {
  const { accountId, caixinhaId } = req.params;
  const adminId = req.user.uid;

  logger.info('Iniciando ativação de conta bancária', {
    controller: 'BankAccountController',
    method: 'activateBankAccount',
    accountId,
  });

  try {
    const activeAccount = await BankAccount.find(adminId, caixinhaId);
    if (!activeAccount) throw new Error('Conta não encontrada.');

    await BankAccount.update(adminId, accountId,
      { status: 'validada', isActive: true },
      { status: 'inativa', isActive: false }
    );

    activeAccount.status = 'ativa';
    // await activeAccount.save();

    logger.info('Conta bancária ativada com sucesso', {
      controller: 'BankAccountController',
      method: 'activateBankAccount',
      accountId,
    });

    res.status(200).json({ message: 'Conta ativada com sucesso.', account: activeAccount });
  } catch (error) {
    logger.error('Erro ao ativar conta bancária', {
      controller: 'BankAccountController',
      method: 'activateBankAccount',
      accountId,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({ message: 'Erro ao ativar conta.', error: error.message });
  }
};

/**
 * Deleta uma conta bancária pelo ID.
 */
exports.deleteBankAccount = async (req, res) => {
  const { id } = req.params;

  logger.info('Iniciando exclusão de conta bancária', {
    controller: 'BankAccountController',
    method: 'deleteBankAccount',
    accountId: id,
  });

  try {
    const deletedAccount = await BankAccount.findByIdAndDelete(id);
    if (!deletedAccount) throw new Error('Conta não encontrada.');

    logger.info('Conta bancária excluída com sucesso', {
      controller: 'BankAccountController',
      method: 'deleteBankAccount',
      accountId: deletedAccount.id,
    });

    res.status(200).json({ message: 'Conta excluída com sucesso.', account: deletedAccount });
  } catch (error) {
    logger.error('Erro ao excluir conta bancária', {
      controller: 'BankAccountController',
      method: 'deleteBankAccount',
      accountId: id,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({ message: 'Erro ao excluir conta.', error: error.message });
  }
};

/**
 * Obtém todas as contas bancárias associadas ao administrador atual.
 */
exports.getAllBankAccounts = async (req, res) => {
  const adminId = req.user.uid;

  logger.info('Iniciando busca de todas as contas bancárias', {
    controller: 'BankAccountController',
    method: 'getAllBankAccounts',
    adminId
  });

  logger.info('Chamando método find com adminId', {
    adminId,
    query: {},
  });

  try {
    const accounts = await BankAccount.find(adminId);

    logger.info('Contas bancárias recuperadas com sucesso', {
      controller: 'BankAccountController',
      method: 'getAllBankAccounts',
      adminId,
      count: accounts.length,
    });

    res.status(200).json(accounts);
  } catch (error) {
    logger.error('Erro ao buscar contas bancárias', {
      controller: 'BankAccountController',
      method: 'getAllBankAccounts',
      adminId,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({ message: 'Erro ao buscar contas.', error: error.message });
  }
};
