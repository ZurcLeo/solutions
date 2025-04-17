// models/UserRole.js
const { getFirestore } = require('../firebaseAdmin');
const { logger } = require('../logger');
const LocalStorageService = require('../services/LocalStorageService')
const FirestoreService = require('../utils/firestoreService');
const dbServiceUserRole = LocalStorageService.collection('roles');
const User = require('./User');
const Role = require('./Role');
const RolePermission = require('./RolePermission');

class UserRole {
  constructor(data) {
    this.id = data.id;
    this.userId = data.userId;
    this.roleId = data.roleId;
    this.context = data.context || { type: 'global', resourceId: null };
    this.validationStatus = data.validationStatus || 'pending';
    this.validatedAt = data.validatedAt || null;
    this.validationData = data.validationData || null;
    this.expiresAt = data.expiresAt || null;
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
    this.createdBy = data.createdBy || null;
    this.metadata = data.metadata || {};
  }

  toPlainObject() {
    return {
      id: this.id,
      userId: this.userId,
      roleId: this.roleId,
      context: this.context,
      validationStatus: this.validationStatus,
      validatedAt: this.validatedAt,
      validationData: this.validationData,
      expiresAt: this.expiresAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      createdBy: this.createdBy,
      metadata: this.metadata
    };
  }

  static async getUserRoles(userId, contextType = null, resourceId = null) {
    try {
      let query = dbServiceUserRole.where('userId', '==', userId);
      
      // Filtrar por tipo de contexto se fornecido
      if (contextType) {
        query = query.where('context.type', '==', contextType);
      }
      
      // Executar a query
      const userRolesCollection = await query.get();
      
      // Filtrar por resourceId se fornecido (precisa ser feito em memória)
      let userRoles = userRolesCollection.docs.map(doc => {
        const userRoleData = doc.data();
        userRoleData.id = doc.id;
        return new UserRole(userRoleData);
      });
      
      if (resourceId && contextType) {
        userRoles = userRoles.filter(userRole => 
          userRole.context.resourceId === resourceId
        );
      }

      logger.info('Roles do usuário obtidas com sucesso', { 
        service: 'userRoleModel', 
        function: 'getUserRoles', 
        userId,
        contextType,
        resourceId,
        count: userRoles.length 
      });
      
      return userRoles;
    } catch (error) {
      logger.error('Erro ao buscar roles do usuário', { 
        service: 'userRoleModel', 
        function: 'getUserRoles', 
        userId,
        contextType,
        resourceId,
        error: error.message 
      });
      throw error;
    }
  }

  static async getById(userRoleId) {
    if (!userRoleId) {
      const error = new Error('userRoleId não fornecido');
      logger.error('Erro no getById', { 
        service: 'userRoleModel', 
        function: 'getById', 
        error: error.message 
      });
      throw error;
    }
  
    try {
      const userRoleDoc = await dbServiceUserRole.doc(userRoleId).get();
      
      if (!userRoleDoc.exists) {
        logger.warn('UserRole não encontrada', { 
          service: 'userRoleModel', 
          function: 'getById', 
          userRoleId 
        });
        throw new Error('UserRole não encontrada');
      }
      
      const userRoleData = userRoleDoc.data();
      userRoleData.id = userRoleId;
      return new UserRole(userRoleData);
    } catch (error) {
      logger.error('Erro ao obter userRole por ID', { 
        service: 'userRoleModel', 
        function: 'getById', 
        userRoleId, 
        error: error.message 
      });
      throw error;
    }
  }

  static async assignRoleToUser(userId, roleId, context = { type: 'global', resourceId: null }, options = {}) {
    try {
      return await User.addRole(userId, roleId, context, options);
    } catch (error) {
      logger.error('Erro ao atribuir role ao usuário', {
        service: 'userRoleService',
        function: 'assignRoleToUser',
        userId,
        roleId,
        error: error.message
      });
      throw error;
    }
  }

