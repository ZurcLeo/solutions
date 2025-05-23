// src/controllers/disputeController.js
const { logger } = require('../logger');
const disputeService = require('../services/disputeService');

/**
 * Obtém as disputas de uma caixinha
 */
const getDisputes = async (req, res) => {
  const { caixinhaId } = req.params;
  const { status } = req.query; // 'active' ou 'resolved'
  
  logger.info('Iniciando busca de disputas', {
    controller: 'DisputeController',
    method: 'getDisputes',
    caixinhaId,
    status,
    userId: req.user.uid
  });
  
  try {
    const disputes = await disputeService.getDisputes(caixinhaId, status);
    
    logger.info('Disputas recuperadas com sucesso', {
      controller: 'DisputeController',
      method: 'getDisputes',
      count: disputes.length,
      caixinhaId
    });
    
    res.status(200).json(disputes);
  } catch (error) {
    logger.error('Erro ao buscar disputas', {
      controller: 'DisputeController',
      method: 'getDisputes',
      error: error.message,
      stack: error.stack,
      caixinhaId
    });
    
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar disputas',
      error: error.message
    });
  }
};

/**
 * Obtém uma disputa específica por ID
 */
const getDisputeById = async (req, res) => {
  const { caixinhaId, disputeId } = req.params;
  
  logger.info('Iniciando busca de disputa por ID', {
    controller: 'DisputeController',
    method: 'getDisputeById',
    caixinhaId,
    disputeId,
    userId: req.user.uid
  });
  
  try {
    const dispute = await disputeService.getDisputeById(disputeId);
    
    if (dispute.caixinhaId !== caixinhaId) {
      return res.status(403).json({
        success: false,
        message: 'Disputa não pertence a esta caixinha'
      });
    }
    
    logger.info('Disputa recuperada com sucesso', {
      controller: 'DisputeController',
      method: 'getDisputeById',
      disputeId,
      caixinhaId
    });
    
    res.status(200).json(dispute);
  } catch (error) {
    logger.error('Erro ao buscar disputa', {
      controller: 'DisputeController',
      method: 'getDisputeById',
      error: error.message,
      stack: error.stack,
      caixinhaId,
      disputeId
    });
    
    if (error.message === 'Disputa não encontrada') {
      return res.status(404).json({
        success: false,
        message: 'Disputa não encontrada',
        error: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar disputa',
      error: error.message
    });
  }
};

/**
 * Cria uma nova disputa
 */
const createDispute = async (req, res) => {
    const { caixinhaId } = req.params;
    const disputeData = req.body;
    
    logger.info('Iniciando criação de disputa', {
      controller: 'DisputeController',
      method: 'createDispute',
      caixinhaId,
      type: disputeData.type,
      userId: req.user
    });
    
    try {
      // Adicionar proposedBy e proposedByName
      disputeData.proposedBy = req.user.uid;
      disputeData.proposedByName = req.user.nome || req.user.email || 'Usuário';
      
      const dispute = await disputeService.createDispute(caixinhaId, disputeData);
      
      logger.info('Disputa criada com sucesso', {
        controller: 'DisputeController',
        method: 'createDispute',
        disputeId: dispute.id,
        caixinhaId,
        type: dispute.type
      });
      
      res.status(201).json(dispute);
    } catch (error) {
      logger.error('Erro ao criar disputa', {
        controller: 'DisputeController',
        method: 'createDispute',
        error: error.message,
        stack: error.stack,
        caixinhaId
      });
      
      res.status(500).json({
        success: false,
        message: 'Erro ao criar disputa',
        error: error.message
      });
    }
  };
  
  /**
   * Vota em uma disputa
   */
  const voteOnDispute = async (req, res) => {
    const { caixinhaId, disputeId } = req.params;
    const voteData = req.body;
    
    logger.info('Registrando voto em disputa', {
      controller: 'DisputeController',
      method: 'voteOnDispute',
      caixinhaId,
      disputeId,
      userId: req.user.uid
    });
    
    try {
      // Garantir que o usuário votando é o autenticado
      if (voteData.userId !== req.user.uid) {
        return res.status(403).json({
          success: false,
          message: 'Não é permitido votar em nome de outro usuário'
        });
      }
      
      const updatedDispute = await disputeService.voteOnDispute(
        caixinhaId,
        disputeId,
        voteData
      );
      
      logger.info('Voto registrado com sucesso', {
        controller: 'DisputeController',
        method: 'voteOnDispute',
        disputeId,
        userId: voteData.userId,
        status: updatedDispute.status
      });
      
      res.status(200).json(updatedDispute);
    } catch (error) {
      logger.error('Erro ao registrar voto', {
        controller: 'DisputeController',
        method: 'voteOnDispute',
        error: error.message,
        stack: error.stack,
        caixinhaId,
        disputeId,
        userId: voteData.userId
      });
      
      if (error.message === 'Usuário não é membro desta caixinha') {
        return res.status(403).json({
          success: false,
          message: 'Usuário não tem permissão para votar nesta caixinha',
          error: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: 'Erro ao registrar voto',
        error: error.message
      });
    }
  };
  
  /**
   * Cancela uma disputa
   */
  const cancelDispute = async (req, res) => {
    const { caixinhaId, disputeId } = req.params;
    const { userId, reason } = req.body;
    
    logger.info('Cancelando disputa', {
      controller: 'DisputeController',
      method: 'cancelDispute',
      caixinhaId,
      disputeId,
      userId: req.user.uid
    });
    
    try {
      // Garantir que o usuário cancelando é o autenticado
      if (userId !== req.user.uid) {
        return res.status(403).json({
          success: false,
          message: 'Não é permitido cancelar em nome de outro usuário'
        });
      }
      
      const updatedDispute = await disputeService.cancelDispute(
        caixinhaId,
        disputeId,
        userId,
        reason
      );
      
      logger.info('Disputa cancelada com sucesso', {
        controller: 'DisputeController',
        method: 'cancelDispute',
        disputeId,
        userId,
        reason
      });
      
      res.status(200).json(updatedDispute);
    } catch (error) {
      logger.error('Erro ao cancelar disputa', {
        controller: 'DisputeController',
        method: 'cancelDispute',
        error: error.message,
        stack: error.stack,
        caixinhaId,
        disputeId,
        userId
      });
      
      if (error.message === 'Usuário não tem permissão para cancelar esta disputa') {
        return res.status(403).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: 'Erro ao cancelar disputa',
        error: error.message
      });
    }
  };
  
  /**
   * Verifica se uma ação requer disputa
   */
  const checkDisputeRequirement = async (req, res) => {
    const { caixinhaId } = req.params;
    const { changeType } = req.query;
    const userId = req.user.uid;
    
    logger.info('Verificando requisito de disputa', {
      controller: 'DisputeController',
      method: 'checkDisputeRequirement',
      caixinhaId,
      changeType,
      userId
    });
    
    try {
      const result = await disputeService.checkDisputeRequirement(
        caixinhaId,
        changeType,
        userId
      );
      
      logger.info('Requisito de disputa verificado', {
        controller: 'DisputeController',
        method: 'checkDisputeRequirement',
        caixinhaId,
        changeType,
        requiresDispute: result.requiresDispute,
        reason: result.reason
      });
      
      res.status(200).json(result);
    } catch (error) {
      logger.error('Erro ao verificar requisito de disputa', {
        controller: 'DisputeController',
        method: 'checkDisputeRequirement',
        error: error.message,
        stack: error.stack,
        caixinhaId,
        changeType
      });
      
      res.status(500).json({
        success: false,
        message: 'Erro ao verificar requisito de disputa',
        error: error.message
      });
    }
  };
  
  /**
   * Cria uma disputa de alteração de regras
   */
  const createRuleChangeDispute = async (req, res) => {
    const { caixinhaId } = req.params;
    const { currentRules, proposedRules, title, description } = req.body;
    const userId = req.user.uid;
    
    logger.info('Criando disputa de alteração de regras', {
      controller: 'DisputeController',
      method: 'createRuleChangeDispute',
      caixinhaId,
      userId
    });
    
    try {
      const dispute = await disputeService.createRuleChangeDispute(
        caixinhaId,
        userId,
        currentRules,
        proposedRules,
        title,
        description
      );
      
      logger.info('Disputa de alteração de regras criada com sucesso', {
        controller: 'DisputeController',
        method: 'createRuleChangeDispute',
        disputeId: dispute.id,
        caixinhaId
      });
      
      res.status(201).json(dispute);
    } catch (error) {
      logger.error('Erro ao criar disputa de alteração de regras', {
        controller: 'DisputeController',
        method: 'createRuleChangeDispute',
        error: error.message,
        stack: error.stack,
        caixinhaId,
        userId
      });
      
      if (error.message === 'Nenhuma alteração detectada') {
        return res.status(400).json({
          success: false,
          message: 'Nenhuma alteração detectada entre as regras atuais e propostas',
          error: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: 'Erro ao criar disputa de alteração de regras',
        error: error.message
      });
    }
  };
  
  module.exports = {
    getDisputes,
    getDisputeById,
    createDispute,
    voteOnDispute,
    cancelDispute,
    checkDisputeRequirement,
    createRuleChangeDispute
  };