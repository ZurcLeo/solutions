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
    
    // JOGOS-001: opcional para tipos sem bilhete (ELEICAO, SOLIDARIA, AMIGO_SECRETO)
    valorBilhete: Joi.number()
      .optional()
      .min(0)
      .messages({
        'number.base': 'O valor do bilhete deve ser um número',
        'number.min': 'O valor do bilhete não pode ser negativo'
      }),
    
    quantidadeBilhetes: Joi.number()
      .required()
      .integer()
      .min(2)
      .max(10000)
      .messages({
        'number.base': 'A quantidade de bilhetes deve ser um número',
        'number.integer': 'A quantidade de bilhetes deve ser um número inteiro',
        'number.min': 'A quantidade mínima de bilhetes é 2',
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
      .optional() // Opcional — service usa dataFim como fallback se não informado
      .empty('') // trata string vazia como ausente (undefined) antes do parse
      .min(Joi.ref('dataFim'))
      .messages({
        'date.base': 'A data do sorteio deve ser uma data válida',
        'date.min': 'A data do sorteio deve ser igual ou posterior à data de fim da rifa'
      }),
    
    // [TECH-DEBT] JOGOS-001: unificar semântica de sorteioMetodo.
    // Valores MAJORITY/TWO_THIRDS/UNANIMOUS = regra de quórum (concurso/votação).
    // Valores LOTERIA/RANDOM_ORG/NIST = método de sorteio por loteria (rifa clássica).
    // Este campo é metadado armazenado; o endpoint /sorteio usa campo `metodo` separado.
    sorteioMetodo: Joi.string()
      .valid('LOTERIA', 'RANDOM_ORG', 'NIST', 'MAJORITY', 'TWO_THIRDS', 'UNANIMOUS')
      .default('MAJORITY')
      .messages({
        'any.only': 'Método inválido. Use MAJORITY, TWO_THIRDS, UNANIMOUS (concurso) ou LOTERIA, RANDOM_ORG, NIST (rifa)'
      }),
    
    sorteioReferencia: Joi.string()
      .allow(null, '')
      .optional()
      .max(100)
      .messages({
        'string.max': 'A referência do sorteio deve ter no máximo 100 caracteres'
      }),

    // JOGOS-001: tipo de concurso e configuração específica por tipo
    contest_type: Joi.string()
      .valid('SORTEIO', 'ELEICAO', 'SOLIDARIA', 'AMIGO_SECRETO', 'BOLAO', 'DESAFIO')
      .default('SORTEIO'),

    contest_config: Joi.object()
      .default({})
      .optional()
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
      .valid('LOTERIA', 'RANDOM_ORG', 'NIST', 'MAJORITY', 'TWO_THIRDS', 'UNANIMOUS')
      .optional(),
    
    sorteioReferencia: Joi.string()
      .allow(null, '')
      .optional()
      .max(100),
    
    status: Joi.string()
      .valid('ABERTA', 'FINALIZADA', 'CANCELADA')
      .optional(),

    contest_type: Joi.string()
      .valid('SORTEIO', 'ELEICAO', 'SOLIDARIA', 'AMIGO_SECRETO', 'BOLAO', 'DESAFIO')
      .optional(),

    contest_config: Joi.object()
      .optional()
  }),

  // Schema para sortear pares do Amigo Secreto (Sattolo cycle)
  sortearPares: Joi.object({
    participantes: Joi.array()
      .items(Joi.string())
      .optional(), // se omitido, usa todos os membros da caixinha
    limitePresente: Joi.number()
      .optional()
      .min(0)
      .messages({ 'number.min': 'O limite do presente não pode ser negativo' }),
  }),

  // Schema para votação em concurso (ELEICAO, SOLIDARIA)
  votar: Joi.object({
    candidato: Joi.string()
      .required()
      .min(1)
      .max(200)
      .messages({
        'string.empty': 'O candidato ou causa é obrigatório',
        'string.max': 'O candidato deve ter no máximo 200 caracteres'
      })
  }),

  // Schema para resolver/finalizar um concurso por votação
  resolver: Joi.object({
    forcar: Joi.boolean()
      .default(false)
  }),

  // Schema para venda de bilhete
  venderBilhete: Joi.object({
    membroId: Joi.string()
      .optional(), // Controller usa req.user.uid — não precisa vir no body

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