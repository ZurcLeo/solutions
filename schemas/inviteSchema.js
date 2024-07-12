// schemas/inviteSchema.js
const Joi = require('joi');

const inviteSchema = Joi.object({
  id: Joi.string().optional(),
  createdAt: Joi.date().optional(),
  senderId: Joi.string().optional(),
  friendName: Joi.string().optional(),
  senderName: Joi.string().optional(),
  senderPhotoURL: Joi.string().uri().optional(),
  inviteId: Joi.string().optional(),
  email: Joi.string().email().required().messages({
    'string.email': 'Email deve ser um endereço de email válido.',
    'any.required': 'Email é obrigatório.',
  }),
  validatedBy: Joi.string().optional(),
  status: Joi.string().valid('pending', 'accepted', 'rejected').optional(),
  lastSentAt: Joi.date().optional(),
});

module.exports = inviteSchema;