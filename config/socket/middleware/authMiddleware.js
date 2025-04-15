/**
 * authMiddleware.js
 * Middleware de autenticação para conexões Socket.IO.
 * Valida tokens de acesso e associa usuários autenticados aos sockets.
 */

const { logger } = require('../../../logger');
const socketManager = require('../socketManager');
const verifyIdToken = require('../../../middlewares/auth');
const { SYSTEM_EVENTS } = require('../socketEvents');

/**
 * Middleware de autenticação para Socket.IO
 * @param {SocketIO.Socket} socket - Socket do cliente
 * @param {Function} next - Função para continuar o pipeline de middleware
 */
function socketAuthMiddleware(socket, next) {
  try {
    // Extrair token de diferentes possíveis localizações
    const token = extractToken(socket);

    if (!token) {
      logger.warn('Tentativa de conexão socket sem token', {
        service: 'socket',
        function: 'authMiddleware',
        socketId: socket.id,
        ip: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent']
      });

      return next(new Error('Authentication token is required'));
    }

    // Validar o token
    verifyIdToken(token)
      .then(decoded => {
        if (!decoded || !decoded.uid) {
          throw new Error('Invalid token payload');
        }

        const userId = decoded.uid;

        // Armazenar informações do usuário no objeto socket
        socket.user = {
          id: userId,
          authenticated: true,
          roles: decoded.roles || [],
          authTime: Date.now()
        };

        // Registrar socket no gerenciador para este usuário
        socketManager.registerSocket(socket.id, userId);

        // Registrar informações de dispositivo/conexão
        const connectionInfo = {
          deviceType: detectDeviceType(socket),
          browser: socket.handshake.headers['user-agent'],
          ip: socket.handshake.address,
          timestamp: Date.now()
        };

        // Armazenar informações de conexão no socket
        socket.connectionInfo = connectionInfo;

        logger.info('Socket autenticado com sucesso', {
          service: 'socket',
          function: 'authMiddleware',
          socketId: socket.id,
          userId,
          deviceType: connectionInfo.deviceType
        });

        next();
      })
      .catch(error => {
        logger.error('Erro ao validar token para socket', {
          service: 'socket',
          function: 'authMiddleware',
          socketId: socket.id,
          error: error.message
        });

        // Emitir evento de erro (opcional)
        socket.emit(SYSTEM_EVENTS.AUTHENTICATION_ERROR, {
          message: 'Authentication failed',
          reconnect: true
        });

        next(new Error('Authentication failed: ' + error.message));
      });
  } catch (error) {
    logger.error('Exceção no middleware de autenticação do socket', {
      service: 'socket',
      function: 'authMiddleware',
      socketId: socket.id,
      error: error.message,
      stack: error.stack
    });

    next(new Error('Authentication error'));
  }
}

/**
 * Extrai token de autenticação de diferentes locais no request
 * @param {SocketIO.Socket} socket - Socket do cliente
 * @returns {string|null} Token encontrado ou null
 */
function extractToken(socket) {
  try {
    // Ordem de prioridade para encontrar token:
    // 1. Objeto de autenticação do handshake
    if (socket.handshake.auth && socket.handshake.auth.token) {
      return socket.handshake.auth.token;
    }

    // 2. Parâmetros de query
    if (socket.handshake.query && socket.handshake.query.token) {
      return socket.handshake.query.token;
    }

    // 3. Header de autorização
    const authHeader = socket.handshake.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // 4. Cookies (se disponível)
    if (socket.handshake.headers.cookie) {
      const cookies = parseCookies(socket.handshake.headers.cookie);
      if (cookies.accessToken) {
        return cookies.accessToken;
      }
    }

    return null;
  } catch (error) {
    logger.error('Erro ao extrair token', {
      service: 'socket',
      function: 'extractToken',
      socketId: socket.id,
      error: error.message
    });
    return null;
  }
}

/**
 * Analisa string de cookies em um objeto
 * @param {string} cookieString - String de cookies do header
 * @returns {Object} Objeto com os cookies
 */
function parseCookies(cookieString) {
  try {
    const cookies = {};
    cookieString.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        if (key) cookies[key] = value;
      }
    });
    return cookies;
  } catch (error) {
    return {};
  }
}

/**
 * Detecta o tipo de dispositivo com base no user-agent
 * @param {SocketIO.Socket} socket - Socket do cliente
 * @returns {string} Tipo de dispositivo ('mobile', 'tablet', 'desktop')
 */
function detectDeviceType(socket) {
  try {
    const userAgent = socket.handshake.headers['user-agent'] || '';
    
    // Expressões regulares simples para detecção básica
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    const isTablet = /tablet|ipad/i.test(userAgent);
    
    if (isTablet) return 'tablet';
    if (isMobile) return 'mobile';
    return 'desktop';
  } catch (error) {
    return 'unknown';
  }
}

module.exports = socketAuthMiddleware;