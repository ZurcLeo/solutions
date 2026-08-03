const { logger } = require('../logger');

module.exports = (routeHandler) => {
  if (typeof routeHandler !== 'function') {
    throw new TypeError(
      `[routeLogger] routeHandler must be a function, got "${typeof routeHandler}". ` +
      `Possible circular dependency or missing module.exports in route file.`
    );
  }

  return (req, res, next) => {
    logger.info(`Route Called: [Method]: ${req.method} [Origin]: ${req.originalUrl}`, {
      reqFor: req.baseUrl || 'unknown-service',
      route: req.url || 'unknown-function',
      req: req.user
    });
    routeHandler(req, res, next);
  };
};