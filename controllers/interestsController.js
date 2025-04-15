// src/controllers/interestsController.js
const { logger } = require('../logger');
const Interest = require('../models/Interest');
const InterestsCategory = require('../models/InterestsCategory');

/**
 * Controlador para gerenciar endpoints de interesses
 */
const interestsController = {
  /**
   * Obter todas as categorias de interesses disponíveis
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
   * Obter interesses do usuário
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
   * Atualizar interesses do usuário
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
   * [ADMIN] Criar uma nova categoria
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
   * [ADMIN] Atualizar uma categoria existente
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
   * [ADMIN] Criar um novo interesse
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
   * [ADMIN] Atualizar um interesse existente
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
   * [ADMIN] Obter estatísticas de uso de interesses
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
   * [ADMIN] Migrar interesses do formato estático para o Firestore
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
   * [ADMIN] Migrar interesses de usuários para o novo formato
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