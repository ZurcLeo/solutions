require('dotenv').config();
const express = require('express');
const https = require('https');
const swaggerUi = require('swagger-ui-express');
const { logger } = require('./logger');
const swaggerDocs = require('./swagger');
const configureSocket = require('./config/socket/socketConfig');

// Configurações importadas
const getCertificates = require('./config/ssl/sslConfig');
const setupMiddlewares = require('./config/middlewares/middlewaresConfig');
const securityHeaders = require('./config/headers/securityHeadersConfig');
const setupRoutes = require('./config/routes/routesConfig');
const gracefulShutdown = require('./config/shutdown/gracefulShutdownConfig');

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
server.listen(PORT, () => {
  logger.info(`HTTPS Server Running on port ${PORT}`);
});

// Shutdown graceful
gracefulShutdown(server);