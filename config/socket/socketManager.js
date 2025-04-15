/**
 * socketManager.js
 * Gerencia a instância do Socket.IO, mantém mapeamento de usuários para sockets,
 * e fornece funções utilitárias para comunicação via socket.
 */

const { logger } = require('../../logger');
const events = require('./socketEvents');

class SocketManager {
  constructor() {
    this.io = null;
    this.userSockets = new Map(); // userId -> Set of socket.ids
    this.socketUsers = new Map(); // socket.id -> userId
    this.userRooms = new Map();   // userId -> Set of rooms
    this.isInitialized = false;
  }

  /**
   * Inicializa o SocketManager com uma instância do Socket.IO
   * @param {SocketIO.Server} io - Instância do Socket.IO
   */
  initialize(io) {
    if (this.isInitialized) {
      logger.warn('SocketManager já foi inicializado', {
        service: 'socket',
        function: 'initialize'
      });
      return;
    }

    this.io = io;
    this.isInitialized = true;

    logger.info('SocketManager inicializado', {
      service: 'socket',
      function: 'initialize'
    });
  }

  /**
   * Registra um socket para um usuário
   * @param {string} socketId - ID do socket
   * @param {string} userId - ID do usuário
   */
  registerSocket(socketId, userId) {
    if (!socketId || !userId) {
      logger.warn('Tentativa de registrar socket sem socketId ou userId', {
        service: 'socket',
        function: 'registerSocket',
        socketId,
        userId
      });
      return;
    }

    // Registra o socket para o usuário
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId).add(socketId);

    // Mapeia o socket para o usuário
    this.socketUsers.set(socketId, userId);

