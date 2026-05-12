/**
 * @fileoverview Serviço para gerenciar tickets de suporte, incluindo criação, escalonamento, atribuição, resolução e notificações.
 * @module services/SupportService
 * @requires ../models/SupportTicket
 * @requires ../models/User
 * @requires ../models/Message
 * @requires ./SupportContextBuilder
 * @requires ./emailService
 * @requires ../logger
 */
const SupportTicket = require('../models/SupportTicket');
const User = require('../models/User');
const Message = require('../models/Message');
const SupportContextBuilder = require('./SupportContextBuilder');
const emailService = require('./emailService');
const { logger } = require('../logger');
// const notificationService = require('./NotificationService'); // If you have one

class SupportService {
  /**
   * Cria um novo ticket de suporte.
   * @async
   * @function createTicket
   * @param {Object} ticketRequest - Dados da solicitação do ticket.
   * @param {string} ticketRequest.userId - O ID do usuário que está abrindo o ticket.
   * @param {string} [ticketRequest.category='general'] - Categoria do problema (ex: 'financial', 'security', 'account').
   * @param {string} [ticketRequest.module='app'] - Módulo do aplicativo onde o problema ocorreu (ex: 'chat', 'caixinha').
   * @param {string} [ticketRequest.issueType='other'] - Tipo específico do problema dentro da categoria.
   * @param {string} [ticketRequest.title] - Título do ticket (será gerado se não fornecido).
   * @param {string} [ticketRequest.description='Solicitação de suporte'] - Descrição detalhada do problema.
   * @param {Object} [ticketRequest.context={}] - Contexto adicional relevante para o ticket.
   * @param {Object} [ticketRequest.deviceInfo={}] - Informações do dispositivo do usuário.
   * @param {string} [ticketRequest.userAgent=''] - User-Agent do cliente.
   * @param {Object} [ticketRequest.sessionData={}] - Dados da sessão do usuário.
   * @returns {Promise<Object>} Um objeto com `success`, `message`, `ticketId`, `priority` e `category`.
   * @throws {Error} Se o ID do usuário não for fornecido ou o usuário não for encontrado.
   * @description Processa a criação de um novo ticket de suporte, incluindo a construção de contexto, cálculo de prioridade, criação do ticket no banco de dados e envio de notificações.
   */
  async createTicket(ticketRequest) {
    const { userId, category, module, issueType, title, description, context = {}, deviceInfo = {}, userAgent = '', sessionData = {} } = ticketRequest;
    
    logger.info(`Creating support ticket for user ${userId}`, {
      category, module, issueType, service: 'SupportService', method: 'createTicket'
    });

    if (!userId) {
      throw new Error('User ID is required to create a support ticket.');
    }

    const user = await User.getById(userId);
    if (!user) {
      logger.error(`User ${userId} not found for ticket creation.`);
      throw new Error('User not found.');
    }

    // Build comprehensive context
    const ticketContext = await SupportContextBuilder.buildContext(
      userId, 
      category || 'general', 
      module || 'app', 
      issueType || 'other',
      context
    );

    // Determine priority based on category, issue type, and user context
    const priority = this._calculatePriorityV2(category, issueType, ticketContext.user, description);

    const ticketData = {
      userId,
      userName: user.nome || user.displayName || 'Usuário Desconhecido',
      userEmail: user.email || '',
      userPhotoURL: user.fotoDoPerfil || '',
      category: category || 'general',
      module: module || 'app',
      issueType: issueType || 'other',
      title: title || this._generateTitle(category, issueType),
      description: description || 'Solicitação de suporte',
      context: ticketContext,
      priority,
      status: 'pending',
      deviceInfo,
      userAgent,
      sessionData,
      // Legacy fields for backward compatibility
      lastMessageSnippet: description ? description.substring(0, 100) : '',
    };

    const ticket = await SupportTicket.create(ticketData);

    // Send notifications
    await Promise.all([
      this._notifySupportAccount(ticket),
      this._sendTicketCreatedEmail(ticket, user)
    ]);

    logger.info(`Support ticket ${ticket.id} created successfully`, {
      ticketId: ticket.id,
      userId,
      category,
      module,
      issueType,
      priority,
      service: 'SupportService'
    });

    return { 
      success: true, 
      message: 'Support ticket created successfully.', 
      ticketId: ticket.id,
      priority: ticket.priority,
      category: ticket.category
    };
  }

