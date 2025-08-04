// middlewares/validate.js
const { logger } = require('../logger');

const validate = (schema) => (req, res, next) => {
  // Determina qual schema usar baseado na rota
  const getValidationSchema = (schema, path) => {
    if (schema.schemas && typeof schema.schemas === 'object') {
      const routePath = path.startsWith('/') ? path.substring(1) : path;
      return schema.schemas[routePath] || schema.default;
    }
    return schema;
  };

  logger.info('Iniciando validação de dados', {
    service: 'validationMiddleware',
    method: req.method,
    path: req.path
  });

  const validationSchema = getValidationSchema(schema, req.path);

  if (!validationSchema) {
    logger.warn('Schema de validação não encontrado para a rota', {
      service: 'validationMiddleware',
      path: req.path
    });
    return next();
  }

  // Determina qual objeto de dados validar com base na rota e método
  let dataToValidate;
  
  // Rotas específicas onde precisamos validar params mesmo em métodos não-GET
  if (req.path.includes('/markAsRead') || req.path.includes('/notifications/')) {
    dataToValidate = { 
      ...req.params,  // Inclui os parâmetros da URL
      userId: req.params.userId || req.query.userId || req.body.userId // Busca userId em múltiplos locais
    };
  } 
  // Para métodos GET, validamos os params e query strings
  else if (req.method === 'GET') {
    dataToValidate = {
      ...req.params,
      ...req.query
    };
  } 
  // Para outros métodos (POST, PUT, DELETE), validamos o body
  else {
    let bodyToValidate = req.body;
    
    // Se o body é uma string, tenta fazer parse
    if (typeof req.body === 'string') {
      try {
        bodyToValidate = JSON.parse(req.body);
      } catch (parseError) {
        logger.error('Erro ao fazer parse do body JSON', {
          service: 'validationMiddleware',
          body: req.body,
          parseError: parseError.message,
          path: req.path
        });
        return res.status(400).json({ 
          success: false, 
          message: 'Formato JSON inválido' 
        });
      }
    }
    
    // Se o body tem uma propriedade "body" aninhada, usa ela
    if (bodyToValidate && typeof bodyToValidate === 'object' && bodyToValidate.body) {
      if (typeof bodyToValidate.body === 'string') {
        try {
          bodyToValidate = JSON.parse(bodyToValidate.body);
        } catch (parseError) {
          logger.error('Erro ao fazer parse do body aninhado', {
            service: 'validationMiddleware',
            nestedBody: bodyToValidate.body,
            parseError: parseError.message,
            path: req.path
          });
          return res.status(400).json({ 
            success: false, 
            message: 'Formato JSON aninhado inválido' 
          });
        }
      } else if (typeof bodyToValidate.body === 'object') {
        bodyToValidate = bodyToValidate.body;
      }
    }
    
    // Garantir que temos um objeto válido para validação
    if (!bodyToValidate || typeof bodyToValidate !== 'object') {
      logger.error('Body da requisição inválido ou ausente', {
        service: 'validationMiddleware',
        body: req.body,
        bodyToValidate,
        bodyType: typeof bodyToValidate,
        path: req.path
      });
      return res.status(400).json({ 
        success: false, 
        message: 'Dados da requisição inválidos' 
      });
    }
    
    // Criar uma cópia do body para evitar mutação
    dataToValidate = { ...bodyToValidate };
    
    // Se userId não estiver no body mas estiver nos params, adicione-o
    if (!dataToValidate.userId && (req.params.userId || req.query.userId)) {
      dataToValidate.userId = req.params.userId || req.query.userId;
    }
    
    // Pré-processamento específico para rotas de roles
    if (req.path.includes('/roles') && dataToValidate.context) {
      // Se o contexto é global e resourceId é string vazia, converter para null
      if (dataToValidate.context.type === 'global' && dataToValidate.context.resourceId === '') {
        dataToValidate.context.resourceId = null;
      }
    }
  }

  logger.debug('Dados para validação', {
    service: 'validationMiddleware',
    dataToValidate,
    path: req.path,
    originalBody: req.body,
    params: req.params,
    bodyType: typeof req.body,
    bodyIsString: typeof req.body === 'string',
    bodyParsed: typeof req.body === 'string' ? JSON.parse(req.body) : null
  });

  const { error, value } = validationSchema.validate(dataToValidate);

  if (error) {
    logger.error('Erro de validação', {
      service: 'validationMiddleware',
      error: error.details[0].message,
      path: req.path,
      method: req.method,
      dataToValidate,
      originalBody: req.body,
      params: req.params,
      validationDetails: error.details
    });
    return res.status(400).json({ 
      success: false, 
      message: error.details[0].message 
    });
  }

  // Armazena os dados validados para uso futuro na rota
  req.validatedBody = value;
  
  logger.info('Validação bem-sucedida', {
    service: 'validationMiddleware',
    path: req.path,
    data: req.validatedBody
  });
  
  next();
};

module.exports = validate;