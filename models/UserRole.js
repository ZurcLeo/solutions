// models/UserRole.js
const { getFirestore } = require('../firebaseAdmin');
const { logger } = require('../logger');
const FirestoreService = require('../utils/firestoreService');
const dbServiceUserRole = FirestoreService.collection('user_roles');
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
      // Verificar se o usuário existe
      await User.getById(userId);
      
      // Verificar se a role existe
      await Role.getById(roleId);
      
      // Verificar se a atribuição já existe para o mesmo contexto
      const existingAssignments = await dbServiceUserRole
        .where('userId', '==', userId)
        .where('roleId', '==', roleId)
        .get();
      
      // Verificar se já existe uma atribuição idêntica
      let duplicateFound = false;
      for (const doc of existingAssignments.docs) {
        const existingContext = doc.data().context || {};
        if (existingContext.type === context.type && 
            existingContext.resourceId === context.resourceId) {
          duplicateFound = true;
          logger.warn('Role já atribuída ao usuário neste contexto', { 
            service: 'userRoleModel', 
            function: 'assignRoleToUser', 
            userId,
            roleId,
            context
          });
          
          // Retornar a atribuição existente
          const existingData = doc.data();
          existingData.id = doc.id;
          return new UserRole(existingData);
        }
      }
      
      // Se não encontrou duplicata, criar nova atribuição
      if (!duplicateFound) {
        const userRole = new UserRole({
          userId,
          roleId,
          context,
          validationStatus: options.validationStatus || 'pending',
          validatedAt: options.validationStatus === 'validated' ? new Date() : null,
          validationData: options.validationData || null,
          expiresAt: options.expiresAt || null,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: options.createdBy || null,
          metadata: options.metadata || {}
        });
        
        const docRef = await dbServiceUserRole.add(userRole.toPlainObject());
        userRole.id = docRef.id;
        
        logger.info('Role atribuída ao usuário com sucesso', { 
          service: 'userRoleModel', 
          function: 'assignRoleToUser', 
          userId,
          roleId,
          context,
          userRoleId: userRole.id
        });
        
        return userRole;
      }
    } catch (error) {
      logger.error('Erro ao atribuir role ao usuário', { 
        service: 'userRoleModel', 
        function: 'assignRoleToUser', 
        userId,
        roleId,
        context,
        error: error.message 
      });
      throw error;
    }
  }

  static async removeRoleFromUser(userRoleId) {
    try {
      const userRoleRef = dbServiceUserRole.doc(userRoleId);
      const userRoleDoc = await userRoleRef.get();
      
      if (!userRoleDoc.exists) {
        logger.warn('UserRole não encontrada para remoção', { 
          service: 'userRoleModel', 
          function: 'removeRoleFromUser', 
          userRoleId
        });
        return false;
      }
      
      await userRoleRef.delete();
      
      logger.info('Role removida do usuário com sucesso', { 
        service: 'userRoleModel', 
        function: 'removeRoleFromUser', 
        userRoleId,
        userData: userRoleDoc.data()
      });
      
      return true;
    } catch (error) {
      logger.error('Erro ao remover role do usuário', { 
        service: 'userRoleModel', 
        function: 'removeRoleFromUser', 
        userRoleId,
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
      // Primeiro, buscar a role pelo nome
      const roles = await Role.findAll();
      const targetRole = roles.find(role => role.name === roleName);
      
      if (!targetRole) {
        logger.warn(`Role '${roleName}' não encontrada`, {
          service: 'userRoleModel',
          function: 'checkUserHasRole'
        });
        return false;
      }
      
      // Buscar as UserRoles do usuário
      const userRoles = await this.getUserRoles(userId, contextType, resourceId);
      
      // Verificar se o usuário tem a role especificada
      const hasRole = userRoles.some(userRole => 
        userRole.roleId === targetRole.id && 
        userRole.validationStatus === 'validated'
      );
      
      logger.info(`Verificação se usuário tem role '${roleName}'`, {
        service: 'userRoleModel', 
        function: 'checkUserHasRole', 
        userId,
        roleName,
        contextType,
        resourceId,
        hasRole
      });
      
      return hasRole;
    } catch (error) {
      logger.error(`Erro ao verificar se usuário tem role '${roleName}'`, { 
        service: 'userRoleModel', 
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

  static async checkUserHasPermission(userId, permissionName, contextType = 'global', resourceId = null) {
    try {
      // Buscar todas as roles do usuário no contexto especificado
      const userRoles = await this.getUserRoles(userId, contextType, resourceId);
      
      // Se o usuário não tem nenhuma role, retornar false
      if (userRoles.length === 0) {
        return false;
      }
      
      // Verificar permissões apenas para roles validadas
      const validatedRoleIds = userRoles
        .filter(userRole => userRole.validationStatus === 'validated')
        .map(userRole => userRole.roleId);
      
      if (validatedRoleIds.length === 0) {
        return false;
      }
      
      // Para cada role, verificar se tem a permissão especificada
      for (const roleId of validatedRoleIds) {
        // Buscar todas as permissões associadas à role
        const permissions = await RolePermission.getRolePermissions(roleId);
        
        // Verificar se alguma permissão corresponde ao nome especificado
        const hasPermission = permissions.some(permission => 
          permission.name === permissionName
        );
        
        if (hasPermission) {
          return true;
        }
      }
      
      // Se chegou até aqui, o usuário não tem a permissão
      return false;
    } catch (error) {
      logger.error(`Erro ao verificar se usuário tem permissão '${permissionName}'`, { 
        service: 'userRoleModel', 
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
}

module.exports = UserRole;