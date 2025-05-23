// src/services/loanService.js
const Emprestimos = require('../models/Emprestimos');
const { logger } = require('../logger');
const Caixinha = require('../models/Caixinhas');
const disputeService = require('./disputeService');

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
    
    // Caso não seja necessária disputa, criar o empréstimo diretamente
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

    // Verificar se empréstimo existe
    const loan = await Emprestimos.getById(caixinhaId, loanId);
    
    if (!loan) {
      const error = new Error('Empréstimo não encontrado');
      error.statusCode = 404;
      throw error;
    }
    
    // Verificar status
    if (loan.status !== 'aprovado' && loan.status !== 'parcial') {
      const error = new Error(`Pagamento não pode ser registrado para empréstimo no status: ${loan.status}`);
      error.statusCode = 400;
      throw error;
    }
    
    // Registrar pagamento
    const updatedLoan = await Emprestimos.registrarPagamento(
      caixinhaId, 
      loanId, 
      paymentData.valor, 
      paymentData.observacao || ''
    );
    
    // Atualizar saldo da caixinha
    const caixinha = await Caixinha.getById(caixinhaId);
    if (caixinha) {
      // Supondo que exista um método para atualizar o saldo da caixinha
      await Caixinha.updateBalance(caixinhaId, {
        type: 'LOAN_PAYMENT',
        amount: paymentData.valor,
        loanId,
        userId: loan.memberId
      });
    }
    
    return {
      success: true,
      data: updatedLoan
    };
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

    // Verificar se empréstimo existe
    const loan = await Emprestimos.getById(caixinhaId, loanId);
    
    if (!loan) {
      const error = new Error('Empréstimo não encontrado');
      error.statusCode = 404;
      throw error;
    }
    
    // Verificar permissão do administrador
    const caixinha = await Caixinha.getById(caixinhaId);
    if (caixinha.adminId !== adminId) {
      // Verificar se o adminId é membro da caixinha
      const isMember = caixinha.members.includes(adminId);
      
      if (!isMember) {
        const error = new Error('Usuário não tem permissão para aprovar este empréstimo');
        error.statusCode = 403;
        throw error;
      }
    }
    
    // Aprovar empréstimo
    const updatedLoan = await Emprestimos.aprovar(caixinhaId, loanId, adminId);
    
    // Atualizar saldo da caixinha
    if (caixinha) {
      // Supondo que exista um método para atualizar o saldo da caixinha
      await Caixinha.updateBalance(caixinhaId, {
        type: 'LOAN_APPROVAL',
        amount: -loan.valorSolicitado, // Valor negativo para saída de dinheiro
        loanId,
        userId: loan.memberId
      });
    }
    
    return {
      success: true,
      data: updatedLoan
    };
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

    // Verificar se empréstimo existe
    const loan = await Emprestimos.getById(caixinhaId, loanId);
    
    if (!loan) {
      const error = new Error('Empréstimo não encontrado');
      error.statusCode = 404;
      throw error;
    }
    
    // Verificar permissão do administrador
    const caixinha = await Caixinha.getById(caixinhaId);
    if (caixinha.adminId !== adminId) {
      // Verificar se o adminId é membro da caixinha
      const isMember = caixinha.members.includes(adminId);
      
      if (!isMember) {
        const error = new Error('Usuário não tem permissão para rejeitar este empréstimo');
        error.statusCode = 403;
        throw error;
      }
    }
    
    // Rejeitar empréstimo
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