// services/userRoleService.js
const { logger } = require('../logger');
const UserRole = require('../models/UserRole');
const Role = require('../models/Role');
const User = require('../models/User');
const RolePermission = require('../models/RolePermission');

const { createClient } = require('@supabase/supabase-js');

// Inicializar Supabase para leitura opcional
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

/**
 * Serviço para gerenciamento de roles de usuário
 */
class UserRoleService {
  /**
   * Verifica se um usuário tem uma role específica
   * @param {string} userId - ID do usuário
   * @param {string} roleName - Nome da role
   * @param {string} contextType - Tipo de contexto (opcional)
   * @param {string} resourceId - ID do recurso no contexto (opcional)
   * @returns {Promise<boolean>} True se o usuário tiver a role
   */
  async checkUserHasRole(userId, roleName, contextType = 'global', resourceId = null) {
    if (!supabase) {
      logger.error('Supabase não configurado — roles não podem ser verificadas', { userId, roleName });
      return false;
    }
    try {
      const { data, error } = await supabase.rpc('check_user_has_role', {
        p_user_id: userId,
        p_role_name: roleName,
        p_context_type: contextType,
        p_resource_id: resourceId
      });
      if (error) throw error;
      return data;
    } catch (err) {
      logger.error('Erro ao verificar role no Supabase', {
        service: 'userRoleService',
        function: 'checkUserHasRole',
        userId, roleName, contextType, resourceId,
        error: err.message
      });
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
    if (!supabase) {
      logger.error('Supabase não configurado — permissões não podem ser verificadas', { userId, permissionName });
      return false;
    }
    try {
      const { data, error } = await supabase.rpc('check_user_has_permission', {
        p_user_id: userId,
        p_permission_name: permissionName,
        p_context_type: contextType,
        p_resource_id: resourceId
      });
      if (error) throw error;
      return data;
    } catch (err) {
      logger.error('Erro ao verificar permissão no Supabase', {
        service: 'userRoleService',
        function: 'checkUserHasPermission',
        userId, permissionName, contextType, resourceId,
        error: err.message
      });
      return false;
    }
  }

  /**
   * Obtém as roles de um usuário
   * @param {string} userId - ID do usuário
   * @param {string} contextType - Tipo de contexto (opcional)
   * @param {string} resourceId - ID do recurso no contexto (opcional)
   * @returns {Promise<Array<Object>>} Lista de roles (objetos simples)
   */
  async getUserRoles(userId, contextType = null, resourceId = null) {
    if (!supabase) {
      logger.error('Supabase não configurado — roles retornarão vazias', { userId });
      return [];
    }
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('*, roles(name)')
        .eq('user_id', userId);

      if (error) throw error;

      return (data || []).map(ur => ({
        roleId: ur.role_id,
        roleName: ur.role_id,          // 'admin', 'member' etc. — identificador programático
        displayName: ur.roles?.name,   // 'Administrador', 'Membro' etc. — apenas exibição
        context: ur.metadata?.context || { type: 'global', resourceId: null },
        validationStatus: ur.metadata?.validationStatus || 'validated'
      }));
    } catch (err) {
      logger.error('Erro ao buscar roles do usuário no Supabase', {
        service: 'userRoleService',
        function: 'getUserRoles',
        userId,
        error: err.message
      });
      return [];
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