  /**
   * Solicita a escalonamento de uma conversa de chat para o suporte humano.
   * @async
   * @function requestEscalation
   * @param {string} conversationId - O ID da conversa de onde a escalada é solicitada.
   * @param {string} userId - O ID do usuário que está solicitando a escalada.
   * @param {string} [reason='ai_cannot_help'] - O motivo da escalada.
   * @returns {Promise<Object>} Um objeto com `success`, `message` e o `ticketId` da nova escalada ou da escalada já em andamento.
   * @throws {Error} Se o ID da conversa ou do usuário não forem fornecidos, ou o usuário não for encontrado.
   * @description Cria um ticket de suporte específico para escalonamento de uma conversa com IA, incluindo o histórico da conversa como contexto.
   */
  async requestEscalation(conversationId, userId, reason = 'ai_cannot_help') {
    logger.info(`Requesting escalation for conv ${conversationId} by user ${userId}`, {
      service: 'SupportService', method: 'requestEscalation'
    });

    if (!conversationId || !userId) {
      throw new Error('Conversation ID and User ID are required for escalation.');
    }

    // Check for existing tickets for this conversation
    const existingOpenTickets = await SupportTicket.findByConversationId(conversationId);
    const alreadyOpen = existingOpenTickets.find(t => t.status === 'pending' || t.status === 'assigned');
    if (alreadyOpen) {
      logger.warn(`Escalation already pending/assigned for conv ${conversationId}`, { ticketId: alreadyOpen.id });
      return { success: true, message: 'Escalation already in progress.', ticketId: alreadyOpen.id, status: alreadyOpen.status };
    }

    const user = await User.getById(userId);
    if (!user) {
      logger.error(`User ${userId} not found for escalation request.`);
      throw new Error('User not found.');
    }

    // Get conversation context
    let conversationHistory = [];
    let lastMessageSnippet = 'Escalação solicitada via chat';
    try {
      const messages = await Message.getConversationMessages(conversationId, 10);
      if (messages && messages.length > 0) {
        conversationHistory = messages.map(m => ({
          content: m.content,
          sender: m.senderId,
          timestamp: m.timestamp
        }));
        lastMessageSnippet = messages[0].content ? messages[0].content.substring(0, 100) : 'Conteúdo indisponível';
      }
    } catch (e) {
      logger.warn(`Could not fetch conversation messages for ${conversationId}`, { error: e.message });
    }

    // Create ticket using new system but with conversation context
    const ticketRequest = {
      userId,
      category: 'general',
      module: 'chat',
      issueType: 'escalation_requested',
      title: 'Escalação do Chat com IA',
      description: `Usuário solicitou escalação durante conversa. Razão: ${reason}. Último trecho: ${lastMessageSnippet}`,
      context: {
        conversationId,
        reason,
        conversationHistory,
        escalationType: 'from_ai_chat'
      }
    };

    const result = await this.createTicket(ticketRequest);
    
    // Update ticket with conversation-specific data
    await SupportTicket.update(result.ticketId, {
      conversationId,
      conversationHistory,
      lastMessageSnippet // Legacy field
    });

    return result;
  }

  /**
   * Calcula a prioridade de um ticket de suporte usando uma lógica aprimorada (v2).
   * @private
   * @function _calculatePriorityV2
   * @param {string} category - Categoria do ticket.
   * @param {string} issueType - Tipo do problema.
   * @param {Object} user - Objeto do usuário, contendo seus papéis (roles).
   * @param {string} [description=''] - Descrição do problema.
   * @returns {('urgent'|'high'|'medium'|'low')} A prioridade calculada do ticket.
   * @description Utiliza palavras-chave no conteúdo, categoria, tipo de problema e papéis do usuário para determinar a prioridade do ticket de forma dinâmica.
   */
  _calculatePriorityV2(category, issueType, user, description = '') {
    const content = description.toLowerCase();
    
    // Urgent keywords that always trigger high priority
    const urgentKeywords = [
      'urgent', 'crítico', 'emergência', 'bloqueado', 'não funciona', 
      'erro grave', 'roubaram', 'golpe', 'fraude', 'hackeado', 'vazamento',
      'dinheiro sumiu', 'conta bloqueada', 'não consigo logar'
    ];
    
    // High priority keywords
    const highKeywords = [
      'importante', 'problema', 'bug', 'falha', 'não consigo', 
      'pagamento falhou', 'saldo incorreto', 'transferência não chegou',
      'cobrança indevida', 'estorno', 'reembolso'
    ];

    // Check urgent keywords first
    if (urgentKeywords.some(keyword => content.includes(keyword))) {
      return 'urgent';
    }

    // Category-based priority rules
    switch (category) {
      case 'security':
        return 'urgent'; // All security issues are urgent
      
      case 'financial':
        if (['payment_failed', 'balance_incorrect', 'withdrawal_failed'].includes(issueType)) {
          return 'high';
        }
        break;
        
      case 'account':
        if (['login_failed', 'account_locked'].includes(issueType)) {
          return 'high';
        }
        break;
        
      case 'loan':
        if (['payment_issue', 'approval_delayed'].includes(issueType)) {
          return 'high';
        }
        break;
    }

    // High priority keywords check
    if (highKeywords.some(keyword => content.includes(keyword))) {
      return 'high';
    }

    // User-based priority
    if (user && Array.isArray(user.roles) && (user.roles.includes('admin') || user.roles.includes('vip'))) {
      return 'high';
    }

    // Default priority based on category
    if (['financial', 'caixinha', 'loan'].includes(category)) {
      return 'medium';
    }

    return 'medium';
  }

