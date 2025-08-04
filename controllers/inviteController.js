/**
 * @fileoverview Controller de convites - gerencia sistema de convites entre usuários
 * @module controllers/inviteController
 */

const { logger } = require('../logger');
const inviteService = require('../services/inviteService');
const { HttpError } = require('../utils/errors');

/**
 * Verifica a existência e validade de um convite sem validá-lo
 * @async
 * @function checkInvite
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.inviteId - ID do convite
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Resposta com informações básicas do convite
 */
exports.checkInvite = async (req, res) => {
  const { inviteId } = req.params;
  
  logger.info('Verificando convite', { 
    service: 'inviteController', 
    function: 'checkInvite', 
    inviteId 
  });

  if (!inviteId) {
    return res.status(400).json({ 
      success: false, 
      message: 'ID do convite não fornecido' 
    });
  }

  try {
    const result = await inviteService.checkInvite(inviteId);
    return res.status(200).json(result);
  } catch (error) {
    logger.error('Erro ao verificar convite', { 
      service: 'inviteController', 
      function: 'checkInvite', 
      inviteId, 
      error: error.message 
    });

    // Para este endpoint específico, sempre retornamos 200 com valid:false 
    // para não revelar informações sobre a existência de convites
    return res.status(200).json({ 
      valid: false, 
      message: 'Erro ao verificar convite' 
    });
  }
};

/**
 * Valida um convite com email e nome do usuário
 * @async
 * @function validateInvite
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.inviteId - ID do convite
 * @param {Object} req.body - Dados de validação
 * @param {string} req.body.email - Email do usuário
 * @param {string} req.body.nome - Nome do usuário
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Resposta com resultado da validação e token de registro
 */
exports.validateInvite = async (req, res) => {
  const { inviteId } = req.params;
  const { email, nome } = req.body;
  
  logger.info('Validando convite', { 
    service: 'inviteController', 
    function: 'validateInvite', 
    inviteId, 
    email 
  });

  if (!inviteId || !email || !nome) {
    return res.status(400).json({ 
      success: false, 
      message: 'ID do convite, email e nome são obrigatórios' 
    });
  }

  try {
    const result = await inviteService.validateInvite(inviteId, email, nome);
    return res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    
    logger.error('Erro ao validar convite', { 
      service: 'inviteController', 
      function: 'validateInvite', 
      inviteId,
      email,
      error: error.message 
    });
    
    return res.status(statusCode).json({ 
      success: false, 
      message: error.message 
    });
  }
};

/**
 * Invalida um convite existente após uso
 * @async
 * @function invalidateInvite
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} req.body - Dados da invalidação
 * @param {string} req.body.inviteId - ID do convite
 * @param {Object} req.user - Usuário autenticado
 * @param {string} req.user.uid - ID do usuário
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Resposta com resultado da invalidação
 */
exports.invalidateInvite = async (req, res) => {
  const { inviteId } = req.body;
  const userId = req.user.uid;
  
  logger.info('Invalidando convite', { 
    service: 'inviteController', 
    function: 'invalidateInvite', 
    inviteId, 
    userId
  });

  if (!inviteId) {
    return res.status(400).json({ 
      success: false, 
      message: 'ID do convite é obrigatório' 
    });
  }

  try {
    await inviteService.invalidateInvite(inviteId, userId);
    
    return res.status(200).json({ 
      success: true, 
      message: 'Convite invalidado com sucesso' 
    });
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    
    logger.error('Erro ao invalidar convite', { 
      service: 'inviteController', 
      function: 'invalidateInvite', 
      inviteId, 
      userId,
      error: error.message 
    });
    
    return res.status(statusCode).json({ 
      success: false, 
      message: error.message 
    });
  }
};

/**
 * Reenvia um convite existente
 * @async
 * @function resendInvite
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.inviteId - ID do convite
 * @param {Object} req.user - Usuário autenticado
 * @param {string} req.user.uid - ID do usuário
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Resposta com resultado do reenvio
 */
exports.resendInvite = async (req, res) => {
  const { inviteId } = req.params;
  const userId = req.user.uid;
  
  logger.info('Reenviando convite', { 
    service: 'inviteController', 
    function: 'resendInvite', 
    inviteId, 
    userId 
  });

  if (!inviteId) {
    return res.status(400).json({ 
      success: false, 
      message: 'ID do convite é obrigatório' 
    });
  }

  try {
    const result = await inviteService.resendInvite(inviteId, userId);
    
    return res.status(200).json({
      success: true,
      message: 'Convite reenviado com sucesso',
      ...result
    });
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    
    logger.error('Erro ao reenviar convite', { 
      service: 'inviteController', 
      function: 'resendInvite', 
      inviteId, 
      userId,
      error: error.message 
    });
    
    return res.status(statusCode).json({ 
      success: false, 
      message: error.message 
    });
  }
};

