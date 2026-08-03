// config/socketConfig.js
const socketIo = require('socket.io');
const { logger } = require('../../logger');
const socketManager = require('./socketManager');
const socketAuthMiddleware = require('./middleware/authMiddleware');
const socketLoggingMiddleware = require('./middleware/loggingMiddleware');
const registerMessageHandlers = require('./handlers/messageHandlers');
const { registerNotificationHandlers } = require('./handlers/notificationHandlers');
const { registerPresenceHandlers } = require('./handlers/presenceHandlers');
const { registerDeliveryHandlers } = require('./handlers/deliveryHandlers');
const { registerGameHandlers } = require('./handlers/gameHandlers');
const { registerCaronaHandlers } = require('./handlers/caronaHandlers');
const { registerOpsHandlers } = require('./handlers/opsHandlers');
const { registerAgendaHandlers } = require('./handlers/agendaHandlers');
const { SYSTEM_EVENTS } = require('./socketEvents');

module.exports = (server) => {
  // Configuração do Socket.IO com opções de CORS e cookies
  // Origens permitidas — mesma lógica do middleware CORS do Express
  const productionOrigins = [
    'https://eloscloud.com',
    'https://api.eloscloud.com',
    process.env.FRONTEND_URL,
    process.env.CORS_ADDITIONAL_ORIGIN,
  ].filter(Boolean);

  const developmentOrigins = [
    'http://localhost:3000',
    'https://localhost:3000',
    'http://localhost:9000',
    'https://localhost:9000',
  ];

  const allowedOrigins = process.env.NODE_ENV === 'production'
    ? [...new Set(productionOrigins)]
    : [...new Set([...productionOrigins, ...developmentOrigins])];

  const io = socketIo(server, {
    cors: {
      origin: (origin, callback) => {
        // Permite requests sem origin (mobile, server-to-server)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        // Subdomínios eloscloud.com / eloscloud.com.br
        if (/^https:\/\/(.*\.)?eloscloud\.com(\.br)?$/.test(origin)) return callback(null, true);
        logger.warn('Socket.IO CORS blocked origin', { origin });
        return callback(new Error(`Origin '${origin}' not allowed`));
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    // Transports — websocket prioritário, polling como fallback
    transports: ['websocket', 'polling'],
    cookie: {
      name: 'io',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'none'
    },
    // Configurações adicionais para melhor desempenho e segurança
    pingTimeout: 60000, // 60 segundos de timeout para ping
    pingInterval: 25000, // 25 segundos entre pings
    upgradeTimeout: 10000, // 10 segundos de timeout para upgrade de conexão
    maxHttpBufferSize: 1e6, // 1MB tamanho máximo de pacote
    allowEIO3: true, // Permitir compatibilidade com Socket.IO v3
    serveClient: false // Não servir cliente, usar CDN no frontend
  });

  // Inicializar o SocketManager com a instância do io
  socketManager.initialize(io);

  // Aplicar middlewares globais
  io.use(socketLoggingMiddleware);
  io.use(socketAuthMiddleware);

  // Configuração dos eventos do Socket.io
  io.on('connection', (socket) => {
    const userId = socket.user?.id;
    
    if (!userId) {
      logger.warn('Conexão socket estabelecida sem autenticação', {
        service: 'websocket',
        function: 'connection',
        socketId: socket.id
      });
      
      // Emitir erro de autenticação e desconectar após pequeno delay
      socket.emit(SYSTEM_EVENTS.AUTHENTICATION_ERROR, {
        message: 'Authentication required',
        reconnect: true
      });
      
      setTimeout(() => {
        socket.disconnect(true);
      }, 3000);
      
      return;
    }

    logger.info('WebSocket Connection Established:', {
      service: 'websocket',
      function: 'connection',
      socketId: socket.id,
      userId,
      deviceType: socket.connectionInfo?.deviceType || 'unknown'
    });

    // Entrar na room do feed público — todos os autenticados recebem eventos de posts
    socket.join('feed:public');
    socketManager.addUserToRoom(userId, 'feed:public');

    // Entrar na room de suporte — apenas agentes e admins
    const supportRoles = ['suport', 'support', 'support_agent', 'admin', 'adm-master'];
    const userRoles = socket.user?.roles || [];
    if (userRoles.some(r => supportRoles.includes(r))) {
      socket.join('support-agents');
      socketManager.addUserToRoom(userId, 'support-agents');
      logger.info('Agente de suporte entrou na sala support-agents', {
        service: 'websocket', userId, roles: userRoles
      });
    }

    // RTREAL-003: Remover o socket do registry ANTES de registrar handlers de domínio.
    // Garante que presenceHandlers veja getUserSockets() já sem este socket ao detectar disconnect,
    // corrigindo a race condition que impedia o broadcast de user_offline.
    socket.on('disconnect', () => {
      socketManager.removeSocket(socket.id);
    });

    // Registrar handlers para cada grupo de funcionalidade
    registerMessageHandlers(socket, userId);
    registerNotificationHandlers(socket, userId);
    registerPresenceHandlers(socket, userId, socket.connectionInfo);
    registerDeliveryHandlers(socket, userId);
    registerGameHandlers(socket, userId);
    registerCaronaHandlers(socket, userId);

    // Ops handlers — apenas para admins (Kanban real-time + presenca)
    const adminRoles = ['admin', 'adm-master'];
    if (userRoles.some(r => adminRoles.includes(r))) {
      registerOpsHandlers(socket, userId);
    }

    // Agenda handlers — todos autenticados (user room + seller rooms)
    registerAgendaHandlers(socket, userId);

    // Logging de desconexão (executa por último, após removeSocket e handlers de domínio)
    socket.on('disconnect', (reason) => {
      logger.info('WebSocket Disconnected:', {
        service: 'websocket',
        function: 'disconnect',
        socketId: socket.id,
        userId,
        reason
      });
    });

    // Monitoramento de erros de socket
    socket.on('error', (error) => {
      logger.error('WebSocket Error:', {
        service: 'websocket',
        function: 'error',
        socketId: socket.id,
        userId,
        error: error.message
      });
    });

    // RTREAL-007: reconnect_attempt é evento client-side; nunca dispara no servidor. Removido.

  });

  // Monitoramento periódico do sistema de socket
  setupSystemMonitoring(io);

  // Manipulação de encerramento gracioso
  setupGracefulShutdown(io);

  return io;
};

/**
 * Configura monitoramento do sistema de socket
 * @param {SocketIO.Server} io - Instância do Socket.IO
 */
function setupSystemMonitoring(io) {
  const monitoringInterval = setInterval(() => {
    try {
      // Coletar estatísticas do sistema
      const connectedSockets = io.sockets.sockets.size;
      const rooms = io.sockets.adapter.rooms;
      const roomCount = rooms ? rooms.size : 0;
      
      // Obter estatísticas do SocketManager
      const onlineUsers = socketManager.getOnlineUsers().length;
      
      // Registrar métricas
      logger.info('Estatísticas do sistema de socket', {
        service: 'websocket',
        function: 'system_monitoring',
        connectedSockets,
        roomCount,
        onlineUsers,
        memoryUsage: process.memoryUsage().heapUsed,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Erro ao coletar estatísticas do sistema de socket', {
        service: 'websocket',
        function: 'system_monitoring',
        error: error.message
      });
    }
  }, 5 * 60 * 1000); // A cada 5 minutos

  // Armazenar intervalo para limpeza no encerramento
  global.socketMonitoringInterval = monitoringInterval;
}

/**
 * Configura rotinas para encerramento gracioso
 * @param {SocketIO.Server} io - Instância do Socket.IO
 */
function setupGracefulShutdown(io) {
  // Manipuladores para sinais de encerramento
  const shutdownHandler = (signal) => {
    logger.info(`Recebido sinal ${signal}, encerrando conexões Socket.IO`, {
      service: 'websocket',
      function: 'shutdown'
    });

    // Limpar intervalos de monitoramento
    if (global.socketMonitoringInterval) {
      clearInterval(global.socketMonitoringInterval);
    }

    // Notificar todos os clientes sobre o encerramento
    io.emit(SYSTEM_EVENTS.MAINTENANCE_NOTIFICATION, {
      message: 'Server maintenance, please reconnect in a few minutes',
      timestamp: Date.now()
    });

    // Dar um tempo para mensagens de notificação chegarem aos clientes
    setTimeout(() => {
      // Fechar todas as conexões
      io.close(() => {
        logger.info('Todas as conexões Socket.IO encerradas com sucesso', {
          service: 'websocket',
          function: 'shutdown'
        });
        
        // Desligar o SocketManager
        socketManager.shutdown();
      });
    }, 1000);
  };

  // Registrar handlers para sinais do sistema operacional
  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
  process.on('SIGINT', () => shutdownHandler('SIGINT'));
}