// controllers/permissionController.js
const { logger } = require('../logger');
const permissionService = require('../services/permissionService');

/**
 * Obtém todas as permissões
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const getAllPermissions = async (req, res) => {
  try {
    const filters = req.query || {};
    const permissions = await permissionService.getPermissions(filters);
    
    res.status(200).json({
      success: true,
      data: permissions
    });
  } catch (error) {
    logger.error('Erro ao buscar permissões', {
      controller: 'permissionController',
      method: 'getAllPermissions',
      error: error.message
    });
    
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar permissões',
      error: error.message
    });
  }
};

/**
 * Obtém uma permissão pelo ID
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const getPermissionById = async (req, res) => {
  try {
    const { id } = req.params;
    const permission = await permissionService.getPermissionById(id);
    
    res.status(200).json({
      success: true,
      data: permission
    });
  } catch (error) {
    logger.error('Erro ao buscar permissão por ID', {
      controller: 'permissionController',
      method: 'getPermissionById',
      permissionId: req.params.id,
      error: error.message
    });
    
    if (error.message === 'Permissão não encontrada') {
      return res.status(404).json({
        success: false,
        message: 'Permissão não encontrada'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar permissão',
      error: error.message
    });
  }
};

/**
 * Cria uma nova permissão
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const createPermission = async (req, res) => {
  try {
    const permissionData = req.body;
    const permission = await permissionService.createPermission(permissionData);
    
    res.status(201).json({
      success: true,
      message: 'Permissão criada com sucesso',
      data: permission
    });
  } catch (error) {
    logger.error('Erro ao criar permissão', {
      controller: 'permissionController',
      method: 'createPermission',
      permissionData: req.body,
      error: error.message
    });
    
    if (error.message.includes('já existe')) {
      return res.status(409).json({
        success: false,
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Erro ao criar permissão',
      error: error.message
    });
  }
};

/**
 * Atualiza uma permissão existente
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const updatePermission = async (req, res) => {
  try {
    const { id } = req.params;
    const permissionData = req.body;
    const permission = await permissionService.updatePermission(id, permissionData);
    
    res.status(200).json({
      success: true,
      message: 'Permissão atualizada com sucesso',
      data: permission
    });
  } catch (error) {
    logger.error('Erro ao atualizar permissão', {
      controller: 'permissionController',
      method: 'updatePermission',
      permissionId: req.params.id,
      permissionData: req.body,
      error: error.message
    });
    
    if (error.message === 'Permissão não encontrada') {
      return res.status(404).json({
        success: false,
        message: 'Permissão não encontrada'
      });
    }
    
    if (error.message.includes('já existe')) {
      return res.status(409).json({
        success: false,
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Erro ao atualizar permissão',
      error: error.message
    });
  }
};

/**
 * Remove uma permissão
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const deletePermission = async (req, res) => {
  try {
    const { id } = req.params;
    await permissionService.deletePermission(id);
    
    res.status(200).json({
      success: true,
      message: 'Permissão removida com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao remover permissão', {
      controller: 'permissionController',
      method: 'deletePermission',
      permissionId: req.params.id,
      error: error.message
    });
    
    if (error.message === 'Permissão não encontrada') {
      return res.status(404).json({
        success: false,
        message: 'Permissão não encontrada'
      });
    }
    
    if (error.message.includes('em uso')) {
      return res.status(409).json({
        success: false,
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Erro ao remover permissão',
      error: error.message
    });
  }
};

module.exports = {
  getAllPermissions,
  getPermissionById,
  createPermission,
  updatePermission,
  deletePermission
};