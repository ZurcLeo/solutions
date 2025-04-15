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
    dataToValidate = req.body;
    
    // Se userId não estiver no body mas estiver nos params, adicione-o
    if (!req.body.userId && (req.params.userId || req.query.userId)) {
      dataToValidate.userId = req.params.userId || req.query.userId;
    }
  }

  logger.debug('Dados para validação', {
    service: 'validationMiddleware',
    dataToValidate,
    path: req.path
  });

  const { error, value } = validationSchema.validate(dataToValidate);

  if (error) {
    logger.error('Erro de validação', {
      service: 'validationMiddleware',
      error: error.details[0].message,
      path: req.path,
      data: dataToValidate
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