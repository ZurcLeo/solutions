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
    
    // Eventos de reações
    REACT_MESSAGE: 'react_message',                   // Cliente envia/remove reação
    REACTION_UPDATED: 'reaction_updated',             // Servidor notifica atualização de reação

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
  
  // Eventos de postagens (feed em tempo real)
  const POST_EVENTS = {
    COMMENT_ADDED:    'post:comment_added',    // Novo comentário em um post
    COMMENT_LIKED:    'post:comment_liked',    // Like/unlike em comentário
    REACTION_TOGGLED: 'post:reaction_toggled', // Curtida adicionada ou removida
    POST_CREATED:     'post:created',          // Novo post publicado
    POST_DELETED:     'post:deleted',          // Post removido
    POST_UPDATED:     'post:updated',          // Post editado
  };

  // Eventos de gamificação (progresso, XP, selos, streak, economia)
  const GAMIFICATION_EVENTS = {
    XP_GAINED:       'gamification:xp_gained',       // XP concedido ao usuário
    TASK_PROGRESS:   'gamification:task_progress',   // Progresso parcial em tarefa multi-etapa
    TASK_COMPLETED:  'gamification:task_completed',  // Tarefa concluída
    LEVEL_UP:        'gamification:level_up',        // Usuário subiu de nível
    SELO_GRANTED:    'gamification:selo_granted',    // Novo selo conquistado
    COINS_GAINED:    'gamification:coins_gained',    // EloCoins ganhos
    COINS_SPENT:     'gamification:coins_spent',     // EloCoins gastos (boost, gorjeta, etc.)
    STREAK_UPDATED:  'gamification:streak_updated',  // Streak diário atualizado
    BOOST_ACTIVATED: 'gamification:boost_activated', // Boost de conteúdo ativado
    GIFT_RECEIVED:   'gamification:gift_received',   // Gift/sticker recebido pelo usuário
  };

  // Eventos de suporte (tickets, SLA, atribuição)
  const SUPPORT_EVENTS = {
    TICKET_CREATED:       'support:ticket_created',       // Novo ticket aberto (→ sala support-agents)
    TICKET_UPDATED:       'support:ticket_updated',       // Nota/status adicionado (→ sala support-agents + dono)
    TICKET_ASSIGNED:      'support:ticket_assigned',      // Ticket assumido por agente
    TICKET_RESOLVED:      'support:ticket_resolved',      // Ticket resolvido (→ dono)
    TICKET_STATUS_CHANGED:'support:ticket_status_changed',// Mudança manual de status
  };

  // Eventos de delivery (módulo de entrega hiper-local)
  const DELIVERY_EVENTS = {
    // ── Cliente → Servidor ────────────────────────────────
    GO_ONLINE:        'delivery:go_online',        // Entregador liga disponibilidade + posição
    GO_OFFLINE:       'delivery:go_offline',        // Entregador desliga disponibilidade
    LOCATION_UPDATE:  'delivery:location_update',   // Atualização de posição (enquanto ativo)
    HEARTBEAT:        'delivery:heartbeat',          // Keepalive da sessão (estende TTL 45min)
    ACCEPT_REQUEST:   'delivery:accept_request',    // Entregador aceita pedido
    DECLINE_REQUEST:  'delivery:decline_request',   // Entregador recusa pedido
    CONFIRM_STEP:     'delivery:confirm_step',       // Confirma etapa da entrega
    JOIN_ORDER_ROOM:  'delivery:join_order_room',   // Entra na sala de rastreio do pedido
    LEAVE_ORDER_ROOM: 'delivery:leave_order_room',  // Sai da sala de rastreio
    // Re-leilão [DELIVERY-006]
    FREIGHT_ADJUSTMENT_APPROVE: 'delivery:freight_adjustment_approve', // Cliente aprova frete maior
    FREIGHT_ADJUSTMENT_REJECT:  'delivery:freight_adjustment_reject',  // Cliente recusa frete maior

    // ── Servidor → Cliente ────────────────────────────────
    SESSION_CONFIRMED:  'delivery:session_confirmed',   // Sessão iniciada/atualizada com sucesso
    SESSION_ENDED:      'delivery:session_ended',        // Sessão encerrada
    NEW_REQUEST:        'delivery:new_request',           // Novo pedido de entrega disponível
    REQUEST_ACCEPTED:   'delivery:request_accepted',     // Pedido aceito (→ vendedor + comprador)
    REQUEST_DECLINED:   'delivery:request_declined',     // Pedido recusado pelo entregador
    REQUEST_EXPIRED:    'delivery:request_expired',      // Pedido expirou sem aceite
    STEP_CONFIRMED:     'delivery:step_confirmed',        // Etapa confirmada com sucesso
    STATUS_UPDATE:      'delivery:status_update',         // Mudança de status (→ order room)
    DELIVERER_LOCATION: 'delivery:deliverer_location',   // Posição do entregador (→ order room)
    ERROR:              'delivery:error',                  // Erro específico de delivery
    // Re-leilão [DELIVERY-006]
    GRACE_PERIOD_STARTED:       'delivery:grace_period_started',       // Entregador desconectou; grace ativo
    DELIVERER_RECONNECTED:      'delivery:deliverer_reconnected',      // Entregador reconectou no prazo
    RE_AUCTION_STARTED:         'delivery:re_auction_started',         // Grace expirou; buscando novo entregador
    FREIGHT_ADJUSTMENT_REQUIRED:'delivery:freight_adjustment_required',// Novo frete requer aprovação do cliente
    FREIGHT_ADJUSTMENT_RESULT:  'delivery:freight_adjustment_result',  // Resultado da aprovação/rejeição
    HOLD_MANUAL:                'delivery:hold_manual',                // Sem resolução; lojista deve intervir
    FAILED_NO_DELIVERER:        'delivery:failed_no_deliverer',        // Sem entregador após 10min
    // RTREAL-004: constante ausente declarada em deliveryHandlers mas não no contrato
    JOINED_ORDER_ROOM:          'delivery:joined_order_room',          // Confirmação de entrada na order room
  };

  // Eventos de carona solidária (módulo de mobilidade compartilhada)
  const CARONA_EVENTS = {
    // ── Cliente → Servidor ────────────────────────────────
    JOIN_RIDE_ROOM:    'carona:join_ride_room',    // Passageiro/motorista entra na room da viagem
    LEAVE_RIDE_ROOM:   'carona:leave_ride_room',   // Sai da room da viagem
    LOCATION_UPDATE:   'carona:location_update',   // Motorista envia posição durante viagem ativa

    // ── Servidor → Cliente (emitidos pelo caronaService) ──
    SEAT_BOOKED:           'carona:seat_booked',           // → motorista: nova reserva
    SEAT_CANCELLED:        'carona:seat_cancelled',        // → motorista: reserva cancelada
    RIDE_DEPARTED:         'carona:ride_departed',          // → passageiros: motorista partiu
    RIDE_CANCELLED:        'carona:ride_cancelled',         // → passageiros: viagem cancelada
    RIDE_UPDATED:          'carona:ride_updated',           // → passageiros: viagem editada
    PASSENGER_BOARDED:     'carona:passenger_boarded',      // → ride room: passageiro embarcou
    PASSENGER_ALIGHTED:    'carona:passenger_alighted',     // → ride room: passageiro desembarcou
    RATING_REQUESTED:      'carona:rating_requested',       // → ambos: pós-viagem
    RATING_RECEIVED:       'carona:rating_received',        // → avaliado: recebeu nota
    DRIVER_LOCATION:       'carona:driver_location',        // → ride room: posição do motorista
    ERROR:                 'carona:error',                   // Erro específico de carona
  };

  // Eventos de jogos (módulo de jogos: SELECTION_LIST, SECRET_FRIEND, RAFFLE)
  const GAME_EVENTS = {
    // ── Cliente → Servidor ────────────────────────────────
    JOIN:  'game:join',   // Entra na room do jogo (verifica participação/ownership)
    LEAVE: 'game:leave',  // Sai da room do jogo

    // ── Servidor → Cliente ────────────────────────────────
    ITEM_CLAIMED:       'game:item_claimed',       // Item da selection_list escolhido
    ITEM_RELEASED:      'game:item_released',       // Claim de item removido
    DRAW_DONE:          'game:draw_done',           // Sorteio concluído (SECRET_FRIEND / RAFFLE)
    PARTICIPANT_JOINED: 'game:participant_joined',  // Novo participante confirmado
    INVITE_RECEIVED:    'game:invite_received',     // Convite recebido (→ user personal room)
    JOIN_SUCCESS:       'game:join_success',        // Confirmação de entrada na room
    JOIN_ERROR:         'game:join_error',          // Erro ao entrar na room
    ERROR:              'game:error',               // Erro genérico de domínio de jogos
  };

  // Eventos de operacoes (painel admin: Kanban, metricas, presenca)
  const OPS_EVENTS = {
    // ── Servidor → Cliente (emitidos pelo opsTaskService e agentPresenceService) ──
    TASK_CREATED:           'ops:task_created',
    TASK_UPDATED:           'ops:task_updated',
    TASK_MOVED:             'ops:task_moved',
    TASK_ASSIGNED:          'ops:task_assigned',
    TASK_COMMENTED:         'ops:task_commented',
    TASK_ARCHIVED:          'ops:task_archived',
    AGENT_PRESENCE_UPDATE:  'ops:agent_presence_update',
    METRICS_REFRESH:        'ops:metrics_refresh',

    // ── Cliente → Servidor ────────────────────────────────
    REQUEST_AGENT_PRESENCE: 'ops:request_agent_presence',
  };

  // Eventos de agenda compartilhada (multi-role: admin, seller, user)
  const AGENDA_EVENTS = {
    TASK_CREATED:     'agenda:task_created',
    TASK_UPDATED:     'agenda:task_updated',
    TASK_RESCHEDULED: 'agenda:task_rescheduled',
    TASK_ASSIGNED:    'agenda:task_assigned',
    TASK_ARCHIVED:    'agenda:task_archived',
    BOOKING_CHANGED:  'agenda:booking_changed',
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
    GAMIFICATION_EVENTS,
    POST_EVENTS,
    SUPPORT_EVENTS,
    DELIVERY_EVENTS,
    CARONA_EVENTS,
    GAME_EVENTS,
    OPS_EVENTS,
    AGENDA_EVENTS,

    // Para acessar todos os eventos de forma plana
    ALL_EVENTS: {
      ...CONNECTION_EVENTS,
      ...CHAT_ROOM_EVENTS,
      ...MESSAGE_EVENTS,
      ...TYPING_EVENTS,
      ...NOTIFICATION_EVENTS,
      ...PRESENCE_EVENTS,
      ...SYSTEM_EVENTS,
      ...SYNC_EVENTS,
      ...GAMIFICATION_EVENTS,
      ...POST_EVENTS,
      ...SUPPORT_EVENTS,
      ...DELIVERY_EVENTS,
      ...CARONA_EVENTS,
      ...GAME_EVENTS,
      ...OPS_EVENTS,
      ...AGENDA_EVENTS,
    }
  };