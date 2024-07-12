const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const corsMiddleware = require('./middlewares/cors');
const { logger, morganMiddleware } = require('./logger');
const swaggerUi = require('swagger-ui-express');
const bodyParser = require('body-parser');
const swaggerDocs = require('./swagger');

// Cria uma instância do aplicativo Express
const app = express();

// Middleware para ler o corpo da requisição em JSON
app.use(bodyParser.json());

// Middleware para logar o corpo da requisição
app.use((req, res, next) => {
  logger.info('Corpo da Requisição:', {
    service: 'request-body-logger',
    function: 'request-body-logger',
    body: req.body
  });
  next();
});

// Configurações de Middleware
app.use(corsMiddleware);
app.use(morganMiddleware);

// Middleware para adicionar informações de serviço e função aos logs
app.use((req, res, next) => {
  req.logMetadata = {
    service: req.baseUrl || 'unknown-service',
    function: req.route && req.route.path ? req.route.path : 'unknown-function',
  };
  next();
});

// Passar io para o middleware
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use((req, res, next) => {
  req.io = io;
  next();
});

// Função para envolver rotas com o logger
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
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Load listRoutes dynamically
(async () => {
  const { default: listRoutes } = await import('./middlewares/listRoutes.mjs');
  listRoutes(app);
})();

// Inicialização do Servidor
const PORT = process.env.PORT || 9000;
server.listen(PORT, () => {
  logger.info(`Servidor rodando na porta ${PORT}`, { service: 'server', function: 'listen' });
});