  /**
   * Calcula a prioridade de um ticket de suporte (método legado).
   * @private
   * @function _calculatePriority
   * @param {string} messageContent - Conteúdo da mensagem que descreve o problema.
   * @param {Object} user - Objeto do usuário.
   * @deprecated Este método é legado; use `_calculatePriorityV2` em novas implementações.
   * @returns {('high'|'medium'|'low')} A prioridade calculada do ticket.
   * @description Método de compatibilidade reversa para cálculo de prioridade.
   */
  _calculatePriority(messageContent, user) {
    const urgentKeywords = ['urgent', 'crítico', 'emergência', 'bloqueado', 'não funciona', 'erro', 'problema grave', 'roubaram', 'golpe', 'fraude'];
    const highKeywords = ['importante', 'problema', 'bug', 'falha', 'não consigo', 'pagamento falhou', 'saldo incorreto', 'transferência não chegou'];
    
    const content = messageContent.toLowerCase();
    
    if (urgentKeywords.some(keyword => content.includes(keyword))) {
      return 'high';
    }
    
    if (highKeywords.some(keyword => content.includes(keyword))) {
      return 'medium';
    }
    
    if (user && user.isOwnerOrAdmin) {
      return 'high';
    }
    
    return 'medium';
  }

    /**
   * Gera um título padrão para o ticket com base na categoria e tipo de problema.
   * @private
   * @function _generateTitle
   * @param {string} category - A categoria do ticket.
   * @param {string} issueType - O tipo de problema.
   * @returns {string} O título gerado para o ticket.
   * @description Mapeia combinações de categoria e tipo de problema para títulos descritivos.
   */
  _generateTitle(category, issueType) {
    const titleMap = {
      financial: {
        payment_failed: 'Problema com Pagamento',
        balance_incorrect: 'Saldo Incorreto',
        refund_needed: 'Solicitação de Reembolso',
        withdrawal_failed: 'Falha no Saque',
        charge_dispute: 'Contestação de Cobrança'
      },
      caixinha: {
        cant_contribute: 'Problema para Contribuir',
        member_issue: 'Problema com Membro',
        payout_problem: 'Problema no Pagamento da Caixinha',
        group_access: 'Problema de Acesso ao Grupo',
        invite_problem: 'Problema com Convite'
      },
      loan: {
        approval_delayed: 'Atraso na Aprovação do Empréstimo',
        payment_issue: 'Problema no Pagamento do Empréstimo',
        terms_dispute: 'Contestação dos Termos',
        interest_calculation: 'Problema no Cálculo de Juros'
      },
      account: {
        login_failed: 'Problema de Login',
        account_locked: 'Conta Bloqueada',
        data_update_failed: 'Falha na Atualização dos Dados',
        verification_issue: 'Problema de Verificação',
        password_reset: 'Redefinição de Senha'
      },
      technical: {
        app_crash: 'Aplicativo Travando',
        sync_error: 'Erro de Sincronização',
        performance_issue: 'Problema de Performance',
        api_error: 'Erro de Sistema',
        feature_not_working: 'Funcionalidade não Funciona'
      },
      security: {
        account_compromised: 'Conta Comprometida',
        suspicious_activity: 'Atividade Suspeita',
        fraud_report: 'Relatório de Fraude',
        unauthorized_access: 'Acesso não Autorizado'
      }
    };

    return titleMap[category]?.[issueType] || 'Solicitação de Suporte';
  }

