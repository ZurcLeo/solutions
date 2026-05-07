// schemas/bankAccountSchema.js
const Joi = require('joi');

/**
 * Schema de validação para criação de conta bancária
 * Valida todos os dados sensíveis antes de criptografia
 */
const createBankAccountSchema = Joi.object({
  // Dados do administrador e caixinha
  adminId: Joi.string()
    .required()
    .pattern(/^[a-zA-Z0-9_-]+$/)
    .min(10)
    .max(128)
    .messages({
      'string.empty': 'ID do administrador é obrigatório',
      'string.pattern.base': 'ID do administrador contém caracteres inválidos',
      'string.min': 'ID do administrador muito curto',
      'string.max': 'ID do administrador muito longo',
      'any.required': 'ID do administrador é obrigatório'
    }),

  caixinhaId: Joi.string()
    .required()
    .pattern(/^[a-zA-Z0-9_-]+$/)
    .min(10)
    .max(128)
    .messages({
      'string.empty': 'ID da caixinha é obrigatório',
      'string.pattern.base': 'ID da caixinha contém caracteres inválidos',
      'string.min': 'ID da caixinha muito curto',
      'string.max': 'ID da caixinha muito longo',
      'any.required': 'ID da caixinha é obrigatório'
    }),

  // Dados bancários básicos
  bankName: Joi.string()
    .required()
    .min(3)
    .max(100)
    .trim()
    .messages({
      'string.empty': 'Nome do banco é obrigatório',
      'string.min': 'Nome do banco deve ter pelo menos 3 caracteres',
      'string.max': 'Nome do banco não pode exceder 100 caracteres',
      'any.required': 'Nome do banco é obrigatório'
    }),

  bankCode: Joi.string()
    .required()
    .pattern(/^\d{3,4}$/)
    .messages({
      'string.empty': 'Código do banco é obrigatório',
      'string.pattern.base': 'Código do banco deve conter apenas 3 ou 4 dígitos',
      'any.required': 'Código do banco é obrigatório'
    }),

  // Agência (opcional para alguns bancos)
  agency: Joi.string()
    .optional()
    .allow(null, '')
    .pattern(/^\d{4,5}(-\d{1})?$/)
    .messages({
      'string.pattern.base': 'Agência deve ter formato válido (ex: 1234, 12345, 1234-5)'
    }),

  // Número da conta
  accountNumber: Joi.string()
    .required()
    .pattern(/^[\d-]{1,20}$/)
    .messages({
      'string.empty': 'Número da conta é obrigatório',
      'string.pattern.base': 'Número da conta deve conter apenas dígitos e hífens',
      'any.required': 'Número da conta é obrigatório'
    }),

  // Tipo de conta
  accountType: Joi.string()
    .required()
    .valid('corrente', 'poupanca', 'pagamento')
    .messages({
      'string.empty': 'Tipo de conta é obrigatório',
      'any.only': 'Tipo de conta deve ser: corrente, poupanca ou pagamento',
      'any.required': 'Tipo de conta é obrigatório'
    }),

  // Titular da conta
  accountHolder: Joi.string()
    .required()
    .min(3)
    .max(100)
    .trim()
    .pattern(/^[a-zA-ZÀ-ÿ\s'-]+$/)
    .messages({
      'string.empty': 'Nome do titular é obrigatório',
      'string.min': 'Nome do titular deve ter pelo menos 3 caracteres',
      'string.max': 'Nome do titular não pode exceder 100 caracteres',
      'string.pattern.base': 'Nome do titular contém caracteres inválidos',
      'any.required': 'Nome do titular é obrigatório'
    }),

  // Chave PIX - tipo
  pixKeyType: Joi.string()
    .optional()
    .allow(null, '')
    .valid('cpf', 'cnpj', 'email', 'phone', 'random')
    .messages({
      'any.only': 'Tipo de chave PIX inválido (cpf, cnpj, email, phone ou random)'
    }),

  // Chave PIX - valor (validação condicional baseada no tipo)
  pixKey: Joi.string()
    .optional()
    .allow(null, '')
    .when('pixKeyType', {
      is: 'cpf',
      then: Joi.string()
        .pattern(/^\d{11}$/)
        .messages({
          'string.pattern.base': 'CPF deve conter exatamente 11 dígitos'
        }),
      otherwise: Joi.when('pixKeyType', {
        is: 'cnpj',
        then: Joi.string()
          .pattern(/^\d{14}$/)
          .messages({
            'string.pattern.base': 'CNPJ deve conter exatamente 14 dígitos'
          }),
        otherwise: Joi.when('pixKeyType', {
          is: 'email',
          then: Joi.string()
            .email()
            .messages({
              'string.email': 'Email inválido para chave PIX'
            }),
          otherwise: Joi.when('pixKeyType', {
            is: 'phone',
            then: Joi.string()
              .pattern(/^\+?55\d{10,11}$/)
              .messages({
                'string.pattern.base': 'Telefone deve estar no formato: +5511999999999'
              }),
            otherwise: Joi.when('pixKeyType', {
              is: 'random',
              then: Joi.string()
                .pattern(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
                .messages({
                  'string.pattern.base': 'Chave aleatória deve estar no formato UUID'
                })
            })
          })
        })
      })
    })
});

/**
 * Schema de validação para atualização de conta bancária
 * Permite atualização parcial dos dados
 */
const updateBankAccountSchema = Joi.object({
  bankName: Joi.string()
    .optional()
    .min(3)
    .max(100)
    .trim(),

  accountHolder: Joi.string()
    .optional()
    .min(3)
    .max(100)
    .trim()
    .pattern(/^[a-zA-ZÀ-ÿ\s'-]+$/),

  accountType: Joi.string()
    .optional()
    .valid('corrente', 'poupanca', 'pagamento'),

  pixKeyType: Joi.string()
    .optional()
    .valid('cpf', 'cnpj', 'email', 'phone', 'random'),

  pixKey: Joi.string()
    .optional()
    .allow(null, ''),

  isActive: Joi.boolean()
    .optional(),

  status: Joi.string()
    .optional()
    .valid('pendente', 'validada', 'rejeitada', 'bloqueada')
}).min(1); // Pelo menos um campo deve ser fornecido

/**
 * Schema de validação para busca de contas bancárias
 */
const queryBankAccountSchema = Joi.object({
  caixinhaId: Joi.string()
    .optional()
    .pattern(/^[a-zA-Z0-9_-]+$/),

  isActive: Joi.boolean()
    .optional(),

  lastDigits: Joi.string()
    .optional()
    .pattern(/^\d{4}$/),

  includeDecrypted: Joi.boolean()
    .optional()
    .default(false)
});

/**
 * Schema de validação para ID de conta bancária
 */
const bankAccountIdSchema = Joi.object({
  adminId: Joi.string()
    .required()
    .pattern(/^[a-zA-Z0-9_-]+$/)
    .min(10)
    .max(128),

  accountId: Joi.string()
    .required()
    .pattern(/^[a-zA-Z0-9_-]+$/)
    .min(10)
    .max(128)
});

/**
 * Middleware de validação para criação de conta bancária
 */
const validateCreateBankAccount = (req, res, next) => {
  const { error } = createBankAccountSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message
    }));

    return res.status(400).json({
      success: false,
      message: 'Erro de validação',
      errors
    });
  }

  next();
};

/**
 * Middleware de validação para atualização de conta bancária
 */
const validateUpdateBankAccount = (req, res, next) => {
  const { error } = updateBankAccountSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message
    }));

    return res.status(400).json({
      success: false,
      message: 'Erro de validação',
      errors
    });
  }

  next();
};

