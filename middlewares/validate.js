// middlewares/validate.js
const { logger } = require('../logger');

const validate = (schema) => (req, res, next) => {
  logger.info('Iniciando validação de dados', {
    service: 'validationMiddleware',
    function: 'validate',
    body: req.body,
    path: req.path 
  });

  const { error, value } = req.method === 'GET' ? schema.validate(req.params) : schema.validate(req.body);

  if (error) {
    logger.error('Erro de validação', {
      service: 'validationMiddleware',
      function: 'validate',
      error: error.details[0].message,
      path: req.path 
    });
    return res.status(400).json({ success: false, message: error.details[0].message });
  }

  req.validatedBody = value;
  logger.info('Validação bem-sucedida', {
    service: 'validationMiddleware',
    function: 'validate',
    validatedBody: value,
    path: req.path 
  });
  next();
};

module.exports = validate;