    logger.info('Socket registrado para usuário', {
      service: 'socket',
      function: 'registerSocket',
      socketId,
      userId,
      activeSockets: this.userSockets.get(userId).size
    });
  }

  /**
   * Remove o registro de um socket
   * @param {string} socketId - ID do socket a ser removido
   */
  removeSocket(socketId) {
    if (!socketId) return;

    const userId = this.socketUsers.get(socketId);
    if (userId) {
      // Remove o socket da lista de sockets do usuário
      const userSocketSet = this.userSockets.get(userId);
      if (userSocketSet) {
        userSocketSet.delete(socketId);
        
        // Se não houver mais sockets para este usuário, remover entrada
        if (userSocketSet.size === 0) {
          this.userSockets.delete(userId);
          
          // Notificar outros usuários que este usuário está offline
          this.broadcastUserStatus(userId, false);
        }
      }
      
      // Remove o mapeamento socket -> usuário
      this.socketUsers.delete(socketId);

      logger.info('Socket removido do registro', {
        service: 'socket',
        function: 'removeSocket',
        socketId,
        userId,
        remainingSockets: userSocketSet ? userSocketSet.size : 0
      });
    }
  }

  /**
   * Retorna todos os sockets de um usuário
   * @param {string} userId - ID do usuário
   * @returns {Array} Array de objetos socket
   */
  getUserSockets(userId) {
    if (!userId || !this.userSockets.has(userId)) {
      return [];
    }

    const socketIds = Array.from(this.userSockets.get(userId));
    return socketIds.map(id => this.io.sockets.sockets.get(id)).filter(Boolean);
  }

  /**
   * Verifica se um usuário está online (tem pelo menos um socket conectado)
   * @param {string} userId - ID do usuário
   * @returns {boolean} True se o usuário estiver online
   */
  isUserOnline(userId) {
    return this.userSockets.has(userId) && this.userSockets.get(userId).size > 0;
  }

  /**
   * Registra que um usuário entrou em uma sala
   * @param {string} userId - ID do usuário
   * @param {string} room - Nome da sala
   */
  addUserToRoom(userId, room) {
    if (!userId || !room) return;
    
    if (!this.userRooms.has(userId)) {
      this.userRooms.set(userId, new Set());
    }
    this.userRooms.get(userId).add(room);

    logger.info('Usuário adicionado à sala', {
      service: 'socket',
      function: 'addUserToRoom',
      userId,
      room
    });
  }

  /**
   * Remove um usuário de uma sala
   * @param {string} userId - ID do usuário
   * @param {string} room - Nome da sala
   */
  removeUserFromRoom(userId, room) {
    if (!userId || !room) return;
    
    const userRooms = this.userRooms.get(userId);
    if (userRooms) {
      userRooms.delete(room);
      
      if (userRooms.size === 0) {
        this.userRooms.delete(userId);
      }

      logger.info('Usuário removido da sala', {
        service: 'socket',
        function: 'removeUserFromRoom',
        userId,
        room
      });
    }
  }

  /**
   * Lista todas as salas de um usuário
   * @param {string} userId - ID do usuário
   * @returns {Array} Array com os nomes das salas
   */
  getUserRooms(userId) {
    if (!userId || !this.userRooms.has(userId)) {
      return [];
    }
    return Array.from(this.userRooms.get(userId));
  }

  /**
   * Envia um evento para um usuário específico em todos os seus dispositivos
   * @param {string} userId - ID do usuário
   * @param {string} event - Nome do evento
   * @param {*} data - Dados a serem enviados
   * @returns {boolean} Sucesso do envio
   */
  emitToUser(userId, event, data) {
    if (!this.isInitialized || !userId || !event) {
      return false;
    }

    const sockets = this.getUserSockets(userId);
    if (sockets.length === 0) {
      logger.warn('Tentativa de emitir evento para usuário sem sockets conectados', {
        service: 'socket',
        function: 'emitToUser',
        userId,
        event
      });
      return false;
    }

    sockets.forEach(socket => {
      if (socket) {
        socket.emit(event, data);
      }
    });

    logger.info('Evento emitido para usuário', {
      service: 'socket',
      function: 'emitToUser',
      userId,
      event,
      socketCount: sockets.length
    });

    return true;
  }

  /**
   * Emite um evento para uma sala específica
   * @param {string} room - Nome da sala
   * @param {string} event - Nome do evento
   * @param {*} data - Dados a serem enviados
   */
  emitToRoom(room, event, data) {
    if (!this.isInitialized || !room || !event) {
      return false;
    }

    this.io.to(room).emit(event, data);

    logger.info('Evento emitido para sala', {
      service: 'socket',
      function: 'emitToRoom',
      room,
      event
    });

    return true;
  }

  /**
   * Emite um evento para todos os usuários conectados exceto o emissor
   * @param {string} senderUserId - ID do usuário emissor
   * @param {string} event - Nome do evento
   * @param {*} data - Dados a serem enviados
   */
  broadcastToAll(senderUserId, event, data) {
    if (!this.isInitialized || !event) {
      return false;
    }

    // Se houver um emissor, excluir seus sockets
    const excludeSockets = senderUserId ? this.getUserSockets(senderUserId) : [];
    const excludeIds = excludeSockets.map(socket => socket.id);

    for (const [userId, socketIds] of this.userSockets.entries()) {
      // Ignorar o emissor
      if (userId === senderUserId) continue;

      for (const socketId of socketIds) {
        // Verificar se este socket não está na lista de exclusão
        if (!excludeIds.includes(socketId)) {
          const socket = this.io.sockets.sockets.get(socketId);
          if (socket) {
            socket.emit(event, data);
          }
        }
      }
    }

    logger.info('Evento broadcast emitido', {
      service: 'socket',
      function: 'broadcastToAll',
      event,
      excludedUser: senderUserId
    });

    return true;
  }

  /**
   * Notifica todos os usuários sobre a mudança de status de um usuário
   * @param {string} userId - ID do usuário que mudou de status
   * @param {boolean} isOnline - Status online (true) ou offline (false)
   */
  broadcastUserStatus(userId, isOnline) {
    if (!userId) return;

    const statusEvent = isOnline 
      ? events.PRESENCE_EVENTS.USER_ONLINE 
      : events.PRESENCE_EVENTS.USER_OFFLINE;

    this.broadcastToAll(userId, statusEvent, { userId, timestamp: Date.now() });
  }

  /**
   * Retorna lista de usuários online
   * @returns {Array} Array com IDs dos usuários online
   */
  getOnlineUsers() {
    return Array.from(this.userSockets.keys());
  }

  /**
   * Desconecta todos os sockets de um usuário
   * @param {string} userId - ID do usuário
   */
  disconnectUser(userId) {
    if (!userId) return;

    const sockets = this.getUserSockets(userId);
    sockets.forEach(socket => {
      if (socket) {
        socket.disconnect(true);
      }
    });

    logger.info('Usuário desconectado forçadamente', {
      service: 'socket',
      function: 'disconnectUser',
      userId,
      socketCount: sockets.length
    });
  }

  /**
   * Limpa todas as informações quando o servidor é encerrado
   */
  shutdown() {
    this.userSockets.clear();
    this.socketUsers.clear();
    this.userRooms.clear();
    this.isInitialized = false;

    logger.info('SocketManager desligado', {
      service: 'socket',
      function: 'shutdown'
    });
  }
}

// Exporta uma instância singleton
module.exports = new SocketManager();