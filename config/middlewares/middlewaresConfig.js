const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const { morganMiddleware } = require('../../logger');
const corsMiddleware = require('../../middlewares/cors');
const checkBlacklist = require('../../middlewares/checkBlacklist');
const performanceMiddleware = require('../../middlewares/performance');
const correlationId = require('../../middlewares/correlationId');
const { sanitizerMiddleware } = require('../../middlewares/SanitizerMiddleware');

module.exports = (app) => {
  // Middleware para lidar com proxy headers (deve vir antes de outros middlewares)
  if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
      // Garantir que X-Forwarded-Proto seja respeitado
      if (req.headers['x-forwarded-proto'] === 'https') {
        req.secure = true;
        req.protocol = 'https';
      }
      
      // Log para debug de headers de proxy
      const { logger } = require('../../logger');
      logger.debug('Proxy headers received', {
        'x-forwarded-for': req.headers['x-forwarded-for'],
        'x-forwarded-proto': req.headers['x-forwarded-proto'],
        'x-forwarded-host': req.headers['x-forwarded-host'],
        'user-agent': req.headers['user-agent'],
        origin: req.headers.origin,
        host: req.headers.host
      });
      
      next();
    });
  }

  app.use(cookieParser());
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(checkBlacklist);
  app.use(correlationId);    // propaga x-correlation-id em todos os requests
  app.use(sanitizerMiddleware); // Protocolo Zero-Data para SRE
  app.use(morganMiddleware);
  app.use(corsMiddleware);
  app.use(performanceMiddleware('global'));
};