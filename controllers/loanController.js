// src/controllers/loanController.js
const loanService = require('../services/loanService');
const { logger } = require('../logger');

/**
 * Controller para obter todos os empréstimos de uma caixinha
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
const getLoans = async (req, res) => {
  try {
    const { caixinhaId } = req.params;
    const filtros = req.query; // Filtros como status, userId, etc.
    
    logger.info('Requisição para obter empréstimos', {
      controller: 'loanController',
      method: 'getLoans',
      caixinhaId,
      filtros,
      userId: req.user.uid
    });
    
    const result = await loanService.getLoans(caixinhaId, filtros);
    
    return res.status(200).json(result);
  } catch (error) {
    logger.error('Erro ao processar requisição de obter empréstimos', {
      controller: 'loanController',
      method: 'getLoans',
      error: error.message,
      stack: error.stack
    });
    
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
};

/**
 * Controller para obter um empréstimo específico por ID
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
const getLoanById = async (req, res) => {
  try {
    const { caixinhaId, loanId } = req.params;
    
    logger.info('Requisição para obter empréstimo por ID', {
      controller: 'loanController',
      method: 'getLoanById',
      caixinhaId,
      loanId,
      userId: req.user.uid
    });
    
    const result = await loanService.getLoanById(caixinhaId, loanId);
    
    return res.status(200).json(result);
  } catch (error) {
    logger.error('Erro ao processar requisição de obter empréstimo por ID', {
      controller: 'loanController',
      method: 'getLoanById',
      error: error.message,
      stack: error.stack
    });
    
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
};

/**
 * Controller para solicitar um novo empréstimo
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
const requestLoan = async (req, res) => {
  try {
    const { caixinhaId } = req.params;
    const loanData = req.body;
    
    logger.info('Requisição para solicitar empréstimo', {
      controller: 'loanController',
      method: 'requestLoan',
      caixinhaId,
      userId: req.user.uid,
      loanData
    });
    
    // Garantir que o userId é o do usuário logado
    loanData.userId = req.user.uid;
    
    const result = await loanService.requestLoan(caixinhaId, loanData);
    
    return res.status(201).json(result);
  } catch (error) {
    logger.error('Erro ao processar requisição de solicitar empréstimo', {
      controller: 'loanController',
      method: 'requestLoan',
      error: error.message,
      stack: error.stack
    });
    
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
};

/**
 * Controller para fazer pagamento de parcela de empréstimo
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
const makePayment = async (req, res) => {
  try {
    const { caixinhaId, loanId } = req.params;
    const paymentData = req.body;
    
    logger.info('Requisição para registrar pagamento', {
      controller: 'loanController',
      method: 'makePayment',
      caixinhaId,
      loanId,
      userId: req.user.uid,
      paymentData
    });
    
    // Adicionar userId ao pagamento para rastreamento
    paymentData.userId = req.user.uid;
    
    const result = await loanService.makePayment(caixinhaId, loanId, paymentData);
    
    return res.status(200).json(result);
  } catch (error) {
    logger.error('Erro ao processar requisição de pagamento', {
      controller: 'loanController',
      method: 'makePayment',
      error: error.message,
      stack: error.stack
    });
    
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
};

/**
 * Controller para aprovar um empréstimo
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
const approveLoan = async (req, res) => {
  try {
    const { caixinhaId, loanId } = req.params;
    const adminId = req.user.uid; // Usuário atual que está aprovando
    
    logger.info('Requisição para aprovar empréstimo', {
      controller: 'loanController',
      method: 'approveLoan',
      caixinhaId,
      loanId,
      adminId
    });
    
    const result = await loanService.approveLoan(caixinhaId, loanId, adminId);
    
    return res.status(200).json(result);
  } catch (error) {
    logger.error('Erro ao processar requisição de aprovação', {
      controller: 'loanController',
      method: 'approveLoan',
      error: error.message,
      stack: error.stack
    });
    
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
};

/**
 * Controller para rejeitar um empréstimo
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
const rejectLoan = async (req, res) => {
  try {
    const { caixinhaId, loanId } = req.params;
    const { reason } = req.body;
    const adminId = req.user.uid; // Usuário atual que está rejeitando
    
    logger.info('Requisição para rejeitar empréstimo', {
      controller: 'loanController',
      method: 'rejectLoan',
      caixinhaId,
      loanId,
      adminId,
      reason
    });
    
    const result = await loanService.rejectLoan(caixinhaId, loanId, adminId, reason);
    
    return res.status(200).json(result);
  } catch (error) {
    logger.error('Erro ao processar requisição de rejeição', {
      controller: 'loanController',
      method: 'rejectLoan',
      error: error.message,
      stack: error.stack
    });
    
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
};

/**
 * Controller para obter estatísticas de empréstimos
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
const getLoanStats = async (req, res) => {
  try {
    const { caixinhaId } = req.params;
    
    logger.info('Requisição para obter estatísticas de empréstimos', {
      controller: 'loanController',
      method: 'getLoanStats',
      caixinhaId,
      userId: req.user.uid
    });
    
    const result = await loanService.getLoanStats(caixinhaId);
    
    return res.status(200).json(result);
  } catch (error) {
    logger.error('Erro ao processar requisição de estatísticas', {
      controller: 'loanController',
      method: 'getLoanStats',
      error: error.message,
      stack: error.stack
    });
    
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
};

module.exports = {
  getLoans,
  getLoanById,
  requestLoan,
  makePayment,
  approveLoan,
  rejectLoan,
  getLoanStats
};