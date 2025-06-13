const BankAccount = require('../models/BankAccount');
const paymentService = require('../services/paymentService');
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
 * Gera PIX de validação de R$ 0,01 para validar conta bancária.
 */
exports.generateValidationPix = async (req, res) => {
  const { accountId } = req.params;
  const adminId = req.user.uid;

  logger.info('Gerando PIX de validação para conta bancária', {
    controller: 'BankAccountController',
    method: 'generateValidationPix',
    adminId,
    accountId,
    baseUrl: process.env.BASE_URL,
    action: 'GENERATE_VALIDATION_PIX_START'
  });

  try {
    // 1. Buscar a conta bancária
    const bankAccount = await BankAccount.getById(adminId, accountId, { decrypt: true });
    if (!bankAccount) {
      return res.status(404).json({ message: 'Conta bancária não encontrada.' });
    }

    if (bankAccount.status === 'validada') {
      return res.status(400).json({ message: 'Conta já está validada.' });
    }

    // 2. Gerar PIX de validação de R$ 0,01
    const pixData = await paymentService.createPixPayment(
      0.01, 
      `Validação conta bancária - ${bankAccount.bankName}`,
      {
        email: req.user.email || `${adminId}@eloscloud.com.br`,
        first_name: req.user.firstName || bankAccount.accountHolder.split(' ')[0] || 'Usuario',
        last_name: req.user.lastName || bankAccount.accountHolder.split(' ').slice(1).join(' ') || 'Eloscloud',
        identificationType: 'CPF',
        identificationNumber: req.user.cpf || req.user.document || '00000000000'
      },
      {
        // Não enviar items para PIX - apenas para cartão
        externalReference: `bank_validation_${accountId}_${Date.now()}`,
        // Webhook URL - deve ser HTTPS válida em produção
        notificationUrl: process.env.NODE_ENV === 'production' && process.env.BASE_URL ? 
          `${process.env.BASE_URL}/api/webhooks/mercadopago` : 
          'https://eloscloud.com/api/webhooks/mercadopago'
      }
    );

    logger.info('PIX de validação gerado com sucesso', {
      controller: 'BankAccountController',
      method: 'generateValidationPix',
      adminId,
      accountId,
      paymentId: pixData.id,
      action: 'VALIDATION_PIX_GENERATED'
    });

    // 3. Retornar dados do PIX para o frontend
    res.status(200).json({
      message: 'PIX de validação gerado com sucesso',
      pixData: {
        qr_code: pixData.qr_code,
        qr_code_base64: pixData.qr_code_base64,
        ticket_url: pixData.ticket_url,
        expires_at: pixData.expires_at,
        payment_id: pixData.id,
        amount: 0.01
      },
      instructions: 'Pague o PIX de R$ 0,01 e depois chame a rota /validate com o ID da transação'
    });

  } catch (error) {
    logger.error('Erro ao gerar PIX de validação', {
      controller: 'BankAccountController',
      method: 'generateValidationPix',
      adminId,
      accountId,
      error: error.message,
      stack: error.stack,
      action: 'GENERATE_VALIDATION_PIX_FAILED'
    });

    res.status(500).json({ message: 'Erro ao gerar PIX de validação.', error: error.message });
  }
};

/**
 * Valida uma conta bancária com base em uma transação PIX.
 */
