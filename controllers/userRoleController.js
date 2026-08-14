// controllers/userRoleController.js
const { logger } = require('../logger');
const userRoleService = require('../services/userRoleService');
const User = require('../models/User');
const { getSupabaseClient } = require('../config/supabase');

/**
 * Obtém as roles de um usuário
 */
const getUserRoles = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.getById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    const userRoles = await userRoleService.getUserRoles(userId);

    logger.info('Roles do usuário obtidas pelo controller', {
      controller: 'userRoleController',
      method: 'getUserRoles',
      userId,
      rolesCount: userRoles.length
    });

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
 * POST /rbac/users/:userId/roles
 * Body: { roleId (UUID), context: { type, resourceId }, options: { validationStatus } }
 */
const assignRoleToUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { roleId, context = { type: 'global', resourceId: '' }, options = {} } = req.body;

    if (!roleId) {
      return res.status(400).json({ success: false, message: 'roleId é obrigatório' });
    }

    const user = await User.getById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    }

    const supabase = getSupabaseClient();

    // Resolver nome da role a partir do UUID (frontend envia UUID)
    const { data: roleData, error: roleError } = await supabase
      .from('roles')
      .select('name')
      .eq('id', roleId)
      .maybeSingle();

    if (roleError) throw roleError;
    if (!roleData) {
      return res.status(404).json({ success: false, message: 'Role não encontrada' });
    }

    const { error: rpcError } = await supabase.rpc('sync_user_role', {
      p_user_id: userId,
      p_role_name: roleData.name,
      p_context_type: context.type || 'global',
      p_resource_id: context.resourceId || null,
      p_validation_status: options.validationStatus || 'validated',
    });

    if (rpcError) throw rpcError;

    userRoleService.invalidateUserCache(userId);

    logger.info('Role atribuída com sucesso', {
      controller: 'userRoleController',
      method: 'assignRoleToUser',
      userId,
      roleName: roleData.name,
      context,
    });

    return res.status(201).json({ success: true, message: 'Role atribuída com sucesso' });
  } catch (error) {
    logger.error('Erro ao atribuir role ao usuário', {
      controller: 'userRoleController',
      method: 'assignRoleToUser',
      userId: req.params.userId,
      error: error.message,
    });

    return res.status(500).json({ success: false, message: 'Erro ao atribuir role', error: error.message });
  }
};

module.exports = { getUserRoles, assignRoleToUser };
