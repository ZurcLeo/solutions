const { logger } = require('../logger');
// PAY-ARCH: acessar via factory para permitir troca de provedor sem alterar este controller
const { getProvider } = require('../services/providers/paymentProviderFactory');
const asaasService = getProvider();          // alias semântico — ainda é o AsaasProvider hoje
const ledgerService = require('../services/ledgerService');
const caixinhaService = require('../services/caixinhaService');
const { getSupabaseClient } = require('../config/supabase');
const { getFirestore } = require('../firebaseAdmin');

/**
 * Gera txid único para cobrança PIX conforme padrão BACEN (máx 35 chars, [A-Za-z0-9]).
 * Formato: ELO + 8charsGaixinha + 8charsUser + 6charsTimestamp + 2charsRandom = 27 chars.
 * Anti-colisão: sufixo aleatório de 2 dígitos (100 valores possíveis por milissegundo).
 */
function buildTxid(caixinhaId, userId) {
  const cPart = caixinhaId.replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  const uPart = userId.replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  const tPart = Date.now().toString().slice(-6);
  const rPart = Math.floor(Math.random() * 100).toString().padStart(2, '0');
  const txid = `ELO${cPart}${uPart}${tPart}${rPart}`;
  if (txid.length > 35 || !/^[A-Za-z0-9]+$/.test(txid)) {
    throw new Error(`INVALID_TXID_FORMAT: ${txid}`);
  }
  return txid;
}

/**
 * Busca cpf e telefone do usuário.
 * Supabase-first para telefone; Firestore para cpf (plaintext não armazenado no Supabase).
 * Nunca lança erro — em caso de falha, retorna campos vazios para não bloquear o fluxo.
 */