  /**
   * Determina se uma mensagem ou solicitação deve ser escalada automaticamente para um agente humano.
   * @function shouldEscalateToHuman
   * @param {string} content - O conteúdo da mensagem ou descrição do problema.
   * @param {Object} [userContext=null] - Contexto adicional do usuário que pode influenciar a decisão de escalada.
   * @returns {boolean} `true` se a escalada for recomendada, `false` caso contrário.
   * @description Analisa palavras-chave, tipos de problemas específicos (financeiro, segurança, técnico) e o contexto do usuário para decidir se a intervenção humana é necessária.
   */
  shouldEscalateToHuman(content, userContext = null) {
    const lowerContent = content.toLowerCase();
    
    // Palavras-chave que sempre requerem escalação
    const escalationKeywords = [
      'falar com', 'quero falar', 'atendente', 'humano', 'pessoa',
      'suporte técnico', 'reclamação', 'contestar', 'disputa',
      'não resolve', 'não ajuda', 'não funciona', 'frustrante',
      'cancelar conta', 'excluir dados', 'problema sério'
    ];
    
    // Problemas financeiros específicos
    const financialIssues = [
      'dinheiro sumiu', 'saldo incorreto', 'cobrança indevida',
      'estorno', 'reembolso', 'transferência falhou', 'pix não chegou'
    ];
    
    // Problemas técnicos complexos
    const technicalIssues = [
      'não consigo logar há', 'conta bloqueada', 'erro no sistema',
      'aplicativo travando', 'não carrega'
    ];
    
    // Questões de segurança
    const securityIssues = [
      'conta hackeada', 'acesso não autorizado', 'fraude',
      'golpe', 'suspeita', 'vazamento'
    ];
    
    // Verifica escalação direta
    if (escalationKeywords.some(keyword => lowerContent.includes(keyword))) {
      return true;
    }
    
    // Verifica problemas financeiros
    if (financialIssues.some(keyword => lowerContent.includes(keyword))) {
      return true;
    }
    
    // Verifica problemas de segurança
    if (securityIssues.some(keyword => lowerContent.includes(keyword))) {
      return true;
    }
    
    // Verifica problemas técnicos complexos
    if (technicalIssues.some(keyword => lowerContent.includes(keyword))) {
      return true;
    }
    
    // Verifica se o usuário tem um contexto que sugere problema complexo
    if (userContext) {
      // Se o usuário tem muitas caixinhas e está perguntando sobre saldos
      if (userContext.caixinhas && userContext.caixinhas.length > 3 && 
          lowerContent.includes('saldo')) {
        return true;
      }
      
      // Se o usuário é vendedor e tem problemas com vendas/pagamentos
      if (userContext.roles && Array.isArray(userContext.roles) && userContext.roles.includes('seller') && 
          (lowerContent.includes('venda') || lowerContent.includes('pagamento'))) {
        return true;
      }
    }
    
    return false;
  }

    /**
   * Envia uma notificação para a conta de suporte interna sobre um novo ticket.
   * @private
   * @async
   * @function _notifySupportAccount
   * @param {Object} ticket - O objeto do ticket de suporte recém-criado.
   * @returns {Promise<void>}
   * @description Cria e envia uma mensagem interna para a conta de suporte designada, detalhando o novo ticket.
   */
  async _notifySupportAccount(ticket) {
    const supportUserId = 'sS855lp9DwhZodxMqG7bf5cYeQ92';
    const Message = require('../models/Message');
    
    try {
      // Create rich notification based on new ticket structure
      const priorityEmoji = {
        urgent: '🚨',
        high: '⚠️',
        medium: '📋',
        low: '📝'
      };

      const categoryEmoji = {
        financial: '💰',
        caixinha: '🏦',
        loan: '💳',
        account: '👤',
        technical: '🔧',
        security: '🔒',
        general: '❓'
      };

      const content = `${priorityEmoji[ticket.priority] || '📋'} ${categoryEmoji[ticket.category] || '❓'} Novo Ticket #${ticket.id}

` +
                     `👤 Usuário: ${ticket.userName}
` +
                     `📋 Categoria: ${ticket.category}
` +
                     `🔧 Módulo: ${ticket.module}
` +
                     `⚡ Tipo: ${ticket.issueType}
` +
                     `🎯 Prioridade: ${ticket.priority}
` +
                     `📝 Título: ${ticket.title}
\n` +
                     `💬 Descrição: ${ticket.description.substring(0, 150)}${ticket.description.length > 150 ? '...' : ''}
\n` +
                     `🕐 Criado: ${new Date().toLocaleString('pt-BR')}
\n` +
                     `Acesse o painel de suporte para atender este ticket.`;

      const notificationMessage = {
        conversationId: `support_${ticket.id}`,
        senderId: 'system',
        recipientId: supportUserId,
        content,
        messageType: 'support_notification',
        timestamp: new Date(),
        metadata: {
          ticketId: ticket.id,
          type: 'new_ticket',
          category: ticket.category,
          priority: ticket.priority,
          userId: ticket.userId
        }
      };

      await Message.create(notificationMessage);
      
      logger.info(`Support notification sent for ticket ${ticket.id}`, {
        supportUserId,
        ticketId: ticket.id,
        category: ticket.category,
        priority: ticket.priority
      });
    } catch (error) {
      logger.error('Failed to notify support account', {
        error: error.message,
        ticketId: ticket.id
      });
    }
  }

