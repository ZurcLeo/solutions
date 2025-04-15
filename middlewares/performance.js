// middlewares/performance.js
const { logger } = require('../logger');

module.exports = function(routeName) {
  return function(req, res, next) {
    // Armazenar tempo inicial
    req.performanceMetrics = {
      start: process.hrtime(),
      checkpoints: {}
    };
    
    // Método para marcar checkpoints durante o processamento
    req.markCheckpoint = function(name) {
      const checkpoint = process.hrtime(req.performanceMetrics.start);
      const timeInMs = checkpoint[0] * 1000 + checkpoint[1] / 1000000;
      
      req.performanceMetrics.checkpoints[name] = timeInMs.toFixed(2);
      
      logger.debug(`Checkpoint: ${name}`, {
        service: routeName || 'api',
        method: req.method,
        path: req.path,
        userId: req.user?.uid,
        checkpoint: name,
        timeMs: timeInMs.toFixed(2)
      });
      
      return timeInMs;
    };
    
    // Sobrescrever método end para capturar tempo final
    const originalEnd = res.end;
    res.end = function(chunk, encoding) {
      const elapsedTime = process.hrtime(req.performanceMetrics.start);
      const timeInMs = elapsedTime[0] * 1000 + elapsedTime[1] / 1000000;
      
      // Log detalhado com checkpoints
      logger.info(`Tempo de resposta para ${req.method} ${req.path}`, {
        service: routeName || 'api',
        method: req.method,
        path: req.path,
        userId: req.user?.uid,
        timeMs: timeInMs.toFixed(2),
        statusCode: res.statusCode,
        checkpoints: req.performanceMetrics.checkpoints
      });
      
      return originalEnd.call(this, chunk, encoding);
    };
    
    next();
  };
};