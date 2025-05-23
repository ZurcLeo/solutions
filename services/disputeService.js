// src/services/disputeService.js
const { logger } = require('../logger');
const Dispute = require('../models/Dispute');
const Caixinha = require('../models/Caixinhas');

// Processa o resultado de uma disputa baseada nos votos atuais
const processDisputeResult = async (disputeId) => {
  try {
    const dispute = await Dispute.getById(disputeId);
    const caixinha = await Caixinha.getById(dispute.caixinhaId);
    
    // Se a disputa já estiver resolvida, não fazer nada
    if (dispute.status !== 'OPEN') {
      return dispute;
    }
    
    // Verificar se expirou
    const now = new Date();
    if (new Date(dispute.expiresAt) < now) {
      return await Dispute.update(disputeId, {
        status: 'EXPIRED',
        resolvedAt: now.toISOString()
      });
    }
    
    // Obter configuração de governança
    const governanceModel = caixinha.governanceModel || {
      type: 'GROUP_DISPUTE',
      quorumType: 'PERCENTAGE',
      quorumValue: 51,
      adminHasTiebreaker: true
    };
    
    // Calcular quórum
    const totalMembers = caixinha.members.length;
    const totalVotes = dispute.votes.length;
    let quorumReached = false;
    
    if (governanceModel.quorumType === 'PERCENTAGE') {
      const quorumPercentage = (totalVotes / totalMembers) * 100;
      quorumReached = quorumPercentage >= governanceModel.quorumValue;
    } else { // COUNT
      quorumReached = totalVotes >= governanceModel.quorumValue;
    }
    
    // Se não atingiu quórum, manter aberta
    if (!quorumReached) {
      return dispute;
    }
    
    // Calcular votos
    const approvalVotes = dispute.votes.filter(vote => vote.vote === true).length;
    const rejectionVotes = dispute.votes.filter(vote => vote.vote === false).length;
    
    let isApproved = approvalVotes > rejectionVotes;
    
    // Verificar empate com desempate do admin
    if (approvalVotes === rejectionVotes && governanceModel.adminHasTiebreaker) {
      const adminVote = dispute.votes.find(vote => vote.userId === caixinha.adminId);
      if (adminVote) {
        isApproved = adminVote.vote === true;
      }
    }
    
    // Atualizar status
    const newStatus = isApproved ? 'APPROVED' : 'REJECTED';
    
    const updatedDispute = await Dispute.update(disputeId, {
      status: newStatus,
      resolvedAt: now.toISOString()
    });
    
    // Se aprovada, aplicar as mudanças
    if (isApproved) {
      await applyApprovedChanges(updatedDispute);
    }
    
    return updatedDispute;
  } catch (error) {
    logger.error('Erro ao processar resultado da disputa', {
      service: 'disputeService',
      method: 'processDisputeResult',
      error: error.message,
      stack: error.stack,
      disputeId
    });
    throw error;
  }
};

// Aplica as mudanças aprovadas na disputa
const applyApprovedChanges = async (dispute) => {
  try {
    switch (dispute.type) {
      case 'RULE_CHANGE':
        // Aplicar alterações nas regras da caixinha
        const ruleChanges = {};
        Object.keys(dispute.proposedChanges).forEach(key => {
          ruleChanges[key] = dispute.proposedChanges[key].to;
        });
        
        await Caixinha.update(dispute.caixinhaId, ruleChanges);
        break;
        
      case 'LOAN_APPROVAL':
        // Implementar lógica para aprovação de empréstimo
        // (Isso pode chamar o TransactionService existente)
        break;
        
      case 'MEMBER_REMOVAL':
        // Implementar lógica para remoção de membro
        // (Isso pode chamar o MembrosService existente)
        break;
    }
    
    logger.info('Alterações da disputa aplicadas com sucesso', {
      service: 'disputeService',
      method: 'applyApprovedChanges',
      disputeId: dispute.id,
      type: dispute.type,
      caixinhaId: dispute.caixinhaId
    });
  } catch (error) {
    logger.error('Erro ao aplicar alterações da disputa', {
      service: 'disputeService',
      method: 'applyApprovedChanges',
      error: error.message,
      stack: error.stack,
      disputeId: dispute.id,
      type: dispute.type
    });
    throw error;
  }
};

// Verifica se uma ação requer disputa com base no modelo de governança
const checkDisputeRequirement = async (caixinhaId, changeType, userId) => {
  try {
    const caixinha = await Caixinha.getById(caixinhaId);
    
    // Configuração de governança
    const governanceModel = caixinha.governanceModel || {
      type: 'GROUP_DISPUTE',
      quorumType: 'PERCENTAGE',
      quorumValue: 51,
      adminHasTiebreaker: true,
      canChangeAfterMembers: false
    };
    
    // Verificar casos especiais
    
    // Admin é o único membro - não precisa de disputa
    if (caixinha.members.length === 1 && caixinha.members[0] === userId) {
      return { requiresDispute: false, reason: 'ADMIN_ONLY_MEMBER' };
    }
    
    // Modelo de controle administrativo com usuário atual sendo admin
    if (governanceModel.type === 'ADMIN_CONTROL' && caixinha.adminId === userId) {
      return { requiresDispute: false, reason: 'ADMIN_CONTROL' };
    }
    
    // Configuração inicial pelo admin
    if (changeType === 'INITIAL_CONFIG' && caixinha.adminId === userId) {
      return { requiresDispute: false, reason: 'INITIAL_CONFIG' };
    }
    
    // Todos os outros casos requerem disputa
    return { requiresDispute: true, reason: 'DEFAULT_POLICY', governanceModel };
  } catch (error) {
    logger.error('Erro ao verificar requisito de disputa', {
      service: 'disputeService',
      method: 'checkDisputeRequirement',
      error: error.message,
      stack: error.stack,
      caixinhaId,
      changeType,
      userId
    });
    throw error;
  }
};

