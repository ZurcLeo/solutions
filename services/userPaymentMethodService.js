// services/userPaymentMethodService.js
const UserPaymentMethod = require('../models/UserPaymentMethod');
const BankAccount = require('../models/BankAccount');
const asaasService = require('./asaasService');
const encryptionService = require('./encryptionService');
const { getSupabaseClient } = require('../config/supabase');
const { getAuth } = require('../firebaseAdmin');
const notificationDispatcher = require('./NotificationDispatcher');
const { logger } = require('../logger');

const VALIDATABLE_PIX_TYPES = ['CPF', 'EMAIL', 'PHONE'];
const KYC_LEVELS_RANKED = ['none', 'cpf', 'document', 'full'];

async function getAll(userId) {
  logger.info('Listando métodos de pagamento', { service: 'userPaymentMethodService', userId });
  const methods = await UserPaymentMethod.getByUser(userId);

  return methods.map(m => ({
    id:          m.id,
    bankName:    m.bankName,
    bankCode:    m.bankCode,
    lastDigits:  m.lastDigits,
    isValidated: m.isValidated,
    validatedAt: m.validatedAt,
    createdAt:   m.createdAt,
    updatedAt:   m.updatedAt,
  }));
}

async function register(userId, accountData) {
  logger.info('Registrando método de pagamento', { service: 'userPaymentMethodService', userId });
  const method = await UserPaymentMethod.create(userId, accountData);

  return {
    id:          method.id,
    bankName:    method.bankName,
    bankCode:    method.bankCode,
    lastDigits:  method.lastDigits,
    isValidated: method.isValidated,
    createdAt:   method.createdAt,
  };
}

/**
 * Valida conta bancária via correspondência de chave PIX com dados verificados.
 *
 * Tipos aceitos:
 * - CPF:   chave PIX deve coincidir com CPF verificado via KYC.
 * - EMAIL: requer KYC ≥ cpf + email verificado no Firebase Auth + chave = email Firebase.
 * - PHONE: requer KYC ≥ cpf + telefone cadastrado no Firebase Auth + chave = telefone Firebase.
 *
 * Validação instantânea, sem cobrança para nenhum lado.
 * Retorna { validated: true } em caso de sucesso.
 */
async function initiateValidation(userId, methodId) {
  logger.info('Iniciando validação de método via PIX', { service: 'userPaymentMethodService', userId, methodId });

  const method = await UserPaymentMethod.getById(methodId, userId);
  if (method.isValidated) {
    throw new Error('Esta conta já está validada.');
  }

  // Descriptografa para acessar pixKey e pixKeyType
  await method.decrypt();

  if (!VALIDATABLE_PIX_TYPES.includes(method.pixKeyType)) {
    throw Object.assign(
      new Error('Tipo de chave PIX não suportado para validação automática. Use CPF, e-mail ou telefone.'),
      { status: 422 }
    );
  }

  // Todas as validações exigem KYC com pelo menos nível 'cpf'
  const supabase = getSupabaseClient();
  const { data: userRow } = await supabase
    .from('users')
    .select('cpf_encrypted, kyc_status, kyc_level')
    .eq('id', userId)
    .single();

  const kycLevel = userRow?.kyc_level || 'none';
  const kycRank = KYC_LEVELS_RANKED.indexOf(kycLevel);

  if (userRow?.kyc_status !== 'verified' || kycRank < 1) {
    throw Object.assign(
      new Error('Verificação de identidade (KYC) necessária. Conclua a verificação antes de validar a conta.'),
      { status: 422 }
    );
  }

  // Delegar para o validador específico do tipo de chave
  if (method.pixKeyType === 'CPF') {
    await _validatePixCpf(userId, method, userRow);
  } else if (method.pixKeyType === 'EMAIL') {
    await _validatePixEmail(userId, method);
  } else if (method.pixKeyType === 'PHONE') {
    await _validatePixPhone(userId, method);
  }

  await UserPaymentMethod.markValidated(methodId, userId, null);

  // Fire-and-forget: notificação de conta validada
  setImmediate(() => {
    notificationDispatcher.dispatch({
      userId,
      type:       'account_validated',
      importance: 'high',
      data:       { pixKeyType: method.pixKeyType, bankName: method.bankName },
      metadata:   { triggeredBy: 'system' },
      dedupKey:   `account_validated_${methodId}`,
    }).catch(() => {});
  });

  logger.info('Conta validada via correspondência PIX/dados verificados', {
    service: 'userPaymentMethodService', userId, methodId, pixKeyType: method.pixKeyType,
  });

  return { validated: true };
}

/**
 * Valida chave PIX do tipo CPF contra CPF verificado via KYC.
 */
