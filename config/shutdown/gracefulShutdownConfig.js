const { logger } = require('../../logger');

module.exports = (server) => {
  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM signal, initiating graceful shutdown', {
      service: 'server',
      function: 'shutdown'
    });
    
    server.close(() => {
      logger.info('Server closed, process exiting');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  });
};