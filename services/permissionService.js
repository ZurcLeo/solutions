// services/permissionService.js
const { logger } = require('../logger');
const Permission = require('../models/Permission');
const RolePermission = require('../models/RolePermission');

/**
 * Serviço para gerenciamento de permissões
 */
class PermissionService {
  /**
   * Cria uma nova permissão
   * @param {Object} permissionData - Dados da permissão a ser criada
   * @returns {Promise<Permission>} A permissão criada
   */
  async createPermission(permissionData) {
    logger.info('Criando nova permissão', {
      service: 'permissionService',
      function: 'createPermission',
      permissionName: permissionData.name
    });
    
    try {
      // Formatar nome da permissão (resource:action)
      if (permissionData.resource && permissionData.action && !permissionData.name) {
        permissionData.name = `${permissionData.resource}:${permissionData.action}`;
      }
      
      return await Permission.create(permissionData);
    } catch (error) {
      logger.error('Erro ao criar permissão', {
        service: 'permissionService',
        function: 'createPermission',
        error: error.message,
        permissionData
      });
      throw error;
    }
  }

  /**
   * Atualiza uma permissão existente
   * @param {string} permissionId - ID da permissão a ser atualizada
   * @param {Object} permissionData - Novos dados da permissão
   * @returns {Promise<Permission>} A permissão atualizada
   */
  async updatePermission(permissionId, permissionData) {
    logger.info('Atualizando permissão', {
      service: 'permissionService',
      function: 'updatePermission',
      permissionId
    });
    
    try {
      // Se estiver atualizando resource e action, atualizar também o nome
      if (permissionData.resource && permissionData.action) {
        permissionData.name = `${permissionData.resource}:${permissionData.action}`;
      }
      
      return await Permission.update(permissionId, permissionData);
    } catch (error) {
      logger.error('Erro ao atualizar permissão', {
        service: 'permissionService',
        function: 'updatePermission',
        permissionId,
        error: error.message,
        permissionData
      });
      throw error;
    }
  }

