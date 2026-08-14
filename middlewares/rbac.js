// middlewares/rbac.js
const { logger } = require('../logger');
const userRoleService = require('../services/userRoleService');
const { resolveAdmin, resolvePermission, resolveRole } = require('../services/authorizationResolver');
const { getSupabaseClient } = require('../config/supabase');

/**
 * Middleware para verificação de permissões específicas.
 * Ordem: admin bypass por token → RPC check_user_has_permission (com cache)
 */
const checkPermission = (requiredPermission, contextType = 'global', getResourceId = () => null) => {
  return async (req, res, next) => {
    try {
      const userId = req.uid;

      if (!userId) {
        logger.warn('Tentativa de acesso sem autenticação', {
          middleware: 'checkPermission',
          requiredPermission,
          path: req.path,
        });
        return res.status(401).json({ success: false, message: 'Autenticação necessária' });
      }

      const resourceId = getResourceId(req);
      const hasPermission = await resolvePermission(userId, requiredPermission, contextType, resourceId, req);

      if (hasPermission) return next();

      logger.warn('Acesso negado por falta de permissão', {
        middleware: 'checkPermission',
        userId,
        requiredPermission,
        contextType,
        resourceId,
        path: req.path,
      });
      return res.status(403).json({
        success: false,
        message: 'Você não tem permissão para acessar este recurso',
      });
    } catch (error) {
      logger.error('Erro ao verificar permissão', {
        middleware: 'checkPermission',
        requiredPermission,
        error: error.message,
        path: req.path,
      });
      return res.status(500).json({
        success: false,
        message: 'Erro ao verificar permissões',
        error: error.message,
      });
    }
  };
};

/**
 * Middleware para verificação de role específica.
 * Ordem: role no token (com contexto) → admin bypass por token → RPC (com cache)
 */
const checkRole = (requiredRole, contextType = 'global', getResourceId = () => null) => {
  return async (req, res, next) => {
    try {
      const userId = req.uid;

      if (!userId) {
        return res.status(401).json({ success: false, message: 'Autenticação necessária' });
      }

      const resourceId = getResourceId(req);
      const hasRole = await resolveRole(userId, requiredRole, contextType, resourceId, req);

      if (hasRole) return next();

      logger.warn('Acesso negado por falta de role', {
        middleware: 'checkRole',
        userId,
        requiredRole,
        contextType,
        resourceId,
        path: req.path,
      });
      return res.status(403).json({
        success: false,
        message: 'Você não tem o papel necessário para acessar este recurso',
      });
    } catch (error) {
      logger.error('Erro ao verificar role', {
        middleware: 'checkRole',
        requiredRole,
        error: error.message,
        path: req.path,
      });
      return res.status(500).json({
        success: false,
        message: 'Erro ao verificar papel de usuário',
        error: error.message,
      });
    }
  };
};

/**
 * Middleware de verificação de admin.
 * Ordem: admin bypass por token → DB (todos os ADMIN_ROLE_NAMES, com cache)
 * Seta req.user.isAdmin = true quando aprovado.
 */
const isAdmin = async (req, res, next) => {
  const userId = req.uid;

  if (!userId) {
    return res.status(401).json({ success: false, message: 'Autenticação necessária' });
  }

  try {
    const admin = await resolveAdmin(userId, req);

    if (admin) {
      req.user.isAdmin = true;
      return next();
    }

    logger.warn('Usuário sem permissão de admin tentou acessar recurso protegido', {
      middleware: 'isAdmin',
      userId,
    });
    return res.status(403).json({ success: false, message: 'Acesso negado' });
  } catch (error) {
    logger.error('Erro ao verificar permissões de admin', {
      middleware: 'isAdmin',
      userId,
      error: error.message,
    });
    return res.status(500).json({ success: false, message: 'Erro ao verificar permissões' });
  }
};

/**
 * Middleware para verificação de validação bancária de caixinha.
 * Ordem: admin bypass → Supabase RPCs (se USE_SUPABASE_RBAC) → getUserRoles fallback
 */