    /**
   * Atribui um ticket de suporte a um agente.
   * @async
   * @function assignTicket
   * @param {string} ticketId - O ID do ticket a ser atribuído.
   * @param {string} agentId - O ID do agente ao qual o ticket será atribuído.
   * @returns {Promise<Object>} O ticket de suporte atualizado.
   * @throws {Error} Se o ticket não for encontrado ou não estiver no status 'pending'.
   * @description Atualiza o ticket com o ID do agente, o status 'assigned' e a data de atribuição.
   */
  async assignTicket(ticketId, agentId) {
    logger.info(`Assigning ticket ${ticketId} to agent ${agentId}`, {
      service: 'SupportService', method: 'assignTicket'
    });
    const ticket = await SupportTicket.getById(ticketId);
    if (!ticket) throw new Error('Support ticket not found.');
    if (ticket.status !== 'pending') throw new Error('Ticket is not pending and cannot be assigned.');

    // TODO: Verify agentId is a valid agent (e.g., check role)
    // const agentUser = await User.getById(agentId);
    // if (!agentUser || !agentUser.roles.includes('support_agent')) {
    //   throw new Error('Invalid agent ID or user is not an agent.');
    // }

    return SupportTicket.update(ticketId, {
      assignedTo: agentId,
      status: 'assigned',
      assignedAt: new Date(), // Use JS Date for immediate update, Firestore will use serverTimestamp
    });
  }

    /**
   * Resolve um ticket de suporte.
   * @async
   * @function resolveTicket
   * @param {string} ticketId - O ID do ticket a ser resolvido.
   * @param {string} agentId - O ID do agente que está resolvendo o ticket.
   * @param {string} [resolutionNotes='Ticket resolved'] - Notas detalhadas da resolução.
   * @param {string} [resolutionSummary='Ticket resolved successfully'] - Um resumo conciso da resolução.
   * @returns {Promise<Object>} O ticket de suporte atualizado com status 'resolved'.
   * @throws {Error} Se o ticket não for encontrado ou não estiver em um status elegível para resolução.
   * @description Marca o ticket como resolvido, adiciona notas de resolução e um resumo.
   */
  async resolveTicket(ticketId, agentId, resolutionNotes = '', resolutionSummary = '') {
    logger.info(`Resolving ticket ${ticketId} by agent ${agentId}`, {
      service: 'SupportService', method: 'resolveTicket'
    });
    const ticket = await SupportTicket.getById(ticketId);
    if (!ticket) throw new Error('Support ticket not found.');
    if (ticket.status !== 'assigned' && ticket.status !== 'pending' && ticket.status !== 'in_progress') {
         throw new Error('Ticket must be assigned, pending, or in progress to be resolved.');
    }
    // Optional: if (ticket.assignedTo && ticket.assignedTo !== agentId) throw new Error('Ticket assigned to another agent.');

    const newNote = { 
      agentId, 
      note: resolutionNotes || 'Ticket resolved', 
      timestamp: new Date().toISOString(),
      type: 'resolution'
    };
    const updatedNotes = [...(ticket.notes || []), newNote];

    return SupportTicket.update(ticketId, {
      status: 'resolved',
      resolvedAt: new Date(),
      resolutionSummary: resolutionSummary || 'Ticket resolved successfully',
      notes: updatedNotes,
    });
  }

