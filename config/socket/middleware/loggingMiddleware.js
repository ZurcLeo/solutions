/**
 * loggingMiddleware.js
 * Middleware de logging para conexões Socket.IO.
 * Registra eventos de conexão, desconexão e comunicação para fins de depuração e auditoria.
 */

const { logger } = require('../../../logger');

/**
 * Middleware de logging para Socket.IO
 * @param {SocketIO.Socket} socket - Socket do cliente
 * @param {Function} next - Função para continuar o pipeline de middleware
 */
function socketLoggingMiddleware(socket, next) {
  try {
    // Dados básicos de conexão
    const connectionData = {
      socketId: socket.id,
      ip: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent'],
      transport: socket.conn.transport.name,
      timestamp: new Date().toISOString()
    };

    // Registrar tentativa de conexão
    logger.info('Nova conexão Socket.IO iniciada', {
      service: 'socket',
      function: 'connect',
      ...connectionData
    });

    // Evento de conclusão de handshake
    socket.on('connect', () => {
      const userId = socket.user?.id || 'unauthenticated';
      
      logger.info('Conexão Socket.IO estabelecida', {
        service: 'socket',
        function: 'connect_complete',
        socketId: socket.id,
        userId,
        authenticated: !!socket.user
      });
    });

    // Registrar eventos de desconexão
    socket.on('disconnect', (reason) => {
      const userId = socket.user?.id || 'unauthenticated';
      const duration = socket.user ? (Date.now() - socket.user.authTime) : null;
      
      logger.info('Conexão Socket.IO encerrada', {
        service: 'socket',
        function: 'disconnect',
        socketId: socket.id,
        userId,
        reason,
        authenticated: !!socket.user,
        duration: duration ? `${Math.floor(duration / 1000)}s` : null
      });
    });

    // Registrar erros de conexão
    socket.on('error', (error) => {
      const userId = socket.user?.id || 'unauthenticated';
      
      logger.error('Erro em conexão Socket.IO', {
        service: 'socket',
        function: 'socket_error',
        socketId: socket.id,
        userId,
        error: error.message,
        stack: error.stack
      });
    });

    // Monitorar eventos (somente em ambiente de desenvolvimento ou configurável)
    if (process.env.NODE_ENV !== 'production' || process.env.SOCKET_DEBUG === 'true') {
      // Interceptar eventos recebidos para logging
      const originalOnevent = socket.onevent;
      socket.onevent = function(packet) {
        const userId = socket.user?.id || 'unauthenticated';
        const eventName = packet.data[0];
        const eventData = packet.data[1] || {};
        
        // Filtrar eventos sensíveis ou de alta frequência para evitar spam no log
        const sensitiveEvents = ['typing_status', 'heartbeat'];
        if (!sensitiveEvents.includes(eventName)) {
          logger.debug('Evento Socket.IO recebido', {
            service: 'socket',
            function: 'event_received',
            socketId: socket.id,
            userId,
            event: eventName,
            dataSize: JSON.stringify(eventData).length,
            timestamp: new Date().toISOString()
          });
        }
        
        originalOnevent.call(this, packet);
      };

      // Interceptar eventos enviados para logging
      const originalEmit = socket.emit;
      socket.emit = function(eventName, ...args) {
        const userId = socket.user?.id || 'unauthenticated';
        
        // Filtrar eventos sensíveis ou de alta frequência
        const sensitiveEvents = ['typing_status', 'heartbeat'];
        if (!sensitiveEvents.includes(eventName) && eventName !== 'error') {
          logger.debug('Evento Socket.IO enviado', {
            service: 'socket',
            function: 'event_sent',
            socketId: socket.id,
            userId,
            event: eventName,
            argsCount: args.length,
            timestamp: new Date().toISOString()
          });
        }
        
        return originalEmit.apply(this, [eventName, ...args]);
      };
    }

    // Configurar um monitor de atividade para estatísticas (opcional)
    setupActivityMonitor(socket);

    // Continuar para o próximo middleware
    next();
  } catch (error) {
    logger.error('Erro no middleware de logging do socket', {
      service: 'socket',
      function: 'loggingMiddleware',
      socketId: socket?.id,
      error: error.message,
      stack: error.stack
    });
    
    // Continuar apesar do erro no logging
    next();
  }
}

/**
 * Configura um monitor de atividade para o socket
 * @param {SocketIO.Socket} socket - Socket do cliente
 */
function setupActivityMonitor(socket) {
  try {
    // Inicializar métricas
    socket.metrics = {
      eventsReceived: 0,
      eventsSent: 0,
      bytesReceived: 0,
      bytesSent: 0,
      lastActivity: Date.now(),
      startTime: Date.now()
    };

    // Monitorar eventos recebidos
    const originalOnevent = socket.onevent;
    socket.onevent = function(packet) {
      socket.metrics.eventsReceived++;
      socket.metrics.lastActivity = Date.now();
      
      if (packet.data[1]) {
        const dataSize = JSON.stringify(packet.data[1]).length;
        socket.metrics.bytesReceived += dataSize;
      }
      
      originalOnevent.call(this, packet);
    };

    // Monitorar eventos enviados
    const originalEmit = socket.emit;
    socket.emit = function(event, ...args) {
      if (event !== 'error') {
        socket.metrics.eventsSent++;
        socket.metrics.lastActivity = Date.now();
        
        if (args.length > 0) {
          const dataSize = JSON.stringify(args).length;
          socket.metrics.bytesSent += dataSize;
        }
      }
      
      return originalEmit.apply(this, [event, ...args]);
    };

    // Registrar métricas periodicamente (a cada 5 minutos)
    if (process.env.NODE_ENV === 'production') {
      const metricsInterval = setInterval(() => {
        try {
          if (!socket.connected) {
            clearInterval(metricsInterval);
            return;
          }
          
          const userId = socket.user?.id || 'unauthenticated';
          const duration = Date.now() - socket.metrics.startTime;
          
          // Registrar estatísticas da conexão
          logger.info('Estatísticas de conexão Socket.IO', {
            service: 'socket',
            function: 'activity_metrics',
            socketId: socket.id,
            userId,
            durationSeconds: Math.floor(duration / 1000),
            eventsReceived: socket.metrics.eventsReceived,
            eventsSent: socket.metrics.eventsSent,
            bytesReceived: socket.metrics.bytesReceived,
            bytesSent: socket.metrics.bytesSent,
            idleTime: Date.now() - socket.metrics.lastActivity
          });
        } catch (error) {
          // Ignorar erros no registro de métricas
        }
      }, 5 * 60 * 1000); // 5 minutos
      
      // Limpar o intervalo no desconexão
      socket.on('disconnect', () => {
        clearInterval(metricsInterval);
      });
    }
  } catch (error) {
    // Ignorar erros na configuração do monitor
    logger.error('Erro ao configurar monitor de atividade do socket', {
      service: 'socket',
      function: 'setupActivityMonitor',
      socketId: socket.id,
      error: error.message
    });
  }
}

module.exports = socketLoggingMiddleware;