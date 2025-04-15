const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const { morganMiddleware } = require('../../logger');
const corsMiddleware = require('../../middlewares/cors');
const performanceMiddleware = require('../../middlewares/performance');

module.exports = (app) => {
  app.use(cookieParser());
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(morganMiddleware);
  app.use(corsMiddleware);
  app.use(performanceMiddleware('global'));
};