/**
 * Gera e envia um novo convite
 * @async
 * @function sendInvite
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} req.validatedBody - Dados validados
 * @param {string} req.validatedBody.email - Email do destinatário
 * @param {string} req.validatedBody.friendName - Nome do amigo
 * @param {Object} req.user - Usuário autenticado
 * @param {string} req.user.uid - ID do usuário
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Resposta com resultado da geração do convite
 */
exports.sendInvite = async (req, res) => {
  const { email, friendName } = req.validatedBody;
  const userId = req.user.uid;
  
  logger.info('Enviando novo convite', {
    service: 'inviteController',
    function: 'sendInvite',
    email,
    userId
  });

  try {
    // Verificar limitações e permissões
    const canSendResult = await inviteService.canSendInvite(userId, email);
    
    if (!canSendResult.canSend) {
      return res.status(400).json({
        success: false,
        message: canSendResult.message
      });
    }
    
    // Gerar e enviar o convite
    const result = await inviteService.generateAndSendInvite(userId, email, friendName);
    
    return res.status(200).json({
      success: true,
      message: 'Convite enviado com sucesso',
      ...result
    });
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    
    logger.error('Erro ao enviar convite', {
      service: 'inviteController',
      function: 'sendInvite',
      email,
      userId,
      error: error.message
    });
    
    return res.status(statusCode).json({ 
      success: false, 
      message: error.message 
    });
  }
};

/**
 * Busca todos os convites enviados por um usuário
 * @async
 * @function getSentInvites
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} req.user - Usuário autenticado
 * @param {string} req.user.uid - ID do usuário
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Resposta com lista de convites enviados
 */
exports.getSentInvites = async (req, res) => {
  const userId = req.user.uid;
  
  logger.info('Buscando convites enviados', { 
    service: 'inviteController', 
    function: 'getSentInvites', 
    userId 
  });

  try {
    const invites = await inviteService.getSentInvites(userId);
    
    logger.info('Convites processados com sucesso', { 
      service: 'inviteController', 
      function: 'getSentInvites',
      userId,
      count: invites.length
    });
    
    // Sempre retornar 200 com o array de convites, mesmo vazio
    return res.status(200).json({
      success: true,
      invitations: invites,
      message: invites.length ? 'Convites encontrados' : 'Nenhum convite encontrado'
    });
  } catch (error) {
    logger.error('Erro ao buscar convites', { 
      service: 'inviteController', 
      function: 'getSentInvites', 
      userId, 
      error: error.message 
    });
    
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar convites.',
      error: error.message,
    });
  }
};

/**
 * Busca detalhes de um convite específico por ID
 * @async
 * @function getInviteById
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.inviteId - ID do convite
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Resposta com detalhes do convite
 */
exports.getInviteById = async (req, res) => {
  const { inviteId } = req.params;
  
  logger.info('Buscando convite por ID', { 
    service: 'inviteController', 
    function: 'getInviteById', 
    inviteId 
  });

  if (!inviteId) {
    return res.status(400).json({ 
      success: false, 
      message: 'ID do convite é obrigatório' 
    });
  }

  try {
    const invite = await inviteService.getInviteById(inviteId);
    
    return res.status(200).json({
      success: true,
      data: invite
    });
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    
    logger.error('Erro ao buscar convite', { 
      service: 'inviteController', 
      function: 'getInviteById', 
      inviteId,
      error: error.message 
    });
    
    return res.status(statusCode).json({ 
      success: false, 
      message: error.message 
    });
  }
};

/**
 * Cancela um convite que ainda não foi utilizado
 * @async
 * @function cancelInvite
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.inviteId - ID do convite
 * @param {Object} req.user - Usuário autenticado
 * @param {string} req.user.uid - ID do usuário
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Resposta com resultado do cancelamento
 */
exports.cancelInvite = async (req, res) => {
  const { inviteId } = req.params;
  const userId = req.user.uid;
  
  logger.info('Cancelando convite', { 
    service: 'inviteController', 
    function: 'cancelInvite', 
    inviteId,
    userId
  });

  if (!inviteId) {
    return res.status(400).json({ 
      success: false, 
      message: 'ID do convite é obrigatório' 
    });
  }

  try {
    await inviteService.cancelInvite(inviteId, userId);
    
    return res.status(200).json({
      success: true,
      message: 'Convite cancelado com sucesso'
    });
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    
    logger.error('Erro ao cancelar convite', { 
      service: 'inviteController', 
      function: 'cancelInvite', 
      inviteId,
      userId,
      error: error.message 
    });
    
    return res.status(statusCode).json({ 
      success: false, 
      message: error.message 
    });
  }
};

module.exports = exports;