// Busca todas as disputas para uma caixinha
const getDisputes = async (caixinhaId, status) => {
  try {
    return await Dispute.getByCaixinhaId(caixinhaId, status);
  } catch (error) {
    logger.error('Erro ao buscar disputas', {
      service: 'disputeService',
      method: 'getDisputes',
      error: error.message,
      stack: error.stack,
      caixinhaId,
      status
    });
    throw error;
  }
};

// Busca uma disputa específica
const getDisputeById = async (disputeId) => {
  try {
    return await Dispute.getById(disputeId);
  } catch (error) {
    logger.error('Erro ao buscar disputa', {
      service: 'disputeService',
      method: 'getDisputeById',
      error: error.message,
      stack: error.stack,
      disputeId
    });
    throw error;
  }
};

// Cria uma nova disputa
const createDispute = async (caixinhaId, disputeData) => {
  try {
    // Adicionar caixinhaId ao objeto
    const dispute = await Dispute.create({
      ...disputeData,
      caixinhaId
    });
    
    logger.info('Disputa criada com sucesso', {
      service: 'disputeService',
      method: 'createDispute',
      disputeId: dispute.id,
      type: dispute.type,
      caixinhaId
    });
    
    return dispute;
  } catch (error) {
    logger.error('Erro ao criar disputa', {
      service: 'disputeService',
      method: 'createDispute',
      error: error.message,
      stack: error.stack,
      caixinhaId,
      disputeData
    });
    throw error;
  }
};

// Processa o voto em uma disputa
const voteOnDispute = async (caixinhaId, disputeId, voteData) => {
  try {
    // Verificar se o usuário é membro da caixinha
    const caixinha = await Caixinha.getById(caixinhaId);
    
    if (!caixinha.members.includes(voteData.userId)) {
      throw new Error('Usuário não é membro desta caixinha');
    }
    
    // Registrar o voto
    await Dispute.addVote(disputeId, voteData);
    
    // Processar resultado
    const updatedDispute = await processDisputeResult(disputeId);
    
    logger.info('Voto registrado com sucesso', {
      service: 'disputeService',
      method: 'voteOnDispute',
      disputeId,
      userId: voteData.userId,
      status: updatedDispute.status
    });
    
    return updatedDispute;
  } catch (error) {
    logger.error('Erro ao votar em disputa', {
      service: 'disputeService',
      method: 'voteOnDispute',
      error: error.message,
      stack: error.stack,
      caixinhaId,
      disputeId,
      userId: voteData.userId
    });
    throw error;
  }
};

// Cancela uma disputa
const cancelDispute = async (caixinhaId, disputeId, userId, reason) => {
  try {
    const dispute = await Dispute.getById(disputeId);
    const caixinha = await Caixinha.getById(caixinhaId);
    
    // Verificar permissão para cancelar
    const isAdmin = caixinha.adminId === userId;
    const isProposer = dispute.proposedBy === userId;
    
    if (!isAdmin && !isProposer) {
      throw new Error('Usuário não tem permissão para cancelar esta disputa');
    }
    
    // Atualizar status da disputa
    const updatedDispute = await Dispute.update(disputeId, {
      status: 'CANCELLED',
      resolvedAt: new Date().toISOString(),
      cancelledBy: userId,
      cancellationReason: reason
    });
    
    logger.info('Disputa cancelada com sucesso', {
      service: 'disputeService',
      method: 'cancelDispute',
      disputeId,
      userId,
      reason
    });
    
    return updatedDispute;
  } catch (error) {
    logger.error('Erro ao cancelar disputa', {
      service: 'disputeService',
      method: 'cancelDispute',
      error: error.message,
      stack: error.stack,
      caixinhaId,
      disputeId,
      userId
    });
    throw error;
  }
};

// Criar disputa de alteração de regras
const createRuleChangeDispute = async (caixinhaId, userId, currentRules, proposedRules, title, description) => {
  try {
    // Gerar objeto de alterações
    const changes = {};
    
    Object.keys(proposedRules).forEach(key => {
      if (JSON.stringify(currentRules[key]) !== JSON.stringify(proposedRules[key])) {
        changes[key] = {
          from: currentRules[key],
          to: proposedRules[key]
        };
      }
    });
    
    if (Object.keys(changes).length === 0) {
      throw new Error('Nenhuma alteração detectada');
    }
    
    // Buscar informações do usuário
    // (Normalmente teria um userService para isso)
    const userName = userId; // Simplificado para o exemplo
    
    // Criar disputa
    const disputeData = {
      title: title || 'Alteração nas regras da Caixinha',
      description: description || 'Proposta de alteração nas regras da Caixinha',
      type: 'RULE_CHANGE',
      proposedBy: userId,
      proposedByName: userName,
      proposedChanges: changes,
      status: 'OPEN',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 dias
    };
    
    return await createDispute(caixinhaId, disputeData);
  } catch (error) {
    logger.error('Erro ao criar disputa de alteração de regras', {
      service: 'disputeService',
      method: 'createRuleChangeDispute',
      error: error.message,
      stack: error.stack,
      caixinhaId,
      userId
    });
    throw error;
  }
};

module.exports = {
  getDisputes,
  getDisputeById,
  createDispute,
  voteOnDispute,
  cancelDispute,
  checkDisputeRequirement,
  createRuleChangeDispute,
  processDisputeResult
};