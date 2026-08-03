// middlewares/rbac.js
const { logger } = require('../logger');
const userRoleService = require('../services/userRoleService');
const { createClient } = require('@supabase/supabase-js');

// Inicializar Supabase para leitura opcional
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

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

      // 1. Otimização Stateless: Verificar se a role já está no token (JWT)
      // Nota: O token contém roles completas. Se o contexto bater, podemos autorizar sem DB.
      if (req.user && req.user.roles && Array.isArray(req.user.roles)) {
        const resourceId = getResourceId(req);
        const hasPermissionInToken = req.user.roles.some(role => {
          // BUG FIX: usar 'admin' (lowercase) conforme V2.0 RBAC
          if ((role.roleName === 'admin' || role.roleName === 'Admin') && role.validationStatus === 'validated') return true;
          return false;
        });

        if (hasPermissionInToken) return next();
      }
      
      const resourceId = getResourceId(req);
      
      // 2. Fallback para verificação no banco (via Service que respeita o Toggle)
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
        return res.status(401).json({
          success: false,
          message: 'Autenticação necessária'
        });
      }

      const resourceId = getResourceId(req);

      // 1. Otimização Stateless: Verificar no Token
      if (req.user && req.user.roles && Array.isArray(req.user.roles)) {
        const hasRoleInToken = req.user.roles.some(role => 
          (role.roleName === requiredRole || role.roleId === requiredRole) &&
          role.validationStatus === 'validated' &&
          (contextType === 'global' || (role.context && role.context.type === contextType && role.context.resourceId === resourceId))
        );

        if (hasRoleInToken) return next();

        // BUG FIX: usar 'admin' (lowercase) conforme V2.0 RBAC
        const isAdmin = req.user.roles.some(role => (role.roleName === 'admin' || role.roleName === 'Admin') && role.validationStatus === 'validated');
        if (isAdmin) return next();
      }
      
      // 2. Fallback para banco
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

  // 1. Verificar no Token (Stateless)
  if (req.user && req.user.roles && Array.isArray(req.user.roles)) {
    // BUG FIX: normalizar para 'admin' e 'adm-master'
    const hasAdminInToken = req.user.roles.some(role => 
      (role.roleName === 'admin' || role.roleName === 'Admin' || role.roleId === 'admin' || role.roleName === 'adm-master') && 
      role.validationStatus === 'validated'
    );
    if (hasAdminInToken) {
      req.user.isAdmin = true;
      return next();
    }
  }

  try {
    // 2. Verificar se o usuário é administrador pelo novo sistema (Service respeita o Toggle)
    // BUG FIX: verificar 'admin' e 'adm-master'
    const hasAdminRole = await userRoleService.checkUserHasRole(userId, 'admin') || 
                         await userRoleService.checkUserHasRole(userId, 'adm-master') ||
                         await userRoleService.checkUserHasRole(userId, 'Admin');
    
    if (hasAdminRole) {
      req.user.isAdmin = true;
      return next();
    }

    logger.warn('Usuário sem permissão de admin tentou acessar recurso protegido', {
      middleware: 'isAdmin',
      userId
    });
    
    return res.status(403).json({
      success: false,
      message: 'Acesso negado'
    });
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

      // Feature Toggle: Usar Supabase
      if (process.env.USE_SUPABASE_RBAC === 'true' && supabase) {
        // 1. Verificar acesso validado
        const { data: hasAccess, error: accessError } = await supabase.rpc('check_caixinha_access', {
          p_user_id: userId,
          p_caixinha_id: caixinhaId
        });

        if (accessError) {
          logger.error('Erro no Supabase check_caixinha_access', { accessError });
        } else if (hasAccess) {
          return next();
        }

        // 2. Verificar se está pendente
        const { data: isPending, error: pendingError } = await supabase.rpc('check_caixinha_pending', {
          p_user_id: userId,
          p_caixinha_id: caixinhaId
        });

        if (!pendingError && isPending) {
          return res.status(403).json({
            success: false,
            message: 'Validação bancária pendente',
            requiresValidation: true,
            caixinhaId
          });
        }
        
        // Se falhou ambos no Supabase, tentamos Firestore como fallback abaixo
      }
      
      // Fallback para Firestore (Service respeita o toggle no futuro, mas aqui injetamos direto)
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

/**
 * Middleware para verificar se o usuário é membro de uma caixinha
 * 1. Bypass para admin global (token ou DB)
 * 2. Consulta caixinha_members no Supabase (exclui role 'removed')
 * 3. Fallback para Firestore legado
 * @param {Function} getCaixinhaId - Função para extrair o ID da caixinha da request
 * @returns {Function} Middleware do Express
 */
const checkCaixinhaMembership = (getCaixinhaId = req => req.params.caixinhaId) => {
  return async (req, res, next) => {
    try {
      const userId = req.uid;
      const caixinhaId = getCaixinhaId(req);

      if (!userId || !caixinhaId) {
        return res.status(400).json({
          success: false,
          message: 'Dados insuficientes para verificar membership'
        });
      }

      // 1. Bypass para admin global (stateless via token)
      if (req.user && req.user.roles && Array.isArray(req.user.roles)) {
        const isGlobalAdmin = req.user.roles.some(role =>
          (role.roleName === 'admin' || role.roleName === 'Admin' || role.roleName === 'adm-master') &&
          role.validationStatus === 'validated'
        );
        if (isGlobalAdmin) return next();
      }

      // 2. Bypass para admin global (fallback DB)
      const hasAdminRole = await userRoleService.checkUserHasRole(userId, 'admin') ||
                           await userRoleService.checkUserHasRole(userId, 'adm-master');
      if (hasAdminRole) return next();

      // 3. Verificar membership via caixinha_members no Supabase
      if (supabase) {
        const { data: member, error } = await supabase
          .from('caixinha_members')
          .select('id')
          .eq('caixinha_id', caixinhaId)
          .eq('user_id', userId)
          .neq('role', 'removed')
          .maybeSingle();

        if (!error && member) return next();
      }

      // 4. Fallback para sistema legado: verificar array de membros na caixinha
      const Caixinha = require('../models/Caixinhas');
      const caixinha = await Caixinha.getById(caixinhaId);

      if (caixinha && caixinha.members && caixinha.members.includes(userId)) {
        return next();
      }

      logger.warn('Usuário sem membership tentou acessar caixinha', {
        middleware: 'checkCaixinhaMembership',
        userId,
        caixinhaId
      });

      return res.status(403).json({
        success: false,
        message: 'Você não é membro desta caixinha'
      });
    } catch (error) {
      logger.error('Erro ao verificar membership da caixinha', {
        middleware: 'checkCaixinhaMembership',
        error: error.message
      });

      return res.status(403).json({
        success: false,
        message: 'Erro ao verificar permissão de membro'
      });
    }
  };
};

      module.exports = {
      checkPermission,
      checkRole,
      isAdmin,
      injectRoleInfo,
      checkBankValidation,
      checkCaixinhaMembership
      };