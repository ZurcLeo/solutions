const Joi = require('joi');

const caixinhaInviteSchema = {
  // Schema para criação de um novo convite
  create: Joi.object({
    caixinhaId: Joi.string()
      .required()
      .messages({
        'string.empty': 'O ID da caixinha é obrigatório'
      }),

    targetId: Joi.string()
      .optional()
      .messages({
        'string.empty': 'O ID do destinatário é obrigatório para convites de membros existentes'
      }),

    email: Joi.string()
      .optional()
      .email()
      .messages({
        'string.email': 'O email deve ser válido'
      }),

    // Ou targetId ou email deve ser fornecido
    // Validação condicional
    _targetValidation: Joi.alternatives().try(
      Joi.object({ targetId: Joi.string().required() }),
      Joi.object({ email: Joi.string().required() })
    ).match('one'),

    senderId: Joi.string()
      .required()
      .messages({
        'string.empty': 'O ID do remetente é obrigatório'
      }),

      senderName: Joi.string()
      .required()
      .messages({
        'string.empty': 'O senderName é obrigatório'
      }),

      targetName: Joi.string()
      .required()
      .messages({
        'string.empty': 'O targetName é obrigatório'
      }),

    message: Joi.string()
      .optional()
      .max(500)
      .messages({
        'string.max': 'A mensagem deve ter no máximo 500 caracteres'
      }),

    type: Joi.string()
      .required()
      .valid('caixinha_invite', 'caixinha_email_invite')
      .messages({
        'any.only': 'O tipo de convite deve ser caixinha_invite ou caixinha_email_invite'
      }),

    expiresAt: Joi.date()
      .optional()
      .default(() => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)) // Default: 7 dias
      .messages({
        'date.base': 'A data de expiração deve ser uma data válida'
      })
  }),

  // Schema para responder a um convite (aceitar/rejeitar)
  respond: Joi.object({
    caxinhaInviteId: Joi.string()
      .required()
      .messages({
        'string.empty': 'O ID do convite é obrigatório'
      }),

    userId: Joi.string()
      .required()
      .messages({
        'string.empty': 'O ID do usuário é obrigatório'
      }),

    action: Joi.string()
      .required()
      .valid('aceitar', 'rejeitar')
      .messages({
        'any.only': 'A ação deve ser aceitar ou rejeitar'
      }),

    reason: Joi.string()
      .optional()
      .max(255)
      .messages({
        'string.max': 'O motivo deve ter no máximo 255 caracteres'
      })
  }),

  // Schema para cancelar um convite enviado
  cancel: Joi.object({
    caxinhaInviteId: Joi.string()
      .required()
      .messages({
        'string.empty': 'O ID do convite é obrigatório'
      }),

    userId: Joi.string()
      .required()
      .messages({
        'string.empty': 'O ID do usuário é obrigatório'
      }),

    reason: Joi.string()
      .optional()
      .max(255)
      .messages({
        'string.max': 'O motivo deve ter no máximo 255 caracteres'
      })
  }),

  // Schema para consulta de convites
  query: Joi.object({
    userId: Joi.string()
      .required()
      .messages({
        'string.empty': 'O ID do usuário é obrigatório'
      }),

    type: Joi.string()
      .optional()
      .valid('caixinha_invite', 'caixinha_email_invite', 'all')
      .default('all')
      .messages({
        'any.only': 'O tipo de convite deve ser caixinha_invite, caixinha_email_invite ou all'
      }),

    direction: Joi.string()
      .optional()
      .valid('sent', 'received', 'all')
      .default('all')
      .messages({
        'any.only': 'A direção do convite deve ser sent, received ou all'
      }),

    status: Joi.string()
      .optional()
      .valid('pending', 'accepted', 'rejected', 'canceled', 'expired', 'all')
      .default('all')
      .messages({
        'any.only': 'O status do convite deve ser pending, accepted, rejected, canceled, expired ou all'
      }),

    caixinhaId: Joi.string()
      .optional()
      .messages({
        'string.empty': 'O ID da caixinha é obrigatório'
      }),

    limit: Joi.number()
      .integer()
      .min(1)
      .max(100)
      .default(20)
      .messages({
        'number.base': 'O limite deve ser um número',
        'number.min': 'O limite mínimo é 1',
        'number.max': 'O limite máximo é 100'
      }),

    offset: Joi.number()
      .integer()
      .min(0)
      .default(0)
      .messages({
        'number.base': 'O offset deve ser um número',
        'number.min': 'O offset mínimo é 0'
      })
  }),

  // Schema para reenvio de convites
  resend: Joi.object({
    caxinhaInviteId: Joi.string()
      .required()
      .messages({
        'string.empty': 'O ID do convite é obrigatório'
      }),

    userId: Joi.string()
      .required()
      .messages({
        'string.empty': 'O ID do usuário é obrigatório'
      }),

    updatedMessage: Joi.string()
      .optional()
      .max(500)
      .messages({
        'string.max': 'A mensagem deve ter no máximo 500 caracteres'
      })
  })
};

module.exports = caixinhaInviteSchema;