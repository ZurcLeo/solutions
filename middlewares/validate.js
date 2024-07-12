// middlewares/validate.js
const { logger } = require('../logger');

const validate = (schema) => (req, res, next) => {
  logger.info('Iniciando validação de dados', {
    service: 'validationMiddleware',
    function: 'validate',
    body: req.body
  });

  const { error, value } = schema.validate(req.body);

  if (error) {
    logger.error('Erro de validação', {
      service: 'validationMiddleware',
      function: 'validate',
      error: error.details[0].message
    });
    return res.status(400).json({ success: false, message: error.details[0].message });
  }

  req.validatedBody = value;
  logger.info('Validação bem-sucedida', {
    service: 'validationMiddleware',
    function: 'validate',
    validatedBody: value
  });
  next();
};

module.exports = validate;