const Emprestimos = require('../models/Emprestimos');
const { logger } = require('../logger');
const Caixinha = require('../models/Caixinhas');
const disputeService = require('./disputeService');
const { getFirestore } = require('../firebaseAdmin');
const db = getFirestore();

/**
 * Obtém todos os empréstimos de uma caixinha
 * @param {string} caixinhaId - ID da caixinha
 * @param {Object} filtros - Filtros opcionais
 * @returns {Promise<Array>} Lista de empréstimos
 */
const getLoans = async (caixinhaId, filtros = {}) => {
  try {
    logger.info('Buscando empréstimos da caixinha', {
      service: 'loanService',
      method: 'getLoans',
      caixinhaId,
      filtros
    });

    const loans = await Emprestimos.getAllByCaixinha(caixinhaId, filtros);
    
    return {
      success: true,
      data: loans,
      count: loans.length
    };
  } catch (error) {
    logger.error('Erro ao buscar empréstimos', {
      service: 'loanService',
      method: 'getLoans',
      caixinhaId,
      error: error.message,
      stack: error.stack
    });
    
    throw error;
  }
};

/**
 * Obtém um empréstimo específico por ID
 * @param {string} caixinhaId - ID da caixinha
 * @param {string} loanId - ID do empréstimo
 * @returns {Promise<Object>} Dados do empréstimo
 */
const getLoanById = async (caixinhaId, loanId) => {
  try {
    logger.info('Buscando empréstimo por ID', {
      service: 'loanService',
      method: 'getLoanById',
      caixinhaId,
      loanId
    });

    const loan = await Emprestimos.getById(caixinhaId, loanId);
    
    if (!loan) {
      const error = new Error('Empréstimo não encontrado');
      error.statusCode = 404;
      throw error;
    }
    
    return {
      success: true,
      data: loan
    };
  } catch (error) {
    logger.error('Erro ao buscar empréstimo', {
      service: 'loanService',
      method: 'getLoanById',
      caixinhaId,
      loanId,
      error: error.message,
      stack: error.stack
    });
    
    throw error;
  }
};

/**
 * Solicita um novo empréstimo
 * @param {string} caixinhaId - ID da caixinha
 * @param {Object} loanData - Dados do empréstimo
 * @returns {Promise<Object>} Empréstimo criado
 */
const requestLoan = async (caixinhaId, loanData) => {
  try {
    logger.info('Solicitando empréstimo', {
      service: 'loanService',
      method: 'requestLoan',
      caixinhaId,
      userId: loanData.userId,
      valor: loanData.valor
    });

    // 1. Verificar se o membro está ativo
    const membroSnapshot = await db
      .collection('caixinhas')
      .doc(caixinhaId)
      .collection('membros')
      .where('userId', '==', loanData.userId)
      .limit(1)
      .get();

    if (membroSnapshot.empty) {
      throw new Error('Membro não encontrado nesta caixinha');
    }

    const membroData = membroSnapshot.docs[0].data();
    if (membroData.status !== 'ativo' && membroData.active !== true) {
      throw new Error('Membro inativo não pode solicitar empréstimo');
    }

    // Verificar requisito de disputa
    const { requiresDispute } = await disputeService.checkDisputeRequirement(caixinhaId, 'LOAN_APPROVAL', loanData.userId);
    
    if (requiresDispute) {
      logger.info('Empréstimo requer disputa de governança', {
        service: 'loanService',
        method: 'requestLoan',
        caixinhaId,
        userId: loanData.userId
      });
      
      // Criar uma disputa para aprovação de empréstimo
      const disputeData = {
        title: `Aprovação de empréstimo de ${loanData.valor}`,
        description: `Solicitação de empréstimo: ${loanData.motivo}`,
        type: 'LOAN_APPROVAL',
        proposedBy: loanData.userId,
        proposedChanges: {
          loan: loanData
        }
      };
      
      const dispute = await disputeService.createDispute(caixinhaId, disputeData);
      
      // Criar empréstimo em status pendente
      const loan = await Emprestimos.create(caixinhaId, {
        ...loanData,
        disputeId: dispute.id
      });
      
      return {
        success: true,
        data: loan,
        requiresDispute: true,
        disputeId: dispute.id
      };
    }
    
    // Caso não seja necessária disputa, criar the empréstimo diretamente
    const loan = await Emprestimos.create(caixinhaId, loanData);
    
    return {
      success: true,
      data: loan,
      requiresDispute: false
    };
  } catch (error) {
    logger.error('Erro ao solicitar empréstimo', {
      service: 'loanService',
      method: 'requestLoan',
      caixinhaId,
      userId: loanData.userId,
      error: error.message,
      stack: error.stack
    });
    
    throw error;
  }
};