const checkBankValidation = (getCaixinhaId = req => req.params.caixinhaId) => {
  return async (req, res, next) => {
    try {
      const userId = req.uid;

      if (!userId) {
        return res.status(401).json({ success: false, message: 'Autenticação necessária' });
      }

      const caixinhaId = getCaixinhaId(req);

      if (!caixinhaId) {
        return res.status(400).json({ success: false, message: 'ID da caixinha não fornecido' });
      }

      const supabase = getSupabaseClient();

      // Feature Toggle: Supabase RPCs
      if (process.env.USE_SUPABASE_RBAC === 'true' && supabase) {
        const { data: hasAccess, error: accessError } = await supabase.rpc('check_caixinha_access', {
          p_user_id: userId,
          p_caixinha_id: caixinhaId,
        });

        if (accessError) {
          logger.error('Erro no Supabase check_caixinha_access', { accessError });
        } else if (hasAccess) {
          return next();
        }

        const { data: isPending, error: pendingError } = await supabase.rpc('check_caixinha_pending', {
          p_user_id: userId,
          p_caixinha_id: caixinhaId,
        });

        if (!pendingError && isPending) {
          return res.status(403).json({
            success: false,
            message: 'Validação bancária pendente',
            requiresValidation: true,
            caixinhaId,
          });
        }
        // Se ambos os RPCs falharam, cai no fallback abaixo
      }

      // Fallback: getUserRoles via userRoleService (com cache)
      const userRoles = await userRoleService.getUserRoles(userId, 'caixinha', caixinhaId);

      if (userRoles.some(ur => ur.validationStatus === 'validated')) {
        return next();
      }

      if (userRoles.length > 0) {
        return res.status(403).json({
          success: false,
          message: 'Validação bancária pendente',
          requiresValidation: true,
          caixinhaId,
        });
      }

      return res.status(403).json({
        success: false,
        message: 'Você não tem acesso a esta caixinha',
      });
    } catch (error) {
      logger.error('Erro ao verificar validação bancária', {
        middleware: 'checkBankValidation',
        userId: req.uid,
        error: error.message,
      });
      return res.status(500).json({
        success: false,
        message: 'Erro ao verificar validação bancária',
        error: error.message,
      });
    }
  };
};

/**
 * Middleware para verificar membership em uma caixinha.
 * Ordem: admin bypass → Supabase caixinha_members → Firestore legado
 */
const checkCaixinhaMembership = (getCaixinhaId = req => req.params.caixinhaId) => {
  return async (req, res, next) => {
    try {
      const userId = req.uid;
      const caixinhaId = getCaixinhaId(req);

      if (!userId || !caixinhaId) {
        return res.status(400).json({
          success: false,
          message: 'Dados insuficientes para verificar membership',
        });
      }

      // Admin bypass (token → DB com cache)
      if (await resolveAdmin(userId, req)) return next();

      const supabase = getSupabaseClient();

      // Supabase: caixinha_members
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

      // Fallback legado: array members na caixinha (Firestore)
      const Caixinha = require('../models/Caixinhas');
      const caixinha = await Caixinha.getById(caixinhaId);

      if (caixinha?.members?.includes(userId)) return next();

      logger.warn('Usuário sem membership tentou acessar caixinha', {
        middleware: 'checkCaixinhaMembership',
        userId,
        caixinhaId,
      });
      return res.status(403).json({ success: false, message: 'Você não é membro desta caixinha' });
    } catch (error) {
      logger.error('Erro ao verificar membership da caixinha', {
        middleware: 'checkCaixinhaMembership',
        error: error.message,
      });
      return res.status(403).json({ success: false, message: 'Erro ao verificar permissão de membro' });
    }
  };
};

module.exports = {
  checkPermission,
  checkRole,
  isAdmin,
  checkBankValidation,
  checkCaixinhaMembership,
};
