/**
 * @fileoverview Controller de interesses - gerencia interesses de usuarios e categorias
 * @module controllers/interestsController
 */

const { logger } = require('../logger');
const interestsService = require('../services/interestsService');

/**
 * Controlador para gerenciar endpoints de interesses
 */
const interestsController = {
  /**
   * Busca todas as categorias de interesses disponiveis com seus respectivos interesses
   * @async
   * @function getAvailableInterests
   * @param {Object} req - Objeto de requisicao Express
   * @param {Object} res - Objeto de resposta Express
   * @returns {Promise<Object>} Lista de categorias com interesses
   */
  async getAvailableInterests(req, res) {
    try {
      const categoriesWithInterests = await interestsService.getAvailableInterests();

      return res.status(200).json({ success: true, data: categoriesWithInterests });
    } catch (error) {
      logger.error('Erro ao buscar interesses e categorias', {
        controller: 'interestsController',
        function: 'getAvailableInterests',
        error: error.message
      });
      return res.status(500).json({ success: false, message: 'Erro ao buscar interesses e categorias.' });
    }
  },

  /**
   * Busca interesses de um usuario especifico
   * @async
   * @function getUserInterests
   * @param {Object} req - Objeto de requisicao Express
   * @param {string} req.params.userId - ID do usuario
   * @param {Object} req.user - Usuario autenticado
   * @param {Object} res - Objeto de resposta Express
   * @returns {Promise<Object>} Interesses do usuario
   */
  async getUserInterests(req, res) {
    try {
      const { userId } = req.params;
      const isFirstAccess = req.query.isFirstAccess === 'true';

      // Validar usuario
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'ID do usuario e obrigatorio'
        });
      }

      // Interesses sao dados publicos (exibidos em perfis, usados para recomendacoes)
      // Qualquer usuario autenticado pode visualizar interesses de outros usuarios

      if (isFirstAccess) {
        return res.status(200).json({
          success: true,
          data: []
        });
      }

      const interests = await interestsService.getUserInterests(userId);
      return res.status(200).json({
        success: true,
        data: interests
      });
    } catch (error) {
      logger.error('Erro ao obter interesses do usuario', {
        controller: 'interestsController',
        function: 'getUserInterests',
        error: error.message
      });

      if (error.message.includes('nao encontrado')) {
        return res.status(404).json({
          success: false,
          message: 'Usuario nao encontrado'
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Erro ao obter interesses do usuario',
        error: error.message
      });
    }
  },

  /**
   * Atualiza os interesses de um usuario
   * @async
   * @function updateUserInterests
   * @param {Object} req - Objeto de requisicao Express
   * @param {string} req.params.userId - ID do usuario
   * @param {Object} req.body - Dados da atualizacao
   * @param {Array<string>} req.body.interestIds - IDs dos interesses selecionados
   * @param {Object} req.user - Usuario autenticado
   * @param {Object} res - Objeto de resposta Express
   * @returns {Promise<Object>} Resultado da atualizacao
   */
  async updateUserInterests(req, res) {
    try {
      const { userId } = req.params;
      const { interestIds } = req.body;

      // Validar dados
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'ID do usuario e obrigatorio'
        });
      }

      if (!Array.isArray(interestIds)) {
        return res.status(400).json({
          success: false,
          message: 'interestIds deve ser um array'
        });
      }

      // Verificar autorizacao (o proprio usuario ou admin)
      if (req.user && req.user.uid !== userId && !req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Nao autorizado a modificar interesses de outro usuario'
        });
      }

      const result = await interestsService.updateUserInterests(userId, interestIds);

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Erro ao atualizar interesses do usuario', {
        controller: 'interestsController',
        function: 'updateUserInterests',
        error: error.message
      });

      if (error.message.includes('nao encontrado')) {
        return res.status(404).json({
          success: false,
          message: 'Usuario nao encontrado'
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Erro ao atualizar interesses do usuario',
        error: error.message
      });
    }
  },

  /**
   * [ADMIN] Cria uma nova categoria de interesses
   * @async
   * @function createCategory
   * @param {Object} req - Objeto de requisicao Express
   * @param {Object} req.body - Dados da categoria
   * @param {string} req.body.name - Nome da categoria
   * @param {string} req.body.description - Descricao da categoria
   * @param {string} req.body.icon - Icone da categoria
   * @param {number} req.body.order - Ordem de exibicao
   * @param {Object} req.user - Usuario autenticado (deve ser admin)
   * @param {Object} res - Objeto de resposta Express
   * @returns {Promise<Object>} Categoria criada
   */
  async createCategory(req, res) {
    try {
      if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Acesso restrito a administradores'
        });
      }

      const { name, description, icon, order } = req.body;

      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'Nome da categoria e obrigatorio'
        });
      }

      const categoryData = {
        name,
        description,
        icon,
        order: order || 0,
        active: true
      };

      const category = await interestsService.createCategory(categoryData);

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

      if (error.message.includes('ja existe')) {
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
   * @param {Object} req - Objeto de requisicao Express
   * @param {string} req.params.categoryId - ID da categoria
   * @param {Object} req.body - Dados da atualizacao
   * @param {Object} req.user - Usuario autenticado (deve ser admin)
   * @param {Object} res - Objeto de resposta Express
   * @returns {Promise<Object>} Categoria atualizada
   */
  async updateCategory(req, res) {
    try {
      if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Acesso restrito a administradores'
        });
      }

      const { categoryId } = req.params;
      const { name, description, icon, order, active } = req.body;

      if (!categoryId) {
        return res.status(400).json({
          success: false,
          message: 'ID da categoria e obrigatorio'
        });
      }

      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (icon !== undefined) updateData.icon = icon;
      if (order !== undefined) updateData.order = order;
      if (active !== undefined) updateData.active = active;

      const category = await interestsService.updateCategory(categoryId, updateData);

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

      if (error.message.includes('nao encontrada')) {
        return res.status(404).json({
          success: false,
          message: 'Categoria nao encontrada'
        });
      }

      if (error.message.includes('ja existe')) {
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
   * @param {Object} req - Objeto de requisicao Express
   * @param {Object} req.body - Dados do interesse
   * @param {string} req.body.label - Rotulo do interesse
   * @param {string} req.body.categoryId - ID da categoria
   * @param {string} req.body.description - Descricao do interesse
   * @param {number} req.body.order - Ordem de exibicao
   * @param {Object} req.user - Usuario autenticado (deve ser admin)
   * @param {Object} res - Objeto de resposta Express
   * @returns {Promise<Object>} Interesse criado
   */
  async createInterest(req, res) {
    try {
      if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Acesso restrito a administradores'
        });
      }

      const { label, categoryId, description, order } = req.body;

      if (!label || !categoryId) {
        return res.status(400).json({
          success: false,
          message: 'Label e categoryId sao obrigatorios'
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

      if (error.message.includes('Categoria nao encontrada')) {
        return res.status(404).json({
          success: false,
          message: 'Categoria nao encontrada'
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
   * @param {Object} req - Objeto de requisicao Express
   * @param {string} req.params.interestId - ID do interesse
   * @param {Object} req.body - Dados da atualizacao
   * @param {Object} req.user - Usuario autenticado (deve ser admin)
   * @param {Object} res - Objeto de resposta Express
   * @returns {Promise<Object>} Interesse atualizado
   */
  async updateInterest(req, res) {
    try {
      if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Acesso restrito a administradores'
        });
      }

      const { interestId } = req.params;
      const { label, categoryId, description, order, active } = req.body;

      if (!interestId) {
        return res.status(400).json({
          success: false,
          message: 'ID do interesse e obrigatorio'
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

      if (error.message.includes('nao encontrado')) {
        return res.status(404).json({
          success: false,
          message: 'Interesse nao encontrado'
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
   * [ADMIN] Busca estatisticas de uso dos interesses
   * @async
   * @function getInterestStats
   * @param {Object} req - Objeto de requisicao Express
   * @param {Object} req.user - Usuario autenticado (deve ser admin)
   * @param {Object} res - Objeto de resposta Express
   * @returns {Promise<Object>} Estatisticas de interesses
   */
  async getInterestStats(req, res) {
    try {
      if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Acesso restrito a administradores'
        });
      }

      const stats = await interestsService.calculateInterestStatistics();

      return res.status(200).json({ success: true, ...stats });

    } catch (error) {
      logger.error('Erro ao obter estatisticas de interesses', {
        controller: 'interestsController',
        function: 'getInterestStats',
        error: error.message
      });

      return res.status(500).json({
        success: false,
        message: 'Erro ao obter estatisticas de interesses',
        error: error.message
      });
    }
  },

  /**
   * [DEPRECATED] Endpoint de migracao de interesses estaticos.
   * Mantido para compatibilidade — retorna 410 Gone.
   */
  async migrateStaticInterests(req, res) {
    return res.status(410).json({
      success: false,
      message: 'Endpoint de migracao descontinuado. Dados ja residem no Supabase.'
    });
  },

  /**
   * [DEPRECATED] Endpoint de migracao de interesses de usuarios.
   * Mantido para compatibilidade — retorna 410 Gone.
   */
  async migrateUserInterests(req, res) {
    return res.status(410).json({
      success: false,
      message: 'Endpoint de migracao descontinuado. Dados ja residem no Supabase.'
    });
  }
};

module.exports = interestsController;
