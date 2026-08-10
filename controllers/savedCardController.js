// controllers/savedCardController.js — PAY-CARD-001
const Joi = require('joi');
const savedCardService = require('../services/savedCardService');
const { logger } = require('../logger');

const saveSchema = Joi.object({
  cardData: Joi.object({
    holderName:  Joi.string().required(),
    number:      Joi.string().min(13).max(19).required(),
    expiryMonth: Joi.string().length(2).required(),
    expiryYear:  Joi.string().length(4).required(),
    ccv:         Joi.string().min(3).max(4).required(),
  }).required(),
  holderInfo: Joi.object({
    name:       Joi.string().required(),
    email:      Joi.string().email().required(),
    cpfCnpj:    Joi.string().allow('', null),
    phone:      Joi.string().allow('', null),
    postalCode: Joi.string().allow('', null),
  }).required(),
  nickname: Joi.string().max(30).allow('', null),
});

exports.list = async (req, res) => {
  const userId = req.user.uid;
  try {
    const data = await savedCardService.listCards(userId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error('Erro ao listar cartões salvos', { userId, error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.save = async (req, res) => {
  const userId = req.user.uid;
  try {
    const { error: valErr, value } = saveSchema.validate(req.body);
    if (valErr) return res.status(400).json({ success: false, error: valErr.message });

    const remoteIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;

    const data = await savedCardService.tokenizeAndSave(userId, {
      cardData:   value.cardData,
      holderInfo: value.holderInfo,
      remoteIp,
      nickname:   value.nickname,
    });

    return res.status(201).json({ success: true, data });
  } catch (error) {
    logger.error('Erro ao salvar cartão', { userId, error: error.message });
    const status = error.message.includes('Limite') ? 409 : 500;
    return res.status(status).json({ success: false, error: error.message });
  }
};

exports.remove = async (req, res) => {
  const userId = req.user.uid;
  const cardId = req.params.id;
  try {
    await savedCardService.deleteCard(userId, cardId);
    return res.status(200).json({ success: true, data: { deleted: true } });
  } catch (error) {
    logger.error('Erro ao remover cartão', { userId, cardId, error: error.message });
    const status = error.message.includes('não encontrado') ? 404 : 500;
    return res.status(status).json({ success: false, error: error.message });
  }
};

exports.setDefault = async (req, res) => {
  const userId = req.user.uid;
  const cardId = req.params.id;
  try {
    const data = await savedCardService.setDefault(userId, cardId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error('Erro ao definir cartão padrão', { userId, cardId, error: error.message });
    const status = error.message.includes('não encontrado') ? 404 : 500;
    return res.status(status).json({ success: false, error: error.message });
  }
};
