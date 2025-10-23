// schemas/inviteSchema.js
const Joi = require('joi');

const inviteSchema = Joi.object({
  id: Joi.string().optional(),
  inviteId: Joi.string().optional(),
  createdAt: Joi.date().optional(),
  userId: Joi.string().optional(),
  senderName: Joi.string().optional(),
  senderEmail: Joi.string().optional(),
  friendName: Joi.string().optional(),
  nome: Joi.string().optional(),
  senderPhotoURL: Joi.string().uri().optional(),
  email: Joi.string().email().optional().messages({
    'string.email': 'Email deve ser um endereço de email válido.',
    'any.required': 'Email é obrigatório.',
  }),
  validatedBy: Joi.string().optional(),
  status: Joi.string().valid('pending', 'accepted', 'rejected').optional(),
  lastSentAt: Joi.date().optional(),
  headers: Joi.date().optional()
});

// Schema específico para envio de convites
const sendInviteSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.email': 'Email deve ser um endereço de email válido.',
    'string.empty': 'Email não pode estar vazio.',
    'any.required': 'Email é obrigatório.',
  }),
  friendName: Joi.string().required().messages({
    'string.empty': 'Nome do amigo não pode estar vazio.',
    'any.required': 'Nome do amigo é obrigatório.',
  })
});

module.exports = inviteSchema;
module.exports.sendInviteSchema = sendInviteSchema;