/**
 * Middleware de validação para consulta de contas bancárias
 */
const validateQueryBankAccount = (req, res, next) => {
  const { error } = queryBankAccountSchema.validate(req.query, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message
    }));

    return res.status(400).json({
      success: false,
      message: 'Erro de validação nos parâmetros de consulta',
      errors
    });
  }

  next();
};

/**
 * Validação de segurança adicional para dados bancários
 * Verifica padrões suspeitos e potenciais ataques
 */
const securityValidation = (data) => {
  const suspiciousPatterns = {
    // Padrões de SQL Injection
    sqlInjection: /(union|select|insert|update|delete|drop|create|alter|exec|script)/i,

    // Padrões de XSS
    xss: /(<script|javascript:|onerror=|onload=)/i,

    // Números de conta obviamente falsos
    testData: /(^0+$|^1+$|^9+$|^12345|^00000)/,

    // Padrões de números sequenciais
    sequential: /(?:0123|1234|2345|3456|4567|5678|6789|7890){3,}/
  };

  const warnings = [];

  // Validar accountNumber
  if (data.accountNumber) {
    if (suspiciousPatterns.sqlInjection.test(data.accountNumber)) {
      throw new Error('Padrão suspeito detectado no número da conta');
    }
    if (suspiciousPatterns.testData.test(data.accountNumber)) {
      warnings.push('Número de conta parece ser dado de teste');
    }
    if (suspiciousPatterns.sequential.test(data.accountNumber)) {
      warnings.push('Número de conta contém sequência suspeita');
    }
  }

  // Validar accountHolder
  if (data.accountHolder) {
    if (suspiciousPatterns.sqlInjection.test(data.accountHolder)) {
      throw new Error('Padrão suspeito detectado no nome do titular');
    }
    if (suspiciousPatterns.xss.test(data.accountHolder)) {
      throw new Error('Padrão suspeito detectado no nome do titular');
    }
  }

  // Validar pixKey
  if (data.pixKey) {
    if (suspiciousPatterns.sqlInjection.test(data.pixKey)) {
      throw new Error('Padrão suspeito detectado na chave PIX');
    }
    if (suspiciousPatterns.xss.test(data.pixKey)) {
      throw new Error('Padrão suspeito detectado na chave PIX');
    }
  }

  return {
    isValid: true,
    warnings
  };
};

module.exports = {
  createBankAccountSchema,
  updateBankAccountSchema,
  queryBankAccountSchema,
  bankAccountIdSchema,
  validateCreateBankAccount,
  validateUpdateBankAccount,
  validateQueryBankAccount,
  securityValidation
};
