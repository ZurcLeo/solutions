// services/roleService.js
const { logger } = require('../logger');
const Role = require('../models/Role');
const RolePermission = require('../models/RolePermission');
const UserRole = require('../models/UserRole');

/**
 * Serviço para gerenciamento de roles do sistema
 */
class RoleService {
  /**
   * Cria uma nova role
   * @param {Object} roleData - Dados da role a ser criada
   * @returns {Promise<Role>} A role criada
   */
  async createRole(roleData) {
    logger.info('Criando nova role', {
      service: 'roleService',
      function: 'createRole',
      roleName: roleData.name
    });
    
    try {
      return await Role.create(roleData);
    } catch (error) {
      logger.error('Erro ao criar role', {
        service: 'roleService',
        function: 'createRole',
        error: error.message,
        roleData
      });
      throw error;
    }
  }

  /**
   * Atualiza uma role existente
   * @param {string} roleId - ID da role a ser atualizada
   * @param {Object} roleData - Novos dados da role
   * @returns {Promise<Role>} A role atualizada
   */
  async updateRole(roleId, roleData) {
    logger.info('Atualizando role', {
      service: 'roleService',
      function: 'updateRole',
      roleId
    });
    
    try {
      return await Role.update(roleId, roleData);
    } catch (error) {
      logger.error('Erro ao atualizar role', {
        service: 'roleService',
        function: 'updateRole',
        roleId,
        error: error.message,
        roleData
      });
      throw error;
    }
  }

  /**
   * Remove uma role
   * @param {string} roleId - ID da role a ser removida
   * @returns {Promise<boolean>} Sucesso da operação
   */
  async deleteRole(roleId) {
    logger.info('Removendo role', {
      service: 'roleService',
      function: 'deleteRole',
      roleId
    });
    
    try {
      // Verificar se a role está em uso
      const isInUse = await this.isRoleInUse(roleId);
      
      if (isInUse) {
        throw new Error('Não é possível remover uma role que está em uso por usuários');
      }
      
      // Remover todas as associações de permissões
      const rolePermissions = await RolePermission.getByRoleId(roleId);
      for (const rp of rolePermissions) {
        await RolePermission.removePermissionFromRole(roleId, rp.permissionId);
      }
      
      // Remover a role
      return await Role.delete(roleId);
    } catch (error) {
      logger.error('Erro ao remover role', {
        service: 'roleService',
        function: 'deleteRole',
        roleId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Obtém todas as roles com filtros opcionais
   * @param {Object} filters - Filtros opcionais
   * @returns {Promise<Array<Role>>} Lista de roles
   */
  async getRoles(filters = {}) {
    logger.info('Buscando roles', {
      service: 'roleService',
      function: 'getRoles',
      filters
    });
    
    try {
      const roles = await Role.findAll();
      
      // Aplicar filtros em memória (se necessário)
      let filteredRoles = roles;
      
      if (filters.isSystemRole !== undefined) {
        filteredRoles = filteredRoles.filter(role => 
          role.isSystemRole === filters.isSystemRole
        );
      }
      
      if (filters.name) {
        const nameFilter = filters.name.toLowerCase();
        filteredRoles = filteredRoles.filter(role => 
          role.name.toLowerCase().includes(nameFilter)
        );
      }
      
      return filteredRoles;
    } catch (error) {
      logger.error('Erro ao buscar roles', {
        service: 'roleService',
        function: 'getRoles',
        error: error.message,
        filters
      });
      throw error;
    }
  }

  /**
   * Obtém uma role pelo ID
   * @param {string} roleId - ID da role
   * @returns {Promise<Role>} A role encontrada
   */
  async getRoleById(roleId) {
    logger.info('Buscando role por ID', {
      service: 'roleService',
      function: 'getRoleById',
      roleId
    });
    
    try {
      return await Role.getById(roleId);
    } catch (error) {
      logger.error('Erro ao buscar role por ID', {
        service: 'roleService',
        function: 'getRoleById',
        roleId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Obtém as permissões associadas a uma role
   * @param {string} roleId - ID da role
   * @returns {Promise<Array<Permission>>} Lista de permissões
   */
  async getRolePermissions(roleId) {
    logger.info('Buscando permissões da role', {
      service: 'roleService',
      function: 'getRolePermissions',
      roleId
    });
    
    try {
      return await RolePermission.getRolePermissions(roleId);
    } catch (error) {
      logger.error('Erro ao buscar permissões da role', {
        service: 'roleService',
        function: 'getRolePermissions',
        roleId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Verifica se uma role está sendo usada por algum usuário
   * @param {string} roleId - ID da role
   * @returns {Promise<boolean>} True se a role estiver em uso
   */
  async isRoleInUse(roleId) {
    try {
      // Buscar no Firestore se há algum documento UserRole com esta roleId
      const db = require('../firebaseAdmin').getFirestore();
      const snapshot = await db.collection('user_roles')
        .where('roleId', '==', roleId)
        .limit(1)
        .get();
      
      return !snapshot.empty;
    } catch (error) {
      logger.error('Erro ao verificar se role está em uso', {
        service: 'roleService',
        function: 'isRoleInUse',
        roleId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Inicializa as roles padrão do sistema
   * @returns {Promise<void>}
   */
  async initializeDefaultRoles() {
    const defaultRoles = [
      {
        name: 'Client',
        description: 'Usuário padrão do sistema',
        isSystemRole: true
      },
      {
        name: 'Admin',
        description: 'Administrador do sistema com acesso completo',
        isSystemRole: true
      },
      {
        name: 'Support',
        description: 'Equipe de suporte ao cliente',
        isSystemRole: true
      },
      {
        name: 'Seller',
        description: 'Vendedor do marketplace',
        isSystemRole: true
      },
      {
        name: 'CaixinhaManager',
        description: 'Gerente de caixinha',
        isSystemRole: true
      },
      {
        name: 'CaixinhaMember',
        description: 'Membro de caixinha',
        isSystemRole: true
      },
      {
        name: 'CaixinhaModerator',
        description: 'Moderador de caixinha',
        isSystemRole: true
      }
    ];
    
    logger.info('Inicializando roles padrão do sistema', {
      service: 'roleService',
      function: 'initializeDefaultRoles'
    });
    
    try {
      // Buscar roles existentes
      const existingRoles = await Role.findAll();
      const existingRoleNames = existingRoles.map(role => role.name);
      
      // Criar apenas as roles que não existem
      for (const roleData of defaultRoles) {
        if (!existingRoleNames.includes(roleData.name)) {
          await Role.create(roleData);
          logger.info(`Role padrão criada: ${roleData.name}`, {
            service: 'roleService',
            function: 'initializeDefaultRoles'
          });
        }
      }
      
      logger.info('Inicialização de roles padrão concluída', {
        service: 'roleService',
        function: 'initializeDefaultRoles'
      });
    } catch (error) {
      logger.error('Erro ao inicializar roles padrão', {
        service: 'roleService',
        function: 'initializeDefaultRoles',
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = new RoleService();