    /**
   * Obtém o histórico de conversas associado a um ticket.
   * @async
   * @function getConversationHistoryForTicket
   * @param {string} ticketId - O ID do ticket.
   * @param {number} [limit=50] - O número máximo de mensagens a serem retornadas.
   * @returns {Promise<Array<Object>>} Um array de objetos de mensagem ou histórico de conversa.
   * @throws {Error} Se o ticket não for encontrado.
   * @description Retorna o histórico de mensagens armazenado diretamente no ticket ou busca as mensagens da conversa associada.
   */
  async getConversationHistoryForTicket(ticketId, limit = 50) {
    const ticket = await SupportTicket.getById(ticketId);
    if (!ticket) {
      logger.warn(`Ticket ${ticketId} not found for fetching history.`);
      throw new Error('Ticket not found.');
    }
    
    // If ticket has stored conversation history, return it
    if (ticket.conversationHistory && ticket.conversationHistory.length > 0) {
      return ticket.conversationHistory.slice(0, limit);
    }
    
    // Fall back to conversation messages if conversationId exists
    if (ticket.conversationId) {
      return Message.getConversationMessages(ticket.conversationId, limit);
    }
    
    // No conversation history available
    return [];
  }

  /**
   * Obtém tickets de suporte filtrados por categoria.
   * @async
   * @function getTicketsByCategory
   * @param {string} category - A categoria dos tickets a serem buscados.
   * @param {string} [status=null] - O status opcional para filtrar os tickets.
   * @param {number} [limit=20] - O número máximo de tickets a serem retornados.
   * @returns {Promise<Array<Object>>} Uma lista de tickets de suporte.
   * @description Delega ao modelo `SupportTicket` a busca de tickets por categoria.
   */
  async getTicketsByCategory(category, status = null, limit = 20) {
    return SupportTicket.findByCategory(category, status, limit);
  }

    /**
   * Obtém tickets de suporte filtrados por módulo.
   * @async
   * @function getTicketsByModule
   * @param {string} module - O módulo dos tickets a serem buscados.
   * @param {string} [status=null] - O status opcional para filtrar os tickets.
   * @param {number} [limit=20] - O número máximo de tickets a serem retornados.
   * @returns {Promise<Array<Object>>} Uma lista de tickets de suporte.
   * @description Delega ao modelo `SupportTicket` a busca de tickets por módulo.
   */
  async getTicketsByModule(module, status = null, limit = 20) {
    return SupportTicket.findByModule(module, status, limit);
  }

    /**
   * Obtém todos os tickets de suporte abertos por um usuário específico.
   * @async
   * @function getUserTickets
   * @param {string} userId - O ID do usuário cujos tickets serão buscados.
   * @param {string} [status=null] - O status opcional para filtrar os tickets.
   * @param {number} [limit=20] - O número máximo de tickets a serem retornados.
   * @returns {Promise<Array<Object>>} Uma lista de tickets de suporte do usuário.
   * @description Delega ao modelo `SupportTicket` a busca de tickets por ID de usuário.
   */
  async getUserTickets(userId, status = null, limit = 20) {
    return SupportTicket.findByUserId(userId, status, limit);
  }

    /**
   * Obtém dados analíticos sobre os tickets de suporte.
   * @async
   * @function getTicketAnalytics
   * @param {number} [timeRange=30] - O período em dias para o qual as análises serão geradas.
   * @returns {Promise<Object>} Dados analíticos dos tickets.
   * @description Delega ao modelo `SupportTicket` a agregação de dados para análises.
   */
  async getTicketAnalytics(timeRange = 30) {
    return SupportTicket.getAnalytics(timeRange);
  }

    /**
   * Obtém tickets de suporte que estão pendentes.
   * @async
   * @function getPendingTickets
   * @param {number} [limit=10] - O número máximo de tickets pendentes a serem retornados.
   * @returns {Promise<Array<Object>>} Uma lista de tickets de suporte pendentes.
   * @description Delega ao modelo `SupportTicket` a busca por tickets com status 'pending'.
   */
  async getPendingTickets(limit = 10) {
    return SupportTicket.getTicketsByStatus('pending', limit);
  }

