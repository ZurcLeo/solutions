/**
 * socketEvents.js
 * Define todas as constantes de eventos usados na comunicação via Socket.IO.
 * Este arquivo serve como um "contrato" entre frontend e backend para garantir
 * consistência na nomenclatura dos eventos.
 */

// Eventos de conexão/sessão
const CONNECTION_EVENTS = {
    CONNECT: 'connect',
    DISCONNECT: 'disconnect',
    ERROR: 'error',
    RECONNECT: 'reconnect',
    RECONNECT_ATTEMPT: 'reconnect_attempt'
  };
  
  // Eventos de chat/sala
  const CHAT_ROOM_EVENTS = {
    JOIN_CHAT: 'join_chat',         // Cliente solicita entrada em sala
    LEAVE_CHAT: 'leave_chat',       // Cliente solicita saída de sala
    JOIN_SUCCESS: 'join_success',   // Servidor confirma entrada
    JOIN_ERROR: 'join_error',       // Servidor reporta erro de entrada
    USER_JOINED: 'user_joined',     // Notifica outros sobre nova entrada
    USER_LEFT: 'user_left'          // Notifica outros sobre saída
  };
  
  // Eventos de mensagens
  const MESSAGE_EVENTS = {
    // Eventos do cliente para o servidor
    SEND_MESSAGE: 'send_message',           // Cliente envia mensagem
    DELETE_MESSAGE: 'delete_message',       // Cliente solicita exclusão
    
    // Eventos do servidor para o cliente
    NEW_MESSAGE: 'new_message',             // Nova mensagem recebida
    MESSAGE_DELETED: 'message_deleted',     // Mensagem foi excluída
    
    // Eventos de status de mensagem
    MESSAGE_STATUS_UPDATE: 'message_status_update',   // Atualização de status (lido/entregue)
    MESSAGE_DELIVERED: 'message_delivered',           // Mensagem entregue
    MESSAGE_READ: 'message_read',                     // Mensagem lida
    
    // Eventos de reconciliação
    RECONCILE_MESSAGE: 'reconcile_message',           // Reconciliação de mensagens temporárias
    MESSAGE_SEND_FAILED: 'message_send_failed'        // Falha ao enviar mensagem
  };
  
  // Eventos de digitação
  const TYPING_EVENTS = {
    TYPING_STATUS: 'typing_status',         // Status de digitação
    USER_TYPING: 'user_typing',             // Usuário está digitando
    USER_STOPPED_TYPING: 'user_stopped_typing'  // Usuário parou de digitar
  };
  
  // Eventos de notificação
  const NOTIFICATION_EVENTS = {
    NEW_NOTIFICATION: 'new_notification',       // Nova notificação
    NOTIFICATION_READ: 'notification_read',     // Marcar notificação como lida
    CLEAR_NOTIFICATIONS: 'clear_notifications'  // Limpar todas notificações
  };
  
  // Eventos de presença/status do usuário
  const PRESENCE_EVENTS = {
    USER_STATUS_CHANGE: 'user_status_change',   // Mudança de status (online/offline)
    USER_ONLINE: 'user_online',                 // Usuário ficou online
    USER_OFFLINE: 'user_offline',               // Usuário ficou offline
    USER_INACTIVE: 'user_inactive',             // Usuário inativo (ausente)
    GET_ONLINE_USERS: 'get_online_users',       // Solicitação de lista de usuários online
    ONLINE_USERS_LIST: 'online_users_list'      // Lista de usuários online
  };
  
  // Eventos de erro e sistema
  const SYSTEM_EVENTS = {
    AUTHENTICATION_ERROR: 'authentication_error',  // Erro de autenticação
    PERMISSION_ERROR: 'permission_error',          // Erro de permissão
    VALIDATION_ERROR: 'validation_error',          // Erro de validação de dados
    SERVER_ERROR: 'server_error',                  // Erro interno do servidor
    MAINTENANCE_NOTIFICATION: 'maintenance'        // Notificação de manutenção
  };
  
  // Eventos específicos para sincronização
  const SYNC_EVENTS = {
    REQUEST_SYNC: 'request_sync',                 // Solicitação de sincronização
    SYNC_COMPLETE: 'sync_complete',               // Sincronização concluída
    SYNC_FAILED: 'sync_failed'                    // Falha na sincronização
  };
  
  // Exportar todos os grupos de eventos
  module.exports = {
    CONNECTION_EVENTS,
    CHAT_ROOM_EVENTS,
    MESSAGE_EVENTS,
    TYPING_EVENTS,
    NOTIFICATION_EVENTS,
    PRESENCE_EVENTS,
    SYSTEM_EVENTS,
    SYNC_EVENTS,
    
    // Para acessar todos os eventos de forma plana
    ALL_EVENTS: {
      ...CONNECTION_EVENTS,
      ...CHAT_ROOM_EVENTS,
      ...MESSAGE_EVENTS,
      ...TYPING_EVENTS,
      ...NOTIFICATION_EVENTS,
      ...PRESENCE_EVENTS,
      ...SYSTEM_EVENTS,
      ...SYNC_EVENTS
    }
  };