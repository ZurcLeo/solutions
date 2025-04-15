// middlewares/healthMiddleware.js
const { checkSpecificService } = require('../services/healthService');
const { logger } = require('../logger');

/**
 * Middleware que verifica a saúde de um serviço antes de processar uma rota
 * @param {string} serviceName - Nome do serviço a verificar
 */
const healthCheck = (serviceName) => async (req, res, next) => {
  try {
    // Vamos executar apenas se o cliente solicitar explicitamente
    // para não impactar o desempenho de todas as rotas
    if (req.query.checkHealth === 'true') {
      logger.info(`Health check solicitado para rota ${req.path} (serviço: ${serviceName})`, {
        service: 'healthMiddleware',
        path: req.path
      });
      
      const health = await checkSpecificService(serviceName);
      
      // Anexar status de saúde ao objeto req para uso pelo manipulador de rota
      req.serviceHealth = health;
      
      // Se o serviço estiver fora do ar, retornar erro imediatamente
      if (health.status === 'error') {
        return res.status(503).json({
          error: `Serviço ${serviceName} indisponível`,
          details: health
        });
      }
    }
    
    // Continuar para o manipulador de rota
    next();
  } catch (error) {
    logger.error(`Erro no middleware de health check para ${serviceName}`, {
      service: 'healthMiddleware',
      error: error.message
    });
    next();
  }
};

module.exports = { healthCheck };