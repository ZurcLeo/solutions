// controllers/userRoleController.js
const { logger } = require('../logger');
const userRoleService = require('../services/userRoleService');
const roleService = require('../services/roleService');
const User = require('../models/User');

/**
 * Obtém as roles de um usuário
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const getUserRoles = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Verificar se o usuário existe
    const user = await User.getById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }
    
    // Buscar as roles do usuário usando o serviço
    const userRoles = await userRoleService.getUserRoles(userId);
    
    // Log para depuração
    logger.info('Roles do usuário obtidas pelo controller', {
      controller: 'userRoleController',
      method: 'getUserRoles',
      userId,
      rolesCount: userRoles.length
    });
    
    // Retornar as roles
    res.status(200).json({
      success: true,
      data: userRoles
    });
  } catch (error) {
    logger.error('Erro ao buscar roles do usuário', {
      controller: 'userRoleController',
      method: 'getUserRoles',
      userId: req.params.userId,
      error: error.message
    });
    
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar roles do usuário',
      error: error.message
    });
  }
};

/**
 * Atribui uma role a um usuário
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const assignRoleToUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { roleId, context, options } = req.body;
    
    // Verificações básicas
    if (!roleId) {
      return res.status(400).json({
        success: false,
        message: 'ID da role é obrigatório'
      });
    }
    
    // Verificar se o usuário existe
    const user = await User.getById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }
    
    // Incluir o ID do usuário que está atribuindo a role
    const assignOptions = {
      ...options,
      createdBy: req.uid
    };
    
    const userRole = await userRoleService.assignRoleToUser(
      userId, 
      roleId, 
      context || { type: 'global', resourceId: null },
      assignOptions
    );
    
    res.status(201).json({
      success: true,
      message: 'Role atribuída ao usuário com sucesso',
      data: userRole
    });
  } catch (error) {
    logger.error('Erro ao atribuir role ao usuário', {
      controller: 'userRoleController',
      method: 'assignRoleToUser',
      userId: req.params.userId,
      roleId: req.body.roleId,
      error: error.message
    });
    
    if (error.message.includes('já atribuída')) {
      return res.status(409).json({
        success: false,
        message: error.message
      });
    }
    
    if (error.message.includes('não encontrad')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Erro ao atribuir role ao usuário',
      error: error.message
    });
  }
};

/**
 * Remove uma role de um usuário
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const removeRoleFromUser = async (req, res) => {
  try {
    const { userId, userRoleId } = req.params;
    
    // Verificar se o usuário existe
    const user = await User.getById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }
    
    const result = await userRoleService.removeRoleFromUser(userRoleId);
    
    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Role de usuário não encontrada'
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Role removida do usuário com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao remover role do usuário', {
      controller: 'userRoleController',
      method: 'removeRoleFromUser',
      userId: req.params.userId,
      userRoleId: req.params.userRoleId,
      error: error.message
    });
    
    res.status(500).json({
      success: false,
      message: 'Erro ao remover role do usuário',
      error: error.message
    });
  }
};

/**
 * Valida uma role de usuário
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const validateUserRole = async (req, res) => {
  try {
    const { userId, userRoleId } = req.params;
    const validationData = req.body || {};
    
    // Verificar se o usuário existe
    const user = await User.getById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }
    
    // Incluir informações de validação
    const validationInfo = {
      ...validationData,
      validatedBy: req.uid,
      validatedAt: new Date()
    };
    
    const userRole = await userRoleService.validateUserRole(userRoleId, validationInfo);
    
    res.status(200).json({
      success: true,
      message: 'Role de usuário validada com sucesso',
      data: userRole
    });
  } catch (error) {
    logger.error('Erro ao validar role de usuário', {
      controller: 'userRoleController',
      method: 'validateUserRole',
      userId: req.params.userId,
      userRoleId: req.params.userRoleId,
      error: error.message
    });
    
    if (error.message === 'UserRole não encontrada') {
      return res.status(404).json({
        success: false,
        message: 'Role de usuário não encontrada'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Erro ao validar role de usuário',
      error: error.message
    });
  }
};

/**
 * Rejeita uma role de usuário
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const rejectUserRole = async (req, res) => {
  try {
    const { userId, userRoleId } = req.params;
    const { reason, details } = req.body || {};
    
    // Verificar se o usuário existe
    const user = await User.getById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }
    
    // Dados da rejeição
    const reasonData = {
      reason: reason || 'Não especificado',
      rejectedBy: req.uid,
      details: details || null
    };
    
    const userRole = await userRoleService.rejectUserRole(userRoleId, reasonData);
    
    res.status(200).json({
      success: true,
      message: 'Role de usuário rejeitada com sucesso',
      data: userRole
    });
  } catch (error) {
    logger.error('Erro ao rejeitar role de usuário', {
      controller: 'userRoleController',
      method: 'rejectUserRole',
      userId: req.params.userId,
      userRoleId: req.params.userRoleId,
      error: error.message
    });
    
    if (error.message === 'UserRole não encontrada') {
      return res.status(404).json({
        success: false,
        message: 'Role de usuário não encontrada'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Erro ao rejeitar role de usuário',
      error: error.message
    });
  }
};

/**
 * Inicia o processo de validação bancária
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const initBankValidation = async (req, res) => {
  try {
    const { userId } = req.params;
    const { userRoleId, bankData } = req.body;
    
    // Verificar se o usuário existe
    const user = await User.getById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }
    
    // Verificar se a userRole existe
    if (userRoleId) {
      try {
        const userRoleModel = require('../models/UserRole');
        await userRoleModel.getById(userRoleId);
      } catch (error) {
        return res.status(404).json({
          success: false,
          message: 'Role de usuário não encontrada'
        });
      }
    }
    
    // Gerar um código Pix simbólico para validação
    const validationAmount = (Math.floor(Math.random() * 5) + 1) / 100; // Entre 0,01 e 0,05
    const validationCode = generateValidationCode();
    
    // Armazenar dados da validação
    // Em um sistema real, isso seria armazenado em um banco de dados
    // e monitorado por um processo assíncrono
    const validationInfo = {
      userId,
      userRoleId,
      validationCode,
      amount: validationAmount,
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 horas
      bankData
    };
    
    // Aqui seria feita a integração com um serviço de Pix
    // Para este exemplo, apenas simulamos
    
    res.status(200).json({
      success: true,
      message: 'Processo de validação bancária iniciado',
      data: {
        validationCode,
        amount: validationAmount,
        instructions: 'Realize um pagamento Pix do valor exato indicado para concluir a validação',
        expiresAt: validationInfo.expiresAt
      }
    });
  } catch (error) {
    logger.error('Erro ao iniciar validação bancária', {
      controller: 'userRoleController',
      method: 'initBankValidation',
      userId: req.params.userId,
      error: error.message
    });
    
    res.status(500).json({
      success: false,
      message: 'Erro ao iniciar validação bancária',
      error: error.message
    });
  }
};

/**
 * Simula a confirmação de validação bancária
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const confirmBankValidation = async (req, res) => {
  try {
    const { userId } = req.params;
    const { validationCode, userRoleId } = req.body;
    
    // Verificar se o usuário existe
    const user = await User.getById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }
    
    // Em um sistema real, verificaríamos se o pagamento foi recebido
    // Para este exemplo, apenas simulamos uma validação bem-sucedida
    
    if (!validationCode) {
      return res.status(400).json({
        success: false,
        message: 'Código de validação é obrigatório'
      });
    }
    
    // Validar a role do usuário
    let userRole;
    if (userRoleId) {
      userRole = await userRoleService.validateUserRole(userRoleId, {
        validatedBy: 'system',
        validationMethod: 'bank_transfer',
        validationCode
      });
    } else {
      // Buscar todas as roles pendentes do usuário
      const pendingRoles = await userRoleService.getUserRoles(userId);
      const filteredRoles = pendingRoles.filter(ur => ur.validationStatus === 'pending');
      
      if (filteredRoles.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Não há roles pendentes de validação para este usuário'
        });
      }
      
      // Validar a primeira role pendente
      userRole = await userRoleService.validateUserRole(filteredRoles[0].id, {
        validatedBy: 'system',
        validationMethod: 'bank_transfer',
        validationCode
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Validação bancária concluída com sucesso',
      data: userRole
    });
  } catch (error) {
    logger.error('Erro ao confirmar validação bancária', {
      controller: 'userRoleController',
      method: 'confirmBankValidation',
      userId: req.params.userId,
      error: error.message
    });
    
    if (error.message === 'UserRole não encontrada') {
      return res.status(404).json({
        success: false,
        message: 'Role de usuário não encontrada'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Erro ao confirmar validação bancária',
      error: error.message
    });
  }
};

/**
 * Migra usuários com flag isOwnerOrAdmin para a role Admin
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const migrateAdminUsers = async (req, res) => {
  try {
    const result = await userRoleService.migrateAdminUsers();
    
    res.status(200).json({
      success: true,
      message: 'Migração de usuários admin concluída com sucesso',
      data: result
    });
  } catch (error) {
    logger.error('Erro ao migrar usuários admin', {
      controller: 'userRoleController',
      method: 'migrateAdminUsers',
      error: error.message
    });
    
    res.status(500).json({
      success: false,
      message: 'Erro ao migrar usuários admin',
      error: error.message
    });
  }
};

/**
 * Gera um código de validação aleatório
 * @returns {string} Código de validação
 */
function generateValidationCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

module.exports = {
  getUserRoles,
  assignRoleToUser,
  removeRoleFromUser,
  validateUserRole,
  rejectUserRole,
  initBankValidation,
  confirmBankValidation,
  migrateAdminUsers
};