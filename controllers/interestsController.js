/**
 * @fileoverview Controller de interesses - gerencia interesses de usuários e categorias
 * @module controllers/interestsController
 */

const { logger } = require('../logger');
const Interest = require('../models/Interest');
const InterestsCategory = require('../models/InterestsCategory');

/**
 * Controlador para gerenciar endpoints de interesses
 */
const interestsController = {
  /**
   * Busca todas as categorias de interesses disponíveis com seus respectivos interesses
   * @async
   * @function getAvailableInterests
   * @param {Object} req - Objeto de requisição Express
   * @param {Object} res - Objeto de resposta Express
   * @returns {Promise<Object>} Lista de categorias com interesses
   */
  async getAvailableInterests(req, res) {
    try {
      // 1. Buscar todas as categorias ativas
      const categories = await InterestsCategory.getAllCategories();
  
      // 2. Para cada categoria, buscar APENAS os interesses relacionados àquela categoria
      const categoriesWithInterests = await Promise.all(
        categories.map(async (category) => {
          // Modificação aqui - passar o ID da categoria como filtro
          const interests = await Interest.getInterestsByCategory(category.id);
  
          return {
            ...category.toPlainObject(),
            interests: interests.map(interest => interest.toPlainObject()),
          };
        })
      );
  
      return res.status(200).json({ success: true, data: categoriesWithInterests });
    } catch (error) {
      console.error('Erro ao buscar interesses e categorias:', error);
      return res.status(500).json({ success: false, message: 'Erro ao buscar interesses e categorias.' });
    }
  },

  /**
   * Busca interesses de um usuário específico
   * @async
   * @function getUserInterests
   * @param {Object} req - Objeto de requisição Express
   * @param {string} req.params.userId - ID do usuário
   * @param {boolean} req.isFirstAccess - Indica se é primeiro acesso
   * @param {Object} req.user - Usuário autenticado
   * @param {Object} res - Objeto de resposta Express
   * @returns {Promise<Object>} Interesses do usuário
   */
  async getUserInterests(req, res) {
    try {
      const { userId } = req.params;
      const { isFirstAccess } = req.isFirstAccess
      // Validar usuário (pode ser feito por middleware)
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'ID do usuário é obrigatório'
        });
      }
      
      // Verificar autorização (o próprio usuário ou admin)
      if (req.user && req.user.uid !== userId && !req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Não autorizado a acessar interesses de outro usuário'
        });
      }
      
      if (!isFirstAccess) {
        const interests = await Interest.getUserInterests(userId);
        return res.status(200).json({
          success: true,
          data: interests
        });
      }

      return res.status(200).json({
        success: true,
        data: {}
      });
    } catch (error) {
      logger.error('Erro ao obter interesses do usuário', {
        controller: 'interestsController',
        function: 'getUserInterests',
        error: error.message
      });
      
      // Tratar erro específico de "Usuário não encontrado"
      if (error.message.includes('não encontrado')) {
        return res.status(404).json({
          success: false,
          message: 'Usuário não encontrado'
        });
      }
      
      return res.status(500).json({
        success: false,
        message: 'Erro ao obter interesses do usuário',
        error: error.message
      });
    }
  },

  /**
   * Atualiza os interesses de um usuário
   * @async
   * @function updateUserInterests
   * @param {Object} req - Objeto de requisição Express
   * @param {string} req.params.userId - ID do usuário
   * @param {Object} req.body - Dados da atualização
   * @param {Array<string>} req.body.interestIds - IDs dos interesses selecionados
   * @param {Object} req.user - Usuário autenticado
   * @param {Object} res - Objeto de resposta Express
   * @returns {Promise<Object>} Resultado da atualização
   */
  async updateUserInterests(req, res) {
    try {
      const { userId } = req.params;
      const { interestIds } = req.body;
      
      // Validar dados
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'ID do usuário é obrigatório'
        });
      }
      
      if (!Array.isArray(interestIds)) {
        return res.status(400).json({
          success: false,
          message: 'interestIds deve ser um array'
        });
      }
      
      // Verificar autorização (o próprio usuário ou admin)
      if (req.user && req.user.uid !== userId && !req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Não autorizado a modificar interesses de outro usuário'
        });
      }
      
      const result = await Interest.updateUserInterests(userId, interestIds);
      
      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Erro ao atualizar interesses do usuário', {
        controller: 'interestsController',
        function: 'updateUserInterests',
        error: error.message
      });
      
      // Tratar erro específico de "Usuário não encontrado"
      if (error.message.includes('não encontrado')) {
        return res.status(404).json({
          success: false,
          message: 'Usuário não encontrado'
        });
      }
      
      return res.status(500).json({
        success: false,
        message: 'Erro ao atualizar interesses do usuário',
        error: error.message
      });
    }
  },

  /**
   * [ADMIN] Cria uma nova categoria de interesses
   * @async
   * @function createCategory
   * @param {Object} req - Objeto de requisição Express
   * @param {Object} req.body - Dados da categoria
   * @param {string} req.body.name - Nome da categoria
   * @param {string} req.body.description - Descrição da categoria
   * @param {string} req.body.icon - Ícone da categoria
   * @param {number} req.body.order - Ordem de exibição
   * @param {Object} req.user - Usuário autenticado (deve ser admin)
   * @param {Object} res - Objeto de resposta Express
   * @returns {Promise<Object>} Categoria criada
   */
  async createCategory(req, res) {
    try {
      // Verificar se é admin
      if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Acesso restrito a administradores'
        });
      }
      
      const { name, description, icon, order } = req.body;
      
      // Validar dados
      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'Nome da categoria é obrigatório'
        });
      }
      
      const categoryData = {
        name,
        description,
        icon,
        order: order || 0,
        active: true
      };
      
      const category = await InterestsCategory.createCategory(categoryData);
      
      return res.status(201).json({
        success: true,
        data: category
      });
    } catch (error) {
      logger.error('Erro ao criar categoria', {
        controller: 'interestsController',
        function: 'createCategory',
        error: error.message
      });
      
      // Tratar erro de categoria duplicada
      if (error.message.includes('já existe')) {
        return res.status(409).json({
          success: false,
          message: error.message
        });
      }
      
      return res.status(500).json({
        success: false,
        message: 'Erro ao criar categoria',
        error: error.message
      });
    }
  },

  /**
   * [ADMIN] Atualiza uma categoria existente
   * @async
   * @function updateCategory
   * @param {Object} req - Objeto de requisição Express
   * @param {string} req.params.categoryId - ID da categoria
   * @param {Object} req.body - Dados da atualização
   * @param {Object} req.user - Usuário autenticado (deve ser admin)
   * @param {Object} res - Objeto de resposta Express
   * @returns {Promise<Object>} Categoria atualizada
   */
  async updateCategory(req, res) {
    try {
      // Verificar se é admin
      if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Acesso restrito a administradores'
        });
      }
      
      const { categoryId } = req.params;
      const { name, description, icon, order, active } = req.body;
      
      // Validar dados
      if (!categoryId) {
        return res.status(400).json({
          success: false,
          message: 'ID da categoria é obrigatório'
        });
      }
      
      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (icon !== undefined) updateData.icon = icon;
      if (order !== undefined) updateData.order = order;
      if (active !== undefined) updateData.active = active;
      
      const category = await InterestsCategory.updateCategory(categoryId, updateData);
      
      return res.status(200).json({
        success: true,
        data: category
      });
    } catch (error) {
      logger.error('Erro ao atualizar categoria', {
        controller: 'interestsController',
        function: 'updateCategory',
        error: error.message
      });
      
      // Tratar erro de categoria não encontrada
      if (error.message.includes('não encontrada')) {
        return res.status(404).json({
          success: false,
          message: 'Categoria não encontrada'
        });
      }
      
      // Tratar erro de categoria duplicada
      if (error.message.includes('já existe')) {
        return res.status(409).json({
          success: false,
          message: error.message
        });
      }
      
      return res.status(500).json({
        success: false,
        message: 'Erro ao atualizar categoria',
        error: error.message
      });
    }
  },

  /**
   * [ADMIN] Cria um novo interesse dentro de uma categoria
   * @async
   * @function createInterest
   * @param {Object} req - Objeto de requisição Express
   * @param {Object} req.body - Dados do interesse
   * @param {string} req.body.label - Rótulo do interesse
   * @param {string} req.body.categoryId - ID da categoria
   * @param {string} req.body.description - Descrição do interesse
   * @param {number} req.body.order - Ordem de exibição
   * @param {Object} req.user - Usuário autenticado (deve ser admin)
   * @param {Object} res - Objeto de resposta Express
   * @returns {Promise<Object>} Interesse criado
   */
  async createInterest(req, res) {
    try {
      // Verificar se é admin
      if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Acesso restrito a administradores'
        });
      }
      
      const { label, categoryId, description, order } = req.body;
      
      // Validar dados
      if (!label || !categoryId) {
        return res.status(400).json({
          success: false,
          message: 'Label e categoryId são obrigatórios'
        });
      }
      
      const interestData = {
        label,
        categoryId,
        description,
        order: order || 0,
        active: true
      };
      
      const interest = await interestsService.createInterest(interestData);
      
      return res.status(201).json({
        success: true,
        data: interest
      });
    } catch (error) {
      logger.error('Erro ao criar interesse', {
        controller: 'interestsController',
        function: 'createInterest',
        error: error.message
      });
      
      // Tratar erro de categoria não encontrada
      if (error.message.includes('Categoria não encontrada')) {
        return res.status(404).json({
          success: false,
          message: 'Categoria não encontrada'
        });
      }
      
      return res.status(500).json({
        success: false,
        message: 'Erro ao criar interesse',
        error: error.message
      });
    }
  },

  /**
   * [ADMIN] Atualiza um interesse existente
   * @async
   * @function updateInterest
   * @param {Object} req - Objeto de requisição Express
   * @param {string} req.params.interestId - ID do interesse
   * @param {Object} req.body - Dados da atualização
   * @param {Object} req.user - Usuário autenticado (deve ser admin)
   * @param {Object} res - Objeto de resposta Express
   * @returns {Promise<Object>} Interesse atualizado
   */
  async updateInterest(req, res) {
    try {
      // Verificar se é admin
      if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Acesso restrito a administradores'
        });
      }
      
      const { interestId } = req.params;
      const { label, categoryId, description, order, active } = req.body;
      
      // Validar dados
      if (!interestId) {
        return res.status(400).json({
          success: false,
          message: 'ID do interesse é obrigatório'
        });
      }
      
      const updateData = {};
      if (label !== undefined) updateData.label = label;
      if (categoryId !== undefined) updateData.categoryId = categoryId;
      if (description !== undefined) updateData.description = description;
      if (order !== undefined) updateData.order = order;
      if (active !== undefined) updateData.active = active;
      
      const interest = await interestsService.updateInterest(interestId, updateData);
      
      return res.status(200).json({
        success: true,
        data: interest
      });
    } catch (error) {
      logger.error('Erro ao atualizar interesse', {
        controller: 'interestsController',
        function: 'updateInterest',
        error: error.message
      });
      
      // Tratar erro de interesse não encontrado
      if (error.message.includes('não encontrado')) {
        return res.status(404).json({
          success: false,
          message: 'Interesse não encontrado'
        });
      }
      
      return res.status(500).json({
        success: false,
        message: 'Erro ao atualizar interesse',
        error: error.message
      });
    }
  },

  /**
   * [ADMIN] Busca estatísticas de uso dos interesses
   * @async
   * @function getInterestStats
   * @param {Object} req - Objeto de requisição Express
   * @param {Object} req.user - Usuário autenticado (deve ser admin)
   * @param {Object} res - Objeto de resposta Express
   * @returns {Promise<Object>} Estatísticas de interesses
   */
  async getInterestStats(req, res) {
    try {
      // Verificar se é admin (mantendo a verificação no controlador)
      if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Acesso restrito a administradores'
        });
      }
  
      // Chamar o serviço para calcular as estatísticas
      const stats = await Interest.calculateInterestStatistics();
  
      return res.status(200).json({ success: true, ...stats });
  
    } catch (error) {
      logger.error('Erro ao obter estatísticas de interesses', {
        controller: 'interestsController',
        function: 'getInterestStats',
        error: error.message
      });
  
      return res.status(500).json({
        success: false,
        message: 'Erro ao obter estatísticas de interesses',
        error: error.message
      });
    }
  },
  
  /**
   * [ADMIN] Migra interesses do formato estático para o Firestore
   * @async
   * @function migrateStaticInterests
   * @param {Object} req - Objeto de requisição Express
   * @param {Object} req.body - Dados da migração
   * @param {Object} req.body.staticInterests - Interesses estáticos a migrar
   * @param {Object} req.user - Usuário autenticado (deve ser admin)
   * @param {Object} res - Objeto de resposta Express
   * @returns {Promise<Object>} Resultado da migração
   */
  async migrateStaticInterests(req, res) {
    try {
      // Verificar se é admin
      if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Acesso restrito a administradores'
        });
      }
      
      const { staticInterests } = req.body;
      
      if (!staticInterests || typeof staticInterests !== 'object') {
        return res.status(400).json({
          success: false,
          message: 'Dados de interesses estáticos são obrigatórios'
        });
      }
      
      const result = await interestsService.migrateStaticInterestsToFirestore(staticInterests);
      
      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Erro ao migrar interesses estáticos', {
        controller: 'interestsController',
        function: 'migrateStaticInterests',
        error: error.message
      });
      
      return res.status(500).json({
        success: false,
        message: 'Erro ao migrar interesses estáticos',
        error: error.message
      });
    }
  },

  /**
   * [ADMIN] Migra interesses de usuários para o novo formato
   * @async
   * @function migrateUserInterests
   * @param {Object} req - Objeto de requisição Express
   * @param {Object} req.user - Usuário autenticado (deve ser admin)
   * @param {Object} res - Objeto de resposta Express
   * @returns {Promise<Object>} Resultado da migração
   */
  async migrateUserInterests(req, res) {
    try {
      // Verificar se é admin
      if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Acesso restrito a administradores'
        });
      }
      
      const result = await interestsService.migrateUserInterestsToNewFormat();
      
      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Erro ao migrar interesses de usuários', {
        controller: 'interestsController',
        function: 'migrateUserInterests',
        error: error.message
      });
      
      return res.status(500).json({
        success: false,
        message: 'Erro ao migrar interesses de usuários',
        error: error.message
      });
    }
  }
};

module.exports = interestsController;