async function _validatePixCpf(userId, method, userRow) {
  let kycCpf;
  try {
    if (userRow?.cpf_encrypted) {
      const parsed = typeof userRow.cpf_encrypted === 'string'
        ? JSON.parse(userRow.cpf_encrypted)
        : userRow.cpf_encrypted;
      kycCpf = String(await encryptionService.decrypt(parsed, { dataType: 'cpf', aad: userId }));
    }
  } catch (err) {
    logger.warn('Não foi possível obter CPF KYC', { service: 'userPaymentMethodService', userId, error: err.message });
  }

  if (!kycCpf) {
    throw Object.assign(
      new Error('CPF não verificado. Conclua a verificação de identidade antes de validar a conta.'),
      { status: 422 }
    );
  }

  const pixCpf = (method.pixKey || '').replace(/\D/g, '');
  const cpfKyc = kycCpf.replace(/\D/g, '');

  if (!pixCpf || pixCpf !== cpfKyc) {
    throw Object.assign(
      new Error('A chave PIX (CPF) não corresponde ao CPF verificado no sistema. Verifique a chave cadastrada.'),
      { status: 422 }
    );
  }
}

/**
 * Valida chave PIX do tipo EMAIL contra email verificado no Firebase Auth.
 */
async function _validatePixEmail(userId, method) {
  let userRecord;
  try {
    const auth = getAuth();
    userRecord = await auth.getUser(userId);
  } catch (err) {
    logger.error('Erro ao buscar dados do Firebase Auth', { service: 'userPaymentMethodService', userId, error: err.message });
    throw Object.assign(
      new Error('Não foi possível verificar seus dados. Tente novamente.'),
      { status: 500 }
    );
  }

  if (!userRecord.emailVerified) {
    throw Object.assign(
      new Error('Seu e-mail não está verificado no sistema. Verifique seu e-mail antes de usá-lo como chave PIX.'),
      { status: 422 }
    );
  }

  const pixEmail = (method.pixKey || '').trim().toLowerCase();
  const firebaseEmail = (userRecord.email || '').trim().toLowerCase();

  if (!pixEmail || pixEmail !== firebaseEmail) {
    throw Object.assign(
      new Error('A chave PIX (e-mail) não corresponde ao e-mail verificado na sua conta. Verifique a chave cadastrada.'),
      { status: 422 }
    );
  }
}

/**
 * Valida chave PIX do tipo PHONE contra telefone cadastrado no perfil do usuário (Supabase).
 */
async function _validatePixPhone(userId, method) {
  const supabase = getSupabaseClient();
  const { data: userRow } = await supabase
    .from('users')
    .select('telefone')
    .eq('id', userId)
    .single();

  const profilePhone = userRow?.telefone;

  if (!profilePhone) {
    throw Object.assign(
      new Error('Nenhum telefone cadastrado no seu perfil. Atualize seu perfil com seu telefone antes de usá-lo como chave PIX.'),
      { status: 422 }
    );
  }

  // Normaliza: remove tudo que não é dígito
  const normalizePhone = (phone) => (phone || '').replace(/\D/g, '');
  const pixPhone = normalizePhone(method.pixKey);
  const userPhone = normalizePhone(profilePhone);

  // PIX pode ter ou não código do país (+55)
  // Aceita match exato OU match ignorando o prefixo 55
  const matches = pixPhone === userPhone
    || (userPhone.startsWith('55') && pixPhone === userPhone.slice(2))
    || (pixPhone.startsWith('55') && userPhone === pixPhone.slice(2));

  if (!pixPhone || !matches) {
    throw Object.assign(
      new Error('A chave PIX (telefone) não corresponde ao telefone cadastrado no seu perfil. Verifique a chave cadastrada.'),
      { status: 422 }
    );
  }
}

/**
 * Verifica se o pagador do PIX corresponde ao titular da conta registrada.
 * Scoring: nome (70 pts se >60% similar) + CPF via pixKey (30 pts se tipo CPF).
 * Mínimo: 60 pts para aprovar.
 */
