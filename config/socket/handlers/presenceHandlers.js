/**
 * presenceHandlers.js
 * Manipuladores de eventos relacionados ao status de presença dos usuários no sistema.
 * Estes handlers gerenciam informações sobre quais usuários estão online/offline,
 * atualizações de status, e disseminação dessas informações para outros usuários.
 */

const { logger } = require('../../../logger');
const socketManager = require('../socketManager');
const { PRESENCE_EVENTS } = require('../socketEvents');
const userService = require('../../../services/userService'); // Adapte ao caminho real

// Armazenar informações de status para cada usuário
const userStatusMap = new Map();

/**
 * Estrutura de status do usuário
 * @typedef {Object} UserStatus
 * @property {boolean} online - Se o usuário está online
 * @property {string} status - Status personalizado (disponível, ausente, etc)
 * @property {number} lastActivity - Timestamp da última atividade
 * @property {string} lastSeen - Timestamp ISO da última vez online
 * @property {Object} device - Informações do dispositivo
 */

/**
 * Registra todos os handlers de presença para um socket
 * @param {SocketIO.Socket} socket - Socket do cliente
 * @param {string} userId - ID do usuário autenticado
 * @param {Object} connectionInfo - Informações adicionais da conexão
 */
function registerPresenceHandlers(socket, userId, connectionInfo = {}) {
  if (!socket || !userId) {
    logger.error('Tentativa de registrar handlers de presença sem socket ou userId válidos', {
      service: 'socket',
      function: 'registerPresenceHandlers',
      socketId: socket?.id,
      userId
    });
    return;
  }

  // Definir status inicial do usuário
  const initialStatus = {
    online: true,
    status: 'online',
    lastActivity: Date.now(),
    lastSeen: new Date().toISOString(),
    device: {
      type: connectionInfo.deviceType || 'unknown',
      browser: connectionInfo.browser || 'unknown',
      ip: connectionInfo.ip || 'unknown'
    }
  };
  
  // Atualizar status do usuário
  updateUserStatus(userId, initialStatus);
  
  // Broadcast status online (exceto para o próprio usuário)
  broadcastUserStatus(userId, true);

  // Handler para quando o usuário atualiza seu status (disponível, ausente, ocupado, etc)
  socket.on(PRESENCE_EVENTS.USER_STATUS_CHANGE, (statusData) => {
    try {
      if (!statusData || !statusData.status) {
        return;
      }

      // Validar status permitidos
      const allowedStatuses = ['online', 'away', 'busy', 'invisible', 'offline'];
      const newStatus = allowedStatuses.includes(statusData.status) 
        ? statusData.status 
        : 'online';
      
      logger.info('Usuário atualizou status', {
        service: 'socket',
        function: 'updateUserStatus',
        userId,
        newStatus,
        previousStatus: userStatusMap.get(userId)?.status || 'unknown'
      });

      // Atualizar o status armazenado
      const currentStatus = userStatusMap.get(userId) || initialStatus;
      updateUserStatus(userId, {
        ...currentStatus,
        status: newStatus,
        lastActivity: Date.now()
      });

      // Transmitir para amigos/conexões (exceto status "invisível")
      if (newStatus !== 'invisible') {
        broadcastUserStatus(userId, newStatus !== 'offline');
      }
      
      // Confirmar mudança para o usuário em todos seus dispositivos
      socketManager.emitToUser(userId, PRESENCE_EVENTS.USER_STATUS_CHANGE, {
        status: newStatus,
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error('Erro ao processar user_status_change', {
        service: 'socket',
        function: 'updateUserStatus',
        userId,
        error: error.message
      });
    }
  });

  // Handler para solicitar lista de usuários online
  socket.on(PRESENCE_EVENTS.GET_ONLINE_USERS, async (requestData) => {
    try {
      // Obter IDs de amigos/conexões relevantes para o usuário
      let relevantUserIds;
      
      if (requestData && Array.isArray(requestData.userIds)) {
        // Se o cliente especificou IDs específicos
        relevantUserIds = requestData.userIds;
      } else {
        // Caso contrário, obter conexões do usuário via serviço
        try {
          const connections = await userService.getUserConnections(userId);
          relevantUserIds = connections.map(conn => conn.userId);
        } catch (error) {
          logger.error('Erro ao obter conexões do usuário', {
            service: 'socket',
            function: 'getOnlineUsers',
            userId,
            error: error.message
          });
          relevantUserIds = [];
        }
      }
      
      // Filtrar para obter apenas usuários online
      const onlineUsers = relevantUserIds.filter(id => {
        const status = userStatusMap.get(id);
        return status && status.online && status.status !== 'invisible';
      });
      
      // Preparar dados de status para cada usuário online
      const onlineUsersData = onlineUsers.map(id => {
        const status = userStatusMap.get(id);
        return {
          userId: id,
          status: status.status,
          lastActivity: status.lastActivity
        };
      });
      
      // Responder com a lista
      socket.emit(PRESENCE_EVENTS.ONLINE_USERS_LIST, {
        users: onlineUsersData,
        timestamp: Date.now()
      });
      
      logger.info('Lista de usuários online enviada', {
        service: 'socket',
        function: 'getOnlineUsers',
        userId,
        count: onlineUsersData.length
      });
    } catch (error) {
      logger.error('Erro ao processar get_online_users', {
        service: 'socket',
        function: 'getOnlineUsers',
        userId,
        error: error.message
      });
    }
  });

  // Manter conexão ativa e atualizar timestamp de atividade
  const activityInterval = setInterval(() => {
    try {
      if (!socket.connected) {
        clearInterval(activityInterval);
        return;
      }
      
      // Atualizar timestamp de última atividade
      const status = userStatusMap.get(userId);
      if (status) {
        status.lastActivity = Date.now();
        userStatusMap.set(userId, status);
      }
    } catch (error) {
      logger.error('Erro no intervalo de atividade', {
        service: 'socket',
        function: 'activityInterval',
        userId,
        error: error.message
      });
    }
  }, 60000); // Atualizar a cada minuto

  // Limpar intervalo e atualizar status quando o socket desconectar
  socket.on('disconnect', () => {
    clearInterval(activityInterval);
    
    // Verificar se o usuário tem outros sockets conectados
    if (socketManager.getUserSockets(userId).length === 0) {
      // Se não tiver mais sockets, marcar como offline
      const status = userStatusMap.get(userId);
      if (status) {
        status.online = false;
        status.lastSeen = new Date().toISOString();
        userStatusMap.set(userId, status);
        
        // Persistir último status (opcional)
        try {
          userService.updateLastSeen(userId, status.lastSeen)
            .catch(error => {
              logger.error('Erro ao atualizar lastSeen do usuário', {
                service: 'socket',
                function: 'disconnect',
                userId,
                error: error.message
              });
            });
        } catch (error) {
          // Ignorar erros na persistência de último acesso
        }
        
        // Notificar outros usuários
        broadcastUserStatus(userId, false);
      }
    }
  });
}

/**
 * Atualiza o status de um usuário no mapa de status
 * @param {string} userId - ID do usuário
 * @param {UserStatus} status - Objeto de status do usuário
 */
function updateUserStatus(userId, status) {
  if (!userId || !status) return;
  
  userStatusMap.set(userId, {
    ...(userStatusMap.get(userId) || {}),
    ...status,
    lastUpdated: Date.now()
  });
}

/**
 * Transmite o status de um usuário para suas conexões
 * @param {string} userId - ID do usuário que teve status alterado
 * @param {boolean} isOnline - Se o usuário está online ou offline
 */
async function broadcastUserStatus(userId, isOnline) {
  try {
    // Obter conexões do usuário (amigos, seguidores, etc.)
    let connections = [];
    try {
      connections = await userService.getUserConnections(userId);
    } catch (error) {
      logger.error('Erro ao obter conexões para broadcast de status', {
        service: 'socket',
        function: 'broadcastUserStatus',
        userId,
        error: error.message
      });
      return;
    }
    
    // Extrair IDs de usuários conectados
    const connectionIds = connections.map(conn => conn.userId);
    
    // Obter status atual
    const status = userStatusMap.get(userId) || { status: isOnline ? 'online' : 'offline' };
    
    // Preparar payload
    const statusPayload = {
      userId,
      online: isOnline,
      status: status.status,
      lastActivity: status.lastActivity,
      timestamp: Date.now()
    };
    
    // Enviar para cada conexão
    for (const targetId of connectionIds) {
      socketManager.emitToUser(
        targetId,
        isOnline ? PRESENCE_EVENTS.USER_ONLINE : PRESENCE_EVENTS.USER_OFFLINE,
        statusPayload
      );
    }
    
    logger.info(`Status de usuário (${isOnline ? 'online' : 'offline'}) transmitido`, {
      service: 'socket',
      function: 'broadcastUserStatus',
      userId,
      connectionCount: connectionIds.length
    });
  } catch (error) {
    logger.error('Erro ao transmitir status de usuário', {
      service: 'socket',
      function: 'broadcastUserStatus',
      userId,
      isOnline,
      error: error.message
    });
  }
}

/**
 * Verifica se um usuário está online
 * @param {string} userId - ID do usuário
 * @returns {boolean} True se o usuário estiver online
 */
function isUserOnline(userId) {
  const status = userStatusMap.get(userId);
  return status?.online === true;
}

/**
 * Obtém o status atual de um usuário
 * @param {string} userId - ID do usuário
 * @returns {UserStatus|null} Objeto de status ou null se não encontrado
 */
function getUserStatus(userId) {
  return userStatusMap.get(userId) || null;
}

// Exportar handlers e funções utilitárias
module.exports = {
  registerPresenceHandlers,
  isUserOnline,
  getUserStatus,
  broadcastUserStatus
};