  /**
   * Remove uma permissão
   * @param {string} permissionId - ID da permissão a ser removida
   * @returns {Promise<boolean>} Sucesso da operação
   */
  async deletePermission(permissionId) {
    logger.info('Removendo permissão', {
      service: 'permissionService',
      function: 'deletePermission',
      permissionId
    });
    
    try {
      // Verificar se a permissão está em uso
      const isInUse = await this.isPermissionInUse(permissionId);
      
      if (isInUse) {
        throw new Error('Não é possível remover uma permissão que está em uso por roles');
      }
      
      return await Permission.delete(permissionId);
    } catch (error) {
      logger.error('Erro ao remover permissão', {
        service: 'permissionService',
        function: 'deletePermission',
        permissionId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Obtém todas as permissões com filtros opcionais
   * @param {Object} filters - Filtros opcionais
   * @returns {Promise<Array<Permission>>} Lista de permissões
   */
  async getPermissions(filters = {}) {
    logger.info('Buscando permissões', {
      service: 'permissionService',
      function: 'getPermissions',
      filters
    });
    
    try {
      return await Permission.findAll(filters);
    } catch (error) {
      logger.error('Erro ao buscar permissões', {
        service: 'permissionService',
        function: 'getPermissions',
        error: error.message,
        filters
      });
      throw error;
    }
  }

  /**
   * Obtém uma permissão pelo ID
   * @param {string} permissionId - ID da permissão
   * @returns {Promise<Permission>} A permissão encontrada
   */
  async getPermissionById(permissionId) {
    logger.info('Buscando permissão por ID', {
      service: 'permissionService',
      function: 'getPermissionById',
      permissionId
    });
    
    try {
      return await Permission.getById(permissionId);
    } catch (error) {
      logger.error('Erro ao buscar permissão por ID', {
        service: 'permissionService',
        function: 'getPermissionById',
        permissionId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Atribui uma permissão a uma role
   * @param {string} roleId - ID da role
   * @param {string} permissionId - ID da permissão
   * @returns {Promise<Object>} Resultado da operação
   */
  async assignPermissionToRole(roleId, permissionId) {
    logger.info('Atribuindo permissão à role', {
      service: 'permissionService',
      function: 'assignPermissionToRole',
      roleId,
      permissionId
    });
    
    try {
      return await RolePermission.assignPermissionToRole(roleId, permissionId);
    } catch (error) {
      logger.error('Erro ao atribuir permissão à role', {
        service: 'permissionService',
        function: 'assignPermissionToRole',
        roleId,
        permissionId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Remove uma permissão de uma role
   * @param {string} roleId - ID da role
   * @param {string} permissionId - ID da permissão
   * @returns {Promise<boolean>} Sucesso da operação
   */
  async removePermissionFromRole(roleId, permissionId) {
    logger.info('Removendo permissão da role', {
      service: 'permissionService',
      function: 'removePermissionFromRole',
      roleId,
      permissionId
    });
    
    try {
      return await RolePermission.removePermissionFromRole(roleId, permissionId);
    } catch (error) {
      logger.error('Erro ao remover permissão da role', {
        service: 'permissionService',
        function: 'removePermissionFromRole',
        roleId,
        permissionId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Verifica se uma permissão está sendo usada por alguma role
   * @param {string} permissionId - ID da permissão
   * @returns {Promise<boolean>} True se a permissão estiver em uso
   */
  async isPermissionInUse(permissionId) {
    try {
      const rolePermissions = await RolePermission.getByPermissionId(permissionId);
      return rolePermissions.length > 0;
    } catch (error) {
      logger.error('Erro ao verificar se permissão está em uso', {
        service: 'permissionService',
        function: 'isPermissionInUse',
        permissionId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Inicializa as permissões padrão do sistema
   * @returns {Promise<void>}
   */
  async initializeDefaultPermissions() {
    const defaultPermissions = [
      // Permissões de administração
      { resource: 'admin', action: 'access', description: 'Acesso ao painel administrativo' },
      { resource: 'user', action: 'create', description: 'Criar usuários' },
      { resource: 'user', action: 'read', description: 'Visualizar usuários' },
      { resource: 'user', action: 'update', description: 'Atualizar usuários' },
      { resource: 'user', action: 'delete', description: 'Remover usuários' },
      
      // Permissões de caixinha
      { resource: 'caixinha', action: 'create', description: 'Criar caixinha' },
      { resource: 'caixinha', action: 'read', description: 'Visualizar caixinha' },
      { resource: 'caixinha', action: 'update', description: 'Atualizar caixinha' },
      { resource: 'caixinha', action: 'delete', description: 'Remover caixinha' },
      { resource: 'caixinha', action: 'manage_members', description: 'Gerenciar membros de caixinha' },
      { resource: 'caixinha', action: 'manage_loans', description: 'Gerenciar empréstimos de caixinha' },
      { resource: 'caixinha', action: 'view_reports', description: 'Visualizar relatórios de caixinha' },
      
      // Permissões de marketplace
      { resource: 'product', action: 'create', description: 'Criar produto' },
      { resource: 'product', action: 'read', description: 'Visualizar produto' },
      { resource: 'product', action: 'update', description: 'Atualizar produto' },
      { resource: 'product', action: 'delete', description: 'Remover produto' },
      { resource: 'order', action: 'create', description: 'Criar pedido' },
      { resource: 'order', action: 'read', description: 'Visualizar pedido' },
      { resource: 'order', action: 'update', description: 'Atualizar pedido' },
      { resource: 'order', action: 'cancel', description: 'Cancelar pedido' },
      
      // Permissões de suporte
      { resource: 'support', action: 'access', description: 'Acesso ao painel de suporte' },
      { resource: 'support', action: 'manage_tickets', description: 'Gerenciar tickets de suporte' },
      { resource: 'support', action: 'view_logs', description: 'Visualizar logs do sistema' }
    ];
    
    logger.info('Inicializando permissões padrão do sistema', {
      service: 'permissionService',
      function: 'initializeDefaultPermissions'
    });
    
    try {
      // Buscar permissões existentes
      const existingPermissions = await Permission.findAll();
      const existingPermissionNames = existingPermissions.map(p => p.name);
      
      // Criar apenas as permissões que não existem
      for (const permData of defaultPermissions) {
        // Formatar nome (resource:action)
        const permissionName = `${permData.resource}:${permData.action}`;
        
        if (!existingPermissionNames.includes(permissionName)) {
          await this.createPermission({
            name: permissionName,
            resource: permData.resource,
            action: permData.action,
            description: permData.description
          });
          
          logger.info(`Permissão padrão criada: ${permissionName}`, {
            service: 'permissionService',
            function: 'initializeDefaultPermissions'
          });
        }
      }
      
      logger.info('Inicialização de permissões padrão concluída', {
        service: 'permissionService',
        function: 'initializeDefaultPermissions'
      });
    } catch (error) {
      logger.error('Erro ao inicializar permissões padrão', {
        service: 'permissionService',
        function: 'initializeDefaultPermissions',
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = new PermissionService();