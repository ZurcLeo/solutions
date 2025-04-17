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
    logger.info('Inicializando permissões padrão do sistema', {
      service: 'permissionService',
      function: 'initializeDefaultPermissions'
    });
    
    try {
      // Obter permissões do initialData
      const { permissions } = require('../config/data/initialData');
      
      // Buscar permissões existentes
      const existingPermissions = await Permission.findAll();
      const existingPermissionNames = existingPermissions.map(p => p.name);
      
      // Criar apenas as permissões que não existem
      for (const permId in permissions) {
        const permData = permissions[permId];
        
        if (!existingPermissionNames.includes(permData.name)) {
          await this.createPermission({
            id: permId,  // Usar o ID do mapa como ID da permissão
            name: permData.name,
            resource: permData.resource,
            action: permData.action,
            description: permData.description
          });
          
          logger.info(`Permissão padrão criada: ${permData.name}`, {
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