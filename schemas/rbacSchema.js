// schemas/rbacSchema.js
const Joi = require('joi');

// Schema para criação de role
const roleCreate = Joi.object({
  name: Joi.string()
    .required()
    .min(3)
    .max(50)
    .pattern(/^[a-zA-Z0-9_]+$/)
    .messages({
      'string.empty': 'Nome da role é obrigatório',
      'string.min': 'Nome da role deve ter pelo menos 3 caracteres',
      'string.max': 'Nome da role deve ter no máximo 50 caracteres',
      'string.pattern.base': 'Nome da role deve conter apenas letras, números e underscore'
    }),
  
  description: Joi.string()
    .required()
    .max(200)
    .messages({
      'string.empty': 'Descrição da role é obrigatória',
      'string.max': 'Descrição da role deve ter no máximo 200 caracteres'
    }),
  
  isSystemRole: Joi.boolean()
    .default(false)
});

// Schema para atualização de role
const roleUpdate = Joi.object({
  name: Joi.string()
    .min(3)
    .max(50)
    .pattern(/^[a-zA-Z0-9_]+$/)
    .messages({
      'string.min': 'Nome da role deve ter pelo menos 3 caracteres',
      'string.max': 'Nome da role deve ter no máximo 50 caracteres',
      'string.pattern.base': 'Nome da role deve conter apenas letras, números e underscore'
    }),
  
  description: Joi.string()
    .max(200)
    .messages({
      'string.max': 'Descrição da role deve ter no máximo 200 caracteres'
    }),
  
  isSystemRole: Joi.boolean()
});

// Schema para criação de permissão
const permissionCreate = Joi.object({
  name: Joi.string()
    .pattern(/^[a-zA-Z0-9_]+:[a-zA-Z0-9_]+$/)
    .messages({
      'string.pattern.base': 'Nome da permissão deve seguir o formato "recurso:ação"'
    }),
  
  resource: Joi.string()
    .required()
    .min(2)
    .max(50)
    .pattern(/^[a-zA-Z0-9_]+$/)
    .messages({
      'string.empty': 'Recurso é obrigatório',
      'string.min': 'Recurso deve ter pelo menos 2 caracteres',
      'string.max': 'Recurso deve ter no máximo 50 caracteres',
      'string.pattern.base': 'Recurso deve conter apenas letras, números e underscore'
    }),
  
  action: Joi.string()
    .required()
    .min(2)
    .max(50)
    .pattern(/^[a-zA-Z0-9_]+$/)
    .messages({
      'string.empty': 'Ação é obrigatória',
      'string.min': 'Ação deve ter pelo menos 2 caracteres',
      'string.max': 'Ação deve ter no máximo 50 caracteres',
      'string.pattern.base': 'Ação deve conter apenas letras, números e underscore'
    }),
  
  description: Joi.string()
    .required()
    .max(200)
    .messages({
      'string.empty': 'Descrição da permissão é obrigatória',
      'string.max': 'Descrição da permissão deve ter no máximo 200 caracteres'
    })
});

// Schema para atualização de permissão
const permissionUpdate = Joi.object({
  resource: Joi.string()
    .min(2)
    .max(50)
    .pattern(/^[a-zA-Z0-9_]+$/)
    .messages({
      'string.min': 'Recurso deve ter pelo menos 2 caracteres',
      'string.max': 'Recurso deve ter no máximo 50 caracteres',
      'string.pattern.base': 'Recurso deve conter apenas letras, números e underscore'
    }),
  
  action: Joi.string()
    .min(2)
    .max(50)
    .pattern(/^[a-zA-Z0-9_]+$/)
    .messages({
      'string.min': 'Ação deve ter pelo menos 2 caracteres',
      'string.max': 'Ação deve ter no máximo 50 caracteres',
      'string.pattern.base': 'Ação deve conter apenas letras, números e underscore'
    }),
  
  description: Joi.string()
    .max(200)
    .messages({
      'string.max': 'Descrição da permissão deve ter no máximo 200 caracteres'
    })
});

// Schema para atribuição de role a usuário
const userRoleAssign = Joi.object({
  userId: Joi.string()
    .optional()
    .messages({
      'string.empty': 'ID do usuário é obrigatório'
    }),
    
  roleId: Joi.string()
    .required()
    .messages({
      'string.empty': 'ID da role é obrigatório'
    }),
  
  context: Joi.object({
    type: Joi.string()
      .valid('global', 'caixinha', 'marketplace')
      .default('global')
      .messages({
        'any.only': 'Tipo de contexto deve ser global, caixinha ou marketplace'
      }),
    
    resourceId: Joi.when('type', {
      is: Joi.string().valid('caixinha', 'marketplace'),
      then: Joi.string().required().min(1).messages({
        'string.empty': 'ID do recurso é obrigatório para contextos não-globais',
        'string.min': 'ID do recurso é obrigatório para contextos não-globais'
      }),
      otherwise: Joi.alternatives().try(
        Joi.string().allow(''),
        Joi.valid(null)
      )
    })
  }).default({ type: 'global', resourceId: null }),
  
  options: Joi.object({
    validationStatus: Joi.string()
      .valid('pending', 'validated', 'rejected')
      .default('pending'),
    
    validationData: Joi.object().default({}),
    
    expiresAt: Joi.date().allow(null),
    
    metadata: Joi.object().default({})
  }).default({})
});

// Schema para validação de role de usuário
const userRoleValidate = Joi.object({
  validationData: Joi.object().default({})
});

// Schema para rejeição de role de usuário
const userRoleReject = Joi.object({
  reason: Joi.string()
    .required()
    .max(200)
    .messages({
      'string.empty': 'Motivo da rejeição é obrigatório',
      'string.max': 'Motivo da rejeição deve ter no máximo 200 caracteres'
    }),
  
  details: Joi.string()
    .max(500)
    .allow(null)
    .messages({
      'string.max': 'Detalhes da rejeição devem ter no máximo 500 caracteres'
    })
});

// Schema para validação bancária
const bankValidationInit = Joi.object({
  userRoleId: Joi.string().allow(null),
  
  bankData: Joi.object({
    bankName: Joi.string().required(),
    bankCode: Joi.string().required(),
    accountType: Joi.string().required(),
    accountNumber: Joi.string().required(),
    branchCode: Joi.string().required(),
    holderName: Joi.string().required(),
    holderDocument: Joi.string().required()
  }).required()
});

// Schema para confirmação de validação bancária
const bankValidationConfirm = Joi.object({
  validationCode: Joi.string()
    .required()
    .pattern(/^[A-Z0-9]{6}$/)
    .messages({
      'string.empty': 'Código de validação é obrigatório',
      'string.pattern.base': 'Código de validação deve ter 6 caracteres alfanuméricos maiúsculos'
    }),
  
  userRoleId: Joi.string().allow(null)
});

// Exportar todos os schemas
module.exports = {
  roleCreate,
  roleUpdate,
  permissionCreate,
  permissionUpdate,
  userRoleAssign,
  userRoleValidate,
  userRoleReject,
  bankValidationInit,
  bankValidationConfirm
};