exports.validateAccount = async (req, res) => {
  const { accountId, transactionId } = req.body;
  const adminId = req.user.uid;

  logger.info('Iniciando validação de conta bancária', {
    controller: 'BankAccountController',
    method: 'validateAccount',
    adminId,
    accountId,
    transactionId,
    action: 'BANK_ACCOUNT_VALIDATION_START'
  });

  try {
    // 1. Buscar a conta bancária para validar
    const bankAccount = await BankAccount.getById(adminId, accountId, { decrypt: true });
    if (!bankAccount) {
      throw new Error('Conta bancária não encontrada.');
    }

    if (bankAccount.status === 'validada') {
      return res.status(400).json({ message: 'Conta já está validada.' });
    }

    // 2. Verificar o status do pagamento no Mercado Pago
    const paymentData = await paymentService.checkPaymentStatus(transactionId);
    
    logger.info('Dados do pagamento recuperados', {
      controller: 'BankAccountController',
      method: 'validateAccount',
      paymentStatus: paymentData.status,
      paymentAmount: paymentData.transaction_amount,
      action: 'PAYMENT_DATA_RETRIEVED'
    });

    // 3. Validar se o pagamento foi aprovado
    if (paymentData.status !== 'approved') {
      throw new Error(`Pagamento não aprovado. Status: ${paymentData.status}`);
    }

    // 4. Validar se é um micropagamento de R$ 0,01
    if (paymentData.transaction_amount !== 0.01) {
      throw new Error(`Valor incorreto. Esperado: R$ 0,01, Recebido: R$ ${paymentData.transaction_amount}`);
    }

    // 5. Validar se os dados do pagador correspondem à conta bancária
    const isValidPayer = await this._validatePayerData(paymentData, bankAccount);
    if (!isValidPayer) {
      logger.warn('Dados do pagador não correspondem à conta bancária', {
        controller: 'BankAccountController',
        method: 'validateAccount',
        adminId,
        accountId,
        action: 'PAYER_VALIDATION_FAILED'
      });
      throw new Error('Os dados do pagamento não correspondem à conta bancária registrada.');
    }

    // 6. Atualizar status da conta para validada
    const updatedAccount = await BankAccount.update(adminId, accountId, {
      status: 'validada',
      validatedAt: new Date().toISOString(),
      validationPaymentId: transactionId
    });

    logger.info('Conta bancária validada com sucesso', {
      controller: 'BankAccountController',
      method: 'validateAccount',
      adminId,
      accountId,
      transactionId,
      action: 'BANK_ACCOUNT_VALIDATED'
    });

    res.status(200).json({ 
      message: 'Conta validada com sucesso.', 
      account: updatedAccount,
      validationDetails: {
        paymentId: transactionId,
        validatedAt: updatedAccount.validatedAt
      }
    });

  } catch (error) {
    logger.error('Erro ao validar conta bancária', {
      controller: 'BankAccountController',
      method: 'validateAccount',
      adminId,
      accountId,
      transactionId,
      error: error.message,
      stack: error.stack,
      action: 'BANK_ACCOUNT_VALIDATION_FAILED'
    });

    res.status(500).json({ message: 'Erro ao validar conta.', error: error.message });
  }
};

/**
 * Valida se os dados do pagador correspondem à conta bancária
 */
exports._validatePayerData = async (paymentData, bankAccount) => {
  try {
    const payerDoc = paymentData.payer?.identification?.number;
    const payerEmail = paymentData.payer?.email;
    const payerName = `${paymentData.payer?.first_name || ''} ${paymentData.payer?.last_name || ''}`.trim();
    
    // Normalizar nomes para comparação
    const normalizeString = (str) => {
      return str?.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove acentos
        .replace(/[^a-z0-9\s]/g, '') // Remove caracteres especiais
        .replace(/\s+/g, ' ') // Normaliza espaços
        .trim();
    };

    const normalizedPayerName = normalizeString(payerName);
    const normalizedAccountHolder = normalizeString(bankAccount.accountHolder);

    // Validações múltiplas para maior segurança
    let validationScore = 0;
    const validations = [];

    // 1. Validação de nome (peso 60%)
    const nameSimilarity = this._calculateSimilarity(normalizedPayerName, normalizedAccountHolder);
    if (nameSimilarity > 0.7) {
      validationScore += 60;
      validations.push(`Nome: ${Math.round(nameSimilarity * 100)}% similar`);
    }

    // 2. Validação de documento se disponível (peso 30%)
    if (payerDoc && bankAccount.holderDocument) {
      const normalizedPayerDoc = payerDoc.replace(/[^0-9]/g, '');
      const normalizedHolderDoc = bankAccount.holderDocument.replace(/[^0-9]/g, '');
      if (normalizedPayerDoc === normalizedHolderDoc) {
        validationScore += 30;
        validations.push('Documento: Válido');
      }
    }

    // 3. Validação de email se disponível (peso 10%)
    if (payerEmail && bankAccount.holderEmail) {
      if (payerEmail.toLowerCase() === bankAccount.holderEmail.toLowerCase()) {
        validationScore += 10;
        validations.push('Email: Válido');
      }
    }

    // Score mínimo: 70 pontos para aprovar
    const isValid = validationScore >= 70;
    
    logger.info('Validação de dados do pagador', {
      service: 'BankAccountController',
      method: '_validatePayerData',
      payerName: normalizedPayerName,
      accountHolder: normalizedAccountHolder,
      nameSimilarity: Math.round(nameSimilarity * 100),
      validationScore,
      validations,
      payerDoc: payerDoc ? '***' + payerDoc.slice(-4) : 'N/A',
      isValid,
      action: 'PAYER_DATA_COMPARISON'
    });

    return isValid;

  } catch (error) {
    logger.error('Erro na validação de dados do pagador', {
      service: 'BankAccountController',
      method: '_validatePayerData',
      error: error.message
    });
    return false;
  }
};

