const { logger } = require('../logger');

module.exports = (routeHandler) => (req, res, next) => {
  logger.info(`Route Called: [Method]: ${req.method} [Origin]: ${req.originalUrl}`, {
    reqFor: req.baseUrl || 'unknown-service',
    route: req.url || 'unknown-function',
    req: req.user
  });
  routeHandler(req, res, next);
};