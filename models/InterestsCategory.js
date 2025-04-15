// src/models/category.js
const FirestoreService = require('../utils/firestoreService');
const dbService = FirestoreService.collection('interests');
const categoriesDbService = FirestoreService.collection('interests_categories');
const { logger } = require('../logger');

class InterestsCategory {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.description = data.description || '';
    this.icon = data.icon || null;
    this.order = data.order || 0;
    this.active = data.active !== undefined ? data.active : true;
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  toPlainObject() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      icon: this.icon,
      order: this.order,
      active: this.active,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  static async getById(categoryId) {
    logger.info('Buscando categoria por ID', { service: 'categoryModel', function: 'getById', categoryId });

    try {
      const categoryDoc = await categoriesDbService.doc(categoryId).get();

      if (!categoryDoc.exists) {
        logger.warn('Categoria não encontrada', { service: 'categoryModel', function: 'getById', categoryId });
        return null;
      }

      const categoryData = categoryDoc.data();
      categoryData.id = categoryId;

      return new InterestsCategory(categoryData);
    } catch (error) {
      logger.error('Erro ao buscar categoria por ID', {
        service: 'categoryModel',
        function: 'getById',
        categoryId,
        error: error.message
      });
      throw new Error('Erro ao buscar categoria por ID');
    }
  }

  static async getAllCategories(includeInactive = false) {
    logger.info('Buscando todas as categorias', {
      service: 'categoryModel',
      function: 'getAllCategories',
      includeInactive
    });

    try {
      let query = categoriesDbService;

      if (!includeInactive) {
        query = query.where('active', '==', true);
      }

      query = query.orderBy('order');

      const snapshot = await query.get();

      const categories = [];
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        data.id = doc.id;
        categories.push(new InterestsCategory(data));
      });

      logger.info('Categorias obtidas com sucesso', {
        service: 'categoryModel',
        function: 'getAllCategories',
        count: categories.length
      });

