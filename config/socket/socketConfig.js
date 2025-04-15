// config/socketConfig.js
const socketIo = require('socket.io');
const { logger } = require('../../logger');
const socketManager = require('./socketManager');
const socketAuthMiddleware = require('./middleware/authMiddleware');
const socketLoggingMiddleware = require('./middleware/loggingMiddleware');
const registerMessageHandlers = require('./handlers/messageHandlers');
const { registerNotificationHandlers } = require('./handlers/notificationHandlers');
const { registerPresenceHandlers } = require('./handlers/presenceHandlers');
const { SYSTEM_EVENTS } = require('./socketEvents');

module.exports = (server) => {
  // Configuração do Socket.IO com opções de CORS e cookies
  const io = socketIo(server, {
    cors: {
      origin: process.env.NODE_ENV === 'production' 
        ? process.env.FRONTEND_URL 
        : 'https://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
      transports: ['websocket', 'polling']
    },
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

    // Registrar handlers para cada grupo de funcionalidade
    registerMessageHandlers(socket, userId);
    registerNotificationHandlers(socket, userId);
    registerPresenceHandlers(socket, userId, socket.connectionInfo);

    // Handler de desconexão
    socket.on('disconnect', (reason) => {
      logger.info('WebSocket Disconnected:', {
        service: 'websocket',
        function: 'disconnect',
        socketId: socket.id,
        userId,
        reason
      });

      // Remover o socket do gerenciador
      socketManager.removeSocket(socket.id);
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

    // Evento de reconexão
    socket.on('reconnect_attempt', (attemptNumber) => {
      logger.info('WebSocket Reconnect Attempt:', {
        service: 'websocket',
        function: 'reconnect_attempt',
        socketId: socket.id,
        userId,
        attemptNumber
      });
    });

    // Adicionar monitoramento de saúde do sistema
    setupHealthMonitoring(socket, userId);
  });

  // Monitoramento periódico do sistema de socket
  setupSystemMonitoring(io);

  // Manipulação de encerramento gracioso
  setupGracefulShutdown(io);

  return io;
};

/**
 * Configura monitoramento de saúde para um cliente específico
 * @param {SocketIO.Socket} socket - Socket do cliente
 * @param {string} userId - ID do usuário
 */
function setupHealthMonitoring(socket, userId) {
  // Ping-pong personalizado para clientes
  const heartbeatInterval = setInterval(() => {
    // Verificar se o socket ainda está conectado
    if (!socket.connected) {
      clearInterval(heartbeatInterval);
      return;
    }

    // Enviar ping e esperar resposta
    const startTime = Date.now();
    socket.emit('ping', { timestamp: startTime }, () => {
      const latency = Date.now() - startTime;
      
      // Armazenar latência nas métricas do socket (se existirem)
      if (socket.metrics) {
        socket.metrics.latency = latency;
      }
      
      // Registrar apenas se latência for alta (para evitar excesso de logs)
      if (latency > 200) {
        logger.warn('Alta latência detectada', {
          service: 'websocket',
          function: 'heartbeat',
          socketId: socket.id,
          userId,
          latencyMs: latency
        });
      }
    });
  }, 30000); // A cada 30 segundos

  // Limpar intervalo na desconexão
  socket.on('disconnect', () => {
    clearInterval(heartbeatInterval);
  });
}

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