// INDEX.JS LOADED
require('dotenv').config();

// ── BOOT-TIME ENVIRONMENT VALIDATION ──────────────────────────
// Fail fast in production if critical payment secrets are missing or misconfigured.
// Better a process.exit(1) than silent sandbox charges or phantom billing.
if (process.env.NODE_ENV === 'production') {
  const bootErrors = [];

  if (!process.env.ASAAS_API_URL) {
    bootErrors.push('ASAAS_API_URL is not set (would silently fallback to sandbox)');
  } else if (process.env.ASAAS_API_URL.includes('sandbox')) {
    bootErrors.push(`ASAAS_API_URL points to sandbox: ${process.env.ASAAS_API_URL}`);
  }

  if (!process.env.ASAAS_API_KEY) {
    bootErrors.push('ASAAS_API_KEY is not set');
  } else if (process.env.ASAAS_API_KEY.startsWith('$aact_hmlg_')) {
    bootErrors.push('ASAAS_API_KEY is a sandbox/homologation key ($aact_hmlg_)');
  }

  if (!process.env.ASAAS_WEBHOOK_TOKEN) {
    bootErrors.push('ASAAS_WEBHOOK_TOKEN is not set (webhook validation will fail)');
  }

  if (bootErrors.length > 0) {
    console.error('\n╔══════════════════════════════════════════════════╗');
    console.error('║  FATAL: Production environment misconfigured     ║');
    console.error('╚══════════════════════════════════════════════════╝');
    bootErrors.forEach(e => console.error(`  ✗ ${e}`));
    console.error('\nAborting. Fix secrets via: flyctl secrets set -a eloscloud-api\n');
    process.exit(1);
  }
}
// ── END BOOT VALIDATION ──────────────────────────────────────

// Polyfill WebSocket para Node.js < 22 (requerido por @supabase/realtime-js)
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = require('ws');
}

const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
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
const { startSreWorker, startBookingExpirationWorker, startGroupBookingWorker } = require('./sreWorker');
const { startReconciliationJob } = require('./config/jobs/reconciliationJob');
const { startRaffleExpirationJob } = require('./config/jobs/raffleExpirationJob');
const { startIcalSyncJob } = require('./config/jobs/icalSyncJob');
const { startGooglePlacesSyncJob } = require('./config/jobs/googlePlacesSyncJob');
const { startBillingTierCheckJob } = require('./config/jobs/billingTierCheckJob');
const { startBillingCollectionJob } = require('./config/jobs/billingCollectionJob');
const { startExemptionExpirationJob } = require('./config/jobs/exemptionExpirationJob');
const { startVestTrustEventsJob } = require('./config/jobs/vestTrustEventsJob');
const { startWebhookRetryJob } = require('./config/jobs/webhookRetryJob');
const { startPinExpirationJob } = require('./config/jobs/pinExpirationJob');
const { startAddonDeactivationJob } = require('./config/jobs/addonDeactivationJob');
const { startShippingTrackingPollerJob } = require('./config/jobs/shippingTrackingPollerJob');
const { startOpsMetricsSnapshotJob } = require('./config/jobs/opsMetricsSnapshotJob');
const { startFranchisePendingAlertJob } = require('./config/jobs/franchisePendingAlertJob');
const { startStuckOrdersAlertJob } = require('./config/jobs/stuckOrdersAlertJob');
const { startCaronaDocExpiryJob } = require('./config/jobs/caronaDocExpiryJob');
const { loadBlacklistCache, startCacheRefresh } = require('./utils/securityUtils');

const app = express();

// Trust proxy - CRÍTICO para deployment em plataformas como Render.com
if (process.env.NODE_ENV === 'production') {
  const bootErrors = [];

  // Escape hatch para ambientes não-produtivos (staging/homologação) que rodam
  // com NODE_ENV=production para manter cookies, CORS e SSL idênticos a produção.
  // Valor deliberadamente verboso — não se liga por acidente.
  const sandboxAck = process.env.ASAAS_SANDBOX_ACK === 'i-know-this-is-not-production';

  if (!process.env.ASAAS_API_URL) {
    bootErrors.push('ASAAS_API_URL is not set (would silently fallback to sandbox)');
  } else if (process.env.ASAAS_API_URL.includes('sandbox') && !sandboxAck) {
    bootErrors.push(`ASAAS_API_URL points to sandbox: ${process.env.ASAAS_API_URL}`);
  }

  if (!process.env.ASAAS_API_KEY) {
    bootErrors.push('ASAAS_API_KEY is not set');
  } else if (process.env.ASAAS_API_KEY.startsWith('$aact_hmlg_') && !sandboxAck) {
    bootErrors.push('ASAAS_API_KEY is a sandbox/homologation key ($aact_hmlg_)');
  }

  if (!process.env.ASAAS_WEBHOOK_TOKEN) {
    bootErrors.push('ASAAS_WEBHOOK_TOKEN is not set (webhook validation will fail)');
  }

  if (bootErrors.length > 0) {
    console.error('\n╔══════════════════════════════════════════════════╗');
    console.error('║  FATAL: Production environment misconfigured     ║');
    console.error('╚══════════════════════════════════════════════════╝');
    bootErrors.forEach(e => console.error(`  ✗ ${e}`));
    console.error('\nAborting. Fix secrets via: flyctl secrets set -a eloscloud-api\n');
    process.exit(1);
  }

  if (sandboxAck) {
    console.warn('\n╔══════════════════════════════════════════════════╗');
    console.warn('║  ⚠️  ASAAS_SANDBOX_ACK ATIVO                      ║');
    console.warn('║  Pagamentos em modo sandbox. Se esta app atende  ║');
    console.warn('║  clientes reais, REMOVA este secret agora.       ║');
    console.warn('╚══════════════════════════════════════════════════╝\n');
  }
} else {
  logger.info('Trust proxy disabled for development', { service: 'index' });
}