  static async removeRoleFromUser(userId, roleId) {
    try {
      return await User.removeRole(userId, roleId);
    } catch (error) {
      logger.error('Erro ao remover role do usuário', {
        service: 'userRoleService',
        function: 'removeRoleFromUser',
        userId,
        roleId,
        error: error.message
      });
      throw error;
    }
  }
  
  static async validateUserRole(userRoleId, validationData = {}) {
    try {
      const userRoleRef = dbServiceUserRole.doc(userRoleId);
      const userRoleDoc = await userRoleRef.get();
      
      if (!userRoleDoc.exists) {
        logger.warn('UserRole não encontrada para validação', { 
          service: 'userRoleModel', 
          function: 'validateUserRole', 
          userRoleId
        });
        throw new Error('UserRole não encontrada');
      }
      
      // Atualizar o status de validação
      const updateData = {
        validationStatus: 'validated',
        validatedAt: new Date(),
        validationData: validationData,
        updatedAt: new Date()
      };
      
      await userRoleRef.update(updateData);
      
      // Buscar documento atualizado
      const updatedDoc = await userRoleRef.get();
      const updatedData = updatedDoc.data();
      updatedData.id = userRoleId;
      
      logger.info('UserRole validada com sucesso', { 
        service: 'userRoleModel', 
        function: 'validateUserRole', 
        userRoleId
      });
      
      return new UserRole(updatedData);
    } catch (error) {
      logger.error('Erro ao validar role do usuário', { 
        service: 'userRoleModel', 
        function: 'validateUserRole', 
        userRoleId,
        error: error.message 
      });
      throw error;
    }
  }
  
  static async rejectUserRole(userRoleId, reasonData = {}) {
    try {
      const userRoleRef = dbServiceUserRole.doc(userRoleId);
      const userRoleDoc = await userRoleRef.get();
      
      if (!userRoleDoc.exists) {
        logger.warn('UserRole não encontrada para rejeição', { 
          service: 'userRoleModel', 
          function: 'rejectUserRole', 
          userRoleId
        });
        throw new Error('UserRole não encontrada');
      }
      
      // Atualizar o status de validação
      const updateData = {
        validationStatus: 'rejected',
        validatedAt: new Date(),
        validationData: {
          ...userRoleDoc.data().validationData,
          rejectionReason: reasonData.reason || 'Não especificado',
          rejectedBy: reasonData.rejectedBy || null,
          rejectionDetails: reasonData.details || null
        },
        updatedAt: new Date()
      };
      
      await userRoleRef.update(updateData);
      
      // Buscar documento atualizado
      const updatedDoc = await userRoleRef.get();
      const updatedData = updatedDoc.data();
      updatedData.id = userRoleId;
      
      logger.info('UserRole rejeitada com sucesso', { 
        service: 'userRoleModel', 
        function: 'rejectUserRole', 
        userRoleId,
        reason: reasonData.reason
      });
      
      return new UserRole(updatedData);
    } catch (error) {
      logger.error('Erro ao rejeitar role do usuário', { 
        service: 'userRoleModel', 
        function: 'rejectUserRole', 
        userRoleId,
        error: error.message 
      });
      throw error;
    }
  }

  static async checkUserHasRole(userId, roleName, contextType = 'global', resourceId = null) {
  try {
    return await User.hasRole(userId, roleName, contextType, resourceId);
  } catch (error) {
    logger.error('Erro ao verificar se usuário tem role', {
      service: 'userRoleService',
      function: 'checkUserHasRole',
      userId,
      roleName,
      error: error.message
    });
    return false;
  }
}

static async checkUserHasPermission(userId, permissionName, contextType = 'global', resourceId = null) {
  try {
    return await User.hasPermission(userId, permissionName, contextType, resourceId);
  } catch (error) {
    logger.error('Erro ao verificar se usuário tem permissão', {
      service: 'userRoleService',
      function: 'checkUserHasPermission',
      userId,
      permissionName,
      error: error.message
    });
    return false;
  }
}
}

module.exports = UserRole;