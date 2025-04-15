// src/middleware/admin.js
const User = require('../models/User');
const { logger } = require('../logger');
const userRoleService = require('../services/userRoleService');

/**
 * Middleware para verificar se o usuário é administrador
 * Compatível com o sistema legado (isOwnerOrAdmin) e o novo sistema RBAC (role Admin)
 * Deve ser usado após o middleware verifyToken
 */
const isAdmin = async (req, res, next) => {
  // Já deve ter um usuário autenticado a partir do middleware verifyToken
  if (!req.user || !req.user.uid) {
    return res.status(401).json({
      success: false,
      message: 'Autenticação necessária'
    });
  }

  try {
    // Verificar se o usuário existe no banco de dados
    const user = await User.getById(req.user.uid);
    
    if (!user) {
      logger.warn('Usuário não encontrado ao verificar permissões de admin', {
        middleware: 'isAdmin',
        userId: req.user.uid
      });
      
      return res.status(403).json({
        success: false,
        message: 'Acesso negado'
      });
    }
    
    // Verificar se o usuário é administrador
    // Primeiro, verificar pelo novo sistema RBAC
    const hasAdminRole = await userRoleService.checkUserHasRole(req.user.uid, 'Admin');
    
    // Depois, verificar pelo sistema legado (isOwnerOrAdmin)
    const isOwnerOrAdmin = user.isOwnerOrAdmin === true;
    
    if (hasAdminRole || isOwnerOrAdmin) {
      // Adicionar flag de admin ao objeto req.user
      req.user.isAdmin = true;
      
      // Se chegou até aqui, o usuário é admin
      next();
    } else {
      logger.warn('Usuário sem permissão de admin tentou acessar recurso protegido', {
        middleware: 'isAdmin',
        userId: req.user.uid
      });
      
      return res.status(403).json({
        success: false,
        message: 'Acesso negado'
      });
    }
  } catch (error) {
    logger.error('Erro ao verificar permissões de admin', {
      middleware: 'isAdmin',
      userId: req.user.uid,
      error: error.message
    });
    
    return res.status(500).json({
      success: false,
      message: 'Erro ao verificar permissões'
    });
  }
};

module.exports = {
  isAdmin
};