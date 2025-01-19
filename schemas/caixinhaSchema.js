const Joi = require('joi');

const caixinhaSchema = {
    // Schema para criação de uma nova caixinha
    create: Joi.object({
      name: Joi.string()
        .required()
        .min(3)
        .max(100)
        .messages({
          'string.empty': 'O nome é obrigatório',
          'string.min': 'O nome deve ter no mínimo 3 caracteres',
          'string.max': 'O nome deve ter no máximo 100 caracteres'
        }),
  
      description: Joi.string()
        .optional()
        .max(500)
        .messages({
          'string.max': 'A descrição deve ter no máximo 500 caracteres'
        }),

        duracaoMeses: Joi.number()
        .required()
        .max(40)
        .messages({
          'string.empty': 'O campo Duração em meses é obrigatório'
        }),

        distribuicaoTipo: Joi.string()
        .required()
        .max(100)
        .message({
          'string.empty': 'O campo Tipo de distribuição é obrigatório'
        }),
  
      contribuicaoMensal: Joi.number()
        .required()
        .min(0)
        .messages({
          'number.base': 'A contribuição mensal deve ser um número',
          'number.min': 'A contribuição mensal não pode ser negativa'
        }),
  
        adminId:Joi.string().required(),
        permiteEmprestimos: Joi.boolean().default(false),
        taxaJuros: Joi.number().min(0).max(100).default(0),
        diaVencimento: Joi.number().min(1).max(31).default(1),
        valorMulta: Joi.number().min(0).default(0),
        valorJuros: Joi.number().min(0).default(0),
        limiteEmprestimo: Joi.number().min(0).default(0),
        prazoMaximoEmprestimo: Joi.number().min(1).default(12),
        dataCriacao: Joi.date().required()
    }),
  
    // Schema para atualização de uma caixinha existente
    update: Joi.object({
      name: Joi.string()
        .optional()
        .min(3)
        .max(100),
      
      description: Joi.string()
        .optional()
        .max(500),
      
      contribuicaoMensal: Joi.number()
        .optional()
        .min(0),
      
      configuracoes: Joi.object({
        permiteEmprestimos: Joi.boolean(),
        taxaJuros: Joi.number().min(0).max(100),
        limiteEmprestimo: Joi.number().min(0),
        prazoMaximoEmprestimo: Joi.number().min(1)
      }).optional()
    }),
  
    // Schema para ações relacionadas aos membros da caixinha
    membro: Joi.object({
      acao: Joi.string()
        .required()
        .valid('adicionar', 'atualizar', 'remover', 'transferir')
        .messages({
          'any.only': 'A ação deve ser uma das seguintes: adicionar, atualizar, remover ou transferir'
        }),
  
      membroId: Joi.string()
        .required()
        .messages({
          'string.empty': 'O ID do membro é obrigatório'
        }),
  
      dados: Joi.object({
        novoStatus: Joi.string()
          .optional()
          .valid('ativo', 'inativo')
          .messages({
            'any.only': 'O novo status deve ser "ativo" ou "inativo"'
          }),
  
        motivo: Joi.string()
          .optional()
          .max(255)
          .messages({
            'string.max': 'O motivo deve ter no máximo 255 caracteres'
          })
      }).optional()
    }),
  
    // Schema para empréstimos associados à caixinha
    emprestimo: Joi.object({
      acao: Joi.string()
        .required()
        .valid('solicitar', 'aprovar', 'rejeitar', 'pagar')
        .messages({
          'any.only': 'A ação deve ser uma das seguintes: solicitar, aprovar, rejeitar ou pagar'
        }),
  
      emprestimoId: Joi.string()
        .optional()
        .when('acao', {
          is: Joi.valid('aprovar', 'rejeitar', 'pagar'),
          then: Joi.required(),
          otherwise: Joi.optional()
        })
        .messages({
          'string.empty': 'O ID do empréstimo é obrigatório para esta ação'
        }),
  
      dados: Joi.object({
        valor: Joi.number()
          .optional()
          .min(0)
          .messages({
            'number.base': 'O valor deve ser um número',
            'number.min': 'O valor não pode ser negativo'
          }),
  
        prazo: Joi.number()
          .optional()
          .min(1)
          .messages({
            'number.base': 'O prazo deve ser um número',
            'number.min': 'O prazo deve ser no mínimo 1 mês'
          })
      }).optional()
    }),
  
    // Schema para relatórios da caixinha
    relatorio: Joi.object({
      tipo: Joi.string()
        .required()
        .valid('geral', 'contribuicoes', 'participacao', 'transacoes')
        .messages({
          'any.only': 'O tipo de relatório deve ser: geral, contribuições, participação ou transações'
        }),
  
      filtros: Joi.object()
        .optional()
        .pattern(Joi.string(), Joi.any())
        .messages({
          'object.base': 'Os filtros devem ser um objeto'
        })
    })
  };
  
  module.exports = caixinhaSchema;  