      return categories;
    } catch (error) {
      logger.error('Erro ao obter todas as categorias', {
        service: 'categoryModel',
        function: 'getAllCategories',
        error: error.message
      });
      throw new Error('Erro ao obter todas as categorias');
    }
  }

  static async createCategory(categoryData) {
    logger.info('Criando nova categoria', { service: 'categoryModel', function: 'createCategory' });
    
    try {
      // Verificar se já existe uma categoria com o mesmo nome
      const existingQuery = await categoriesDbService.where('name', '==', categoryData.name).get();
      
      if (!existingQuery.empty) {
        logger.warn('Já existe uma categoria com este nome', { 
          service: 'categoryModel', 
          function: 'createCategory', 
          name: categoryData.name 
        });
        throw new Error('Já existe uma categoria com este nome');
      }
      
      // Preparar dados da categoria
      const now = new Date();
      const category = new InterestsCategory({
        ...categoryData,
        createdAt: now,
        updatedAt: now
      });
      
      // Verificar próxima ordem se não fornecida
      if (!categoryData.order) {
        const lastOrderQuery = await categoriesDbService.orderBy('order', 'desc').limit(1).get();
        
        if (!lastOrderQuery.empty) {
          const lastOrder = lastOrderQuery.docs[0].data().order || 0;
          category.order = lastOrder + 1;
        }
      }
      
      // Salvar no Firestore
      const docRef = await categoriesDbService.add(category.toPlainObject());
      category.id = docRef.id;
      
      logger.info('Categoria criada com sucesso', { 
        service: 'categoryModel', 
        function: 'createCategory', 
        categoryId: category.id 
      });
      return category;
    } catch (error) {
      logger.error('Erro ao criar categoria', { 
        service: 'categoryModel', 
        function: 'createCategory', 
        error: error.message 
      });
      throw new Error(`Erro ao criar categoria: ${error.message}`);
    }
  }

  static async updateCategory(categoryId, updateData) {
    logger.info('Atualizando categoria', { service: 'categoryModel', function: 'updateCategory', categoryId });
    
    try {
      const categoryRef = categoriesDbService.doc(categoryId);
      const categoryDoc = await categoryRef.get();
      
      if (!categoryDoc.exists) {
        logger.warn('Categoria não encontrada para atualização', { 
          service: 'categoryModel', 
          function: 'updateCategory', 
          categoryId 
        });
        throw new Error('Categoria não encontrada');
      }
      
      // Verificar se está tentando atualizar para um nome que já existe em outra categoria
      if (updateData.name) {
        const existingQuery = await categoriesDbService.where('name', '==', updateData.name).get();
        
        const isDuplicate = existingQuery.docs.some(doc => doc.id !== categoryId);
        
        if (isDuplicate) {
          logger.warn('Já existe outra categoria com este nome', { 
            service: 'categoryModel', 
            function: 'updateCategory', 
            name: updateData.name 
          });
          throw new Error('Já existe outra categoria com este nome');
        }
      }
      
      // Preparar dados para atualização
      const updatePayload = {
        ...updateData,
        updatedAt: new Date()
      };
      
      // Atualizar no Firestore
      await categoryRef.update(updatePayload);
      
      // Buscar o documento atualizado
      const updatedDoc = await categoryRef.get();
      const updatedData = updatedDoc.data();
      updatedData.id = categoryId;
      
      logger.info('Categoria atualizada com sucesso', { 
        service: 'categoryModel', 
        function: 'updateCategory', 
        categoryId 
      });
      return new InterestsCategory(updatedData);
    } catch (error) {
      logger.error('Erro ao atualizar categoria', { 
        service: 'categoryModel', 
        function: 'updateCategory', 
        categoryId, 
        error: error.message 
      });
      throw new Error(`Erro ao atualizar categoria: ${error.message}`);
    }
  }

  static async deleteCategory(categoryId) {
    logger.info('Verificando se é possível excluir categoria', { 
      service: 'categoryModel', 
      function: 'deleteCategory', 
      categoryId 
    });
    
    try {
      // Verificar se há interesses usando esta categoria
      const interestsQuery = await dbService.where('categoryId', '==', categoryId).limit(1).get();
      
      if (!interestsQuery.empty) {
        logger.warn('Não é possível excluir categoria com interesses associados', { 
          service: 'categoryModel', 
          function: 'deleteCategory', 
          categoryId 
        });
        throw new Error('Não é possível excluir categoria com interesses associados');
      }
      
      // Excluir categoria
      await categoriesDbService.doc(categoryId).delete();
      
      logger.info('Categoria excluída com sucesso', { 
        service: 'categoryModel', 
        function: 'deleteCategory', 
        categoryId 
      });
      return { success: true };
    } catch (error) {
      logger.error('Erro ao excluir categoria', { 
        service: 'categoryModel', 
        function: 'deleteCategory', 
        categoryId, 
        error: error.message 
      });
      throw new Error(`Erro ao excluir categoria: ${error.message}`);
    }
  }

  // Método alternativo: desativar em vez de excluir
  static async deactivateCategory(categoryId) {
    return this.updateCategory(categoryId, { active: false });
  }

  // Reordenar categorias
  static async reorderCategories(orderMap) {
    logger.info('Reordenando categorias', { service: 'categoryModel', function: 'reorderCategories' });
    
    const batch = db.batch();
    
    try {
      for (const [categoryId, newOrder] of Object.entries(orderMap)) {
        const categoryRef = categoriesDbService.doc(categoryId);
        batch.update(categoryRef, { 
          order: newOrder,
          updatedAt: new Date()
        });
      }
      
      await batch.commit();
      
      logger.info('Categorias reordenadas com sucesso', { 
        service: 'categoryModel', 
        function: 'reorderCategories',
        count: Object.keys(orderMap).length
      });
      
      return { success: true };
    } catch (error) {
      logger.error('Erro ao reordenar categorias', { 
        service: 'categoryModel', 
        function: 'reorderCategories', 
        error: error.message 
      });
      throw new Error(`Erro ao reordenar categorias: ${error.message}`);
    }
  }
}

module.exports = InterestsCategory;