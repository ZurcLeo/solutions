// controllers/roleController.js
const { logger } = require('../logger');
const roleService = require('../services/roleService');
const permissionService = require('../services/permissionService');
const RolePermission = require('../models/RolePermission');

/**
 * Obtém todas as roles
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const getAllRoles = async (req, res) => {
  try {
    const filters = req.query || {};
    const roles = await roleService.getRoles(filters);
    
    res.status(200).json({
      success: true,
      data: roles
    });
  } catch (error) {
    logger.error('Erro ao buscar roles', {
      controller: 'roleController',
      method: 'getAllRoles',
      error: error.message
    });
    
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar roles',
      error: error.message
    });
  }
};

/**
 * Obtém uma role pelo ID
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const getRoleById = async (req, res) => {
  try {
    const { id } = req.params;
    const role = await roleService.getRoleById(id);
    
    res.status(200).json({
      success: true,
      data: role
    });
  } catch (error) {
    logger.error('Erro ao buscar role por ID', {
      controller: 'roleController',
      method: 'getRoleById',
      roleId: req.params.id,
      error: error.message
    });
    
    if (error.message === 'Role não encontrada') {
      return res.status(404).json({
        success: false,
        message: 'Role não encontrada'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar role',
      error: error.message
    });
  }
};

/**
 * Cria uma nova role
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const createRole = async (req, res) => {
  try {
    const roleData = req.body;
    const role = await roleService.createRole(roleData);
    
    res.status(201).json({
      success: true,
      message: 'Role criada com sucesso',
      data: role
    });
  } catch (error) {
    logger.error('Erro ao criar role', {
      controller: 'roleController',
      method: 'createRole',
      roleData: req.body,
      error: error.message
    });
    
    if (error.message.includes('já existe')) {
      return res.status(409).json({
        success: false,
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Erro ao criar role',
      error: error.message
    });
  }
};

/**
 * Atualiza uma role existente
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const roleData = req.body;
    const role = await roleService.updateRole(id, roleData);
    
    res.status(200).json({
      success: true,
      message: 'Role atualizada com sucesso',
      data: role
    });
  } catch (error) {
    logger.error('Erro ao atualizar role', {
      controller: 'roleController',
      method: 'updateRole',
      roleId: req.params.id,
      roleData: req.body,
      error: error.message
    });
    
    if (error.message === 'Role não encontrada') {
      return res.status(404).json({
        success: false,
        message: 'Role não encontrada'
      });
    }
    
    if (error.message.includes('já existe')) {
      return res.status(409).json({
        success: false,
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Erro ao atualizar role',
      error: error.message
    });
  }
};

/**
 * Remove uma role
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const deleteRole = async (req, res) => {
  try {
    const { id } = req.params;
    await roleService.deleteRole(id);
    
    res.status(200).json({
      success: true,
      message: 'Role removida com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao remover role', {
      controller: 'roleController',
      method: 'deleteRole',
      roleId: req.params.id,
      error: error.message
    });
    
    if (error.message === 'Role não encontrada') {
      return res.status(404).json({
        success: false,
        message: 'Role não encontrada'
      });
    }
    
    if (error.message.includes('em uso')) {
      return res.status(409).json({
        success: false,
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Erro ao remover role',
      error: error.message
    });
  }
};

/**
 * Obtém as permissões de uma role
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const getRolePermissions = async (req, res) => {
  try {
    const { id } = req.params;
    const permissions = await roleService.getRolePermissions(id);
    
    res.status(200).json({
      success: true,
      data: permissions
    });
  } catch (error) {
    logger.error('Erro ao buscar permissões da role', {
      controller: 'roleController',
      method: 'getRolePermissions',
      roleId: req.params.id,
      error: error.message
    });
    
    if (error.message === 'Role não encontrada') {
      return res.status(404).json({
        success: false,
        message: 'Role não encontrada'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar permissões da role',
      error: error.message
    });
  }
};

/**
 * Atribui uma permissão a uma role
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const assignPermissionToRole = async (req, res) => {
  try {
    const { roleId, permissionId } = req.params;
    const result = await permissionService.assignPermissionToRole(roleId, permissionId);
    
    res.status(200).json({
      success: true,
      message: 'Permissão atribuída à role com sucesso',
      data: result
    });
  } catch (error) {
    logger.error('Erro ao atribuir permissão à role', {
      controller: 'roleController',
      method: 'assignPermissionToRole',
      roleId: req.params.roleId,
      permissionId: req.params.permissionId,
      error: error.message
    });
    
    if (error.message.includes('não encontrada')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Erro ao atribuir permissão à role',
      error: error.message
    });
  }
};

/**
 * Remove uma permissão de uma role
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const removePermissionFromRole = async (req, res) => {
  try {
    const { roleId, permissionId } = req.params;
    const result = await permissionService.removePermissionFromRole(roleId, permissionId);
    
    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Associação entre role e permissão não encontrada'
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Permissão removida da role com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao remover permissão da role', {
      controller: 'roleController',
      method: 'removePermissionFromRole',
      roleId: req.params.roleId,
      permissionId: req.params.permissionId,
      error: error.message
    });
    
    res.status(500).json({
      success: false,
      message: 'Erro ao remover permissão da role',
      error: error.message
    });
  }
};

/**
 * Inicializa as roles e permissões padrão do sistema
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const initializeSystem = async (req, res) => {
  try {
    // Inicializar roles padrão
    await roleService.initializeDefaultRoles();
    
    // Inicializar permissões padrão
    await permissionService.initializeDefaultPermissions();
    
    // Configurar permissões básicas para cada role
    await setupDefaultRolePermissions();
    
    res.status(200).json({
      success: true,
      message: 'Sistema de RBAC inicializado com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao inicializar sistema de RBAC', {
      controller: 'roleController',
      method: 'initializeSystem',
      error: error.message
    });
    
    res.status(500).json({
      success: false,
      message: 'Erro ao inicializar sistema de RBAC',
      error: error.message
    });
  }
};

/**
 * Configura as permissões padrão para cada role
 * @returns {Promise<void>}
 */
