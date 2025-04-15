// src/models/interest.js
const FirestoreService = require('../utils/firestoreService');
const FieldValue = require('firebase-admin').firestore.FieldValue;
const dbService = FirestoreService.collection('interests');
const dbServiceUser = FirestoreService.collection('usuario');
const categoriesDbService = FirestoreService.collection('interests_categories');
const { prepareSearchTerms } = require('../utils/searchUtils');
const { logger } = require('../logger');
const admin = require('../firebaseAdmin');

class Interest {
  constructor(data) {
    this.id = data.id;
    this.label = data.label;
    this.categoryId = data.categoryId;
    this.description = data.description || '';
    this.active = data.active !== undefined ? data.active : true;
    this.order = data.order || 0;
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  toPlainObject() {
    return {
      id: this.id,
      label: this.label,
      categoryId: this.categoryId,
      description: this.description,
      active: this.active,
      order: this.order,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  static async getById(interestId) {
    logger.info('Buscando interesse por ID', { service: 'interestModel', function: 'getById', interestId });
    
    try {
      const interestDoc = await dbService.doc(interestId).get();
      
      if (!interestDoc.exists) {
        logger.warn('Interesse não encontrado', { service: 'interestModel', function: 'getById', interestId });
        return null;
      }
      
      const interestData = interestDoc.data();
      interestData.id = interestId;
      
      return new Interest(interestData);
    } catch (error) {
      logger.error('Erro ao buscar interesse por ID', { 
        service: 'interestModel', 
        function: 'getById', 
        interestId, 
        error: error.message 
      });
      throw new Error('Erro ao buscar interesse por ID');
    }
  }

  static async getInterestsByCategory(categoryId, includeInactive = false) {
    try {
      let query = dbService;
      
      // Filtrar por categoryId
      query = query.where('categoryId', '==', categoryId);
      
      if (!includeInactive) {
        query = query.where('active', '==', true);
      }
      
      query = query.orderBy('order');
      
      const snapshot = await query.get();
      
      const interests = [];
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        data.id = doc.id;
        interests.push(new Interest(data));
      });
      
      return interests;
    } catch (error) {
      logger.error('Erro ao obter interesses por categoria', {
        service: 'interestModel',
        function: 'getInterestsByCategory',
        categoryId,
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Erro ao obter interesses por categoria: ${error.message}`);
    }
  }

  static async createInterest(interestData) {
    
    logger.info('Criando novo interesse', { service: 'interestModel', function: 'createInterest' });
    
    try {
      // Verificar se a categoria existe
      const categoryRef = categoriesDbService.doc(interestData.categoryId);
      const categoryDoc = await categoryRef.get();
      
      if (!categoryDoc.exists) {
        logger.error('Categoria não encontrada', { service: 'interestModel', function: 'createInterest', categoryId: interestData.categoryId });
        throw new Error('Categoria não encontrada');
      }
      
      // Preparar termos de pesquisa para facilitar buscas posteriores
      const searchTerms = [
        interestData.label.toLowerCase(),
        ...interestData.label.toLowerCase().split(' ')
      ];
      
      if (interestData.description) {
        searchTerms.push(...interestData.description.toLowerCase().split(' '));
      }
      
      // Filtrar termos de pesquisa duplicados e muito curtos
      const filteredTerms = [...new Set(searchTerms)].filter(term => term.length > 2);
      
      // Preparar dados do interesse
      const now = new Date();
      const interest = new Interest({
        ...interestData,
        createdAt: now,
        updatedAt: now
      });
      
      const interestToSave = {
        ...interest.toPlainObject(),
        searchTerms: prepareSearchTerms(interest.label + ' ' + interest.description)
      };
      
      // Salvar no Firestore
      const docRef = await dbService.collection('interests').add(interestToSave);
      interest.id = docRef.id;
      
      logger.info('Interesse criado com sucesso', { service: 'interestModel', function: 'createInterest', interestId: interest.id });
      return interest;
    } catch (error) {
      logger.error('Erro ao criar interesse', { service: 'interestModel', function: 'createInterest', error: error.message });
      throw new Error(`Erro ao criar interesse: ${error.message}`);
    }
  }

  static async updateInterest(interestId, updateData) {
    
    logger.info('Atualizando interesse', { service: 'interestModel', function: 'updateInterest', interestId });
    
    try {
      const interestRef = dbService.collection('interests').doc(interestId);
      const interestDoc = await interestRef.get();
      
      if (!interestDoc.exists) {
        logger.warn('Interesse não encontrado para atualização', { service: 'interestModel', function: 'updateInterest', interestId });
        throw new Error('Interesse não encontrado');
      }
      
      // Se o nome ou descrição mudar, atualize os termos de pesquisa
      const currentData = interestDoc.data();
      let searchTerms = currentData.searchTerms || [];
      
      if (updateData.label && updateData.label !== currentData.label) {
        const labelTerms = [
          updateData.label.toLowerCase(),
          ...updateData.label.toLowerCase().split(' ')
        ];
        searchTerms = [...new Set([...searchTerms, ...labelTerms])].filter(term => term.length > 2);
      }
      
      if (updateData.description && updateData.description !== currentData.description) {
        const descTerms = updateData.description.toLowerCase().split(' ');
        searchTerms = [...new Set([...searchTerms, ...descTerms])].filter(term => term.length > 2);
      }
      
      // Preparar dados para atualização
      const updatePayload = {
        ...updateData,
        updatedAt: new Date(),
        searchTerms: prepareSearchTerms((updateData.label || currentData.label) + ' ' + (updateData.description || currentData.description))
      };
      
      // Atualizar no Firestore
      await interestRef.update(updatePayload);
      
      // Buscar o documento atualizado
      const updatedDoc = await interestRef.get();
      const updatedData = updatedDoc.data();
      updatedData.id = interestId;
      
      logger.info('Interesse atualizado com sucesso', { service: 'interestModel', function: 'updateInterest', interestId });
      return new Interest(updatedData);
    } catch (error) {
      logger.error('Erro ao atualizar interesse', { service: 'interestModel', function: 'updateInterest', interestId, error: error.message });
      throw new Error(`Erro ao atualizar interesse: ${error.message}`);
    }
  }

/**
 * Fetches a user's interests from their Firestore document
 * Handles both the newer interestIds array format and the legacy interesses map format
 * @param {string} userId - The ID of the user to fetch interests for
 * @returns {Promise<Array>} Array of interest categories with their interests
 */
static async getUserInterests(userId) {
  logger.info('Buscando interesses do usuário', { service: 'interestModel', function: 'getUserInterests', userId });
  
  try {
    // Buscar o usuário
    const userRef = dbServiceUser.doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      logger.warn('Usuário não encontrado', { service: 'interestModel', function: 'getUserInterests', userId });
      throw new Error('Usuário não encontrado');
    }
    
    const userData = userDoc.data();
    
    // Checar ambos os formatos de armazenamento de interesses
    const userInterestIds = userData.interestIds || []; // Novo formato (array plano)
    const userInteresses = userData.interesses || {}; // Formato legado (mapa de categorias)
    
    // Se não houver interesses em nenhum formato, retornar array vazio
    if (userInterestIds.length === 0 && Object.keys(userInteresses).length === 0) {
      logger.info('Usuário não possui interesses', { service: 'interestModel', function: 'getUserInterests', userId });
      return [];
    }
    
    // Determinar quais IDs de interesses usar (priorizar o novo formato, mas usar o legado se necessário)
    let interestIdsToFetch = [];
    
    if (userInterestIds.length > 0) {
      // Se temos o novo formato, usar ele diretamente
      interestIdsToFetch = userInterestIds;
      logger.info('Usando formato novo (interestIds) para buscar interesses', { 
        service: 'interestModel', 
        function: 'getUserInterests',
        count: interestIdsToFetch.length
      });
    } else {
      // Caso contrário, extrair IDs do formato legado
      Object.values(userInteresses).forEach(categoryInterests => {
        if (Array.isArray(categoryInterests)) {
          categoryInterests.forEach(interestId => {
            if (interestId && !interestIdsToFetch.includes(interestId)) {
              interestIdsToFetch.push(interestId);
            }
          });
        }
      });
      
      logger.info('Usando formato legado (interesses) para buscar interesses', { 
        service: 'interestModel', 
        function: 'getUserInterests',
        count: interestIdsToFetch.length
      });
    }
    
    // Se não temos interesses para buscar, retornar array vazio
    if (interestIdsToFetch.length === 0) {
      return [];
    }
    
    // Buscar todos os interesses de uma vez (mais eficiente)
    const interestsMap = {};
    
    // Dividir em lotes de 10 para evitar limites do Firestore
    const batchSize = 10;
    for (let i = 0; i < interestIdsToFetch.length; i += batchSize) {
      const batch = interestIdsToFetch.slice(i, i + batchSize);
      
      // Para cada lote, buscar os documentos de interesse
      const interestPromises = batch.map(interestId => 
        dbService.doc(interestId).get()
      );
      
      const interestDocs = await Promise.all(interestPromises);
      
      // Processar cada documento de interesse
      interestDocs.forEach(doc => {
        if (doc.exists) {
          const interestData = doc.data();
          const interestId = doc.id;
          const categoryId = interestData.categoryId;
          
          if (categoryId) {
            if (!interestsMap[categoryId]) {
              interestsMap[categoryId] = {
                categoryId,
                interests: []
              };
            }
            
            // Adicionar o interesse ao seu mapa de categoria
            interestsMap[categoryId].interests.push({
              id: interestId,
              label: interestData.label,
              ...interestData
            });
          }
        }
      });
    }
    
    // Agora, buscar os detalhes das categorias
    const categoryIds = Object.keys(interestsMap);
    const categoryPromises = categoryIds.map(categoryId => 
      categoriesDbService.doc(categoryId).get()
    );
    
    const categoryDocs = await Promise.all(categoryPromises);
    
    // Adicionar os detalhes das categorias
    categoryDocs.forEach(doc => {
      if (doc.exists && interestsMap[doc.id]) {
        const categoryData = doc.data();
        interestsMap[doc.id].name = categoryData.name;
        interestsMap[doc.id].icon = categoryData.icon;
        interestsMap[doc.id].id = doc.id;
      }
    });
    
    // Converter para array e filtrar categorias sem interesses
    const result = Object.values(interestsMap)
      .filter(category => category.interests && category.interests.length > 0);
    
    logger.info('Interesses do usuário obtidos com sucesso', { 
      service: 'interestModel', 
      function: 'getUserInterests', 
      userId,
      categoriesCount: result.length,
      interestsCount: result.reduce((sum, cat) => sum + cat.interests.length, 0)
    });
    
    return result;
    
  } catch (error) {
    logger.error('Erro ao buscar interesses do usuário', { 
      service: 'interestModel', 
      function: 'getUserInterests', 
      userId, 
      error: error.message,
      stack: error.stack
    });
    throw new Error(`Erro ao buscar interesses do usuário: ${error.message}`);
  }
}

/**
 * Updates the interests of a user, maintaining both the legacy format (interesses map)
 * and the new format (interestIds array)
 * @param {string} userId - The ID of the user to update
 * @param {Array} interestIds - Array of interest IDs selected by the user
 * @returns {Promise<Object>} Result with success status and updated interest IDs
 */
static async updateUserInterests(userId, interestIds) {
  logger.info('Updating user interests', { 
    service: 'interestModel', 
    function: 'updateUserInterests', 
    userId 
  });
  
  try {
    // Verify if the user exists
    const userRef = dbServiceUser.doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      logger.warn('User not found', { 
        service: 'interestModel', 
        function: 'updateUserInterests', 
        userId 
      });
      throw new Error('User not found');
    }
    
    // Get current user data
    const userData = userDoc.data();
    
    // Validate and filter interest IDs to ensure they exist and are active
    const validInterestIds = [];
    const interestsByCategory = {};
    
    // Process each interest ID
    for (const interestId of interestIds) {
      try {
        const interestDoc = await dbService.doc(interestId).get();
        
        if (interestDoc.exists && interestDoc.data().active !== false) {
          validInterestIds.push(interestId);
          
          // Group by category for the legacy format
          const interestData = interestDoc.data();
          const categoryId = interestData.categoryId;
          
          if (!interestsByCategory[categoryId]) {
            interestsByCategory[categoryId] = [];
          }
          
          interestsByCategory[categoryId].push(interestId);
        } else {
          logger.warn('Skipping invalid or inactive interest', { 
            service: 'interestModel', 
            function: 'updateUserInterests', 
            interestId 
          });
        }
      } catch (err) {
        logger.warn('Error processing interest', { 
          service: 'interestModel', 
          function: 'updateUserInterests', 
          interestId,
          error: err.message
        });
        // Continue with other interests even if one fails
      }
    }
    
    // // Step 1: Get all categories to build complete structure
    // const categoriesSnapshot = await categoriesDbService.get();
    // const allCategories = {};
    
    // categoriesSnapshot.docs.forEach(doc => {
    //   allCategories[doc.id] = []; // Initialize each category with empty array
    // });
    
    // Step 2: Merge with the user-selected interests
    // const interessesMap = { ...allCategories, ...interestsByCategory };
    
    // Step 3: Update user document with both new and legacy formats
    const updates = {
      // New format - flat array of interest IDs
      interestIds: validInterestIds,
      
      // Legacy format - map of categories to arrays of interest IDs
      interesses: interestsByCategory,
      
      // Update timestamp
      updatedAt: FieldValue.serverTimestamp()
    };
    
    await userRef.update(updates);
    
    logger.info('User interests updated successfully', { 
      service: 'interestModel', 
      function: 'updateUserInterests', 
      userId,
      interestCount: validInterestIds.length,
      categoryCount: Object.keys(interestsByCategory).length
    });
    
    return { 
      success: true, 
      interestIds: validInterestIds,
      categoryCount: Object.keys(interestsByCategory).length
    };
  } catch (error) {
    logger.error('Error updating user interests', { 
      service: 'interestModel', 
      function: 'updateUserInterests', 
      userId, 
      error: error.message,
      stack: error.stack
    });
    throw new Error(`Failed to update user interests: ${error.message}`);
  }
}
  
  static async getAllInterestsFlat() {
    
    logger.info('Buscando todos os interesses em formato plano', { 
      service: 'interestModel', 
      function: 'getAllInterestsFlat'
    });
    
    try {
      const snapshot = await dbService
        .where('active', '==', true)
        .get();
      
      const interests = [];
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        data.id = doc.id;
        interests.push(new Interest(data).toPlainObject());
      });
      
      logger.info('Interesses obtidos com sucesso', { 
        service: 'interestModel', 
        function: 'getAllInterestsFlat',
        count: interests.length
      });
      
      return interests;
    } catch (error) {
      logger.error('Erro ao obter todos os interesses', { 
        service: 'interestModel', 
        function: 'getAllInterestsFlat', 
        error: error.message 
      });
      throw new Error('Erro ao obter todos os interesses');
    }
  }

  static async calculateInterestStatistics() {
    const db = admin.getFirestore();
    logger.info('Calculando estatísticas de interesses', { service: 'interestStatsService', function: 'calculateInterestStatistics' });

    try {
      // Buscar todos os usuários
      const usersSnapshot = await dbServiceUser.get();

      // Mapa para contar ocorrências de cada interesse
      const interestCounts = {};

      // Processar cada usuário
      usersSnapshot.docs.forEach(doc => {
        const userData = doc.data();

        // Novo formato
        if (userData.interestIds && Array.isArray(userData.interestIds)) {
          userData.interestIds.forEach(interestId => {
            interestCounts[interestId] = (interestCounts[interestId] || 0) + 1;
          });
        }
        // Formato antigo
        else if (userData.interesses) {
          Object.values(userData.interesses).forEach(categoryInterests => {
            if (Array.isArray(categoryInterests)) {
              categoryInterests.forEach(interestId => {
                interestCounts[interestId] = (interestCounts[interestId] || 0) + 1;
              });
            }
          });
        }
      });

      // Obter detalhes dos interesses
      const interestIds = Object.keys(interestCounts);
      const interestDetails = [];

      for (const interestId of interestIds) {
        const interest = await this.getById(interestId);
        if (interest) {
          interestDetails.push({
            id: interestId,
            label: interest.label,
            categoryId: interest.categoryId,
            count: interestCounts[interestId]
          });
        }
      }

      // Ordenar por contagem (mais populares primeiro)
      interestDetails.sort((a, b) => b.count - a.count);

      return {
        totalUsers: usersSnapshot.size,
        data: interestDetails
      };
    } catch (error) {
      logger.error('Erro ao calcular estatísticas de interesses', {
        service: 'interestStatsService',
        function: 'calculateInterestStatistics',
        error: error.message
      });
      throw new Error('Erro ao calcular estatísticas de interesses');
    }
  }
}

module.exports = Interest;