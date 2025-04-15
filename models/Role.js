// models/Role.js
const { getFirestore } = require('../firebaseAdmin');
const { logger } = require('../logger');
const FirestoreService = require('../utils/firestoreService');
const dbServiceRole = FirestoreService.collection('roles');

class Role {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.description = data.description || '';
    this.isSystemRole = data.isSystemRole || false;
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  toPlainObject() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      isSystemRole: this.isSystemRole,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  static async findAll() {
    try {
      const rolesCollection = await dbServiceRole.get();
      
      const roles = rolesCollection.docs.map(doc => {
        const roleData = doc.data();
        roleData.id = doc.id;
        return new Role(roleData);
      });

      logger.info('Roles obtidas com sucesso', { 
        service: 'roleModel', 
        function: 'findAll', 
        count: roles.length 
      });
      
      return roles;
    } catch (error) {
      logger.error('Erro ao buscar todas as roles', { 
        service: 'roleModel', 
        function: 'findAll', 
        error: error.message 
      });
      throw new Error('Erro ao buscar todas as roles');
    }
  }

  static async getById(roleId) {
    if (!roleId) {
      const error = new Error('roleId não fornecido');
      logger.error('Erro no getById', { 
        service: 'roleModel', 
        function: 'getById', 
        error: error.message 
      });
      throw error;
    }
  
    try {
      const roleDoc = await dbServiceRole.doc(roleId).get();
      
      if (!roleDoc.exists) {
        logger.warn('Role não encontrada', { 
          service: 'roleModel', 
          function: 'getById', 
          roleId 
        });
        throw new Error('Role não encontrada');
      }
      
      const roleData = roleDoc.data();
      roleData.id = roleId;
      return new Role(roleData);
    } catch (error) {
      logger.error('Erro ao obter role por ID', { 
        service: 'roleModel', 
        function: 'getById', 
        roleId, 
        error: error.message 
      });
      throw error;
    }
  }

  static async create(roleData) {
    try {
      // Verificar se já existe uma role com esse nome
      const existingRoles = await dbServiceRole.where('name', '==', roleData.name).get();
      
      if (!existingRoles.empty) {
        throw new Error(`Role com nome '${roleData.name}' já existe`);
      }
      
      const role = new Role({
        ...roleData,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      const docRef = await dbServiceRole.add(role.toPlainObject());
      role.id = docRef.id;
      
      logger.info('Role criada com sucesso', { 
        service: 'roleModel', 
        function: 'create', 
        roleId: role.id 
      });
      
      return role;
    } catch (error) {
      logger.error('Erro ao criar role', { 
        service: 'roleModel', 
        function: 'create', 
        error: error.message 
      });
      throw error;
    }
  }

  static async update(roleId, data) {
    if (!roleId) throw new Error('ID da role é obrigatório');
    
    try {
      const roleRef = dbServiceRole.doc(roleId);
      const roleDoc = await roleRef.get();
      
      if (!roleDoc.exists) {
        throw new Error('Role não encontrada');
      }
      
      // Se estiver tentando atualizar o nome, verificar duplicidade
      if (data.name) {
        const existingRoles = await dbServiceRole
          .where('name', '==', data.name)
          .get();
        
        // Se existir uma role com esse nome que não seja a atual
        for (const doc of existingRoles.docs) {
          if (doc.id !== roleId) {
            throw new Error(`Role com nome '${data.name}' já existe`);
          }
        }
      }
      
      const updateData = {
        ...data,
        updatedAt: new Date()
      };
      
      await roleRef.update(updateData);
      
      const updatedRoleDoc = await roleRef.get();
      const updatedRoleData = updatedRoleDoc.data();
      updatedRoleData.id = roleId;
      
      logger.info('Role atualizada com sucesso', { 
        service: 'roleModel', 
        function: 'update', 
        roleId 
      });
      
      return new Role(updatedRoleData);
    } catch (error) {
      logger.error('Erro ao atualizar role', { 
        service: 'roleModel', 
        function: 'update', 
        roleId, 
        error: error.message 
      });
      throw error;
    }
  }

  static async delete(roleId) {
    if (!roleId) throw new Error('ID da role é obrigatório');
    
    try {
      const roleRef = dbServiceRole.doc(roleId);
      const roleDoc = await roleRef.get();
      
      if (!roleDoc.exists) {
        throw new Error('Role não encontrada');
      }
      
      const roleData = roleDoc.data();
      
      // Impedir a exclusão de roles de sistema
      if (roleData.isSystemRole) {
        throw new Error('Não é possível excluir uma role de sistema');
      }
      
      // TODO: Verificar se a role está sendo usada por usuários
      // Se implementarmos essa verificação, podemos adicionar aqui
      
      await roleRef.delete();
      
      logger.info('Role excluída com sucesso', { 
        service: 'roleModel', 
        function: 'delete', 
        roleId 
      });
      
      return true;
    } catch (error) {
      logger.error('Erro ao excluir role', { 
        service: 'roleModel', 
        function: 'delete', 
        roleId, 
        error: error.message 
      });
      throw error;
    }
  }
}

module.exports = Role;