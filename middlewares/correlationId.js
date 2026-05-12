const { v4: uuidv4 } = require('uuid');

/**
 * Propaga um correlation ID em cada request.
 * - Se o cliente enviar x-correlation-id, usa o valor recebido.
 * - Caso contrário, gera um novo UUID v4.
 * - Prefixo "qa_" é reservado para runs do QA Orchestrator.
 */
module.exports = (req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || uuidv4();
  res.setHeader('x-correlation-id', req.correlationId);
  next();
};