// Configurações de Servidor (SSL/Certificados)
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

// Documentação Swagger — apenas em desenvolvimento (nunca expor em produção)
if (process.env.NODE_ENV !== 'production') {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));
}

// Middleware: bloqueia requests de usuários suspensos (após auth, antes de rotas)
const requireActiveUser = require('./middlewares/requireActiveUser');
app.use(requireActiveUser);

// Configuração de Rotas
setupRoutes(app);

// Página inicial de status
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: 'ElosCloud API em funcionamento',
    environment: process.env.NODE_ENV || 'development',
    version: '2.0.0',
    timestamp: new Date().toISOString()
  });
});

// Health check para monitors
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', uptime: process.uptime() });
});

// Middleware de tratamento de erros
app.use((err, req, res, next) => {
  logger.error('Erro não tratado na aplicação', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    correlationId: req.correlationId,
    sreContext: req.sreContext || 'no-context'
  });
  res.status(500).json({ 
    error: 'Erro interno do servidor',
    correlationId: req.correlationId
  });
});

// Inicialização do servidor
const PORT = process.env.PORT || 9000;
Promise.all([
  initializeLocalStorage(),
  secretsManager.initialize(), // Adicionar inicialização do secretsManager
  encryptionService.initialized, // Aguardar inicialização do serviço de criptografia
  loadBlacklistCache(), // ADM-070: carregar blacklist do Supabase para cache in-memory
])
  .then(() => {
    // Iniciar o servidor
    server.listen(PORT, '0.0.0.0', () => {
      const protocol = process.env.NODE_ENV === 'production' ? 'HTTP' : 'HTTPS';
      console.log(`Servidor ${protocol} rodando na porta ${PORT}`);
      
      // Inicia o Worker de SRE (Diagnósticos IA)
      startSreWorker();
      // Inicia o Worker de expiração de agendamentos (a cada 15min)
      startBookingExpirationWorker();
      // [SCHED-CAP-004/006] Confirmação automática de turmas + cancelamento por deadline (a cada 15min)
      startGroupBookingWorker();
      // PAY-H0-004: Inicia jobs de reconciliação PIX (DLQ + scan periódico)
      startReconciliationJob();
      // JOGOS-OPS-001: Libera bilhetes de rifa expirados a cada 5min
      startRaffleExpirationJob();
      // ICAL-SYNC: Sincroniza calendarios iCal de plataformas externas a cada 30min
      startIcalSyncJob();
      // GP-5: Sync periodico Google Places (rating, horarios, status) — diario 05:00 BRT
      startGooglePlacesSyncJob();
      // v2.1 Billing: tier check (06:00), cobranca basico (07:00), expiracao isencoes (08:00)
      startBillingTierCheckJob();
      startBillingCollectionJob();
      startExemptionExpirationJob();
      // Add-on deactivation: desativa add-ons expirados (08:30 BRT)
      startAddonDeactivationJob();
      // Trust Marketplace: vesting de trust events a cada hora
      startVestTrustEventsJob();
      // Webhook retry: re-tentativa de webhooks falhados a cada 5min
      startWebhookRetryJob();
      // ICON-PIN: expiracao de PINs efemeros a cada 5min
      startPinExpirationJob();
      // SHIP-004: Polling de rastreio Melhor Envio a cada 30min
      startShippingTrackingPollerJob();
      // OPS-001: Snapshot diario de metricas de negocio (06:00 BRT)
      startOpsMetricsSnapshotJob();
      // ADM-070: Refresh periodico do cache de blacklist (a cada 5min)
      startCacheRefresh();
      // Franchise pending alert: alerta admin se franchise_pending stale >24h (09:00 BRT)
      startFranchisePendingAlertJob();
      // ADM-027: Alerta de pedidos travados >24h (a cada 6h)
      startStuckOrdersAlertJob();
      // CARONA-GAP-007: Validade de documentos de motoristas (diario 08:00 BRT)
      startCaronaDocExpiryJob();
      // Poller durável de delivery: recovery + matching contínuo a cada 60s
      const { startDeliveryPoller } = require('./services/deliveryService');
      startDeliveryPoller();

      // [FISCAL-004] Job periódico de prazos fiscais (a cada 30min)
      const fiscalService = require('./services/fiscalService');
      setInterval(() => {
        fiscalService.runDeadlineNotificationJob().catch(err =>
          console.warn('[fiscal] runDeadlineNotificationJob falhou:', err.message)
        );
      }, 30 * 60 * 1000);
    });
  })
  .catch(err => {
    console.error('Falha ao inicializar o servidor:', err);
    process.exit(1);
  });

// Shutdown graceful
gracefulShutdown(server);
