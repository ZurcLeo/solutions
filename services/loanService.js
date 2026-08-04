const Emprestimos = require('../models/Emprestimos');
const { logger } = require('../logger');
const Caixinha = require('../models/Caixinhas');
const disputeService = require('./disputeService');
const { getFirestore } = require('../firebaseAdmin'); // legado — requestLoan ainda usa fallback de leitura Firestore
const { getSupabaseClient } = require('../config/supabase');

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

    // 1. Verificar se o membro está ativo — Supabase PRIMEIRO, fallback Firestore
    let membroAtivo = false;
    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        const { data: membroSb, error: sbErr } = await supabase
          .from('caixinha_members')
          .select('user_id, status, active')
          .eq('caixinha_id', caixinhaId)
          .eq('user_id', loanData.userId)
          .maybeSingle();

        if (sbErr) throw sbErr;

        if (!membroSb) {
          throw new Error('Membro não encontrado nesta caixinha');
        }

        // status ausente = membro ativo (dados legados sem campo status)
        const st = membroSb.status;
        membroAtivo = !st || st === 'ativo' || st === 'active';
      } catch (sbCheckErr) {
        if (sbCheckErr.message === 'Membro não encontrado nesta caixinha') throw sbCheckErr;
        logger.warn('Falha ao verificar membro no Supabase, usando fallback Firestore', {
          service: 'loanService', method: 'requestLoan', error: sbCheckErr.message
        });
        // Firestore fallback
        const dbFallback = getFirestore();
        const membroSnapshot = await dbFallback
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
        const st = membroData.status;
        membroAtivo = !st || st === 'ativo' || st === 'active' || membroData.active === true;
      }
    } else {
      const dbNoSb = getFirestore();
      const membroSnapshot = await dbNoSb
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
      const st = membroData.status;
      membroAtivo = !st || st === 'ativo' || st === 'active' || membroData.active === true;
    }

    if (!membroAtivo) {
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
    
    // Notificar Admin da Caixinha sobre nova solicitação
    try {
      const NotificationDispatcher = require('./NotificationDispatcher');
      const User = require('../models/User');
      const Caixinha = require('../models/Caixinhas');
      
      const [caixinha, user] = await Promise.all([
        Caixinha.getById(caixinhaId),
        User.getById(loanData.userId)
      ]);
      
      if (caixinha && caixinha.adminId) {
        await NotificationDispatcher.dispatch({
          userId: caixinha.adminId,
          type: 'loan_requested',
          importance: 'high',
          data: {
            amount: loanData.valor,
            userName: user.nome || user.displayName || 'Um membro',
            caixinhaName: caixinha.nome,
            caixinhaId
          },
          metadata: { triggeredBy: loanData.userId, correlationId: loan.id }
        });
      }
    } catch (notifError) {
      logger.warn('Falha ao despachar notificação de solicitação de empréstimo', { error: notifError.message });
    }

    // [CX-P2-M1] Gamificação — fire-and-forget
    setImmediate(() => {
      try {
        const gamificationService = require('./gamificationService');
        gamificationService.triggerEvent('loan_requested', loanData.userId, {
          caixinhaId, loanId: loan.id, amount: loanData.valor
        }).catch(err => logger.warn('Falha ao acionar gamificação em solicitação de empréstimo', {
          service: 'loanService', userId: loanData.userId, error: err.message
        }));
      } catch (err) {
        logger.warn('Erro síncrono ao acionar gamificação (loan_requested)', { error: err.message });
      }
    });

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
      service: 'loanService', method: 'makePayment', caixinhaId, loanId, valor: paymentData.valor
    });

    const supabase = getSupabaseClient();
    const now = new Date().toISOString();

    if (supabase) {
      // RPC atômica: lock + insert pagamento + update empréstimo + transação audit + saldo
      const { data: result, error: rpcError } = await supabase.rpc('registrar_pagamento_emprestimo', {
        p_emprestimo_id: loanId,
        p_caixinha_id: caixinhaId,
        p_user_id: paymentData.userId || 'unknown',
        p_valor: paymentData.valor,
        p_observacao: paymentData.observacao || ''
      });

      if (rpcError) {
        // Map PostgreSQL error codes to user-friendly messages
        if (rpcError.message?.includes('não encontrado')) throw new Error('Empréstimo não encontrado');
        if (rpcError.message?.includes('status:')) throw new Error(rpcError.message);
        if (rpcError.message?.includes('maior que zero')) throw new Error('Valor do pagamento deve ser maior que zero');
        throw new Error(rpcError.message || 'Erro ao registrar pagamento');
      }

      // [CX-P2-M1] Gamificação — fire-and-forget
      setImmediate(() => {
        try {
          const gamificationService = require('./gamificationService');
          gamificationService.triggerEvent('loan_paid', paymentData.userId || 'unknown', {
            caixinhaId, loanId, amount: paymentData.valor, newStatus: result.novo_status
          }).catch(err => logger.warn('Falha ao acionar gamificação em pagamento de empréstimo', {
            service: 'loanService', loanId, error: err.message
          }));

          // Trust Passport — parcela paga (+2 financial)
          const trustPassportService = require('./trustPassportService');
          trustPassportService.recordEvent(paymentData.userId || 'unknown', 'financial', 'loan_payment', 2, false, {
            caixinhaId, loanId, amount: paymentData.valor,
          }).catch(err => logger.warn('Falha ao registrar trust event loan_payment', {
            service: 'loanService', loanId, error: err.message
          }));
        } catch (err) {
          logger.warn('Erro síncrono ao acionar gamificação/trust (loan_paid)', { error: err.message });
        }
      });

      return {
        success: true,
        data: {
          id: loanId,
          caixinha_id: caixinhaId,
          status: result.novo_status,
          valor_pago: result.valor_pago_total,
          pagamento_id: result.pagamento_id,
          transacao_id: result.transacao_id
        }
      };
    }

    throw new Error('Supabase client indisponível — pagamento requer Supabase');
  } catch (error) {
    logger.error('Erro ao registrar pagamento', {
      service: 'loanService', method: 'makePayment', caixinhaId, loanId, error: error.message
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
const approveLoan = async (caixinhaId, loanId, adminOrObj) => {
  // Normaliza adminId — aceita string ou objeto { adminId }
  const adminId = (typeof adminOrObj === 'object' && adminOrObj !== null)
    ? adminOrObj.adminId
    : adminOrObj;
  const isSystemVote = adminId === 'system-vote';

  try {
    logger.info('Aprovando empréstimo', {
      service: 'loanService', method: 'approveLoan', caixinhaId, loanId, adminId
    });

    const supabase = getSupabaseClient();
    const now = new Date().toISOString();

    if (supabase) {
      // 1. Buscar empréstimo
      const { data: loan, error: errLoan } = await supabase
        .from('emprestimos')
        .select('*')
        .eq('id', loanId)
        .eq('caixinha_id', caixinhaId)
        .single();

      if (errLoan || !loan) throw new Error('Empréstimo não encontrado');
      if (loan.status !== 'pendente') throw new Error(`Empréstimo não pode ser aprovado no status: ${loan.status}`);

      // Impedir auto-aprovação (C-04)
      if (!isSystemVote && loan.user_id === adminId) {
        throw new Error('Você não pode aprovar seu próprio empréstimo');
      }

      // 2. Buscar caixinha
      const { data: caixinha, error: errCaixinha } = await supabase
        .from('caixinhas')
        .select('admin_id, saldo_total')
        .eq('id', caixinhaId)
        .single();

      if (errCaixinha || !caixinha) throw new Error('Caixinha não encontrada');

      if (!isSystemVote && caixinha.admin_id !== adminId) {
        throw new Error('Usuário não tem permissão para aprovar este empréstimo');
      }

      const valorSolicitado = Number(loan.valor_solicitado || loan.valor_total);
      if ((Number(caixinha.saldo_total) || 0) < valorSolicitado) {
        throw new Error('Saldo insuficiente na caixinha');
      }

      // 3. Atualizar empréstimo
      await supabase.from('emprestimos').update({
        status: 'aprovado',
        data_aprovacao: now,
        admin_aprovador: adminId,
        updated_at: now
      }).eq('id', loanId);

      // 4. Atualizar saldo da caixinha (RPC atômica — falha se saldo insuficiente) (RISCO-03)
      const { error: errSaldoApprove } = await supabase.rpc('update_caixinha_saldo', {
        p_caixinha_id: caixinhaId,
        p_delta: -valorSolicitado,
        p_min_saldo: valorSolicitado
      });

      if (errSaldoApprove) {
        throw new Error(errSaldoApprove.message.includes('SALDO_INSUFICIENTE')
          ? 'Saldo insuficiente na caixinha'
          : errSaldoApprove.message);
      }

      // Notificar mutuário
      setImmediate(async () => {
        try {
          const NotificationDispatcher = require('./NotificationDispatcher');
          await NotificationDispatcher.dispatch({
            userId: loan.user_id, type: 'loan_approved', importance: 'high',
            data: { amount: valorSolicitado, dueDate: loan.data_vencimento || 'Data a definir', loanId },
            metadata: { triggeredBy: adminId, correlationId: loanId }
          });
        } catch (err) {
          logger.warn('Falha ao notificar aprovação de empréstimo', { error: err.message, loanId });
        }
      });

      // [CX-P2-M1] Gamificação — notificar mutuário que empréstimo foi aprovado
      setImmediate(() => {
        try {
          const gamificationService = require('./gamificationService');
          gamificationService.triggerEvent('loan_approved', loan.user_id, {
            caixinhaId, loanId, amount: valorSolicitado, approvedBy: adminId
          }).catch(err => logger.warn('Falha ao acionar gamificação em aprovação de empréstimo', {
            service: 'loanService', loanId, error: err.message
          }));
        } catch (err) {
          logger.warn('Erro síncrono ao acionar gamificação (loan_approved)', { error: err.message });
        }
      });

      return { success: true, data: { ...loan, id: loanId, status: 'aprovado' } };
    }

    throw new Error('Supabase client indisponível — aprovação requer Supabase');
  } catch (error) {
    logger.error('Erro ao aprovar empréstimo', {
      service: 'loanService', method: 'approveLoan', caixinhaId, loanId, adminId, error: error.message
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
    
    // Notificar mutuário sobre rejeição
    setImmediate(async () => {
      try {
        const NotificationDispatcher = require('./NotificationDispatcher');
        await NotificationDispatcher.dispatch({
          userId: loan.userId,
          type: 'loan_rejected',
          importance: 'high',
          data: {
            amount: loan.valorSolicitado || loan.valor,
            reason: reason,
            loanId: loanId
          },
          metadata: { triggeredBy: adminId, correlationId: loanId }
        });
      } catch (err) {
        logger.warn('Falha ao notificar rejeição de empréstimo', { error: err.message, loanId });
      }
    });

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