/**
 * Registra pagamento de parcela de empréstimo
 * @param {string} caixinhaId - ID da caixinha
 * @param {string} loanId - ID do empréstimo
 * @param {Object} paymentData - Dados do pagamento
 * @returns {Promise<Object>} Empréstimo atualizado
 */
const makePayment = async (caixinhaId, loanId, paymentData) => {
  try {
    logger.info('Registrando pagamento de empréstimo', {
      service: 'loanService',
      method: 'makePayment',
      caixinhaId,
      loanId,
      valor: paymentData.valor
    });

    return await db.runTransaction(async (transaction) => {
      // 1. Obter empréstimo
      const loanRef = db.collection('caixinhas').doc(caixinhaId).collection('emprestimos').doc(loanId);
      const loanDoc = await transaction.get(loanRef);
      
      if (!loanDoc.exists) {
        throw new Error('Empréstimo não encontrado');
      }
      
      const loan = loanDoc.data();
      
      // 2. Verificar status
      if (loan.status !== 'aprovado' && loan.status !== 'parcial') {
        throw new Error(`Pagamento não pode ser registrado para empréstimo no status: ${loan.status}`);
      }
      
      // 3. Obter caixinha
      const caixinhaRef = db.collection('caixinhas').doc(caixinhaId);
      const caixinhaDoc = await transaction.get(caixinhaRef);
      
      if (!caixinhaDoc.exists) {
        throw new Error('Caixinha não encontrada');
      }
      
      const caixinha = caixinhaDoc.data();
      
      // 4. Calcular novo saldo do empréstimo
      const valorPagoAnterior = (loan.parcelas || []).reduce((total, p) => total + p.valor, 0);
      const novoValorPago = valorPagoAnterior + paymentData.valor;
      const novoStatus = novoValorPago >= loan.valorTotal ? 'quitado' : 'parcial';
      
      const parcelas = [...(loan.parcelas || []), {
        data: new Date().toISOString(),
        valor: paymentData.valor,
        observacao: paymentData.observacao || ''
      }];
      
      // 5. Atualizar empréstimo e caixinha
      transaction.update(loanRef, {
        parcelas,
        status: novoStatus,
        valorPago: novoValorPago,
        ...(novoStatus === 'quitado' && { dataQuitacao: new Date().toISOString() })
      });
      
      transaction.update(caixinhaRef, {
        saldoTotal: (caixinha.saldoTotal || 0) + paymentData.valor,
        dataUltimaAtualizacao: new Date().toISOString()
      });
      
      return {
        success: true,
        data: { ...loan, id: loanId, status: novoStatus, parcelas }
      };
    });
  } catch (error) {
    logger.error('Erro ao registrar pagamento', {
      service: 'loanService',
      method: 'makePayment',
      caixinhaId,
      loanId,
      error: error.message,
      stack: error.stack
    });
    
    throw error;
  }
};

/**
 * Aprova um empréstimo
 * @param {string} caixinhaId - ID da caixinha
 * @param {string} loanId - ID do empréstimo
 * @param {string} adminId - ID do administrador que está aprovando
 * @returns {Promise<Object>} Empréstimo atualizado
 */