    /**
   * Obtém tickets atribuídos a um agente específico.
   * @async
   * @function getAgentTickets
   * @param {string} agentId - O ID do agente.
   * @param {string} [status='assigned'] - O status dos tickets do agente a serem buscados.
   * @param {number} [limit=10] - O número máximo de tickets a serem retornados.
   * @returns {Promise<Array<Object>>} Uma lista de tickets atribuídos ao agente.
   * @description Delega ao modelo `SupportTicket` a busca por tickets atribuídos a um agente.
   */
  async getAgentTickets(agentId, status = 'assigned', limit = 10) {
    return SupportTicket.getTicketsByAgent(agentId, status, limit);
  }

  async getAllTickets(limit = 50, status = null) {
    return SupportTicket.getAllTickets(limit, status);
  }

  /**
   * Envia um e-mail de notificação para o usuário quando um ticket é criado.
   * @private
   * @async
   * @function _sendTicketCreatedEmail
   * @param {Object} ticket - O objeto do ticket de suporte.
   * @param {Object} user - O objeto do usuário que criou o ticket.
   * @returns {Promise<void>}
   * @description Prepara e envia um e-mail de confirmação para o usuário após a criação de um ticket.
   */
    async _sendTicketCreatedEmail(ticket, user) {
    try {
      const NotificationDispatcher = require('./NotificationDispatcher');
      
      await NotificationDispatcher.dispatch({
        userId: ticket.userId,
        type: 'support_ticket_created',
        importance: 'high',
        data: {
          userName: user.nome || user.displayName || 'Usuário',
          ticketId: ticket.id,
          ticketTitle: ticket.title,
          priority: ticket.priority,
          category: ticket.category,
          description: ticket.description
        },
        metadata: {
          triggeredBy: 'system',
          correlationId: ticket.id
        }
      });

      logger.info('Ticket creation notification dispatched', {
        ticketId: ticket.id,
        userId: ticket.userId
      });
    } catch (error) {
      logger.error('Failed to dispatch ticket creation notification', {
        error: error.message,
        ticketId: ticket.id,
        userId: ticket.userId
      });
    }
  }

    /**
   * Envia um e-mail de notificação para o usuário quando há uma atualização em seu ticket.
   * @private
   * @async
   * @function _sendTicketUpdateEmail
   * @param {Object} ticket - O objeto do ticket de suporte.
   * @param {Object} user - O objeto do usuário proprietário do ticket.
   * @param {Object} updateData - Dados da atualização (status anterior, novo status, nome do agente, nota).
   * @returns {Promise<void>}
   * @description Prepara e envia um e-mail para o usuário informando sobre uma mudança de status ou outra atualização em seu ticket.
   */
  /**
   * Envia um e-mail de notificação para o usuário quando há uma atualização em seu ticket.
   * @private
   * @async
   * @function _sendTicketUpdateEmail
   * @param {Object} ticket - O objeto do ticket de suporte.
   * @param {Object} user - O objeto do usuário proprietário do ticket.
   * @param {Object} updateData - Dados da atualização (status anterior, novo status, nome do agente, nota).
   * @returns {Promise<void>}
   * @description Prepara e envia um e-mail para o usuário informando sobre uma mudança de status ou outra atualização em seu ticket.
   */
  async _sendTicketUpdateEmail(ticket, user, updateData) {
    try {
      const NotificationDispatcher = require('./NotificationDispatcher');
      
      await NotificationDispatcher.dispatch({
        userId: ticket.userId,
        type: 'support_ticket_update',
        importance: 'high',
        data: {
          userName: user.nome || user.displayName || 'Usuário',
          ticketId: ticket.id,
          ticketTitle: ticket.title,
          previousStatus: updateData.previousStatus,
          newStatus: updateData.newStatus,
          agentName: updateData.agentName || 'Nossa Equipe',
          updateNote: updateData.note || ''
        },
        metadata: {
          triggeredBy: 'system',
          correlationId: ticket.id
        }
      });

      logger.info('Ticket update notification dispatched', {
        ticketId: ticket.id,
        userId: ticket.userId,
        newStatus: updateData.newStatus
      });
    } catch (error) {
      logger.error('Failed to dispatch ticket update notification', {
        error: error.message,
        ticketId: ticket.id,
        userId: ticket.userId
      });
    }
  }

