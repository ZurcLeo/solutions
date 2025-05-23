// src/schemas/disputeSchema.js
const Joi = require('joi');

const disputeSchema = {
  // Schema para criação de disputa
  create: Joi.object({
    title: Joi.string()
      .required()
      .min(5)
      .max(100)
      .messages({
        'string.empty': 'O título é obrigatório',
        'string.min': 'O título deve ter no mínimo 5 caracteres',
        'string.max': 'O título deve ter no máximo 100 caracteres'
      }),

    description: Joi.string()
      .required()
      .min(10)
      .max(500)
      .messages({
        'string.empty': 'A descrição é obrigatória',
        'string.min': 'A descrição deve ter no mínimo 10 caracteres',
        'string.max': 'A descrição deve ter no máximo 500 caracteres'
      }),

    type: Joi.string()
      .required()
      .valid('RULE_CHANGE', 'LOAN_APPROVAL', 'MEMBER_REMOVAL')
      .messages({
        'any.only': 'O tipo deve ser um dos seguintes: RULE_CHANGE, LOAN_APPROVAL, MEMBER_REMOVAL'
      }),

    proposedChanges: Joi.object()
      .required()
      .messages({
        'object.base': 'As alterações propostas devem ser um objeto válido'
      }),

    expiresAt: Joi.date()
      .min('now')
      .messages({
        'date.min': 'A data de expiração deve ser no futuro'
      })
      .optional()
  }),

  // Schema para votar em disputa
  vote: Joi.object({
    userId: Joi.string()
      .required()
      .messages({
        'string.empty': 'O ID do usuário é obrigatório'
      }),

    vote: Joi.boolean()
      .required()
      .messages({
        'boolean.base': 'O voto deve ser true (aprovar) ou false (rejeitar)'
      }),

    comment: Joi.string()
      .max(255)
      .optional()
      .messages({
        'string.max': 'O comentário deve ter no máximo 255 caracteres'
      })
  }),

  // Schema para cancelar disputa
  cancel: Joi.object({
    userId: Joi.string()
      .required()
      .messages({
        'string.empty': 'O ID do usuário é obrigatório'
      }),

    reason: Joi.string()
      .required()
      .max(255)
      .messages({
        'string.empty': 'O motivo é obrigatório',
        'string.max': 'O motivo deve ter no máximo 255 caracteres'
      })
  })
};

module.exports = disputeSchema;