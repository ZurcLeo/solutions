// controllers/userPaymentMethodController.js
const userPaymentMethodService = require('../services/userPaymentMethodService');
const { logger } = require('../logger');

exports.list = async (req, res) => {
  const userId = req.user.uid;
  try {
    const data = await userPaymentMethodService.getAll(userId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error('Erro ao listar métodos de pagamento', { userId, error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.register = async (req, res) => {
  const userId = req.user.uid;
  try {
    const data = await userPaymentMethodService.register(userId, req.body);
    return res.status(201).json({ success: true, data });
  } catch (error) {
    logger.error('Erro ao registrar método de pagamento', { userId, error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/users/payment-methods/:id/validate
 * Inicia validação via micro-depósito PIX de R$ 0,01.
 * Retorna QR code para o usuário pagar do app bancário da conta a validar.
 * A confirmação automática acontece via webhook Asaas (PAYMENT_CONFIRMED).
 */
exports.validate = async (req, res) => {
  const userId   = req.user.uid;
  const methodId = req.params.id;
  try {
    const data = await userPaymentMethodService.initiateValidation(userId, methodId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error('Erro ao validar método de pagamento', { userId, methodId, error: error.message });
    const status = error.status ||
      (error.message.includes('não encontrado') ? 404
      : error.message.includes('já está validada') ? 409 : 500);
    return res.status(status).json({ success: false, error: error.message });
  }
};

exports.remove = async (req, res) => {
  const userId   = req.user.uid;
  const methodId = req.params.id;
  try {
    await userPaymentMethodService.remove(userId, methodId);
    return res.status(200).json({ success: true, data: { deleted: true } });
  } catch (error) {
    logger.error('Erro ao remover método de pagamento', { userId, methodId, error: error.message });
    const status = error.message.includes('não encontrado') ? 404 : 500;
    return res.status(status).json({ success: false, error: error.message });
  }
};

exports.applyToCaixinha = async (req, res) => {
  const userId                   = req.user.uid;
  const { caixinhaId, methodId } = req.params;
  try {
    const data = await userPaymentMethodService.applyToCaixinha(userId, methodId, caixinhaId);
    return res.status(201).json({ success: true, data });
  } catch (error) {
    logger.error('Erro ao aplicar método de pagamento à caixinha', {
      userId, caixinhaId, methodId, error: error.message,
    });
    const status = error.message.includes('não encontrado') ? 404 : 500;
    return res.status(status).json({ success: false, error: error.message });
  }
};
