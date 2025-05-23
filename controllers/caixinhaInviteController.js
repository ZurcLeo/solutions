// controllers/caixinhaInviteController.js
const CaixinhaInviteService = require('../services/CaixinhaInviteService');
const { logger } = require('../logger');

/**
 * Obtém convites recebidos pelo usuário
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const getReceivedInvites = async (req, res) => {
  try {
    const userId = req.user.uid; // Obtido do middleware de autenticação
    const { status = 'pending', type = null } = req.query;
    
    // Usar o novo método específico para convites recebidos
    const invites = await CaixinhaInviteService.getReceivedInvites(userId, {
      status,
      type
    });
    
    res.status(200).json(invites);
  } catch (error) {
    logger.error('Erro ao buscar convites recebidos:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message || 'Erro ao buscar convites recebidos.'
    });
  }
};

/**
 * Obtém convites enviados pelo usuário
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const getSentInvites = async (req, res) => {
  try {
    const userId = req.user.uid; // Obtido do middleware de autenticação
    const { status = 'pending', type = null } = req.query;
    
    // Usar o novo método específico para convites enviados
    const invites = await CaixinhaInviteService.getSentInvites(userId, {
      status,
      type
    });
    
    res.status(200).json(invites);
  } catch (error) {
    logger.error('Erro ao buscar convites enviados:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message || 'Erro ao buscar convites enviados.'
    });
  }
};

/**
 * Método de compatibilidade com a API antiga
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const getInvitationsByType = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { direction = 'received', status = 'pending', type = null } = req.query;
    
    let invites;
    
    // Redirecionar para os métodos específicos
    if (direction === 'sent') {
      invites = await CaixinhaInviteService.getSentInvites(userId, { status, type });
    } else {
      invites = await CaixinhaInviteService.getReceivedInvites(userId, { status, type });
    }
    
    res.status(200).json(invites);
  } catch (error) {
    logger.error('Erro ao buscar convites:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message || 'Erro ao buscar convites.'
    });
  }
};

/**
 * Cria um convite para um usuário existente
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const inviteExistingMember = async (req, res) => {
  try {
    const { targetId, targetName, message } = req.body;
    const senderId = req.user.uid;
    const caixinhaId = req.params.caixinhaId;
    
    const result = await CaixinhaInviteService.inviteExistingMember({
      caixinhaId,
      targetId,
      targetName,
      senderId,
      message
    });
    
    res.status(200).json(result);
  } catch (error) {
    logger.error('Erro ao enviar convite:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message || 'Erro ao enviar convite.'
    });
  }
};

/**
 * Cria um convite por email
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const inviteByEmail = async (req, res) => {
  try {
    const { email, message } = req.body;
    const senderId = req.user.uid;
    const caixinhaId = req.params.caixinhaId;
    
    const result = await CaixinhaInviteService.inviteByEmail({
      caixinhaId,
      email,
      senderId,
      message
    });
    
    res.status(200).json(result);
  } catch (error) {
    logger.error('Erro ao enviar convite por email:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message || 'Erro ao enviar convite por email.'
    });
  }
};

/**
 * Aceita um convite
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const acceptInvite = async (req, res) => {
  try {
    const userId = req.user.uid;
    const caxinhaInviteId = req.params.caxinhaInviteId;
    
    const result = await CaixinhaInviteService.acceptInvite(caxinhaInviteId, userId);
    
    res.status(200).json(result);
  } catch (error) {
    logger.error('Erro ao aceitar convite:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message || 'Erro ao aceitar convite.'
    });
  }
};

/**
 * Rejeita um convite
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const rejectInvite = async (req, res) => {
  try {
    const userId = req.user.uid;
    const caxinhaInviteId = req.params.caxinhaInviteId;
    const reason = req.body.reason;
    
    const result = await CaixinhaInviteService.rejectInvite(caxinhaInviteId, userId, reason);
    
    res.status(200).json(result);
  } catch (error) {
    logger.error('Erro ao rejeitar convite:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message || 'Erro ao rejeitar convite.'
    });
  }
};

/**
 * Cancela um convite enviado
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const cancelInvite = async (req, res) => {
  try {
    const userId = req.user.uid;
    const caxinhaInviteId = req.params.caxinhaInviteId;
    
    const result = await CaixinhaInviteService.cancelInvite(caxinhaInviteId, userId);
    
    res.status(200).json(result);
  } catch (error) {
    logger.error('Erro ao cancelar convite:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message || 'Erro ao cancelar convite.'
    });
  }
};

/**
 * Reenvia um convite
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const resendInvite = async (req, res) => {
  try {
    const userId = req.user.uid;
    const caxinhaInviteId = req.params.caxinhaInviteId;
    const { message } = req.body;
    
    const result = await CaixinhaInviteService.resendInvite(caxinhaInviteId, userId, { message });
    
    res.status(200).json(result);
  } catch (error) {
    logger.error('Erro ao reenviar convite:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message || 'Erro ao reenviar convite.'
    });
  }
};

/**
 * Busca convites de uma caixinha
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const getCaixinhaInvites = async (req, res) => {
  try {
    const caixinhaId = req.params.caixinhaId;
    const { status = 'pending' } = req.query;
    
    const invites = await CaixinhaInviteService.getCaixinhaInvites(caixinhaId, { status });
    
    res.status(200).json(invites);
  } catch (error) {
    logger.error('Erro ao buscar convites da caixinha:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message || 'Erro ao buscar convites da caixinha.'
    });
  }
};

/**
 * Obtém detalhes de um convite específico
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const getInviteDetails = async (req, res) => {
  try {
    const caxinhaInviteId = req.params.caxinhaInviteId;
    
    const invite = await CaixinhaInviteService.getInviteDetails(caxinhaInviteId);
    
    res.status(200).json(invite);
  } catch (error) {
    logger.error('Erro ao buscar detalhes do convite:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message || 'Erro ao buscar detalhes do convite.'
    });
  }
};

/**
 * Reenvia email de convite
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const resendInviteEmail = async (req, res) => {
  try {
    const caxinhaInviteId = req.params.caxinhaInviteId;
    const caixinhaId = req.params.caixinhaId;
    
    const result = await CaixinhaInviteService.resendInviteEmail(caxinhaInviteId, caixinhaId);
    
    res.status(200).json(result);
  } catch (error) {
    logger.error('Erro ao reenviar email de convite:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message || 'Erro ao reenviar email de convite.'
    });
  }
};

/**
 * Verifica e marca convites expirados
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const checkExpiredInvites = async (req, res) => {
  try {
    const result = await CaixinhaInviteService.checkExpiredInvites();
    
    res.status(200).json(result);
  } catch (error) {
    logger.error('Erro ao verificar convites expirados:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message || 'Erro ao verificar convites expirados.'
    });
  }
};

/**
 * Migra convites para a nova estrutura
 * @param {Object} req - Objeto de requisição
 * @param {Object} res - Objeto de resposta
 */
const migrateInvitesToNewStructure = async (req, res) => {
  try {
    const result = await CaixinhaInviteService.migrateInvitesToNewStructure();
    
    res.status(200).json(result);
  } catch (error) {
    logger.error('Erro ao migrar convites:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message || 'Erro ao migrar convites.'
    });
  }
};

module.exports = {
  getReceivedInvites,
  getSentInvites,
  getInvitationsByType,
  inviteExistingMember,
  inviteByEmail,
  acceptInvite,
  rejectInvite,
  cancelInvite,
  resendInvite,
  getCaixinhaInvites,
  getInviteDetails,
  resendInviteEmail,
  checkExpiredInvites,
  migrateInvitesToNewStructure
}