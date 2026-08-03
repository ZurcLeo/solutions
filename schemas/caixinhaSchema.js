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
        .allow('')
        .max(500)
        .messages({
          'string.max': 'A descrição deve ter no máximo 500 caracteres'
        }),

        duracaoMeses: Joi.number()
        .integer()
        .min(1)
        .max(120)
        .required()
        .messages({
          'number.base': 'O campo Duração em meses deve ser um número',
          'number.integer': 'O campo Duração em meses deve ser um número inteiro',
          'number.min': 'A duração mínima é de 1 mês',
          'number.max': 'A duração máxima é de 120 meses (10 anos)',
          'any.required': 'O campo Duração em meses é obrigatório'
        }),

        loanApprovalMethod: Joi.string()
        .valid('GROUP_VOTE', 'ADMIN_DECIDES')
        .optional()
        .default('GROUP_VOTE')
        .messages({
          'any.only': 'O método de aprovação deve ser GROUP_VOTE ou ADMIN_DECIDES'
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
        dataCriacao: Joi.date().required(),
        assentos: Joi.number().integer().min(2).max(500).optional().allow(null),
        concursosHabilitados: Joi.boolean().default(false),
        pixKey: Joi.string().optional().allow(null, '')
    }),
  
    // Schema para atualização de uma caixinha existente
    update: Joi.object({
      name:               Joi.string().optional().min(3).max(100),
      description:        Joi.string().optional().allow('').max(500),
      contribuicaoMensal: Joi.number().optional().min(0),
      diaVencimento:      Joi.number().integer().optional().min(1).max(31),
      permiteEmprestimos: Joi.boolean().optional(),
      allowRifas:         Joi.boolean().optional(),
      distribuicaoTipo:   Joi.string().optional().max(100),
      duracaoMeses:       Joi.number().integer().optional().min(1).max(120),
      assentos:           Joi.number().integer().optional().min(2).max(500).allow(null),
      concursosHabilitados: Joi.boolean().optional(),
      pixKey:             Joi.string().optional().allow(null, ''),
      governanceModel:    Joi.object({
        type:                Joi.string().valid('ADMIN_CONTROL', 'GROUP_DISPUTE').required(),
        quorumType:          Joi.string().valid('PERCENTAGE', 'COUNT').required(),
        quorumValue:         Joi.number().min(1).max(100).required(),
        adminHasTiebreaker:  Joi.boolean().default(true),
        canChangeAfterMembers: Joi.boolean().default(false),
      }).optional(),
      configuracoes: Joi.object({
        permiteEmprestimos:     Joi.boolean(),
        taxaJuros:              Joi.number().min(0).max(100),
        limiteEmprestimo:       Joi.number().min(0),
        prazoMaximoEmprestimo:  Joi.number().min(1)
      }).optional()
    }),
  
    // Schema para ações relacionadas aos membros da caixinha
    membro: Joi.object({
      acao: Joi.string()
        .required()
        .valid('adicionar', 'atualizar', 'remover', 'transferir', 'alterar_role')
        .messages({
          'any.only': 'A ação deve ser uma das seguintes: adicionar, atualizar, remover, transferir ou alterar_role'
        }),

      membroId: Joi.string()
        .required()
        .messages({
          'string.empty': 'O ID do membro é obrigatório'
        }),

      dados: Joi.object({
        novoStatus: Joi.string()
          .optional()
          .valid('ativo', 'inativo', 'suspenso')
          .messages({
            'any.only': 'O novo status deve ser "ativo", "inativo" ou "suspenso"'
          }),

        novaRole: Joi.string()
          .optional()
          .valid('gerente', 'membro')
          .messages({
            'any.only': 'A nova role deve ser "gerente" ou "membro"'
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
  
    // Schema para contribuições
    contribuicao: Joi.object({
      valor: Joi.number()
        .required()
        .positive()
        .messages({
          'number.base': 'O valor deve ser um número',
          'number.positive': 'O valor deve ser positivo',
          'any.required': 'O valor é obrigatório'
        }),
      dataContribuicao: Joi.date()
        .optional()
        .messages({
          'date.base': 'A data da contribuição deve ser uma data válida'
        }),
      metodo: Joi.string()
        .optional()
        .valid('pix', 'transferencia', 'boleto', 'manual')
        .messages({
          'any.only': 'O método deve ser: pix, transferencia, boleto ou manual'
        })
    }),

    // Schema para convite por email
    conviteEmail: Joi.object({
      email: Joi.string()
        .required()
        .email()
        .messages({
          'string.email': 'O email deve ser um endereço válido',
          'string.empty': 'O email é obrigatório',
          'any.required': 'O email é obrigatório'
        }),
      message: Joi.string()
        .optional()
        .allow('')
        .max(500)
        .messages({
          'string.max': 'A mensagem deve ter no máximo 500 caracteres'
        })
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

  const governanceSchema = Joi.object({
    type: Joi.string()
      .valid('ADMIN_CONTROL', 'GROUP_DISPUTE')
      .required()
      .messages({
        'any.only': 'O tipo de governança deve ser ADMIN_CONTROL ou GROUP_DISPUTE'
      }),
    
    quorumType: Joi.string()
      .valid('PERCENTAGE', 'COUNT')
      .required()
      .messages({
        'any.only': 'O tipo de quórum deve ser PERCENTAGE ou COUNT'
      }),
    
    quorumValue: Joi.number()
      .when('quorumType', {
        is: 'PERCENTAGE',
        then: Joi.number().min(1).max(100).required(),
        otherwise: Joi.number().min(1).required()
      })
      .messages({
        'number.min': 'O valor do quórum deve ser pelo menos 1',
        'number.max': 'O percentual de quórum não pode exceder 100%'
      }),
    
    adminHasTiebreaker: Joi.boolean().default(true),
    canChangeAfterMembers: Joi.boolean().default(false)
  });
  
  // Adicionar ao schema create
  create: Joi.object({
    // campos existentes...
    governanceModel: governanceSchema.optional()
  });
  
  // Adicionar ao schema update
  update: Joi.object({
    // campos existentes...
    governanceModel: governanceSchema.optional()
  });
  
  module.exports = caixinhaSchema;