/**
 * Calcula similaridade entre duas strings usando algoritmo de Levenshtein
 */
exports._calculateSimilarity = (str1, str2) => {
  if (!str1 || !str2) return 0;
  
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1;
  
  const distance = this._levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
};

/**
 * Calcula distância de Levenshtein entre duas strings
 */
exports._levenshteinDistance = (str1, str2) => {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
};

/**
 * Obtém o histórico de contas bancárias associadas a uma caixinha.
 */
exports.getAccountHistory = async (req, res) => {

  const { caixinhaId } = req.params;
  const adminId = req.user.uid;

  logger.info('Acessando dados sensíveis de contas bancárias', {
    controller: 'BankAccountController',
    method: 'getAccountHistory',
    adminId,
    caixinhaId,
    action: 'SENSITIVE_DATA_ACCESS',
    timestamp: new Date().toISOString()
  });

  try {
    // Buscar com descriptografia automática
    const history = await BankAccount.find(adminId, { 
      caixinhaId, 
      includeDecrypted: true 
    });

    logger.info('Dados bancários descriptografados e enviados', {
      controller: 'BankAccountController',
      method: 'getAccountHistory',
      adminId,
      caixinhaId,
      count: history.length,
      action: 'DECRYPTED_DATA_SENT'
    });

    const activeAccounts = history.filter((account) => account.isActive);
    const status = activeAccounts.length > 0 ? 'validada' : 'pendente';

    res.status(200).json({
      status,
      history: history, 
    });
    } catch (error) {
    logger.error('Erro ao buscar histórico de contas bancárias', {
      controller: 'BankAccountController',
      method: 'getAccountHistory',
      adminId,
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
  const { caixinhaId } = req.params;

  logger.info('Acessando dados sensíveis de contas bancárias', {
    controller: 'BankAccountController',
    method: 'getAllBankAccounts',
    adminId,
    caixinhaId,
    action: 'SENSITIVE_DATA_ACCESS',
    timestamp: new Date().toISOString()
  });

  try {
    // Buscar com filtro por caixinha e descriptografia automática
    const accounts = await BankAccount.find(adminId, { 
      caixinhaId, 
      includeDecrypted: true 
    });

    logger.info('Dados bancários descriptografados e enviados', {
      controller: 'BankAccountController',
      method: 'getAllBankAccounts',
      adminId,
      caixinhaId,
      count: accounts.length,
      action: 'DECRYPTED_DATA_SENT'
    });

    res.status(200).json(accounts);
  } catch (error) {
    logger.error('Erro ao buscar contas bancárias', {
      controller: 'BankAccountController',
      method: 'getAllBankAccounts',
      adminId,
      caixinhaId,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({ message: 'Erro ao buscar contas.', error: error.message });
  }
};
