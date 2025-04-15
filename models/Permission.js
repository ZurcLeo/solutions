// models/Permission.js
const { getFirestore } = require('../firebaseAdmin');
const { logger } = require('../logger');
const FirestoreService = require('../utils/firestoreService');
const dbServicePermission = FirestoreService.collection('permissions');

class Permission {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.description = data.description || '';
    this.resource = data.resource;
    this.action = data.action;
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  toPlainObject() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      resource: this.resource,
      action: this.action,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  static async findAll(filters = {}) {
    try {
      let query = dbServicePermission;
      
      // Aplicar filtros se fornecidos
      if (filters.resource) {
        query = query.where('resource', '==', filters.resource);
      }
      
      if (filters.action) {
        query = query.where('action', '==', filters.action);
      }
      
      const permissionsCollection = await query.get();
      
      const permissions = permissionsCollection.docs.map(doc => {
        const permissionData = doc.data();
        permissionData.id = doc.id;
        return new Permission(permissionData);
      });

      logger.info('Permissões obtidas com sucesso', { 
        service: 'permissionModel', 
        function: 'findAll', 
        count: permissions.length,
        filters
      });
      
      return permissions;
    } catch (error) {
      logger.error('Erro ao buscar permissões', { 
        service: 'permissionModel', 
        function: 'findAll', 
        error: error.message,
        filters
      });
      throw new Error('Erro ao buscar permissões');
    }
  }

  static async getById(permissionId) {
    if (!permissionId) {
      const error = new Error('permissionId não fornecido');
      logger.error('Erro no getById', { 
        service: 'permissionModel', 
        function: 'getById', 
        error: error.message 
      });
      throw error;
    }
  
    try {
      const permissionDoc = await dbServicePermission.doc(permissionId).get();
      
      if (!permissionDoc.exists) {
        logger.warn('Permissão não encontrada', { 
          service: 'permissionModel', 
          function: 'getById', 
          permissionId 
        });
        throw new Error('Permissão não encontrada');
      }
      
      const permissionData = permissionDoc.data();
      permissionData.id = permissionId;
      return new Permission(permissionData);
    } catch (error) {
      logger.error('Erro ao obter permissão por ID', { 
        service: 'permissionModel', 
        function: 'getById', 
        permissionId, 
        error: error.message 
      });
      throw error;
    }
  }

  static async create(permissionData) {
    try {
      // Verificar se já existe uma permissão com esse nome
      const existingPermissions = await dbServicePermission.where('name', '==', permissionData.name).get();
      
      if (!existingPermissions.empty) {
        throw new Error(`Permissão com nome '${permissionData.name}' já existe`);
      }
      
      const permission = new Permission({
        ...permissionData,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      const docRef = await dbServicePermission.add(permission.toPlainObject());
      permission.id = docRef.id;
      
      logger.info('Permissão criada com sucesso', { 
        service: 'permissionModel', 
        function: 'create', 
        permissionId: permission.id 
      });
      
      return permission;
    } catch (error) {
      logger.error('Erro ao criar permissão', { 
        service: 'permissionModel', 
        function: 'create', 
        error: error.message 
      });
      throw error;
    }
  }

  static async update(permissionId, data) {
    if (!permissionId) throw new Error('ID da permissão é obrigatório');
    
    try {
      const permissionRef = dbServicePermission.doc(permissionId);
      const permissionDoc = await permissionRef.get();
      
      if (!permissionDoc.exists) {
        throw new Error('Permissão não encontrada');
      }
      
      // Se estiver tentando atualizar o nome, verificar duplicidade
      if (data.name) {
        const existingPermissions = await dbServicePermission
          .where('name', '==', data.name)
          .get();
        
        // Se existir uma permissão com esse nome que não seja a atual
        for (const doc of existingPermissions.docs) {
          if (doc.id !== permissionId) {
            throw new Error(`Permissão com nome '${data.name}' já existe`);
          }
        }
      }
      
      const updateData = {
        ...data,
        updatedAt: new Date()
      };
      
      await permissionRef.update(updateData);
      
      const updatedPermissionDoc = await permissionRef.get();
      const updatedPermissionData = updatedPermissionDoc.data();
      updatedPermissionData.id = permissionId;
      
      logger.info('Permissão atualizada com sucesso', { 
        service: 'permissionModel', 
        function: 'update', 
        permissionId 
      });
      
      return new Permission(updatedPermissionData);
    } catch (error) {
      logger.error('Erro ao atualizar permissão', { 
        service: 'permissionModel', 
        function: 'update', 
        permissionId, 
        error: error.message 
      });
      throw error;
    }
  }

  static async delete(permissionId) {
    if (!permissionId) throw new Error('ID da permissão é obrigatório');
    
    try {
      const permissionRef = dbServicePermission.doc(permissionId);
      const permissionDoc = await permissionRef.get();
      
      if (!permissionDoc.exists) {
        throw new Error('Permissão não encontrada');
      }
      
      // TODO: Verificar se a permissão está sendo usada por roles
      // Se implementarmos essa verificação, podemos adicionar aqui
      
      await permissionRef.delete();
      
      logger.info('Permissão excluída com sucesso', { 
        service: 'permissionModel', 
        function: 'delete', 
        permissionId 
      });
      
      return true;
    } catch (error) {
      logger.error('Erro ao excluir permissão', { 
        service: 'permissionModel', 
        function: 'delete', 
        permissionId, 
        error: error.message 
      });
      throw error;
    }
  }
}

module.exports = Permission;