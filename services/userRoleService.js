// services/userRoleService.js
const { logger } = require('../logger');
const UserRole = require('../models/UserRole');
const Role = require('../models/Role');
const User = require('../models/User');
const RolePermission = require('../models/RolePermission');

/**
 * Serviço para gerenciamento de roles de usuário
 */
class UserRoleService {
  /**
   * Atribui uma role a um usuário
   * @param {string} userId - ID do usuário
   * @param {string} roleId - ID da role
   * @param {Object} context - Contexto onde a role se aplica
   * @param {Object} options - Opções adicionais
   * @returns {Promise<UserRole>} A UserRole criada
   */
  async assignRoleToUser(userId, roleId, context = { type: 'global', resourceId: null }, options = {}) {
    logger.info('Atribuindo role ao usuário', {
      service: 'userRoleService',
      function: 'assignRoleToUser',
      userId,
      roleId,
      context
    });
    
    try {
      return await UserRole.assignRoleToUser(userId, roleId, context, options);
    } catch (error) {
      logger.error('Erro ao atribuir role ao usuário', {
        service: 'userRoleService',
        function: 'assignRoleToUser',
        userId,
        roleId,
        context,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Remove uma role de um usuário
   * @param {string} userRoleId - ID da userRole a ser removida
   * @returns {Promise<boolean>} Sucesso da operação
   */
  async removeRoleFromUser(userRoleId) {
    logger.info('Removendo role do usuário', {
      service: 'userRoleService',
      function: 'removeRoleFromUser',
      userRoleId
    });
    
    try {
      return await UserRole.removeRoleFromUser(userRoleId);
    } catch (error) {
      logger.error('Erro ao remover role do usuário', {
        service: 'userRoleService',
        function: 'removeRoleFromUser',
        userRoleId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Obtém as roles de um usuário
   * @param {string} userId - ID do usuário
   * @param {string} contextType - Tipo de contexto (opcional)
   * @param {string} resourceId - ID do recurso no contexto (opcional)
   * @returns {Promise<Array<UserRole>>} Lista de userRoles
   */
  async getUserRoles(userId, contextType = null, resourceId = null) {
    logger.info('Buscando roles do usuário', {
      service: 'userRoleService',
      function: 'getUserRoles',
      userId,
      contextType,
      resourceId
    });
    
    try {
      return await UserRole.getUserRoles(userId, contextType, resourceId);
    } catch (error) {
      logger.error('Erro ao buscar roles do usuário', {
        service: 'userRoleService',
        function: 'getUserRoles',
        userId,
        contextType,
        resourceId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Valida uma role de usuário
   * @param {string} userRoleId - ID da userRole
   * @param {Object} validationData - Dados adicionais para validação
   * @returns {Promise<UserRole>} A userRole validada
   */
  async validateUserRole(userRoleId, validationData = {}) {
    logger.info('Validando role do usuário', {
      service: 'userRoleService',
      function: 'validateUserRole',
      userRoleId
    });
    
    try {
      return await UserRole.validateUserRole(userRoleId, validationData);
    } catch (error) {
      logger.error('Erro ao validar role do usuário', {
        service: 'userRoleService',
        function: 'validateUserRole',
        userRoleId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Rejeita uma role de usuário
   * @param {string} userRoleId - ID da userRole
   * @param {Object} reasonData - Dados sobre o motivo da rejeição
   * @returns {Promise<UserRole>} A userRole rejeitada
   */
  async rejectUserRole(userRoleId, reasonData = {}) {
    logger.info('Rejeitando role do usuário', {
      service: 'userRoleService',
      function: 'rejectUserRole',
      userRoleId,
      reasonData
    });
    
    try {
      return await UserRole.rejectUserRole(userRoleId, reasonData);
    } catch (error) {
      logger.error('Erro ao rejeitar role do usuário', {
        service: 'userRoleService',
        function: 'rejectUserRole',
        userRoleId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Verifica se um usuário tem uma role específica
   * @param {string} userId - ID do usuário
   * @param {string} roleName - Nome da role
   * @param {string} contextType - Tipo de contexto (opcional)
   * @param {string} resourceId - ID do recurso no contexto (opcional)
   * @returns {Promise<boolean>} True se o usuário tiver a role
   */
  async checkUserHasRole(userId, roleName, contextType = 'global', resourceId = null) {
    logger.info('Verificando se usuário tem role', {
      service: 'userRoleService',
      function: 'checkUserHasRole',
      userId,
      roleName,
      contextType,
      resourceId
    });
    
    try {
      return await UserRole.checkUserHasRole(userId, roleName, contextType, resourceId);
    } catch (error) {
      logger.error('Erro ao verificar se usuário tem role', {
        service: 'userRoleService',
        function: 'checkUserHasRole',
        userId,
        roleName,
        contextType,
        resourceId,
        error: error.message
      });
      // Em caso de erro, retornar false por segurança
      return false;
    }
  }

  /**
   * Verifica se um usuário tem uma permissão específica
   * @param {string} userId - ID do usuário
   * @param {string} permissionName - Nome da permissão
   * @param {string} contextType - Tipo de contexto (opcional)
   * @param {string} resourceId - ID do recurso no contexto (opcional)
   * @returns {Promise<boolean>} True se o usuário tiver a permissão
   */
  async checkUserHasPermission(userId, permissionName, contextType = 'global', resourceId = null) {
    logger.info('Verificando se usuário tem permissão', {
      service: 'userRoleService',
      function: 'checkUserHasPermission',
      userId,
      permissionName,
      contextType,
      resourceId
    });
    
    try {
      return await UserRole.checkUserHasPermission(userId, permissionName, contextType, resourceId);
    } catch (error) {
      logger.error('Erro ao verificar se usuário tem permissão', {
        service: 'userRoleService',
        function: 'checkUserHasPermission',
        userId,
        permissionName,
        contextType,
        resourceId,
        error: error.message
      });
      // Em caso de erro, retornar false por segurança
      return false;
    }
  }

  /**
   * Migra usuários com flag isOwnerOrAdmin para a role Admin
   * @returns {Promise<Object>} Resultado da migração
   */
  async migrateAdminUsers() {
    logger.info('Iniciando migração de usuários admin', {
      service: 'userRoleService',
      function: 'migrateAdminUsers'
    });
    
    try {
      // 1. Buscar todos os usuários com isOwnerOrAdmin = true
      const users = await User.findAll();
      const adminUsers = users.filter(user => user.isOwnerOrAdmin === true);
      
      if (adminUsers.length === 0) {
        logger.info('Nenhum usuário admin para migrar', {
          service: 'userRoleService',
          function: 'migrateAdminUsers'
        });
        
        return { success: true, migratedUsers: 0 };
      }
      
      // 2. Buscar a role Admin
      const roles = await Role.findAll();
      const adminRole = roles.find(role => role.name === 'Admin');
      
      if (!adminRole) {
        throw new Error('Role Admin não encontrada');
      }
      
      // 3. Atribuir a role Admin para cada usuário
      let migratedCount = 0;
      let errorCount = 0;
      
      for (const user of adminUsers) {
        try {
          // Verificar se o usuário já tem a role Admin
          const existingRoles = await this.getUserRoles(user.uid, 'global');
          const hasAdminRole = existingRoles.some(ur => ur.roleId === adminRole.id);
          
          if (!hasAdminRole) {
            await this.assignRoleToUser(
              user.uid, 
              adminRole.id, 
              { type: 'global', resourceId: null },
              { 
                validationStatus: 'validated',
                createdBy: 'system',
                metadata: { migratedFromIsOwnerOrAdmin: true }
              }
            );
            
            migratedCount++;
          }
        } catch (userError) {
          logger.error(`Erro ao migrar usuário admin: ${user.uid}`, {
            service: 'userRoleService',
            function: 'migrateAdminUsers',
            userId: user.uid,
            error: userError.message
          });
          
          errorCount++;
        }
      }
      
      logger.info('Migração de usuários admin concluída', {
        service: 'userRoleService',
        function: 'migrateAdminUsers',
        totalUsers: adminUsers.length,
        migratedUsers: migratedCount,
        errorUsers: errorCount
      });
      
      return {
        success: true,
        totalUsers: adminUsers.length,
        migratedUsers: migratedCount,
        errorUsers: errorCount
      };
    } catch (error) {
      logger.error('Erro ao migrar usuários admin', {
        service: 'userRoleService',
        function: 'migrateAdminUsers',
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Registra um novo usuário e atribui a role Client
   * @param {string} userId - ID do usuário
   * @returns {Promise<UserRole>} A UserRole criada
   */
  async registerNewUser(userId) {
    logger.info('Registrando novo usuário', {
      service: 'userRoleService',
      function: 'registerNewUser',
      userId
    });
    
    try {
      // 1. Buscar a role Client
      const roles = await Role.findAll();
      const clientRole = roles.find(role => role.name === 'Client');
      
      if (!clientRole) {
        throw new Error('Role Client não encontrada');
      }
      
      // 2. Atribuir a role Client ao usuário
      const userRole = await this.assignRoleToUser(
        userId, 
        clientRole.id, 
        { type: 'global', resourceId: null },
        { 
          validationStatus: 'validated',
          createdBy: 'system',
          metadata: { initialRegistration: true }
        }
      );
      
      logger.info('Novo usuário registrado com sucesso', {
        service: 'userRoleService',
        function: 'registerNewUser',
        userId,
        userRoleId: userRole.id
      });
      
      return userRole;
    } catch (error) {
      logger.error('Erro ao registrar novo usuário', {
        service: 'userRoleService',
        function: 'registerNewUser',
        userId,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Registra um usuário como gerente de caixinha
   * @param {string} userId - ID do usuário
   * @param {string} caixinhaId - ID da caixinha
   * @returns {Promise<UserRole>} A UserRole criada
   */
  async registerCaixinhaManager(userId, caixinhaId) {
    logger.info('Registrando gerente de caixinha', {
      service: 'userRoleService',
      function: 'registerCaixinhaManager',
      userId,
      caixinhaId
    });
    
    try {
      // 1. Buscar a role CaixinhaManager
      const roles = await Role.findAll();
      const managerRole = roles.find(role => role.name === 'CaixinhaManager');
      
      if (!managerRole) {
        throw new Error('Role CaixinhaManager não encontrada');
      }
      
      // 2. Atribuir a role CaixinhaManager ao usuário
      const userRole = await this.assignRoleToUser(
        userId, 
        managerRole.id, 
        { type: 'caixinha', resourceId: caixinhaId },
        { 
          validationStatus: 'pending', // Requer validação de dados bancários
          createdBy: 'system',
          metadata: { caixinhaCreation: true }
        }
      );
      
      logger.info('Gerente de caixinha registrado com sucesso', {
        service: 'userRoleService',
        function: 'registerCaixinhaManager',
        userId,
        caixinhaId,
        userRoleId: userRole.id
      });
      
      return userRole;
    } catch (error) {
      logger.error('Erro ao registrar gerente de caixinha', {
        service: 'userRoleService',
        function: 'registerCaixinhaManager',
        userId,
        caixinhaId,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Registra um usuário como membro de caixinha
   * @param {string} userId - ID do usuário
   * @param {string} caixinhaId - ID da caixinha
   * @returns {Promise<UserRole>} A UserRole criada
   */
  async registerCaixinhaMember(userId, caixinhaId) {
    logger.info('Registrando membro de caixinha', {
      service: 'userRoleService',
      function: 'registerCaixinhaMember',
      userId,
      caixinhaId
    });
    
    try {
      // 1. Buscar a role CaixinhaMember
      const roles = await Role.findAll();
      const memberRole = roles.find(role => role.name === 'CaixinhaMember');
      
      if (!memberRole) {
        throw new Error('Role CaixinhaMember não encontrada');
      }
      
      // 2. Atribuir a role CaixinhaMember ao usuário
      const userRole = await this.assignRoleToUser(
        userId, 
        memberRole.id, 
        { type: 'caixinha', resourceId: caixinhaId },
        { 
          validationStatus: 'pending', // Requer validação de dados bancários
          createdBy: 'system',
          metadata: { caixinhaJoin: true }
        }
      );
      
      logger.info('Membro de caixinha registrado com sucesso', {
        service: 'userRoleService',
        function: 'registerCaixinhaMember',
        userId,
        caixinhaId,
        userRoleId: userRole.id
      });
      
      return userRole;
    } catch (error) {
      logger.error('Erro ao registrar membro de caixinha', {
        service: 'userRoleService',
        function: 'registerCaixinhaMember',
        userId,
        caixinhaId,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Promove um membro de caixinha para moderador
   * @param {string} userId - ID do usuário
   * @param {string} caixinhaId - ID da caixinha
   * @param {string} promoterId - ID do usuário que está promovendo
   * @returns {Promise<UserRole>} A UserRole criada
   */
  async promoteToCaixinhaModerator(userId, caixinhaId, promoterId) {
    logger.info('Promovendo membro a moderador de caixinha', {
      service: 'userRoleService',
      function: 'promoteToCaixinhaModerator',
      userId,
      caixinhaId,
      promoterId
    });
    
    try {
      // 1. Verificar se o usuário é membro da caixinha
      const isMember = await this.checkUserHasRole(userId, 'CaixinhaMember', 'caixinha', caixinhaId);
      
      if (!isMember) {
        throw new Error('Usuário não é membro da caixinha');
      }
      
      // 2. Verificar se o promoter é gerente da caixinha
      const isManager = await this.checkUserHasRole(promoterId, 'CaixinhaManager', 'caixinha', caixinhaId);
      
      if (!isManager) {
        throw new Error('Apenas o gerente da caixinha pode promover membros a moderadores');
      }
      
      // 3. Buscar a role CaixinhaModerator
      const roles = await Role.findAll();
      const moderatorRole = roles.find(role => role.name === 'CaixinhaModerator');
      
      if (!moderatorRole) {
        throw new Error('Role CaixinhaModerator não encontrada');
      }
      
      // 4. Atribuir a role CaixinhaModerator ao usuário
      const userRole = await this.assignRoleToUser(
        userId, 
        moderatorRole.id, 
        { type: 'caixinha', resourceId: caixinhaId },
        { 
          validationStatus: 'validated', // Já deve estar validado como membro
          createdBy: promoterId,
          metadata: { 
            promotedAt: new Date(),
            promotedBy: promoterId
          }
        }
      );
      
      logger.info('Membro promovido a moderador com sucesso', {
        service: 'userRoleService',
        function: 'promoteToCaixinhaModerator',
        userId,
        caixinhaId,
        promoterId,
        userRoleId: userRole.id
      });
      
      return userRole;
    } catch (error) {
      logger.error('Erro ao promover membro a moderador', {
        service: 'userRoleService',
        function: 'promoteToCaixinhaModerator',
        userId,
        caixinhaId,
        promoterId,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Registra um vendedor do marketplace
   * @param {string} userId - ID do usuário
   * @returns {Promise<UserRole>} A UserRole criada
   */
  async registerSeller(userId) {
    logger.info('Registrando vendedor do marketplace', {
      service: 'userRoleService',
      function: 'registerSeller',
      userId
    });
    
    try {
      // 1. Buscar a role Seller
      const roles = await Role.findAll();
      const sellerRole = roles.find(role => role.name === 'Seller');
      
      if (!sellerRole) {
        throw new Error('Role Seller não encontrada');
      }
      
      // 2. Atribuir a role Seller ao usuário
      const userRole = await this.assignRoleToUser(
        userId, 
        sellerRole.id, 
        { type: 'global', resourceId: null },
        { 
          validationStatus: 'pending', // Requer validação de dados
          createdBy: 'system',
          metadata: { sellerRegistration: true }
        }
      );
      
      logger.info('Vendedor registrado com sucesso', {
        service: 'userRoleService',
        function: 'registerSeller',
        userId,
        userRoleId: userRole.id
      });
      
      return userRole;
    } catch (error) {
      logger.error('Erro ao registrar vendedor', {
        service: 'userRoleService',
        function: 'registerSeller',
        userId,
        error: error.message
      });
      
      throw error;
    }
  }
}

module.exports = new UserRoleService();