    /**
   * Envia um e-mail de notificação para o usuário quando seu ticket é resolvido.
   * @private
   * @async
   * @function _sendTicketResolvedEmail
   * @param {Object} ticket - O objeto do ticket de suporte.
   * @param {Object} user - O objeto do usuário proprietário do ticket.
   * @param {Object} resolutionData - Dados da resolução (nome do agente, resumo da resolução).
   * @returns {Promise<void>}
   * @description Prepara e envia um e-mail para o usuário informando que seu ticket foi resolvido, incluindo um resumo da solução.
   */
  async _sendTicketResolvedEmail(ticket, user, resolutionData) {
    try {
      const NotificationDispatcher = require('./NotificationDispatcher');
      
      await NotificationDispatcher.dispatch({
        userId: ticket.userId,
        type: 'support_ticket_resolved',
        importance: 'high',
        data: {
          userName: user.nome || user.displayName || 'Usuário',
          ticketId: ticket.id,
          ticketTitle: ticket.title,
          agentName: resolutionData.agentName || 'Nossa Equipe',
          resolutionSummary: resolutionData.resolutionSummary || 'Seu ticket foi resolvido com sucesso.',
          resolutionDate: new Date().toLocaleString('pt-BR')
        },
        metadata: {
          triggeredBy: 'system',
          correlationId: ticket.id
        }
      });

      logger.info('Ticket resolution notification dispatched', {
        ticketId: ticket.id,
        userId: ticket.userId
      });
    } catch (error) {
      logger.error('Failed to dispatch ticket resolution notification', {
        error: error.message,
        ticketId: ticket.id,
        userId: ticket.userId
      });
    }
  }

  /**
   * Atualiza um ticket de suporte e, opcionalmente, envia um e-mail de notificação ao usuário.
   * @async
   * @function updateTicketWithEmail
   * @param {string} ticketId - O ID do ticket a ser atualizado.
   * @param {Object} updateData - Os dados a serem atualizados no ticket.
   * @param {string} [agentId] - O ID do agente que está realizando a atualização (para informações no e-mail).
   * @returns {Promise<Object>} O ticket de suporte atualizado.
   * @throws {Error} Se o ticket não for encontrado.
   * @description Combina a atualização do ticket com o envio automático de uma notificação por e-mail, especialmente útil para mudanças de status.
   */
    async updateTicketWithEmail(ticketId, updateData, agentId) {
    const ticket = await SupportTicket.getById(ticketId);
    if (!ticket) throw new Error('Support ticket not found.');

    const user = await User.getById(ticket.userId);
    const previousStatus = ticket.status;

    // Update ticket
    const updatedTicket = await SupportTicket.update(ticketId, updateData);

    // Send email notification if status changed
    if (updateData.status && updateData.status !== previousStatus) {
      const agentUser = agentId ? await User.getById(agentId) : null;
      
      await this._sendTicketUpdateEmail(updatedTicket, user, {
        previousStatus,
        newStatus: updateData.status,
        agentName: agentUser ? (agentUser.nome || agentUser.displayName) : 'Nossa Equipe',
        note: updateData.note || ''
      });
    }

    return updatedTicket;
  }

    /**
   * Resolve um ticket de suporte e envia uma notificação por e-mail ao usuário.
   * @async
   * @function resolveTicketWithEmail
   * @param {string} ticketId - O ID do ticket a ser resolvido.
   * @param {string} agentId - O ID do agente que está resolvendo o ticket.
   * @param {string} [resolutionNotes=''] - Notas detalhadas da resolução.
   * @param {string} [resolutionSummary=''] - Um resumo conciso da resolução.
   * @returns {Promise<Object>} O ticket de suporte resolvido.
   * @throws {Error} Se o ticket não for encontrado.
   * @description Resolve o ticket e, em seguida, envia um e-mail de resolução ao usuário final.
   */
  async resolveTicketWithEmail(ticketId, agentId, resolutionNotes = '', resolutionSummary = '') {
    const ticket = await SupportTicket.getById(ticketId);
    if (!ticket) throw new Error('Support ticket not found.');

    const user = await User.getById(ticket.userId);
    const agentUser = agentId ? await User.getById(agentId) : null;

    // Resolve ticket
    const resolvedTicket = await this.resolveTicket(ticketId, agentId, resolutionNotes, resolutionSummary);

    // Send resolution email
    await this._sendTicketResolvedEmail(resolvedTicket, user, {
      agentName: agentUser ? (agentUser.nome || agentUser.displayName) : 'Nossa Equipe',
      resolutionSummary: resolutionSummary || 'Seu ticket foi resolvido com sucesso.'
    });

    return resolvedTicket;
  }
}

module.exports = new SupportService();