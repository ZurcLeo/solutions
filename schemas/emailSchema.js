// schemas/emailSchema.js
const Joi = require('joi');

const emailSchema = {
  /**
   * Schema for sending an email
   */
  send: Joi.object({
    to: Joi.string().email().required()
      .messages({
        'string.email': 'O campo "to" deve ser um email válido',
        'any.required': 'O campo "to" é obrigatório'
      }),
    
    subject: Joi.string().min(3).max(100).required()
      .messages({
        'string.min': 'O assunto deve ter no mínimo 3 caracteres',
        'string.max': 'O assunto deve ter no máximo 100 caracteres',
        'any.required': 'O campo "subject" é obrigatório'
      }),
    
    templateType: Joi.string().required()
      .messages({
        'any.required': 'O campo "templateType" é obrigatório'
      }),
    
    data: Joi.object().required()
      .messages({
        'any.required': 'O campo "data" é obrigatório'
      }),
    
    reference: Joi.string().optional(),
    referenceType: Joi.string().optional()
  }),
  
  /**
   * Schema for resending an email
   */
  resend: Joi.object({
    emailId: Joi.string().required()
      .messages({
        'any.required': 'O ID do email é obrigatório'
      })
  }),
  
  /**
   * Schema for legacy inviteEmail endpoint
   */
  legacyInvite: Joi.object({
    to: Joi.string().email().required(),
    subject: Joi.string().required(),
    content: Joi.required(),
    userId: Joi.string().optional(),
    inviteId: Joi.string().optional(),
    type: Joi.string().required()
  })
};

module.exports = emailSchema;