const approveLoan = async (caixinhaId, loanId, adminId) => {
  try {
    logger.info('Aprovando empréstimo', {
      service: 'loanService',
      method: 'approveLoan',
      caixinhaId,
      loanId,
      adminId
    });

    return await db.runTransaction(async (transaction) => {
      // 1. Obter empréstimo
      const loanRef = db.collection('caixinhas').doc(caixinhaId).collection('emprestimos').doc(loanId);
      const loanDoc = await transaction.get(loanRef);
      
      if (!loanDoc.exists) {
        throw new Error('Empréstimo não encontrado');
      }
      
      const loan = loanDoc.data();
      if (loan.status !== 'pendente') {
        throw new Error(`Empréstimo não pode ser aprovado no status: ${loan.status}`);
      }
      
      // 2. Obter caixinha e verificar permissão e saldo
      const caixinhaRef = db.collection('caixinhas').doc(caixinhaId);
      const caixinhaDoc = await transaction.get(caixinhaRef);
      
      if (!caixinhaDoc.exists) {
        throw new Error('Caixinha não encontrada');
      }
      
      const caixinha = caixinhaDoc.data();
      
      // Verificar permissão (admin ou membro autorizado)
      if (caixinha.adminId !== adminId && !(caixinha.members || []).includes(adminId)) {
        throw new Error('Usuário não tem permissão para aprovar este empréstimo');
      }
      
      // VERIFICAR SALDO (Invariante: saldoTotal nunca vai negativo)
      const valorSolicitado = loan.valorSolicitado || loan.valor;
      if ((caixinha.saldoTotal || 0) < valorSolicitado) {
        throw new Error('Saldo insuficiente na caixinha');
      }
      
      // 3. Atualizar empréstimo e caixinha (ATOMICIDADE)
      transaction.update(loanRef, {
        status: 'aprovado',
        dataAprovacao: new Date().toISOString(),
        adminAprovador: adminId
      });
      
      transaction.update(caixinhaRef, {
        saldoTotal: caixinha.saldoTotal - valorSolicitado,
        dataUltimaAtualizacao: new Date().toISOString()
      });
      
      return {
        success: true,
        data: { ...loan, id: loanId, status: 'aprovado' }
      };
    });
  } catch (error) {
    logger.error('Erro ao aprovar empréstimo', {
      service: 'loanService',
      method: 'approveLoan',
      caixinhaId,
      loanId,
      adminId,
      error: error.message,
      stack: error.stack
    });
    
    throw error;
  }
};

/**
 * Rejeita um empréstimo
 * @param {string} caixinhaId - ID da caixinha
 * @param {string} loanId - ID do empréstimo
 * @param {string} adminId - ID do administrador que está rejeitando
 * @param {string} reason - Motivo da rejeição
 * @returns {Promise<Object>} Empréstimo atualizado
 */
const rejectLoan = async (caixinhaId, loanId, adminId, reason = '') => {
  try {
    logger.info('Rejeitando empréstimo', {
      service: 'loanService',
      method: 'rejectLoan',
      caixinhaId,
      loanId,
      adminId,
      reason
    });

    // Verificar permissão e status antes de rejeitar
    const caixinha = await Caixinha.getById(caixinhaId);
    if (caixinha.adminId !== adminId && !(caixinha.members || []).includes(adminId)) {
      throw new Error('Usuário não tem permissão para rejeitar este empréstimo');
    }

    const loan = await Emprestimos.getById(caixinhaId, loanId);
    if (!loan) {
      throw new Error('Empréstimo não encontrado');
    }
    if (loan.status !== 'pendente') {
      throw new Error(`Empréstimo não pode ser rejeitado no status: ${loan.status}`);
    }

    const updatedLoan = await Emprestimos.rejeitar(caixinhaId, loanId, adminId, reason);
    
    return {
      success: true,
      data: updatedLoan
    };
  } catch (error) {
    logger.error('Erro ao rejeitar empréstimo', {
      service: 'loanService',
      method: 'rejectLoan',
      caixinhaId,
      loanId,
      adminId,
      error: error.message,
      stack: error.stack
    });
    
    throw error;
  }
};

/**
 * Obtém estatísticas de empréstimos de uma caixinha
 * @param {string} caixinhaId - ID da caixinha
 * @returns {Promise<Object>} Estatísticas de empréstimos
 */
const getLoanStats = async (caixinhaId) => {
  try {
    logger.info('Obtendo estatísticas de empréstimos', {
      service: 'loanService',
      method: 'getLoanStats',
      caixinhaId
    });

    const stats = await Emprestimos.getEstatisticas(caixinhaId);
    
    return {
      success: true,
      data: stats
    };
  } catch (error) {
    logger.error('Erro ao obter estatísticas de empréstimos', {
      service: 'loanService',
      method: 'getLoanStats',
      caixinhaId,
      error: error.message,
      stack: error.stack
    });
    
    throw error;
  }
};

module.exports = {
  getLoans,
  getLoanById,
  requestLoan,
  makePayment,
  approveLoan,
  rejectLoan,
  getLoanStats
};
