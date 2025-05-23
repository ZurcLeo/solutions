require('dotenv').config();
const express = require('express');
const https = require('https');
const swaggerUi = require('swagger-ui-express');
const { logger } = require('./logger');
const swaggerDocs = require('./swagger');
const configureSocket = require('./config/socket/socketConfig');
const secretsManager = require('./services/secretsManager');
const encryptionService = require('./services/encryptionService');
// Configurações importadas
const getCertificates = require('./config/ssl/sslConfig');
const setupMiddlewares = require('./config/middlewares/middlewaresConfig');
const securityHeaders = require('./config/headers/securityHeadersConfig');
const setupRoutes = require('./config/routes/routesConfig');
const gracefulShutdown = require('./config/shutdown/gracefulShutdownConfig');
const {initializeLocalStorage} = require('./config/scripts/initializeLocalData');

const app = express();
const server = https.createServer(getCertificates(), app);
const io = configureSocket(server);

// Configurações básicas
setupMiddlewares(app);
app.use(securityHeaders);

// Socket.IO
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Rotas
setupRoutes(app);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Error handling
app.use((err, req, res, next) => {
  logger.error('Unhandled Error:', { error: err.stack });
  res.status(500).json({ error: 'Internal Server Error' });
});

// Inicialização do servidor
const PORT = process.env.PORT || 9000;
Promise.all([
  initializeLocalStorage(),
  secretsManager.initialize(), // Adicionar inicialização do secretsManager
  encryptionService.initialized // Aguardar inicialização do serviço de criptografia
])
  .then(() => {
    // Iniciar o servidor HTTPS (server) em vez de criar um novo com app.listen()
    server.listen(PORT, () => {
      console.log(`Servidor HTTPS rodando na porta ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Falha ao inicializar o servidor:', err);
    process.exit(1);
  });

// Shutdown graceful
gracefulShutdown(server);