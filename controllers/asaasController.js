const { logger } = require('../logger');
const asaasService = require('../services/asaasService');
const ledgerService = require('../services/ledgerService');
const { getFirestore } = require('../firebaseAdmin');

/**
 * Busca cpf e telefone do usuário no Firestore.
 * A coleção é 'usuario' e os campos são 'cpf' e 'telefone'.
 * Retorna um objeto com os valores encontrados ou undefined se ausentes.
 * Nunca lança erro — em caso de falha, retorna campos vazios para não bloquear o fluxo.
 */
async function _getUserProfileFields(uid) {
  try {
    const db = getFirestore();
    const snap = await db.collection('usuario').doc(uid).get();
    if (!snap.exists) {
      logger.warn('Documento de usuário não encontrado no Firestore', {
        controller: 'AsaasController',
        method: '_getUserProfileFields',
        userId: uid
      });
      return { cpf: undefined, telefone: undefined };
    }
    const data = snap.data();
    return {
      cpf: data.cpf || undefined,
      telefone: data.telefone || undefined
    };
  } catch (err) {
    logger.warn('Falha ao buscar perfil do usuário no Firestore — prosseguindo sem cpf/telefone', {
      controller: 'AsaasController',
      method: '_getUserProfileFields',
      userId: uid,
      error: err.message
    });
    return { cpf: undefined, telefone: undefined };
  }
}

/**
 * POST /api/payments/asaas/pix
 * Cria cobrança PIX para contribuição na caixinha.
 * Body: { caixinhaId, amount, description }
 */
exports.createPixCharge = async (req, res) => {
  const { caixinhaId, amount, description } = req.body;
  const { uid, email, name } = req.user;

  if (!caixinhaId || !amount || amount <= 0) {
    return res.status(400).json({
      success: false,
      message: 'caixinhaId e amount são obrigatórios'
    });
  }

  try {
    logger.info('Iniciando cobrança PIX Asaas', {
      controller: 'AsaasController',
      method: 'createPixCharge',
      userId: uid,
      caixinhaId,
      amount
    });

    // Buscar cpf e telefone do Firestore — o JWT não carrega esses campos
    const { cpf, telefone } = await _getUserProfileFields(uid);

    // Criar/reutilizar customer no Asaas (idempotente por externalReference = userId)
    const customer = await asaasService.createCustomer({
      name: name || email,
      email,
      cpfCnpj: cpf,
      phone: telefone,
      externalReference: uid
    });

    // externalReference permite que o webhook identifique quem pagou
    const externalReference = `${caixinhaId}:${uid}`;

    const charge = await asaasService.createPixCharge({
      customerId: customer.id,
      value: Number(amount),
      description: description || 'Contribuição ElosCloud',
      externalReference
    });

    logger.info('Cobrança PIX criada com sucesso', {
      controller: 'AsaasController',
      method: 'createPixCharge',
      paymentId: charge.id,
      userId: uid,
      caixinhaId
    });

    return res.status(200).json({
      success: true,
      data: {
        paymentId: charge.id,
        pixCopiaECola: charge.pixCopiaECola,
        encodedImage: charge.encodedImage,
        txid: charge.txid,
        expiresAt: charge.expirationDate,
        status: charge.status
      }
    });
  } catch (error) {
    logger.error('Erro ao criar cobrança PIX', {
      controller: 'AsaasController',
      method: 'createPixCharge',
      userId: uid,
      caixinhaId,
      error: error.message
    });
    return res.status(500).json({
      success: false,
      message: error.message || 'Falha ao gerar cobrança PIX'
    });
  }
};

/**
 * GET /api/payments/asaas/status/:paymentId
 * Consulta status de um pagamento no Asaas.
 */
exports.getPaymentStatus = async (req, res) => {
  const { paymentId } = req.params;

  try {
    const status = await asaasService.getPaymentStatus(paymentId);
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    logger.error('Erro ao consultar status de pagamento', {
      controller: 'AsaasController',
      method: 'getPaymentStatus',
      paymentId,
      error: error.message
    });
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/payments/asaas/balance/:caixinhaId
 * Retorna saldo virtual do membro autenticado na caixinha.
 */
exports.getMemberBalance = async (req, res) => {
  const { caixinhaId } = req.params;
  const { uid } = req.user;

  try {
    const balance = await ledgerService.getMemberBalance(caixinhaId, uid);
    return res.status(200).json({ success: true, data: { balance, caixinhaId, userId: uid } });
  } catch (error) {
    logger.error('Erro ao consultar saldo', {
      controller: 'AsaasController',
      method: 'getMemberBalance',
      caixinhaId,
      userId: uid,
      error: error.message
    });
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/payments/asaas/withdrawal/request
 * Membro solicita saque — fica pendente de aprovação do admin.
 * Body: { caixinhaId, amount, pixKey, pixKeyType }
 */
exports.requestWithdrawal = async (req, res) => {
  const { caixinhaId, amount, pixKey, pixKeyType } = req.body;
  const { uid } = req.user;

  if (!caixinhaId || !amount || !pixKey) {
    return res.status(400).json({
      success: false,
      message: 'caixinhaId, amount e pixKey são obrigatórios'
    });
  }

  try {
    const result = await ledgerService.requestWithdrawal({
      caixinhaId,
      userId: uid,
      amount: Number(amount),
      pixKey,
      pixKeyType
    });

    logger.info('Solicitação de saque registrada', {
      controller: 'AsaasController',
      method: 'requestWithdrawal',
      saqueId: result.saqueId,
      userId: uid,
      caixinhaId,
      amount
    });

    return res.status(200).json({
      success: true,
      data: {
        saqueId: result.saqueId,
        message: 'Solicitação registrada. Aguardando aprovação do administrador.'
      }
    });
  } catch (error) {
    logger.error('Erro ao solicitar saque', {
      controller: 'AsaasController',
      method: 'requestWithdrawal',
      userId: uid,
      error: error.message
    });
    return res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/payments/asaas/withdrawal/approve
 * Admin aprova saque: debita ledger e executa PIX via Asaas.
 * Body: { caixinhaId, withdrawalId }
 */
exports.approveWithdrawal = async (req, res) => {
  const { caixinhaId, withdrawalId } = req.body;
  const { uid: adminId } = req.user;

  if (!caixinhaId || !withdrawalId) {
    return res.status(400).json({
      success: false,
      message: 'caixinhaId e withdrawalId são obrigatórios'
    });
  }

  try {
    const result = await ledgerService.approveWithdrawal({
      withdrawalId,
      caixinhaId,
      adminId
    });

    logger.info('Saque aprovado', {
      controller: 'AsaasController',
      method: 'approveWithdrawal',
      withdrawalId,
      transferId: result.transferId,
      adminId
    });

    return res.status(200).json({
      success: true,
      data: {
        transferId: result.transferId,
        status: result.status,
        message: 'Saque aprovado. Transferência PIX iniciada.'
      }
    });
  } catch (error) {
    logger.error('Erro ao aprovar saque', {
      controller: 'AsaasController',
      method: 'approveWithdrawal',
      withdrawalId,
      adminId,
      error: error.message
    });
    return res.status(400).json({ success: false, message: error.message });
  }
};