async function _getUserProfileFields(uid) {
  try {
    let telefone;
    let cpf;

    // 1. Supabase: telefone
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data: userRow } = await supabase
        .from('users')
        .select('telefone')
        .eq('id', uid)
        .maybeSingle();
      if (userRow?.telefone) telefone = userRow.telefone;
    }

    // 2. Firestore: cpf (e telefone como fallback se Supabase miss)
    try {
      const db = getFirestore();
      const snap = await db.collection('usuario').doc(uid).get();
      if (snap.exists) {
        const data = snap.data();
        cpf = data.cpf || undefined;
        if (!telefone) telefone = data.telefone || undefined;
      }
    } catch (fsErr) {
      logger.warn('Falha ao buscar cpf no Firestore', {
        controller: 'AsaasController', method: '_getUserProfileFields', userId: uid, error: fsErr.message
      });
    }

    return { cpf, telefone };
  } catch (err) {
    logger.warn('Falha ao buscar perfil do usuário — prosseguindo sem cpf/telefone', {
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

    // Verificar subconta da caixinha — OBRIGATÓRIO para segregação de fundos (sem conta bolsão)
    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({
        success: false,
        error: 'DATABASE_UNAVAILABLE',
        message: 'Serviço temporariamente indisponível. Tente novamente.'
      });
    }

    const { data: caixRow, error: caixErr } = await supabase
      .from('caixinhas')
      .select('asaas_wallet_id, asaas_subconta_status')
      .eq('id', caixinhaId)
      .maybeSingle();

    if (caixErr) {
      logger.error('Falha ao buscar subconta da caixinha', {
        controller: 'AsaasController', method: 'createPixCharge', caixinhaId, error: caixErr.message
      });
      return res.status(503).json({
        success: false,
        error: 'DATABASE_ERROR',
        message: 'Falha ao verificar a caixinha. Tente novamente.'
      });
    }

    if (!caixRow?.asaas_wallet_id || caixRow.asaas_subconta_status !== 'active') {
      logger.warn('Contribuição bloqueada — subconta não ativa (proteção conta bolsão)', {
        controller: 'AsaasController', method: 'createPixCharge',
        caixinhaId, subcontaStatus: caixRow?.asaas_subconta_status || 'not_found',
        action: 'SUBCONTA_NOT_READY_BLOCK'
      });
      return res.status(402).json({
        success: false,
        error: 'SUBCONTA_NOT_READY',
        message: 'A caixinha ainda está sendo configurada. Tente novamente em instantes.',
        retryAfter: 60
      });
    }

    const split = [{ walletId: caixRow.asaas_wallet_id, percentualValue: 100 }];
    logger.info('PIX com split 100% para subconta da caixinha', {
      controller: 'AsaasController', caixinhaId, walletId: caixRow.asaas_wallet_id
    });

    // externalReference permite que o webhook identifique quem pagou
    const externalReference = `${caixinhaId}:${uid}`;

    // Gerar txid customizado para reconciliação automática via webhook (payment.pixTxid)
    let txid;
    let chargeParams = {
      customerId: customer.id,
      value: Number(amount),
      description: description || 'Contribuição ElosCloud',
      externalReference,
      split
    };

    try {
      txid = buildTxid(caixinhaId, uid);
      chargeParams.txid = txid;
    } catch (txidErr) {
      // Não bloqueia — prossegue sem txid customizado (reconciliação via DLQ)
      logger.warn('Falha ao gerar txid customizado — cobrança sem txid', {
        controller: 'AsaasController', method: 'createPixCharge',
        caixinhaId, userId: uid, error: txidErr.message, action: 'TXID_FALLBACK'
      });
    }

    let charge;
    try {
      charge = await asaasService.createPixCharge(chargeParams);
    } catch (chargeErr) {
      // H0-003-b: se Asaas rejeitar o txid, tentar sem ele
      const isPixTxidError = chargeErr.message?.toLowerCase().includes('txid') ||
                              chargeErr.message?.toLowerCase().includes('external reference');
      if (isPixTxidError && chargeParams.txid) {
        logger.warn('Asaas rejeitou txid customizado — retry sem txid', {
          controller: 'AsaasController', method: 'createPixCharge',
          caixinhaId, userId: uid, txid: chargeParams.txid,
          error: chargeErr.message, action: 'TXID_FALLBACK_RETRY'
        });
        delete chargeParams.txid;
        txid = undefined;
        charge = await asaasService.createPixCharge(chargeParams);
      } else {
        throw chargeErr;
      }
    }

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
 * POST /api/payments/asaas/subconta/create/:caixinhaId
 * Admin ElosCloud: força criação/retry da subconta Asaas de uma caixinha.
 * Útil para caixinhas com status pending_data ou failed.
 */
exports.createSubconta = async (req, res) => {
  const { caixinhaId } = req.params;

  if (!caixinhaId) {
    return res.status(400).json({ success: false, message: 'caixinhaId é obrigatório' });
  }

  try {
    // Verificar se a caixinha existe e obter o adminId
    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({ success: false, message: 'Supabase indisponível' });
    }

    const { data: caixinha, error } = await supabase
      .from('caixinhas')
      .select('id, admin_id, asaas_subconta_status')
      .eq('id', caixinhaId)
      .single();

    if (error || !caixinha) {
      return res.status(404).json({ success: false, message: 'Caixinha não encontrada' });
    }

    logger.info('Retry de subconta Asaas solicitado', {
      controller: 'AsaasController',
      method: 'createSubconta',
      caixinhaId,
      currentStatus: caixinha.asaas_subconta_status,
      requestedBy: req.user.uid
    });

    // Executa de forma assíncrona — não bloqueia a resposta
    setImmediate(() =>
      caixinhaService.createAsaasSubconta(caixinhaId, caixinha.admin_id)
    );

    return res.status(202).json({
      success: true,
      message: 'Criação de subconta iniciada em background',
      caixinhaId,
      previousStatus: caixinha.asaas_subconta_status
    });
  } catch (error) {
    logger.error('Erro ao iniciar retry de subconta Asaas', {
      controller: 'AsaasController',
      method: 'createSubconta',
      caixinhaId,
      error: error.message
    });
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/payments/asaas/withdrawal/estimate
 * Retorna estimativa de taxa de saque antes da confirmação.
 * Query: { amount, caixinhaId }
 * Resposta: { grossAmount, fee, netAmount, feePercent, feeFixed }
 */
exports.withdrawalEstimate = async (req, res) => {
  const { amount, caixinhaId } = req.query;
  const { uid } = req.user;

  const grossAmount = parseFloat(amount);
  if (!grossAmount || grossAmount <= 0 || !caixinhaId) {
    return res.status(400).json({
      success: false,
      message: 'amount (>0) e caixinhaId são obrigatórios'
    });
  }

  try {
    // Taxas Asaas para transferência PIX (conta subconta → chave externa)
    // Fonte: tabela de tarifas Asaas (atualizar se houver mudança contratual)
    const FEE_PERCENT = parseFloat(process.env.ASAAS_TRANSFER_FEE_PERCENT || '0.0249'); // 2,49%
    const FEE_FIXED   = parseFloat(process.env.ASAAS_TRANSFER_FEE_FIXED   || '0.50');  // R$ 0,50

    const fee = parseFloat((grossAmount * FEE_PERCENT + FEE_FIXED).toFixed(2));
    const netAmount = parseFloat((grossAmount - fee).toFixed(2));

    logger.info('Estimativa de saque calculada', {
      controller: 'AsaasController', method: 'withdrawalEstimate',
      userId: uid, caixinhaId, grossAmount, fee, netAmount
    });

    return res.status(200).json({
      success: true,
      data: {
        grossAmount,
        fee,
        netAmount,
        feePercent: FEE_PERCENT * 100,
        feeFixed: FEE_FIXED,
        canWithdraw: netAmount > 0,
        message: netAmount <= 0
          ? 'Saldo insuficiente para cobrir a taxa de saque.'
          : `Você receberá R$ ${netAmount.toFixed(2).replace('.', ',')} após a taxa.`
      }
    });
  } catch (error) {
    logger.error('Erro ao calcular estimativa de saque', {
      controller: 'AsaasController', method: 'withdrawalEstimate',
      userId: uid, caixinhaId, error: error.message
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
