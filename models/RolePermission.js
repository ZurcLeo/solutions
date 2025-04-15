// models/RolePermission.js
const { getFirestore } = require('../firebaseAdmin');
const { logger } = require('../logger');
const FirestoreService = require('../utils/firestoreService');
const dbServiceRolePermission = FirestoreService.collection('role_permissions');
const Role = require('./Role');
const Permission = require('./Permission');

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

  static async getByRoleId(roleId) {
    try {
      const rolePermissionsCollection = await dbServiceRolePermission
        .where('roleId', '==', roleId)
        .get();
      
      const rolePermissions = rolePermissionsCollection.docs.map(doc => {
        const rolePermissionData = doc.data();
        rolePermissionData.id = doc.id;
        return new RolePermission(rolePermissionData);
      });

      logger.info('RolePermissions obtidas com sucesso por roleId', { 
        service: 'rolePermissionModel', 
        function: 'getByRoleId', 
        roleId,
        count: rolePermissions.length 
      });
      
      return rolePermissions;
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

  static async getByPermissionId(permissionId) {
    try {
      const rolePermissionsCollection = await dbServiceRolePermission
        .where('permissionId', '==', permissionId)
        .get();
      
      const rolePermissions = rolePermissionsCollection.docs.map(doc => {
        const rolePermissionData = doc.data();
        rolePermissionData.id = doc.id;
        return new RolePermission(rolePermissionData);
      });

      logger.info('RolePermissions obtidas com sucesso por permissionId', { 
        service: 'rolePermissionModel', 
        function: 'getByPermissionId', 
        permissionId,
        count: rolePermissions.length 
      });
      
      return rolePermissions;
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

  static async assignPermissionToRole(roleId, permissionId) {
    try {
      // Verificar se a role existe
      await Role.getById(roleId);
      
      // Verificar se a permissão existe
      await Permission.getById(permissionId);
      
      // Verificar se a associação já existe
      const existingAssociations = await dbServiceRolePermission
        .where('roleId', '==', roleId)
        .where('permissionId', '==', permissionId)
        .get();
      
      if (!existingAssociations.empty) {
        logger.warn('Permissão já atribuída à role', { 
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

  static async removePermissionFromRole(roleId, permissionId) {
    try {
      // Buscar a associação
      const associations = await dbServiceRolePermission
        .where('roleId', '==', roleId)
        .where('permissionId', '==', permissionId)
        .get();
      
      if (associations.empty) {
        logger.warn('Associação entre role e permissão não encontrada', { 
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

  static async getRolePermissions(roleId) {
    try {
      // Obter todas as associações para esta role
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
}

module.exports = RolePermission;