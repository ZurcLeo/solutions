const Joi = require('joi');

const loanSchema = {
  // Schema para criação de um novo empréstimo
  create: Joi.object({
    userId: Joi.string()
      .required()
      .messages({
        'string.empty': 'O ID do usuário é obrigatório',
        'any.required': 'O ID do usuário é obrigatório'
      }),
    
    valor: Joi.number()
      .required()
      .min(1)
      .messages({
        'number.base': 'O valor do empréstimo deve ser um número',
        'number.min': 'O valor do empréstimo deve ser maior que zero',
        'any.required': 'O valor do empréstimo é obrigatório'
      }),
    
    parcelas: Joi.number()
      .required()
      .integer()
      .min(1)
      .max(60)
      .messages({
        'number.base': 'O número de parcelas deve ser um número inteiro',
        'number.min': 'O número de parcelas deve ser pelo menos 1',
        'number.max': 'O número de parcelas não pode exceder 60',
        'any.required': 'O número de parcelas é obrigatório'
      }),
    
    motivo: Joi.string()
      .required()
      .min(3)
      .max(500)
      .messages({
        'string.empty': 'O motivo do empréstimo é obrigatório',
        'string.min': 'O motivo deve ter pelo menos 3 caracteres',
        'string.max': 'O motivo não pode exceder 500 caracteres',
        'any.required': 'O motivo do empréstimo é obrigatório'
      }),
    
    taxaJuros: Joi.number()
      .optional()
      .min(0)
      .max(100)
      .messages({
        'number.base': 'A taxa de juros deve ser um número',
        'number.min': 'A taxa de juros não pode ser negativa',
        'number.max': 'A taxa de juros não pode exceder 100%'
      })
  }),

  // Schema para atualização de um empréstimo
  update: Joi.object({
    status: Joi.string()
      .optional()
      .valid('pendente', 'aprovado', 'parcial', 'rejeitado', 'quitado', 'cancelado')
      .messages({
        'any.only': 'Status inválido'
      }),
    
    dataAprovacao: Joi.date()
      .optional(),
    
    dataRejeitacao: Joi.date()
      .optional(),
    
    adminAprovador: Joi.string()
      .optional(),
    
    adminRejeitador: Joi.string()
      .optional(),
    
    motivoRejeitacao: Joi.string()
      .optional()
      .max(500)
      .messages({
        'string.max': 'O motivo da rejeição não pode exceder 500 caracteres'
      }),
    
    parcelas: Joi.array()
      .optional(),
    
    valorPago: Joi.number()
      .optional()
      .min(0)
      .messages({
        'number.base': 'O valor pago deve ser um número',
        'number.min': 'O valor pago não pode ser negativo'
      }),
    
    dataQuitacao: Joi.date()
      .optional()
  }),

  // Schema para pagamento de parcela
  payment: Joi.object({
    valor: Joi.number()
      .required()
      .min(1)
      .messages({
        'number.base': 'O valor do pagamento deve ser um número',
        'number.min': 'O valor do pagamento deve ser maior que zero',
        'any.required': 'O valor do pagamento é obrigatório'
      }),
    
    metodo: Joi.string()
      .required()
      .valid('pix', 'transferencia', 'deposito', 'dinheiro')
      .messages({
        'string.empty': 'O método de pagamento é obrigatório',
        'any.only': 'Método de pagamento inválido',
        'any.required': 'O método de pagamento é obrigatório'
      }),
    
    observacao: Joi.string()
      .optional()
      .max(255)
      .messages({
        'string.max': 'A observação não pode exceder 255 caracteres'
      })
  }),

  // Schema para rejeição de empréstimo
  reject: Joi.object({
    reason: Joi.string()
      .optional()
      .max(500)
      .messages({
        'string.max': 'O motivo da rejeição não pode exceder 500 caracteres'
      })
  }),

  // Schema para aprovação de empréstimo
  approve: Joi.object({
    adminId: Joi.string()
      .optional()
      .messages({
        'string.empty': 'O ID do administrador é obrigatório'
      })
  }),

  // Schema para busca de empréstimos com filtros
  filters: Joi.object({
    status: Joi.string()
      .optional()
      .valid('pendente', 'aprovado', 'parcial', 'rejeitado', 'quitado', 'cancelado')
      .messages({
        'any.only': 'Status inválido'
      }),
    
    userId: Joi.string()
      .optional(),
    
    dateFrom: Joi.date()
      .optional(),
    
    dateTo: Joi.date()
      .optional(),
    
    minValue: Joi.number()
      .optional()
      .min(0)
      .messages({
        'number.base': 'O valor mínimo deve ser um número',
        'number.min': 'O valor mínimo não pode ser negativo'
      }),
    
    maxValue: Joi.number()
      .optional()
      .min(0)
      .messages({
        'number.base': 'O valor máximo deve ser um número',
        'number.min': 'O valor máximo não pode ser negativo'
      }),
    
    limit: Joi.number()
      .optional()
      .integer()
      .min(1)
      .max(100)
      .messages({
        'number.base': 'O limite deve ser um número inteiro',
        'number.min': 'O limite deve ser pelo menos 1',
        'number.max': 'O limite não pode exceder 100'
      }),
    
    offset: Joi.number()
      .optional()
      .integer()
      .min(0)
      .messages({
        'number.base': 'O offset deve ser um número inteiro',
        'number.min': 'O offset não pode ser negativo'
      })
  }),

  // Schema para estatísticas de empréstimos
  stats: Joi.object({
    period: Joi.string()
      .optional()
      .valid('all', 'month', 'quarter', 'year')
      .default('all')
      .messages({
        'any.only': 'Período inválido'
      }),
    
    groupBy: Joi.string()
      .optional()
      .valid('status', 'month', 'user')
      .default('status')
      .messages({
        'any.only': 'Agrupamento inválido'
      })
  })
};

module.exports = loanSchema;