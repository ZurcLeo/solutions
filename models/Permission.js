// models/Permission.js
const { getFirestore } = require('../firebaseAdmin');
const { logger } = require('../logger');
const LocalStorageService = require('../services/LocalStorageService');
const FirestoreService = require('../utils/firestoreService');
const dbServicePermission = LocalStorageService.collection('permissions');
const { permissions: initialPermissions } = require('../config/data/initialData');

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

  /**
   * Obtém uma lista de todas as permissões, mesclando as permissões do LocalStorage e do initialData
   * @param {Object} filters - Filtros opcionais para busca
   * @returns {Promise<Array<Permission>>} - Lista de permissões
   */
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
      
      // Aqui está a diferença: permissionsCollection já é o array de documentos
      const permissions = permissionsCollection.map(doc => {
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
  

  /**
   * Obtém uma permissão pelo ID, buscando primeiro no LocalStorage e depois no initialData
   * @param {string} permissionId - ID da permissão
   * @returns {Promise<Permission>} - Objeto Permission
   */
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
      // Verificar primeiro no armazenamento local
      const permissionDoc = await dbServicePermission.doc(permissionId).get();
      
      if (permissionDoc.exists) {
        const permissionData = permissionDoc.data();
        permissionData.id = permissionId;
        return new Permission(permissionData);
      }
      
      // Se não encontrou, verificar nos dados iniciais
      const initialPerm = initialPermissions[permissionId];
      if (initialPerm) {
        return new Permission({
          id: permissionId,
          ...initialPerm
        });
      }
      
      // Se não encontrou em nenhum lugar
      logger.warn('Permissão não encontrada', { 
        service: 'permissionModel', 
        function: 'getById', 
        permissionId 
      });
      throw new Error('Permissão não encontrada');
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

  /**
   * Cria uma nova permissão que sobrescreve a versão do initialData, se existir
   * @param {Object} permissionData - Dados da permissão
   * @returns {Promise<Permission>} - Permissão criada
   */
  static async create(permissionData) {
    try {
      // Verificar se já existe uma permissão com esse nome no banco
      const existingPermissions = await dbServicePermission.where('name', '==', permissionData.name).get();
      
      if (!existingPermissions.empty) {
        throw new Error(`Permissão com nome '${permissionData.name}' já existe`);
      }
      
      // Verificar se já existe nos dados iniciais
      const initialPermExists = Object.values(initialPermissions).some(
        p => p.name === permissionData.name
      );
      
      // Criar o objeto Permission
      const permission = new Permission({
        ...permissionData,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      // Se existir nos dados iniciais, logar aviso
      if (initialPermExists) {
        logger.warn('Criando permissão personalizada que sobrescreve definição inicial', {
          service: 'permissionModel',
          function: 'create',
          permissionName: permission.name
        });
      }
      
      // Persistir no banco
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

  /**
   * Atualiza uma permissão existente
   * @param {string} permissionId - ID da permissão
   * @param {Object} data - Novos dados
   * @returns {Promise<Permission>} - Permissão atualizada
   */
  static async update(permissionId, data) {
    if (!permissionId) throw new Error('ID da permissão é obrigatório');
    
    try {
      // Verificar se existe nos dados iniciais
      const isInitialPermission = initialPermissions[permissionId] !== undefined;
      
      // Verificar se existe no banco
      const permissionRef = dbServicePermission.doc(permissionId);
      const permissionDoc = await permissionRef.get();
      
      // Se for uma permissão inicial que não existe no banco, criar cópia antes de atualizar
      if (isInitialPermission && !permissionDoc.exists) {
        logger.info('Criando cópia local de permissão inicial para atualização', {
          service: 'permissionModel',
          function: 'update',
          permissionId
        });
        
        // Criar cópia local da permissão inicial
        await permissionRef.set({
          ...initialPermissions[permissionId],
          id: permissionId,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      } else if (!permissionDoc.exists && !isInitialPermission) {
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
        
        // Verificar também nos dados iniciais
        const existsInInitial = Object.entries(initialPermissions)
          .some(([id, perm]) => id !== permissionId && perm.name === data.name);
        
        if (existsInInitial) {
          throw new Error(`Permissão com nome '${data.name}' já existe nos dados iniciais`);
        }
      }
      
      // Preparar dados de atualização
      const updateData = {
        ...data,
        updatedAt: new Date()
      };
      
      // Atualizar no banco
      await permissionRef.update(updateData);
      
      // Obter permissão atualizada
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

  /**
   * Remove uma permissão do banco (não afeta as permissões do initialData)
   * @param {string} permissionId - ID da permissão
   * @returns {Promise<boolean>} - Sucesso da operação
   */
  static async delete(permissionId) {
    if (!permissionId) throw new Error('ID da permissão é obrigatório');
    
    try {
      // Verificar se existe nos dados iniciais
      const isInitialPermission = initialPermissions[permissionId] !== undefined;
      
      if (isInitialPermission) {
        logger.warn('Tentativa de remover permissão definida nos dados iniciais', {
          service: 'permissionModel',
          function: 'delete',
          permissionId
        });
        throw new Error('Não é possível remover permissões definidas nos dados iniciais');
      }
      
      // Verificar se existe no banco
      const permissionRef = dbServicePermission.doc(permissionId);
      const permissionDoc = await permissionRef.get();
      
      if (!permissionDoc.exists) {
        throw new Error('Permissão não encontrada');
      }
      
      // TODO: Verificar se a permissão está sendo usada por roles
      // Se implementarmos essa verificação, podemos adicionar aqui
      
      // Remover do banco
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

  /**
   * Obtém uma permissão pelo nome, buscando no LocalStorage e no initialData
   * @param {string} permissionName - Nome da permissão
   * @returns {Promise<Permission>} - Objeto Permission
   */
  static async getByName(permissionName) {
    try {
      // Buscar no banco
      const permissionsDb = await dbServicePermission
        .where('name', '==', permissionName)
        .limit(1)
        .get();
      
      if (!permissionsDb.empty) {
        const doc = permissionsDb.docs[0];
        const data = doc.data();
        data.id = doc.id;
        return new Permission(data);
      }
      
      // Buscar nos dados iniciais
      const initialPerm = Object.entries(initialPermissions)
        .find(([_, perm]) => perm.name === permissionName);
      
      if (initialPerm) {
        const [id, data] = initialPerm;
        return new Permission({
          id,
          ...data
        });
      }
      
      // Se não encontrou em nenhum lugar
      logger.warn('Permissão não encontrada pelo nome', { 
        service: 'permissionModel', 
        function: 'getByName', 
        permissionName 
      });
      throw new Error(`Permissão com nome '${permissionName}' não encontrada`);
    } catch (error) {
      logger.error('Erro ao buscar permissão pelo nome', { 
        service: 'permissionModel', 
        function: 'getByName', 
        permissionName, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Verifica se uma permissão com o nome especificado existe
   * @param {string} permissionName - Nome da permissão
   * @returns {Promise<boolean>} - Se a permissão existe
   */
  static async exists(permissionName) {
    try {
      // Buscar no banco
      const permissionsDb = await dbServicePermission
        .where('name', '==', permissionName)
        .limit(1)
        .get();
      
      if (!permissionsDb.empty) {
        return true;
      }
      
      // Buscar nos dados iniciais
      const existsInInitial = Object.values(initialPermissions)
        .some(perm => perm.name === permissionName);
      
      return existsInInitial;
    } catch (error) {
      logger.error('Erro ao verificar existência de permissão', { 
        service: 'permissionModel', 
        function: 'exists', 
        permissionName, 
        error: error.message 
      });
      return false;
    }
  }
}

module.exports = Permission;