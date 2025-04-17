// models/RolePermission.js
const { getFirestore } = require('../firebaseAdmin');
const { logger } = require('../logger');
const LocalStorageService = require('../services/LocalStorageService');
const FirestoreService = require('../utils/firestoreService');
const dbServiceRolePermission = LocalStorageService.collection('role_permissions');
const Role = require('./Role');
const Permission = require('./Permission');

// Importar dados iniciais
const { rolePermissions: initialRolePermissions } = require('../config/data/initialData');

class RolePermission {
  constructor(data) {
    this.id = data.id;
    this.roleId = data.roleId;
    this.permissionId = data.permissionId;
    this.createdAt = data.createdAt || new Date();
  }

  toPlainObject() {
    return {
      id: this.id,
      roleId: this.roleId,
      permissionId: this.permissionId,
      createdAt: this.createdAt
    };
  }

  /**
   * Obtém todas as associações role-permission para uma role específica
   * @param {string} roleId - ID da role
   * @returns {Promise<Array<RolePermission>>} - Lista de associações
   */
  static async getByRoleId(roleId) {
    try {
      // Buscar associações no armazenamento local
      const query = dbServiceRolePermission.where('roleId', '==', roleId);
      
      // Carregar dados diretamente
      const allData = await dbServiceRolePermission._loadData() || {};
      
      // Filtrar manualmente os dados por roleId
      const filteredData = Object.entries(allData)
        .filter(([_id, data]) => data.roleId === roleId)
        .map(([id, data]) => new RolePermission({
          id,
          ...data
        }));
      
      // Adicionar associações dos dados iniciais
      const initialRolePerms = [];
      
      for (const [id, rolePerm] of Object.entries(initialRolePermissions)) {
        if (rolePerm.roleId === roleId) {
          // Verificar se já está na lista filtrada do banco
          const exists = filteredData.some(
            dbPerm => dbPerm.permissionId === rolePerm.permissionId
          );
          
          if (!exists) {
            initialRolePerms.push(new RolePermission({
              id,
              ...rolePerm
            }));
          }
        }
      }
      
      // Combinar resultados
      const allRolePermissions = [...filteredData, ...initialRolePerms];
  
      logger.info('RolePermissions obtidas com sucesso por roleId', { 
        service: 'rolePermissionModel', 
        function: 'getByRoleId', 
        roleId,
        count: allRolePermissions.length,
        dbCount: filteredData.length,
        initialCount: initialRolePerms.length
      });
      
      return allRolePermissions;
    } catch (error) {
      logger.error('Erro ao buscar role permissions por roleId', { 
        service: 'rolePermissionModel', 
        function: 'getByRoleId', 
        roleId,
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Obtém todas as associações role-permission para uma permissão específica
   * @param {string} permissionId - ID da permissão
   * @returns {Promise<Array<RolePermission>>} - Lista de associações
   */
  static async getByPermissionId(permissionId) {
    try {
      // Buscar associações no banco de dados
      const rolePermissionsCollection = await dbServiceRolePermission
        .where('permissionId', '==', permissionId)
        .get();
      
      const dbRolePermissions = rolePermissionsCollection.docs.map(doc => {
        const rolePermissionData = doc.data();
        rolePermissionData.id = doc.id;
        return new RolePermission(rolePermissionData);
      });
      
      // Adicionar associações dos dados iniciais
      const initialRolePerms = [];
      
      for (const [id, rolePerm] of Object.entries(initialRolePermissions)) {
        if (rolePerm.permissionId === permissionId) {
          // Verificar se já está na lista do banco
          const exists = dbRolePermissions.some(
            dbPerm => dbPerm.roleId === rolePerm.roleId
          );
          
          if (!exists) {
            initialRolePerms.push(new RolePermission({
              id,
              ...rolePerm
            }));
          }
        }
      }
      
      // Combinar resultados
      const allRolePermissions = [...dbRolePermissions, ...initialRolePerms];

      logger.info('RolePermissions obtidas com sucesso por permissionId', { 
        service: 'rolePermissionModel', 
        function: 'getByPermissionId', 
        permissionId,
        count: allRolePermissions.length,
        dbCount: dbRolePermissions.length,
        initialCount: initialRolePerms.length
      });
      
      return allRolePermissions;
    } catch (error) {
      logger.error('Erro ao buscar role permissions por permissionId', { 
        service: 'rolePermissionModel', 
        function: 'getByPermissionId', 
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
   * @returns {Promise<RolePermission>} - Associação criada ou existente
   */
  static async assignPermissionToRole(roleId, permissionId) {
    try {
      // Verificar se a role existe
      await Role.getById(roleId);
      
      // Verificar se a permissão existe
      await Permission.getById(permissionId);
      
      // Verificar se a associação já existe nas permissões iniciais
      const existsInInitial = Object.values(initialRolePermissions).some(
        rp => rp.roleId === roleId && rp.permissionId === permissionId
      );
      
      if (existsInInitial) {
        logger.info('Associação já existe nos dados iniciais', {
          service: 'rolePermissionModel',
          function: 'assignPermissionToRole',
          roleId,
          permissionId
        });
        
        // Encontrar a associação nos dados iniciais
        const [id, data] = Object.entries(initialRolePermissions).find(
          ([_, rp]) => rp.roleId === roleId && rp.permissionId === permissionId
        );
        
        return new RolePermission({ id, ...data });
      }
      
      // Verificar se a associação já existe no banco
      const existingAssociations = await dbServiceRolePermission
        .where('roleId', '==', roleId)
        .where('permissionId', '==', permissionId)
        .get();
      
      if (!existingAssociations.empty) {
        logger.warn('Permissão já atribuída à role no banco', { 
          service: 'rolePermissionModel', 
          function: 'assignPermissionToRole', 
          roleId,
          permissionId
        });
        // Retornar a associação existente
        const existingData = existingAssociations.docs[0].data();
        existingData.id = existingAssociations.docs[0].id;
        return new RolePermission(existingData);
      }
      
      // Criar nova associação
      const rolePermission = new RolePermission({
        roleId,
        permissionId,
        createdAt: new Date()
      });
      
      const docRef = await dbServiceRolePermission.add(rolePermission.toPlainObject());
      rolePermission.id = docRef.id;
      
      logger.info('Permissão atribuída à role com sucesso', { 
        service: 'rolePermissionModel', 
        function: 'assignPermissionToRole', 
        roleId,
        permissionId,
        rolePermissionId: rolePermission.id
      });
      
      return rolePermission;
    } catch (error) {
      logger.error('Erro ao atribuir permissão à role', { 
        service: 'rolePermissionModel', 
        function: 'assignPermissionToRole', 
        roleId,
        permissionId,
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Remove uma associação entre role e permissão
   * @param {string} roleId - ID da role
   * @param {string} permissionId - ID da permissão
   * @returns {Promise<boolean>} - Sucesso da operação
   */
  static async removePermissionFromRole(roleId, permissionId) {
    try {
      // Verificar se a associação existe nos dados iniciais
      const existsInInitial = Object.values(initialRolePermissions).some(
        rp => rp.roleId === roleId && rp.permissionId === permissionId
      );
      
      if (existsInInitial) {
        logger.warn('Não é possível remover associações definidas nos dados iniciais', {
          service: 'rolePermissionModel',
          function: 'removePermissionFromRole',
          roleId,
          permissionId
        });
        
        // Se a associação também existir no banco, remover a versão do banco
        const dbAssociations = await dbServiceRolePermission
          .where('roleId', '==', roleId)
          .where('permissionId', '==', permissionId)
          .get();
        
        if (!dbAssociations.empty) {
          logger.info('Removendo associação duplicada do banco', {
            service: 'rolePermissionModel',
            function: 'removePermissionFromRole',
            roleId,
            permissionId
          });
          
          // Remover duplicatas do banco
          const batch = getFirestore().batch();
          dbAssociations.docs.forEach(doc => {
            batch.delete(doc.ref);
          });
          await batch.commit();
        }
        
        // Informar que não foi possível remover a associação inicial
        return false;
      }
      
      // Buscar a associação no banco
      const associations = await dbServiceRolePermission
        .where('roleId', '==', roleId)
        .where('permissionId', '==', permissionId)
        .get();
      
      if (associations.empty) {
        logger.warn('Associação entre role e permissão não encontrada no banco', { 
          service: 'rolePermissionModel', 
          function: 'removePermissionFromRole', 
          roleId,
          permissionId
        });
        return false;
      }
      
      // Excluir todas as associações encontradas (normalmente deve ser apenas uma)
      const batch = getFirestore().batch();
      
      associations.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      
      logger.info('Permissão removida da role com sucesso', { 
        service: 'rolePermissionModel', 
        function: 'removePermissionFromRole', 
        roleId,
        permissionId,
        count: associations.size
      });
      
      return true;
    } catch (error) {
      logger.error('Erro ao remover permissão da role', { 
        service: 'rolePermissionModel', 
        function: 'removePermissionFromRole', 
        roleId,
        permissionId,
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Obtém todas as permissões associadas a uma role
   * @param {string} roleId - ID da role
   * @returns {Promise<Array<Permission>>} - Lista de permissões
   */
  static async getRolePermissions(roleId) {
    try {
      // Obter todas as associações para esta role (do banco e dados iniciais)
      const rolePermissions = await this.getByRoleId(roleId);
      
      if (rolePermissions.length === 0) {
        return [];
      }
      
      // Buscar os detalhes de cada permissão
      const permissionIds = rolePermissions.map(rp => rp.permissionId);
      const permissions = [];
      
      // Buscar cada permissão individualmente
      for (const permissionId of permissionIds) {
        try {
          const permission = await Permission.getById(permissionId);
          permissions.push(permission);
        } catch (error) {
          logger.warn(`Permissão ${permissionId} não encontrada`, {
            service: 'rolePermissionModel',
            function: 'getRolePermissions',
            roleId,
            permissionId
          });
          // Continuar com as outras permissões mesmo se uma falhar
        }
      }
      
      logger.info('Permissões da role obtidas com sucesso', { 
        service: 'rolePermissionModel', 
        function: 'getRolePermissions', 
        roleId,
        count: permissions.length
      });
      
      return permissions;
    } catch (error) {
      logger.error('Erro ao obter permissões da role', { 
        service: 'rolePermissionModel', 
        function: 'getRolePermissions', 
        roleId,
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Obtém todas as roles com uma permissão específica
   * @param {string} permissionId - ID da permissão
   * @returns {Promise<Array<Role>>} - Lista de roles
   */
  static async getPermissionRoles(permissionId) {
    try {
      // Obter todas as associações para esta permissão
      const rolePermissions = await this.getByPermissionId(permissionId);
      
      if (rolePermissions.length === 0) {
        return [];
      }
      
      // Buscar os detalhes de cada role
      const roleIds = rolePermissions.map(rp => rp.roleId);
      const roles = [];
      
      // Buscar cada role individualmente
      for (const roleId of roleIds) {
        try {
          const role = await Role.getById(roleId);
          roles.push(role);
        } catch (error) {
          logger.warn(`Role ${roleId} não encontrada`, {
            service: 'rolePermissionModel',
            function: 'getPermissionRoles',
            permissionId,
            roleId
          });
          // Continuar com as outras roles mesmo se uma falhar
        }
      }
      
      logger.info('Roles da permissão obtidas com sucesso', { 
        service: 'rolePermissionModel', 
        function: 'getPermissionRoles', 
        permissionId,
        count: roles.length
      });
      
      return roles;
    } catch (error) {
      logger.error('Erro ao obter roles da permissão', { 
        service: 'rolePermissionModel', 
        function: 'getPermissionRoles', 
        permissionId,
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Verifica se uma role tem uma permissão específica
   * @param {string} roleId - ID da role
   * @param {string} permissionId - ID da permissão
   * @returns {Promise<boolean>} - Se a role tem a permissão
   */
  static async hasPermission(roleId, permissionId) {
    try {
      // Verificar nos dados iniciais
      const existsInInitial = Object.values(initialRolePermissions).some(
        rp => rp.roleId === roleId && rp.permissionId === permissionId
      );
      
      if (existsInInitial) {
        return true;
      }
      
      // Verificar no banco
      const associations = await dbServiceRolePermission
        .where('roleId', '==', roleId)
        .where('permissionId', '==', permissionId)
        .limit(1)
        .get();
      
      return !associations.empty;
    } catch (error) {
      logger.error('Erro ao verificar se role tem permissão', {
        service: 'rolePermissionModel',
        function: 'hasPermission',
        roleId,
        permissionId,
        error: error.message
      });
      return false;
    }
  }
}

module.exports = RolePermission;