const setupDefaultRolePermissions = async () => {
  try {
    const roles = await roleService.getRoles();
    const permissions = await permissionService.getPermissions();
    
    // Mapeamento de nome da role para array de nomes de permissões
    const rolePermissionsMap = {
      Admin: permissions.map(p => p.name), // Admin tem todas as permissões
      
      Client: [
        'caixinha:read',
        'product:read',
        'order:create',
        'order:read'
      ],
      
      Seller: [
        'product:create',
        'product:read',
        'product:update',
        'product:delete',
        'order:read',
        'order:update'
      ],
      
      Support: [
        'support:access',
        'support:manage_tickets',
        'support:view_logs',
        'user:read',
        'caixinha:read',
        'product:read',
        'order:read'
      ],
      
      CaixinhaManager: [
        'caixinha:read',
        'caixinha:update',
        'caixinha:delete',
        'caixinha:manage_members',
        'caixinha:manage_loans',
        'caixinha:view_reports'
      ],
      
      CaixinhaMember: [
        'caixinha:read'
      ],
      
      CaixinhaModerator: [
        'caixinha:read',
        'caixinha:manage_members',
        'caixinha:view_reports'
      ]
    };
    
    // Para cada role, atribuir suas permissões padrão
    for (const role of roles) {
      const permissionNames = rolePermissionsMap[role.name];
      
      if (permissionNames) {
        for (const permissionName of permissionNames) {
          // Encontrar a permissão pelo nome
          const permission = permissions.find(p => p.name === permissionName);
          
          if (permission) {
            try {
              // Verificar se já existe a associação
              const existingRolePermissions = await RolePermission.getByRoleId(role.id);
              const alreadyAssigned = existingRolePermissions.some(rp => 
                rp.permissionId === permission.id
              );
              
              if (!alreadyAssigned) {
                await permissionService.assignPermissionToRole(role.id, permission.id);
                
                logger.info(`Permissão '${permissionName}' atribuída à role '${role.name}'`, {
                  function: 'setupDefaultRolePermissions'
                });
              }
            } catch (error) {
              logger.warn(`Erro ao atribuir permissão '${permissionName}' à role '${role.name}'`, {
                function: 'setupDefaultRolePermissions',
                error: error.message
              });
            }
          }
        }
      }
    }
    
    logger.info('Configuração de permissões padrão concluída', {
      function: 'setupDefaultRolePermissions'
    });
  } catch (error) {
    logger.error('Erro ao configurar permissões padrão', {
      function: 'setupDefaultRolePermissions',
      error: error.message
    });
    
    throw error;
  }
};

module.exports = {
  getAllRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
  getRolePermissions,
  assignPermissionToRole,
  removePermissionFromRole,
  initializeSystem
};