require('dotenv').config();
const express = require('express');
const http = require('http');
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
const { startSreWorker } = require('./sreWorker');

const app = express();

// Trust proxy - CRÍTICO para deployment em plataformas como Render.com
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1); // Trust first proxy (Render.com)
  logger.info('Trust proxy enabled for production');
} else {
  app.set('trust proxy', false);
  logger.info('Trust proxy disabled for development');
}

// Use HTTP em produção (Render gerencia SSL) e HTTPS em desenvolvimento
const server = process.env.NODE_ENV === 'production' 
  ? http.createServer(app)
  : https.createServer(getCertificates(), app);
const io = configureSocket(server);

// Configurações básicas
setupMiddlewares(app);
app.use(securityHeaders);

// Socket.IO
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Servir arquivos estáticos
app.use(express.static('public'));

// Rota raiz da API com informações básicas
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Dashboard de Monitoramento e QA
app.get('/dashboard', (req, res) => {
  res.sendFile(__dirname + '/public/dashboard.html');
});

// Rotas
setupRoutes(app);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

const { calculateSeverity } = require('./utils/severityCalculator');

// ... (setupMiddlewares, etc)

// Error handling
app.use((err, req, res, next) => {
  const severity = calculateSeverity(req.sreContext || {}, {
    status: 500,
    durationMs: 0 // Simplificado para o erro
  }, err);

  if (req.sreContext) {
    req.sreContext.severity = severity.level;
    req.sreContext.severity_reason = severity.reason;
  }

  logger.error(`${severity.level} Error: ${err.message}`, { 
    error: err.stack,
    sreContext: req.sreContext || 'no-context'
  });
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
    // Iniciar o servidor
    server.listen(PORT, '0.0.0.0', () => {
      const protocol = process.env.NODE_ENV === 'production' ? 'HTTP' : 'HTTPS';
      console.log(`Servidor ${protocol} rodando na porta ${PORT}`);
      
      // Inicia o Worker de SRE (Diagnósticos IA)
      startSreWorker();
    });
  })
  .catch(err => {
    console.error('Falha ao inicializar o servidor:', err);
    process.exit(1);
  });

// Shutdown graceful
gracefulShutdown(server);