function _verifyPayer(pixTx, method) {
  const normalize = (s) =>
    (s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

  const similarity = (a, b) => {
    if (!a || !b) return 0;
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    if (longer.length === 0) return 1;
    const editDistance = (s, t) => {
      const dp = Array.from({ length: s.length + 1 }, (_, i) =>
        Array.from({ length: t.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
      );
      for (let i = 1; i <= s.length; i++)
        for (let j = 1; j <= t.length; j++)
          dp[i][j] = s[i - 1] === t[j - 1]
            ? dp[i - 1][j - 1]
            : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      return dp[s.length][t.length];
    };
    return (longer.length - editDistance(longer, shorter)) / longer.length;
  };

  let score = 0;
  const payerNorm  = normalize(pixTx.payerName);
  const holderNorm = normalize(method.accountHolder);
  const nameSim    = similarity(payerNorm, holderNorm);

  if (nameSim >= 0.60) score += 70;

  if (method.pixKeyType === 'CPF' && pixTx.payerCpfCnpj) {
    const cpfClean = (method.pixKey || '').replace(/\D/g, '');
    const payerCpf = pixTx.payerCpfCnpj.replace(/\D/g, '');
    if (cpfClean && cpfClean === payerCpf) score += 30;
  }

  logger.info('Verificação do pagador PIX', {
    service: 'userPaymentMethodService',
    payerName: payerNorm, holderName: holderNorm,
    nameSimilarity: Math.round(nameSim * 100), score,
  });

  return score >= 60;
}

/**
 * Confirma validação após recebimento do PIX pelo webhook.
 * Chamado pelo webhookController quando externalReference = "validate:*".
 */
async function confirmValidation(methodId, userId, paymentId) {
  logger.info('Confirmando validação via webhook', { service: 'userPaymentMethodService', methodId, userId, paymentId });

  const method = await UserPaymentMethod.getById(methodId, userId);
  if (method.isValidated) {
    logger.info('Método já validado — webhook duplicado ignorado', { service: 'userPaymentMethodService', methodId });
    return;
  }

  await method.decrypt();

  // Busca dados da transação PIX para verificar o pagador
  let pixTx = null;
  try {
    pixTx = await asaasService.getPixTransaction(paymentId);
  } catch (err) {
    logger.warn('Não foi possível buscar dados da transação PIX — validando sem verificação do pagador', {
      service: 'userPaymentMethodService', paymentId, error: err.message,
    });
  }

  if (pixTx && !_verifyPayer(pixTx, method)) {
    logger.warn('Dados do pagador PIX não correspondem ao titular cadastrado', {
      service: 'userPaymentMethodService', methodId, userId,
    });
    throw new Error('Dados do pagador não correspondem ao titular da conta registrada.');
  }

  await UserPaymentMethod.markValidated(methodId, userId, paymentId);

  // Fire-and-forget: notificação de conta validada via webhook
  setImmediate(() => {
    notificationDispatcher.dispatch({
      userId,
      type:       'account_validated',
      importance: 'high',
      data:       { validatedVia: 'pix_webhook' },
      metadata:   { triggeredBy: 'system' },
      dedupKey:   `account_validated_${methodId}`,
    }).catch(() => {});
  });

  logger.info('Conta bancária global validada com sucesso', {
    service: 'userPaymentMethodService', methodId, userId, paymentId,
  });
}

async function markValidated(userId, methodId) {
  logger.info('Validando método de pagamento (manual)', { service: 'userPaymentMethodService', userId, methodId });
  const updated = await UserPaymentMethod.markValidated(methodId, userId);

  // Fire-and-forget: notificação de conta validada manualmente
  setImmediate(() => {
    notificationDispatcher.dispatch({
      userId,
      type:       'account_validated',
      importance: 'high',
      data:       { bankName: updated.bankName, validatedVia: 'manual' },
      metadata:   { triggeredBy: 'system' },
      dedupKey:   `account_validated_${methodId}`,
    }).catch(() => {});
  });

  return {
    id:          updated.id,
    bankName:    updated.bankName,
    lastDigits:  updated.lastDigits,
    isValidated: updated.isValidated,
    validatedAt: updated.validatedAt,
  };
}

async function remove(userId, methodId) {
  logger.info('Removendo método de pagamento', { service: 'userPaymentMethodService', userId, methodId });
  await UserPaymentMethod.delete(methodId, userId);
  return true;
}

async function applyToCaixinha(userId, methodId, caixinhaId) {
  logger.info('Aplicando método de pagamento à caixinha', {
    service: 'userPaymentMethodService', userId, methodId, caixinhaId,
  });

  const method = await UserPaymentMethod.getById(methodId, userId);
  await method.decrypt();

  const isValidated = method.isValidated === true;

  // Se já existe uma banking_account para este usuário+caixinha, ativa sem criar duplicata
  const existing = await BankAccount.find(userId, { caixinhaId });
  if (existing.length > 0) {
    const account = existing[existing.length - 1]; // mais recente
    if (isValidated && !account.isActive) {
      await BankAccount.update(userId, account.id, { isActive: true });
      await getSupabaseClient().from('caixinhas').update({ bank_account_active: true }).eq('id', caixinhaId);
      logger.info('BankAccount existente ativada via método validado', {
        service: 'userPaymentMethodService', userId, methodId, caixinhaId, bankAccountId: account.id,
      });
    }
    return existing[existing.length - 1];
  }

  const bankAccount = await BankAccount.create({
    adminId:       userId,
    caixinhaId,
    bankName:      method.bankName,
    bankCode:      method.bankCode,
    accountNumber: method.accountNumber,
    accountHolder: method.accountHolder,
    accountType:   method.accountType,
    pixKey:        method.pixKey,
    pixKeyType:    method.pixKeyType,
    isActive:      isValidated,
  });

  logger.info('BankAccount criada a partir de método de pagamento global', {
    service: 'userPaymentMethodService',
    userId, methodId, caixinhaId,
    bankAccountId: bankAccount.id,
    isActive: isValidated,
  });

  return bankAccount;
}

module.exports = { getAll, register, initiateValidation, confirmValidation, markValidated, remove, applyToCaixinha };
