const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cookieParser = require('cookie-parser');
const { corsMiddleware, allowedOrigins } = require('./middlewares/cors');
const { logger, morganMiddleware } = require('./logger');
const swaggerUi = require('swagger-ui-express');
const bodyParser = require('body-parser');
const swaggerDocs = require('./swagger');

const app = express();

app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use((req, res, next) => {
  logger.info('Corpo da Requisição:', {
    service: 'request-body-logger',
    function: 'request-body-logger',
    body: req.body
  });
  next();
});

app.use(corsMiddleware);
app.use(morganMiddleware);

app.use((req, res, next) => {
  req.logMetadata = {
    service: req.baseUrl || 'unknown-service',
    function: req.route && req.route.path ? req.route.path : 'unknown-function',
  };
  next();
});

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'userId', 'email']
  },
});

app.use((req, res, next) => {
  logger.info('Verificando cookies na requisição:', {
    service: 'cookie-checker',
    function: 'cookie-checker',
    cookies: req.cookies
  });
  next();
});

app.use((req, res, next) => {
  req.io = io;
  next();
});

const logRoute = (routeHandler) => (req, res, next) => {
  logger.info(`Rota chamada: ${req.method} ${req.originalUrl}`, req.logMetadata);
  routeHandler(req, res, next);
};

// Importação de Rotas
const authRoutes = require('./routes/auth');
const caixinhaRoutes = require('./routes/caixinha');
const emailRoutes = require('./routes/email');
const groupsCaixinhaRoutes = require('./routes/groupsCaixinha');
const inviteRoutes = require('./routes/invite');
const ja3Routes = require('./routes/ja3');
const messageRoutes = require('./routes/messages');
const notificationsRoutes = require('./routes/notifications');
const paymentsRoutes = require('./routes/payments');
const postsRoutes = require('./routes/posts');
const recaptchaRoutes = require('./routes/recaptcha');
const userRoutes = require('./routes/user');
const videoSdkRoutes = require('./routes/videosdk');
const connectionsRoutes = require('./routes/connections');
const sellerRoutes = require('./routes/seller');
const bankAccountRoutes = require('./routes/bankAccount'); 

// Definição de Rotas com logRoute
app.use('/api/auth', (req, res, next) => logRoute(authRoutes)(req, res, next));
app.use('/api/caixinha', (req, res, next) => logRoute(caixinhaRoutes)(req, res, next));
app.use('/api/email', (req, res, next) => logRoute(emailRoutes)(req, res, next));
app.use('/api/groups', (req, res, next) => logRoute(groupsCaixinhaRoutes)(req, res, next));
app.use('/api/invite', (req, res, next) => logRoute(inviteRoutes)(req, res, next));
app.use('/api/ja3', (req, res, next) => logRoute(ja3Routes)(req, res, next));
app.use('/api/messages', (req, res, next) => logRoute(messageRoutes)(req, res, next));
app.use('/api/notifications', (req, res, next) => logRoute(notificationsRoutes)(req, res, next));
app.use('/api/payments', (req, res, next) => logRoute(paymentsRoutes)(req, res, next));
app.use('/api/posts', (req, res, next) => logRoute(postsRoutes)(req, res, next));
app.use('/api/recaptcha', (req, res, next) => logRoute(recaptchaRoutes)(req, res, next));
app.use('/api/users', (req, res, next) => logRoute(userRoutes)(req, res, next));
app.use('/api/video-sdk', (req, res, next) => logRoute(videoSdkRoutes)(req, res, next));
app.use('/api/connections', (req, res, next) => logRoute(connectionsRoutes)(req, res, next));
app.use('/api/sellers', (req, res, next) => logRoute(sellerRoutes)(req, res, next));
app.use('/api/banking', (req, res, next) => logRoute(bankAccountRoutes)(req, res, next));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

(async () => {
  const { default: listRoutes } = await import('./middlewares/listRoutes.mjs');
  listRoutes(app);
})();

const PORT = process.env.PORT || 9000;
server.listen(PORT, () => {
  logger.info(`Servidor rodando na porta ${PORT}`, { service: 'server', function: 'listen' });
});