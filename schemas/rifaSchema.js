const Joi = require('joi');

const rifaSchema = {
  // Schema para criação de uma nova rifa
  create: Joi.object({
    nome: Joi.string()
      .required()
      .min(3)
      .max(100)
      .messages({
        'string.empty': 'O nome da rifa é obrigatório',
        'string.min': 'O nome deve ter no mínimo 3 caracteres',
        'string.max': 'O nome deve ter no máximo 100 caracteres'
      }),
    
    descricao: Joi.string()
      .required()
      .max(500)
      .messages({
        'string.empty': 'A descrição da rifa é obrigatória',
        'string.max': 'A descrição deve ter no máximo 500 caracteres'
      }),
    
    valorBilhete: Joi.number()
      .required()
      .min(1)
      .messages({
        'number.base': 'O valor do bilhete deve ser um número',
        'number.min': 'O valor do bilhete deve ser maior que zero'
      }),
    
    quantidadeBilhetes: Joi.number()
      .required()
      .integer()
      .min(5)
      .max(10000)
      .messages({
        'number.base': 'A quantidade de bilhetes deve ser um número',
        'number.integer': 'A quantidade de bilhetes deve ser um número inteiro',
        'number.min': 'A quantidade mínima de bilhetes é 5',
        'number.max': 'A quantidade máxima de bilhetes é 10000'
      }),
    
    dataInicio: Joi.date()
      .required()
      .messages({
        'date.base': 'A data de início deve ser uma data válida'
      }),
    
    dataFim: Joi.date()
      .required()
      .greater(Joi.ref('dataInicio'))
      .messages({
        'date.base': 'A data de fim deve ser uma data válida',
        'date.greater': 'A data de fim deve ser posterior à data de início'
      }),
    
    premio: Joi.string()
      .required()
      .max(200)
      .messages({
        'string.empty': 'A descrição do prêmio é obrigatória',
        'string.max': 'A descrição do prêmio deve ter no máximo 200 caracteres'
      }),
    
    sorteioData: Joi.date()
      .required()
      .min(Joi.ref('dataFim'))
      .messages({
        'date.base': 'A data do sorteio deve ser uma data válida',
        'date.min': 'A data do sorteio deve ser igual ou posterior à data de fim da rifa'
      }),
    
    sorteioMetodo: Joi.string()
      .valid('LOTERIA', 'RANDOM_ORG', 'NIST')
      .default('RANDOM_ORG')
      .messages({
        'any.only': 'O método de sorteio deve ser um dos seguintes: LOTERIA, RANDOM_ORG ou NIST'
      }),
    
    sorteioReferencia: Joi.string()
      .allow(null, '')
      .optional()
      .max(100)
      .messages({
        'string.max': 'A referência do sorteio deve ter no máximo 100 caracteres'
      })
  }),

  // Schema para atualização de rifa
  update: Joi.object({
    nome: Joi.string()
      .optional()
      .min(3)
      .max(100),
      caixinhaId: Joi.string()
      .required()
      .messages({
        'string.empty': 'O ID da caixinha é obrigatório'
      }),
    descricao: Joi.string()
      .optional()
      .max(500),
    
    dataFim: Joi.date()
      .optional(),
    
    premio: Joi.string()
      .optional()
      .max(200),
    
    sorteioData: Joi.date()
      .optional(),
    
    sorteioMetodo: Joi.string()
      .valid('LOTERIA', 'RANDOM_ORG', 'NIST')
      .optional(),
    
    sorteioReferencia: Joi.string()
      .allow(null, '')
      .optional()
      .max(100),
    
    status: Joi.string()
      .valid('ABERTA', 'FINALIZADA', 'CANCELADA')
      .optional()
  }),

  // Schema para venda de bilhete
  venderBilhete: Joi.object({
    membroId: Joi.string()
      .required()
      .messages({
        'string.empty': 'O ID do usuário é obrigatório'
      }),
    
    numeroBilhete: Joi.number()
      .required()
      .integer()
      .min(1)
      .messages({
        'number.base': 'O número do bilhete deve ser um número',
        'number.integer': 'O número do bilhete deve ser um número inteiro',
        'number.min': 'O número do bilhete deve ser maior que zero'
      })
  }),

  // Schema para realização de sorteio
  realizarSorteio: Joi.object({
    metodo: Joi.string()
      .valid('LOTERIA', 'RANDOM_ORG', 'NIST')
      .required()
      .messages({
        'any.only': 'O método de sorteio deve ser um dos seguintes: LOTERIA, RANDOM_ORG ou NIST'
      }),
    
    referencia: Joi.string()
      .allow(null, '')
      .optional()
      .max(100)
      .messages({
        'string.max': 'A referência do sorteio deve ter no máximo 100 caracteres'
      })
  })
};

module.exports = rifaSchema;