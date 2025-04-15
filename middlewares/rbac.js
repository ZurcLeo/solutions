// middlewares/rbac.js
const { logger } = require('../logger');
const userRoleService = require('../services/userRoleService');

/**
 * Middleware para verificação de permissões específicas
 * @param {string} requiredPermission - Nome da permissão necessária
 * @param {string} contextType - Tipo de contexto (opcional, padrão: 'global')
 * @param {Function} getResourceId - Função para extrair o ID do recurso da request (opcional)
 * @returns {Function} Middleware do Express
 */
const checkPermission = (requiredPermission, contextType = 'global', getResourceId = req => null) => {
  return async (req, res, next) => {
    try {
      const userId = req.uid;
      
      if (!userId) {
        logger.warn('Tentativa de acesso sem autenticação', {
          middleware: 'checkPermission',
          requiredPermission,
          path: req.path
        });
        
        return res.status(401).json({
          success: false,
          message: 'Autenticação necessária'
        });
      }
      
      const resourceId = getResourceId(req);
      
      const hasPermission = await userRoleService.checkUserHasPermission(
        userId, 
        requiredPermission, 
        contextType,
        resourceId
      );
      
      if (hasPermission) {
        return next();
      }
      
      logger.warn('Acesso negado por falta de permissão', {
        middleware: 'checkPermission',
        userId,
        requiredPermission,
        contextType,
        resourceId,
        path: req.path
      });
      
      return res.status(403).json({
        success: false,
        message: 'Você não tem permissão para acessar este recurso'
      });
    } catch (error) {
      logger.error('Erro ao verificar permissão', {
        middleware: 'checkPermission',
        requiredPermission,
        error: error.message,
        path: req.path
      });
      
      return res.status(500).json({
        success: false,
        message: 'Erro ao verificar permissões',
        error: error.message
      });
    }
  };
};

/**
 * Middleware para verificação de role específica
 * @param {string} requiredRole - Nome da role necessária
 * @param {string} contextType - Tipo de contexto (opcional, padrão: 'global')
 * @param {Function} getResourceId - Função para extrair o ID do recurso da request (opcional)
 * @returns {Function} Middleware do Express
 */
const checkRole = (requiredRole, contextType = 'global', getResourceId = req => null) => {
  return async (req, res, next) => {
    try {
      const userId = req.uid;
      
      if (!userId) {
        logger.warn('Tentativa de acesso sem autenticação', {
          middleware: 'checkRole',
          requiredRole,
          path: req.path
        });
        
        return res.status(401).json({
          success: false,
          message: 'Autenticação necessária'
        });
      }
      
      const resourceId = getResourceId(req);
      
      const hasRole = await userRoleService.checkUserHasRole(
        userId, 
        requiredRole, 
        contextType,
        resourceId
      );
      
      if (hasRole) {
        return next();
      }
      
      logger.warn('Acesso negado por falta de role', {
        middleware: 'checkRole',
        userId,
        requiredRole,
        contextType,
        resourceId,
        path: req.path
      });
      
      return res.status(403).json({
        success: false,
        message: 'Você não tem o papel necessário para acessar este recurso'
      });
    } catch (error) {
      logger.error('Erro ao verificar role', {
        middleware: 'checkRole',
        requiredRole,
        error: error.message,
        path: req.path
      });
      
      return res.status(500).json({
        success: false,
        message: 'Erro ao verificar papel de usuário',
        error: error.message
      });
    }
  };
};

/**
 * Middleware de verificação de admin compatível com o sistema atual
 * Verifica se o usuário tem a role "Admin" ou a flag isOwnerOrAdmin
 * @returns {Function} Middleware do Express
 */
