/**
 * @fileoverview Serviço para gerenciar disputas e votações em caixinhas.
 * @module services/disputeService
 * @requires ../logger
 * @requires ../models/Dispute
 * @requires ../models/Caixinhas
 */
const { logger } = require('../logger');
const Dispute = require('../models/Dispute');
const Caixinha = require('../models/Caixinhas');

/**
 * Processa o resultado de uma disputa com base nos votos atuais e no modelo de governança da caixinha.
 * @async
 * @function processDisputeResult
 * @param {string} caixinhaId - O ID da caixinha à qual a disputa pertence.
 * @param {string} disputeId - O ID da disputa a ser processada.
 * @returns {Promise<Object>} O objeto da disputa atualizada com o status de resolução.
 * @throws {Error} Se ocorrer um erro durante o processamento do resultado.
 * @description Verifica o quórum, calcula os votos (incluindo desempate do admin, se configurado) e atualiza o status da disputa. Se aprovada, aplica as mudanças propostas.
 */
const processDisputeResult = async (caixinhaId, disputeId) => {
  try {
    const dispute = await Dispute.getById(caixinhaId, disputeId);
    const caixinha = await Caixinha.getById(dispute.caixinhaId);
    
    // Se a disputa já estiver resolvida, não fazer nada
    if (dispute.status !== 'OPEN') {
      return dispute;
    }
    
    // Verificar se expirou
    const now = new Date();
    if (new Date(dispute.expiresAt) < now) {
      return await Dispute.update(caixinhaId, disputeId, {
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
    
    const updatedDispute = await Dispute.update(caixinhaId, disputeId, {
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

/**
 * Aplica as mudanças aprovadas de uma disputa na caixinha correspondente.
 * @private
 * @async
 * @function applyApprovedChanges
 * @param {Object} dispute - O objeto da disputa com status 'APPROVED'.
 * @param {string} dispute.type - O tipo da disputa (ex: 'RULE_CHANGE', 'LOAN_APPROVAL').
 * @param {string} dispute.caixinhaId - O ID da caixinha afetada.
 * @param {Object} dispute.proposedChanges - As mudanças propostas e aprovadas.
 * @returns {Promise<void>}
 * @throws {Error} Se ocorrer um erro ao aplicar as mudanças.
 * @description Executa ações específicas baseadas no tipo de disputa aprovada, como atualização de regras, aprovação de empréstimos ou remoção de membros.
 */
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

/**
 * Verifica se uma determinada ação (mudança) requer uma disputa com base no modelo de governança da caixinha.
 * @async
 * @function checkDisputeRequirement
 * @param {string} caixinhaId - O ID da caixinha.
 * @param {string} changeType - O tipo de mudança sendo proposta (ex: 'RULE_CHANGE', 'LOAN_APPROVAL', 'MEMBER_REMOVAL', 'INITIAL_CONFIG').
 * @param {string} userId - O ID do usuário que está propondo a mudança.
 * @returns {Promise<{requiresDispute: boolean, reason: string, governanceModel: Object}>} Um objeto indicando se uma disputa é necessária e o motivo.
 * @throws {Error} Se ocorrer um erro durante a verificação do requisito.
 * @description Avalia o modelo de governança da caixinha e as condições da ação proposta para determinar se uma votação formal é obrigatória.
 */
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

/**
 * Busca todas as disputas para uma caixinha, opcionalmente filtradas por status.
 * @async
 * @function getDisputes
 * @param {string} caixinhaId - O ID da caixinha.
 * @param {('OPEN'|'APPROVED'|'REJECTED'|'CANCELLED'|'EXPIRED')} [status] - O status das disputas a serem filtradas.
 * @returns {Promise<Array<Object>>} Uma lista de objetos de disputa.
 * @throws {Error} Se ocorrer um erro ao buscar as disputas.
 * @description Retorna todas as disputas associadas a uma caixinha, permitindo filtro por seu estado atual.
 */
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

/**
 * Busca uma disputa específica pelo seu ID.
 * @async
 * @function getDisputeById
 * @param {string} caixinhaId - O ID da caixinha à qual a disputa pertence.
 * @param {string} disputeId - O ID da disputa a ser buscada.
 * @returns {Promise<Object>} O objeto da disputa encontrada.
 * @throws {Error} Se a disputa não for encontrada ou ocorrer um erro na busca.
 * @description Recupera os detalhes de uma disputa específica usando seus identificadores.
 */
const getDisputeById = async (caixinhaId, disputeId) => {
  try {
    return await Dispute.getById(caixinhaId, disputeId);
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

/**
 * Cria uma nova disputa para uma caixinha.
 * @async
 * @function createDispute
 * @param {string} caixinhaId - O ID da caixinha onde a disputa será criada.
 * @param {Object} disputeData - Os dados da nova disputa.
 * @param {string} disputeData.title - O título da disputa.
 * @param {string} disputeData.description - A descrição da disputa.
 * @param {string} disputeData.type - O tipo da disputa (ex: 'RULE_CHANGE', 'LOAN_APPROVAL').
 * @param {string} disputeData.proposedBy - O ID do usuário que propôs a disputa.
 * @param {Array<Object>} [disputeData.proposedChanges] - As mudanças propostas, se aplicável.
 * @returns {Promise<Object>} O objeto da disputa recém-criada.
 * @throws {Error} Se ocorrer um erro ao criar a disputa.
 * @description Persiste uma nova disputa no banco de dados para iniciar um processo de votação ou decisão.
 */
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

/**
 * Registra o voto de um usuário em uma disputa e, se o quórum for atingido, processa o resultado.
 * @async
 * @function voteOnDispute
 * @param {string} caixinhaId - O ID da caixinha.
 * @param {string} disputeId - O ID da disputa.
 * @param {Object} voteData - Os dados do voto.
 * @param {string} voteData.userId - O ID do usuário que está votando.
 * @param {boolean} voteData.vote - O voto (true para aprovar, false para rejeitar).
 * @param {string} [voteData.comment] - Um comentário opcional sobre o voto.
 * @returns {Promise<Object>} O objeto da disputa atualizado após o registro do voto e possível processamento.
 * @throws {Error} Se o usuário não for membro da caixinha ou ocorrer um erro ao registrar o voto.
 * @description Adiciona o voto de um membro a uma disputa e, em seguida, invoca `processDisputeResult` para verificar e atualizar o estado da disputa.
 */
const voteOnDispute = async (caixinhaId, disputeId, voteData) => {
  try {
    // Verificar se o usuário é membro da caixinha
    const caixinha = await Caixinha.getById(caixinhaId);
    
    if (!caixinha.members.includes(voteData.userId)) {
      throw new Error('Usuário não é membro desta caixinha');
    }
    
    // Registrar o voto
    await Dispute.addVote(caixinhaId, disputeId, voteData);
    
    // Processar resultado
    const updatedDispute = await processDisputeResult(caixinhaId, disputeId);
    
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

/**
 * Cancela uma disputa aberta.
 * @async
 * @function cancelDispute
 * @param {string} caixinhaId - O ID da caixinha à qual a disputa pertence.
 * @param {string} disputeId - O ID da disputa a ser cancelada.
 * @param {string} userId - O ID do usuário que está solicitando o cancelamento (deve ser o proponente ou um admin).
 * @param {string} [reason] - Um motivo opcional para o cancelamento.
 * @returns {Promise<Object>} O objeto da disputa com o status 'CANCELLED'.
 * @throws {Error} Se o usuário não tiver permissão para cancelar ou ocorrer um erro.
 * @description Permite que o proponente ou um administrador encerre uma disputa antes de sua resolução por votação.
 */
const cancelDispute = async (caixinhaId, disputeId, userId, reason) => {
  try {
    const dispute = await Dispute.getById(caixinhaId, disputeId);
    const caixinha = await Caixinha.getById(caixinhaId);
    
    // Verificar permissão para cancelar
    const isAdmin = caixinha.adminId === userId;
    const isProposer = dispute.proposedBy === userId;
    
    if (!isAdmin && !isProposer) {
      throw new Error('Usuário não tem permissão para cancelar esta disputa');
    }
    
    // Atualizar status da disputa
    const updatedDispute = await Dispute.update(caixinhaId, disputeId, {
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

/**
 * Cria uma disputa específica para alteração de regras da caixinha.
 * @async
 * @function createRuleChangeDispute
 * @param {string} caixinhaId - O ID da caixinha.
 * @param {string} userId - O ID do usuário que propõe a mudança.
 * @param {Object} currentRules - As regras atuais da caixinha.
 * @param {Object} proposedRules - As regras propostas para a caixinha.
 * @param {string} [title] - Título personalizado para a disputa.
 * @param {string} [description] - Descrição personalizada para a disputa.
 * @returns {Promise<Object>} O objeto da disputa de alteração de regras recém-criada.
 * @throws {Error} Se não houver alterações detectadas ou ocorrer um erro na criação.
 * @description Compara as regras atuais e propostas, formata as diferenças e cria uma disputa do tipo 'RULE_CHANGE'.
 */
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

/**
 * Obtém informações detalhadas sobre a votação de uma disputa para um usuário específico.
 * @async
 * @function getDisputeVoteInfo
 * @param {string} caixinhaId - O ID da caixinha à qual a disputa pertence.
 * @param {string} disputeId - O ID da disputa.
 * @param {string} userId - O ID do usuário para o qual as informações de votação serão recuperadas.
 * @returns {Promise<Object>} Um objeto contendo o status da disputa, se o usuário votou, o voto do usuário (se houver), estatísticas de votação e se o usuário pode votar.
 * @throws {Error} Se a disputa não for encontrada ou ocorrer um erro.
 * @description Fornece um resumo do progresso da votação em uma disputa, incluindo a participação do usuário.
 */
const getDisputeVoteInfo = async (caixinhaId, disputeId, userId) => {
  try {
    const dispute = await Dispute.getById(caixinhaId, disputeId);
    if (!dispute) {
      throw new Error('Disputa não encontrada');
    }
    
    // Verificar se o usuário já votou
    const hasUserVoted = dispute.votes.some(vote => vote.userId === userId);
    const userVote = dispute.votes.find(vote => vote.userId === userId);
    
    // Calcular estatísticas de votação
    const totalVotes = dispute.votes.length;
    const positiveVotes = dispute.votes.filter(vote => vote.vote === true).length;
    const negativeVotes = dispute.votes.filter(vote => vote.vote === false).length;
    
    // Obter informações da caixinha para calcular quórum
    const caixinha = await Caixinha.getById(caixinhaId);
    const totalMembers = caixinha.members.length;
    const quorumPercentage = (totalVotes / totalMembers) * 100;
    
    // Verificar se a disputa ainda está ativa
    const now = new Date();
    const isExpired = new Date(dispute.expiresAt) < now;
    const isActive = dispute.status === 'OPEN' && !isExpired;
    
    const voteInfo = {
      disputeId: dispute.id,
      status: dispute.status,
      isActive,
      isExpired,
      expiresAt: dispute.expiresAt,
      hasUserVoted,
      userVote: userVote ? {
        vote: userVote.vote,
        comment: userVote.comment,
        timestamp: userVote.timestamp
      } : null,
      statistics: {
        totalVotes,
        positiveVotes,
        negativeVotes,
        totalMembers,
        quorumPercentage: Math.round(quorumPercentage * 100) / 100
      },
      canVote: isActive && !hasUserVoted
    };
    
    logger.info('Informações de votação obtidas com sucesso', {
      service: 'disputeService',
      method: 'getDisputeVoteInfo',
      caixinhaId,
      disputeId,
      userId,
      hasUserVoted,
      canVote: voteInfo.canVote
    });
    
    return voteInfo;
  } catch (error) {
    logger.error('Erro ao obter informações de votação', {
      service: 'disputeService',
      method: 'getDisputeVoteInfo',
      error: error.message,
      stack: error.stack,
      caixinhaId,
      disputeId,
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
  processDisputeResult,
  getDisputeVoteInfo
};