const isAdmin = async (req, res, next) => {
  const userId = req.uid;
  
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Autenticação necessária'
    });
  }

  try {
    // Verificar se o usuário existe no banco de dados
    const user = await require('../models/User').getById(userId);
    
    if (!user) {
      logger.warn('Usuário não encontrado ao verificar permissões de admin', {
        middleware: 'isAdmin',
        userId
      });
      
      return res.status(403).json({
        success: false,
        message: 'Acesso negado'
      });
    }
    
    // Verificar se o usuário é administrador pelo novo ou antigo sistema
    const hasAdminRole = await userRoleService.checkUserHasRole(userId, 'Admin');
    const isOwnerOrAdmin = user.isOwnerOrAdmin === true;
    
    if (hasAdminRole || isOwnerOrAdmin) {
      // Adicionar flag de admin ao objeto req.user
      req.user.isAdmin = true;
      
      // Se chegou até aqui, o usuário é admin
      next();
    } else {
      logger.warn('Usuário sem permissão de admin tentou acessar recurso protegido', {
        middleware: 'isAdmin',
        userId
      });
      
      return res.status(403).json({
        success: false,
        message: 'Acesso negado'
      });
    }
  } catch (error) {
    logger.error('Erro ao verificar permissões de admin', {
      middleware: 'isAdmin',
      userId,
      error: error.message
    });
    
    return res.status(500).json({
      success: false,
      message: 'Erro ao verificar permissões'
    });
  }
};

/**
 * Adiciona um middleware que injeta informações de role no objeto de request
 * @returns {Function} Middleware do Express
 */
const injectRoleInfo = async (req, res, next) => {
  const userId = req.uid;
  
  if (!userId) {
    // Se não há usuário autenticado, apenas continuar
    return next();
  }
  
  try {
    // Buscar todas as roles do usuário
    const userRoles = await userRoleService.getUserRoles(userId);
    
    // Adicionar informações ao objeto req
    if (!req.rbac) {
      req.rbac = {};
    }
    
    req.rbac.roles = userRoles;
    
    // Extrair nomes das roles para fácil acesso
    const rolePromises = userRoles.map(async (userRole) => {
      try {
        const role = await require('../models/Role').getById(userRole.roleId);
        return {
          name: role.name,
          context: userRole.context,
          validationStatus: userRole.validationStatus
        };
      } catch (error) {
        return null;
      }
    });
    
    const roleInfos = await Promise.all(rolePromises);
    req.rbac.roleInfos = roleInfos.filter(Boolean);
    
    // Criar um helper no objeto de request para verificação rápida
    req.hasRole = (roleName, contextType = 'global', resourceId = null) => {
      return req.rbac.roleInfos.some(role => 
        role.name === roleName && 
        role.validationStatus === 'validated' &&
        (contextType === null || role.context.type === contextType) &&
        (resourceId === null || role.context.resourceId === resourceId)
      );
    };
    
    next();
  } catch (error) {
    logger.error('Erro ao injetar informações de roles', {
      middleware: 'injectRoleInfo',
      userId,
      error: error.message
    });
    
    // Continuar mesmo com erro
    next();
  }
};

/**
 * Middleware para verificação de validação bancária
 * Verifica se o usuário tem validação bancária concluída para uma caixinha
 * @param {Function} getCaixinhaId - Função para extrair o ID da caixinha da request
 * @returns {Function} Middleware do Express
 */
const checkBankValidation = (getCaixinhaId = req => req.params.caixinhaId) => {
  return async (req, res, next) => {
    try {
      const userId = req.uid;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Autenticação necessária'
        });
      }
      
      const caixinhaId = getCaixinhaId(req);
      
      if (!caixinhaId) {
        return res.status(400).json({
          success: false,
          message: 'ID da caixinha não fornecido'
        });
      }
      
      // Buscar roles do usuário para esta caixinha
      const userRoles = await userRoleService.getUserRoles(userId, 'caixinha', caixinhaId);
      
      // Verificar se alguma das roles está validada
      const hasValidatedRole = userRoles.some(userRole => 
        userRole.validationStatus === 'validated'
      );
      
      if (hasValidatedRole) {
        return next();
      }
      
      // Se o usuário tem roles, mas nenhuma validada, retornar mensagem específica
      if (userRoles.length > 0) {
        return res.status(403).json({
          success: false,
          message: 'Validação bancária pendente',
          requiresValidation: true,
          caixinhaId
        });
      }
      
      // Se não tem nenhuma role, não tem acesso
      return res.status(403).json({
        success: false,
        message: 'Você não tem acesso a esta caixinha'
      });
    } catch (error) {
      logger.error('Erro ao verificar validação bancária', {
        middleware: 'checkBankValidation',
        userId: req.uid,
        error: error.message
      });
      
      return res.status(500).json({
        success: false,
        message: 'Erro ao verificar validação bancária',
        error: error.message
      });
    }
  };
};

module.exports = {
  checkPermission,
  checkRole,
  isAdmin,
  injectRoleInfo,
  checkBankValidation
};