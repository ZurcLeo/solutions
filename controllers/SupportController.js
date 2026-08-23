// /Users/leocruz/Documents/Projects/eloscloud/backend/eloscloudapp/controllers/SupportController.js
const supportService = require('../services/SupportService');
const SupportTicket = require('../models/SupportTicket');
const { logger } = require('../logger');
const socketManager = require('../config/socket/socketManager');
const { SUPPORT_EVENTS } = require('../config/socket/socketEvents');

// Helper: emite evento de suporte para a sala de agentes e, opcionalmente, para o dono do ticket
function _emitSupportEvent(eventName, payload, ownerUserId = null) {
  try {
    socketManager.emitToRoom('support-agents', eventName, payload);
    if (ownerUserId) {
      socketManager.emitToUser(ownerUserId, eventName, payload);
    }
  } catch (err) {
    logger.warn('_emitSupportEvent failed (non-critical)', { eventName, error: err.message });
  }
}

// Utility function to add agent info to ticket data
async function addAgentInfoToTicket(ticket) {
  const ticketData = ticket.toPlainObject();
  
  if (ticket.assignedTo) {
    try {
      const User = require('../models/User');
      const agent = await User.getById(ticket.assignedTo);
      ticketData.agentInfo = {
        id: agent.uid,
        nome: agent.nome,
        fotoDoPerfil: agent.fotoDoPerfil
      };
    } catch (agentError) {
      logger.warn('Failed to fetch agent info for ticket', { 
        ticketId: ticket.id, 
        agentId: ticket.assignedTo, 
        error: agentError.message 
      });
      ticketData.agentInfo = null;
    }
  }
  
  return ticketData;
}

// Utility function to add agent info to multiple tickets
async function addAgentInfoToTickets(tickets) {
  return Promise.all(tickets.map(ticket => addAgentInfoToTicket(ticket)));
}

class SupportController {
  // New primary method for creating support tickets
  async createTicket(req, res) {
    const { category, module, issueType, title, description, context, deviceInfo, userAgent, sessionData } = req.body;
    const userId = req.user.uid; // From verifyToken middleware

    try {
      const ticketRequest = {
        userId,
        category,
        module,
        issueType,
        title,
        description,
        context: context || {},
        deviceInfo: deviceInfo || {},
        userAgent: userAgent || req.get('user-agent') || '',
        sessionData: sessionData || {}
      };

      const result = await supportService.createTicket(ticketRequest);

      // Notificar agentes em tempo real
      _emitSupportEvent(SUPPORT_EVENTS.TICKET_CREATED, {
        ticketId: result.ticket?.id,
        category: category,
        priority: result.ticket?.priority,
        title: result.ticket?.title,
        userId,
        timestamp: Date.now(),
      });

      res.status(200).json(result);
    } catch (error) {
      logger.error('Error in SupportController.createTicket', {
        error: error.message, 
        userId, 
        category, 
        module, 
        issueType 
      });
      res.status(500).json({ 
        success: false, 
        message: error.message || 'Failed to create support ticket.' 
      });
    }
  }

  // Get user's own tickets
  async getUserTickets(req, res) {
    const userId = req.user.uid;
    const { status, limit } = req.query;

    try {
      const tickets = await supportService.getUserTickets(userId, status, parseInt(limit) || 20);
      const ticketsWithAgentInfo = await addAgentInfoToTickets(tickets);
      
      res.status(200).json({ 
        success: true, 
        data: ticketsWithAgentInfo,
        count: ticketsWithAgentInfo.length
      });
    } catch (error) {
      logger.error('Error in SupportController.getUserTickets', { error: error.message, userId });
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch user tickets.' });
    }
  }

  // Get ticket details (accessible by ticket owner or agents)
  async getTicketDetails(req, res) {
    const { ticketId } = req.params;
    const userId = req.user.uid;
    const userRoles = req.user.roles || [];

    try {
      const ticket = await SupportTicket.getById(ticketId);
      if (!ticket) {
        return res.status(404).json({ success: false, message: 'Ticket not found.' });
      }

      // Check if user can access this ticket
      const canAccess = ticket.userId === userId || 
                       userRoles.includes('support_agent') || 
                       userRoles.includes('admin');
      
      if (!canAccess) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
      }

      const ticketData = await addAgentInfoToTicket(ticket);

      // Usuários comuns não devem ver notas internas
      const isAgent = userRoles.includes('support_agent') || userRoles.includes('admin');
      if (!isAgent) {
        delete ticketData.internalNotes;
        // Filtrar mensagens internas do histórico de conversação
        if (ticketData.conversationHistory) {
          ticketData.conversationHistory = ticketData.conversationHistory.filter(
            m => m.type !== 'internal_note'
          );
        }
      }

      res.status(200).json({ success: true, data: ticketData });
    } catch (error) {
      logger.error('Error in SupportController.getTicketDetails', { error: error.message, ticketId, userId });
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch ticket details.' });
    }
  }

  // Get tickets by category (agents only)
  async getTicketsByCategory(req, res) {
    const { category } = req.params;
    const { status, limit } = req.query;

    try {
      const tickets = await supportService.getTicketsByCategory(category, status, parseInt(limit) || 20);
      const ticketsWithAgentInfo = await addAgentInfoToTickets(tickets);
      
      res.status(200).json({ 
        success: true, 
        data: ticketsWithAgentInfo,
        category,
        count: ticketsWithAgentInfo.length
      });
    } catch (error) {
      logger.error('Error in SupportController.getTicketsByCategory', { error: error.message, category });
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch tickets by category.' });
    }
  }

  // Get analytics (agents/admins only)
  async getAnalytics(req, res) {
    const { timeRange } = req.query;

    try {
      const analytics = await supportService.getTicketAnalytics(parseInt(timeRange) || 30);

      // Enriquecer agentWorkload com nome e foto de cada agente
      if (analytics.agentWorkload?.length) {
        const User = require('../models/User');
        analytics.agentWorkload = await Promise.all(
          analytics.agentWorkload.map(async (item) => {
            try {
              const user = await User.getById(item.agentId);
              return {
                ...item,
                agentName:  user?.nome || user?.displayName || item.agentId,
                agentPhoto: user?.fotoDoPerfil || null,
              };
            } catch {
              return { ...item, agentName: item.agentId, agentPhoto: null };
            }
          })
        );
      }

      res.status(200).json({ success: true, data: analytics });
    } catch (error) {
      logger.error('Error in SupportController.getAnalytics', { error: error.message });
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch analytics.' });
    }
  }

  // Update ticket status (agents only)
  async updateTicketStatus(req, res) {
    const { ticketId } = req.params;
    const { status, note } = req.body;
    const agentId = req.user.uid;

    try {
      if (!ticketId || !status) {
        return res.status(400).json({ success: false, message: 'Ticket ID and status are required.' });
      }

      const validStatuses = ['pending', 'assigned', 'in_progress', 'resolved', 'closed'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status.' });
      }

      const updateData = { status };
      
      // Add status-specific fields
      if (status === 'assigned') {
        updateData.assignedTo = agentId;
        updateData.assignedAt = new Date();
      }

      // Add note if provided
      if (note) {
        const ticket = await SupportTicket.getById(ticketId);
        if (ticket) {
          const newNote = { 
            agentId, 
            note, 
            timestamp: new Date().toISOString(),
            type: 'status_change',
            status: status
          };
          updateData.notes = [...(ticket.notes || []), newNote];
        }
      }

      const updatedTicket = await SupportTicket.update(ticketId, updateData);
      const ticketWithAgentInfo = await addAgentInfoToTicket(updatedTicket);

      _emitSupportEvent(SUPPORT_EVENTS.TICKET_STATUS_CHANGED, {
        ticketId,
        agentId,
        status,
        timestamp: Date.now(),
      }, updatedTicket.userId);

      res.status(200).json({ success: true, data: ticketWithAgentInfo });
    } catch (error) {
      logger.error('Error in SupportController.updateTicketStatus', { error: error.message, ticketId, status });
      res.status(500).json({ success: false, message: error.message || 'Failed to update ticket status.' });
    }
  }
  // Legacy method - maintained for backward compatibility
  async requestEscalation(req, res) {
    const { conversationId, reason } = req.body;
    const userId = req.user.uid; // From verifyToken middleware

    try {
      if (!conversationId) {
        return res.status(400).json({ success: false, message: 'Conversation ID is required.' });
      }
      const result = await supportService.requestEscalation(conversationId, userId, reason);
      res.status(200).json(result);
    } catch (error) {
      logger.error('Error in SupportController.requestEscalation', { error: error.message, userId, conversationId });
      res.status(500).json({ success: false, message: error.message || 'Failed to request escalation.' });
    }
  }

  // For Agents/Admins - Enhanced with filtering
  async getPendingTickets(req, res) {
    try {
      const { limit, category, priority } = req.query;
      let tickets;
      
      if (category) {
        tickets = await supportService.getTicketsByCategory(category, 'pending', parseInt(limit) || 10);
      } else {
        tickets = await supportService.getPendingTickets(parseInt(limit) || 10);
      }
      
      // Filter by priority if specified
      if (priority) {
        tickets = tickets.filter(t => t.priority === priority);
      }
      
      // Sort by priority and creation date
      const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
      tickets.sort((a, b) => {
        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
      
      const ticketsWithAgentInfo = await addAgentInfoToTickets(tickets);
      
      res.status(200).json({ 
        success: true, 
        data: ticketsWithAgentInfo,
        count: ticketsWithAgentInfo.length,
        filters: { category, priority }
      });
    } catch (error) {
      logger.error('Error in SupportController.getPendingTickets', { error: error.message });
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch pending tickets.' });
    }
  }

  async getTicketsAtSLARisk(req, res) {
    try {
      const withinHours = parseFloat(req.query.withinHours) || 2;
      const limit = parseInt(req.query.limit) || 50;
      const tickets = await supportService.getTicketsAtSLARisk(withinHours, limit);
      res.json({ success: true, tickets, total: tickets.length });
    } catch (error) {
      logger.error('Error in SupportController.getTicketsAtSLARisk', { error: error.message });
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getAgentTickets(req, res) {
    // TODO: Add RBAC
    const agentId = req.user.uid; // Assuming agent is fetching their own tickets
    const status = req.query.status || 'assigned';
    const limit = parseInt(req.query.limit) || 10;
    try {
      const tickets = await supportService.getAgentTickets(agentId, status, limit);
      const ticketsWithAgentInfo = await addAgentInfoToTickets(tickets);
      res.status(200).json({ success: true, data: ticketsWithAgentInfo });
    } catch (error) {
      logger.error('Error in SupportController.getAgentTickets', { error: error.message, agentId });
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch agent tickets.' });
    }
  }

  async getAllTickets(req, res) {
    const { status, limit } = req.query;
    
    try {
      const tickets = await supportService.getAllTickets(
        parseInt(limit) || 50, 
        status || null
      );
      
      // Sort by priority and creation date
      const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
      tickets.sort((a, b) => {
        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
      
      const ticketsWithAgentInfo = await addAgentInfoToTickets(tickets);
      
      res.status(200).json({ 
        success: true, 
        data: ticketsWithAgentInfo,
        count: ticketsWithAgentInfo.length,
        filters: { status, limit: parseInt(limit) || 50 }
      });
    } catch (error) {
      logger.error('Error in SupportController.getAllTickets', { error: error.message });
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch all tickets.' });
    }
  }

  async assignTicket(req, res) {
    // TODO: Add RBAC
    const { ticketId } = req.params;
    const requestingAgentId = req.user.uid;
    const { agentIdToAssign } = req.body; // Admin can assign to a specific agent
    // Only admin can assign to another agent; otherwise, always assigns to self
    const isAdmin = req.user.roles?.includes('admin');
    const agentId = (isAdmin && agentIdToAssign) ? agentIdToAssign : requestingAgentId;

    try {
      if (!ticketId) {
        return res.status(400).json({ success: false, message: 'Ticket ID is required.' });
      }
      const ticket = await supportService.assignTicket(ticketId, agentId);
      const ticketWithAgentInfo = await addAgentInfoToTicket(ticket);

      _emitSupportEvent(SUPPORT_EVENTS.TICKET_ASSIGNED, {
        ticketId,
        agentId,
        status: ticket.status,
        timestamp: Date.now(),
      }, ticket.userId);

      res.status(200).json({ success: true, data: ticketWithAgentInfo });
    } catch (error) {
      logger.error('Error in SupportController.assignTicket', { error: error.message, ticketId, agentId });
      res.status(500).json({ success: false, message: error.message || 'Failed to assign ticket.' });
    }
  }

  async resolveTicket(req, res) {
    const { ticketId } = req.params;
    const agentId = req.user.uid;
    const { resolutionNotes, resolutionSummary } = req.body;

    try {
      if (!ticketId) {
        return res.status(400).json({ success: false, message: 'Ticket ID is required.' });
      }
      
      // Enhanced resolution with summary + email notification
      const ticket = await supportService.resolveTicketWithEmail(ticketId, agentId, resolutionNotes, resolutionSummary);
      const ticketWithAgentInfo = await addAgentInfoToTicket(ticket);

      _emitSupportEvent(SUPPORT_EVENTS.TICKET_RESOLVED, {
        ticketId,
        agentId,
        resolutionSummary,
        timestamp: Date.now(),
      }, ticket.userId);

      res.status(200).json({ success: true, data: ticketWithAgentInfo });
    } catch (error) {
      logger.error('Error in SupportController.resolveTicket', { error: error.message, ticketId, agentId });
      res.status(500).json({ success: false, message: error.message || 'Failed to resolve ticket.' });
    }
  }

  async getConversationForTicket(req, res) {
    // TODO: Add RBAC
    const { ticketId } = req.params;
    try {
      if (!ticketId) {
        return res.status(400).json({ success: false, message: 'Ticket ID is required.' });
      }
      const limit = parseInt(req.query.limit) || 50;
      const messages = await supportService.getConversationHistoryForTicket(ticketId, limit);
      res.status(200).json({ success: true, data: messages });
    } catch (error) {
      logger.error('Error in SupportController.getConversationForTicket', { error: error.message, ticketId });
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch conversation history.' });
    }
  }

  // Update ticket with notes and other fields (agents only)
  async updateTicket(req, res) {
    const { ticketId } = req.params;
    const { notes, note, internalNotes, priority, tags } = req.body;
    const agentId = req.user.uid;
    const agentInfo = {
      id: agentId,
      name: req.user.name || 'Agent',
      email: req.user.email || ''
    };

    try {
      logger.info('SupportController.updateTicket - Starting', { 
        ticketId, 
        agentId, 
        requestBody: req.body,
        hasNote: !!(notes || note),
        hasInternalNotes: !!internalNotes
      });

      if (!ticketId) {
        return res.status(400).json({ success: false, message: 'Ticket ID is required.' });
      }

      // Get current ticket
      const ticket = await SupportTicket.getById(ticketId);
      if (!ticket) {
        return res.status(404).json({ success: false, message: 'Ticket not found.' });
      }

      logger.info('SupportController.updateTicket - Current ticket state', { 
        ticketId,
        currentConversationHistory: ticket.conversationHistory,
        currentNotes: ticket.notes,
        currentInternalNotes: ticket.internalNotes
      });

      // Check if agent can access this ticket (assigned to them, support role, or admin)
      const canAccess = ticket.assignedTo === agentId ||
                       req.user.roles?.includes('admin') ||
                       req.user.roles?.includes('support') ||
                       req.user.roles?.includes('support_agent') ||
                       req.user.permissions?.includes('support:manage_all_tickets');

      if (!canAccess) {
        return res.status(403).json({ success: false, message: 'Access denied. You can only update tickets assigned to you.' });
      }

      const updateData = {
        updatedAt: new Date()
      };

      // Add public notes to conversation history (accept both 'notes' and 'note')
      const noteContent = notes || note;
      if (noteContent) {
        const noteEntry = {
          type: 'agent_note',
          content: noteContent,
          timestamp: new Date().toISOString(),
          agentId: agentId,
          agentName: agentInfo.name,
          isInternal: false,
          id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };
        
        const currentHistory = ticket.conversationHistory || [];
        updateData.conversationHistory = [...currentHistory, noteEntry];
        
        // Also add to the notes array for backward compatibility and easier querying
        const currentNotes = ticket.notes || [];
        const legacyNoteEntry = {
          agentId: agentId,
          agentName: agentInfo.name,
          note: noteContent,
          timestamp: new Date().toISOString(),
          type: 'agent_note'
        };
        updateData.notes = [...currentNotes, legacyNoteEntry];

        // Transição automática para in_progress quando agente responde
        const nonTerminalStatuses = ['open', 'pending', 'assigned'];
        if (nonTerminalStatuses.includes(ticket.status)) {
          updateData.status = 'in_progress';
        }

        // Marcar SLA de primeiro atendimento (apenas na primeira nota pública)
        if (!ticket.firstRespondedAt) {
          updateData.firstRespondedAt = new Date();
          updateData.slaFirstResponseBreached =
            ticket.firstResponseDueAt ? new Date() > new Date(ticket.firstResponseDueAt) : false;
        }

        logger.info('SupportController.updateTicket - Adding note to conversation history and notes', {
          ticketId,
          noteEntry,
          legacyNoteEntry,
          currentHistoryLength: currentHistory.length,
          newHistoryLength: updateData.conversationHistory.length,
          currentNotesLength: currentNotes.length,
          newNotesLength: updateData.notes.length
        });
      }

      // Add internal notes
      if (internalNotes) {
        const internalNoteEntry = {
          agentId: agentId,
          agentName: agentInfo.name,
          note: internalNotes,
          timestamp: new Date().toISOString(),
          type: 'internal_note',
          id: `internal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };
        
        const currentInternalNotes = ticket.internalNotes || [];
        updateData.internalNotes = [...currentInternalNotes, internalNoteEntry];
        
        logger.info('SupportController.updateTicket - Adding internal note', { 
          ticketId,
          internalNoteEntry,
          currentInternalNotesLength: currentInternalNotes.length,
          newInternalNotesLength: updateData.internalNotes.length
        });
      }

      // Update priority if provided
      if (priority) {
        const validPriorities = ['low', 'medium', 'high', 'urgent'];
        if (!validPriorities.includes(priority)) {
          return res.status(400).json({ success: false, message: 'Invalid priority. Must be: low, medium, high, or urgent.' });
        }
        updateData.priority = priority;
      }

      // Update tags if provided
      if (tags && Array.isArray(tags)) {
        updateData.tags = tags;
      }

      logger.info('SupportController.updateTicket - Update data prepared', { 
        ticketId,
        updateData: {
          ...updateData,
          conversationHistoryLength: updateData.conversationHistory?.length,
          internalNotesLength: updateData.internalNotes?.length
        }
      });

      // Update the ticket
      const updatedTicket = await SupportTicket.update(ticketId, updateData);

      // Notificar usuário por email quando agente adiciona nota pública
      if (noteContent) {
        try {
          await supportService._sendTicketUpdateEmail(updatedTicket, { email: ticket.userEmail, nome: ticket.userName }, {
            previousStatus: ticket.status,
            newStatus: updatedTicket.status,
            agentName: agentInfo.name,
            note: noteContent
          });
        } catch (emailError) {
          logger.warn('SupportController.updateTicket - Failed to send update email', {
            ticketId, error: emailError.message
          });
        }
      }

      logger.info('SupportController.updateTicket - Ticket updated successfully', {
        ticketId,
        updatedConversationHistoryLength: updatedTicket.conversationHistory?.length,
        updatedNotesLength: updatedTicket.notes?.length,
        updatedInternalNotesLength: updatedTicket.internalNotes?.length
      });

      // Emit realtime event (only for public notes — internal notes are not broadcast to ticket owner)
      // noteContent already declared above as `const noteContent = notes || note`
      _emitSupportEvent(SUPPORT_EVENTS.TICKET_UPDATED, {
        ticketId,
        agentId,
        status: updatedTicket.status,
        hasNote: !!noteContent,
        timestamp: Date.now(),
      }, noteContent ? ticket.userId : null);  // notify owner only for public notes

      const ticketWithAgentInfo = await addAgentInfoToTicket(updatedTicket);

      res.status(200).json({
        success: true,
        data: ticketWithAgentInfo,
        message: 'Ticket updated successfully.'
      });
    } catch (error) {
      logger.error('Error in SupportController.updateTicket', { 
        error: error.message, 
        stack: error.stack,
        ticketId, 
        agentId,
        hasNotes: !!(notes || note),
        hasInternalNotes: !!internalNotes 
      });
      res.status(500).json({ success: false, message: error.message || 'Failed to update ticket.' });
    }
  }

  // ── CSAT ─────────────────────────────────────────────────────────────────
  // Rota PÚBLICA — autenticada apenas pelo token UUID no path

  async submitCsat(req, res) {
    const { token } = req.params;
    const { score, comment } = req.body;

    try {
      if (!token) {
        return res.status(400).json({ success: false, message: 'Survey token is required.' });
      }
      const parsedScore = parseInt(score, 10);
      if (!parsedScore || parsedScore < 1 || parsedScore > 5) {
        return res.status(400).json({ success: false, message: 'score must be an integer between 1 and 5.' });
      }

      await supportService.submitCsat(token, parsedScore, comment || null);
      return res.status(200).json({ success: true, message: 'Obrigado pelo feedback!' });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      logger.error('Error in SupportController.submitCsat', { error: error.message, token });
      return res.status(statusCode).json({ success: false, message: error.message || 'Failed to submit CSAT.' });
    }
  }

  // ── Vínculos entre tickets (SUPP-LINK-001) ───────────────────────────────────

  async createTicketLink(req, res) {
    const { ticketId } = req.params;
    const { linkedTicketId, linkType } = req.body;
    const agentId = req.user.uid;

    try {
      if (!linkedTicketId || !linkType) {
        return res.status(400).json({ success: false, message: 'linkedTicketId e linkType são obrigatórios.' });
      }
      if (!['duplicate', 'related', 'parent'].includes(linkType)) {
        return res.status(400).json({ success: false, message: 'linkType deve ser: duplicate, related ou parent.' });
      }
      if (ticketId === linkedTicketId) {
        return res.status(400).json({ success: false, message: 'Não é possível vincular um ticket a si mesmo.' });
      }

      const [ticket, linkedTicket] = await Promise.all([
        SupportTicket.getById(ticketId),
        SupportTicket.getById(linkedTicketId),
      ]);
      if (!ticket)       return res.status(404).json({ success: false, message: 'Ticket não encontrado.' });
      if (!linkedTicket) return res.status(404).json({ success: false, message: 'Ticket vinculado não encontrado.' });

      const link = await SupportTicket.createLink(ticketId, linkedTicketId, linkType, agentId);
      return res.status(201).json({ success: true, data: link });
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({ success: false, message: 'Este vínculo já existe.' });
      }
      logger.error('Error in SupportController.createTicketLink', { error: error.message, ticketId });
      return res.status(500).json({ success: false, message: error.message || 'Failed to create link.' });
    }
  }

  async getTicketLinks(req, res) {
    const { ticketId } = req.params;
    try {
      const links = await SupportTicket.getLinks(ticketId);

      const enriched = await Promise.all(links.map(async (link) => {
        try {
          const linked = await SupportTicket.getById(link.linked_ticket_id);
          return {
            ...link,
            linkedTicket: linked ? {
              id: linked.id,
              title: linked.title,
              status: linked.status,
              priority: linked.priority,
              category: linked.category,
            } : null,
          };
        } catch {
          return { ...link, linkedTicket: null };
        }
      }));

      return res.status(200).json({ success: true, data: enriched });
    } catch (error) {
      logger.error('Error in SupportController.getTicketLinks', { error: error.message, ticketId });
      return res.status(500).json({ success: false, message: error.message || 'Failed to fetch links.' });
    }
  }

  async deleteTicketLink(req, res) {
    const { linkId } = req.params;
    try {
      await SupportTicket.deleteLink(linkId);
      return res.status(200).json({ success: true, message: 'Vínculo removido.' });
    } catch (error) {
      logger.error('Error in SupportController.deleteTicketLink', { error: error.message, linkId });
      return res.status(500).json({ success: false, message: error.message || 'Failed to delete link.' });
    }
  }

  // ── Macros ────────────────────────────────────────────────────────────────

  async getMacros(req, res) {
    try {
      const { category } = req.query;
      const macros = await supportService.getMacros(category || null);
      res.json({ success: true, data: macros });
    } catch (error) {
      logger.error('Error in SupportController.getMacros', { error: error.message });
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // ── Ação contextual do ticket (approve_or_reject, etc.) ──────────────────────
  // POST /api/support/tickets/:ticketId/action
  // Body: { decision: 'approve' | 'reject' | 'request_info', reason?: string }
  async executeTicketAction(req, res) {
    const { ticketId } = req.params;
    const agentId = req.user.uid;
    const { decision, reason } = req.body;

    if (!decision) {
      return res.status(400).json({ success: false, message: 'decision é obrigatório.' });
    }

    try {
      const ticket = await SupportTicket.getById(ticketId);
      if (!ticket) {
        return res.status(404).json({ success: false, message: 'Ticket não encontrado.' });
      }

      // sellerProfileId/actionRequired podem estar na raiz de context OU em context.additionalData
      // (SupportContextBuilder move o contexto original para additionalData)
      const ctx = ticket.context || {};
      const actionRequired  = ctx.actionRequired  ?? ctx.additionalData?.actionRequired;
      const sellerProfileId = ctx.sellerProfileId ?? ctx.additionalData?.sellerProfileId;

      if (actionRequired === 'approve_or_reject') {
        if (!sellerProfileId) {
          return res.status(400).json({ success: false, message: 'sellerProfileId ausente no contexto do ticket.' });
        }
        if (!['approve', 'reject', 'request_info'].includes(decision)) {
          return res.status(400).json({ success: false, message: 'decision deve ser: approve, reject ou request_info.' });
        }

        if (decision === 'request_info') {
          // Coloca em waiting_user_response com nota pública
          const noteContent = reason || 'Por favor, forneça mais informações para prosseguir com a análise da sua loja.';
          const updated = await SupportTicket.update(ticketId, {
            status: 'waiting_user_response',
            conversationHistory: [
              ...(ticket.conversationHistory || []),
              {
                type: 'agent_note',
                content: noteContent,
                timestamp: new Date().toISOString(),
                agentId,
                isPublic: true,
              },
            ],
          });

          _emitSupportEvent(SUPPORT_EVENTS.TICKET_STATUS_CHANGED, {
            ticketId, agentId, status: 'waiting_user_response', timestamp: Date.now(),
          }, ticket.userId);

          logger.info('executeTicketAction: request_info enviado', { ticketId, agentId });
          return res.status(200).json({ success: true, data: updated.toPlainObject(), action: 'request_info' });
        }

        // approve ou reject → chama marketplaceService
        const marketplaceService = require('../services/marketplaceService');
        const profile = await marketplaceService.approveSellerProfile(sellerProfileId, {
          approved: decision === 'approve',
          reason: reason || '',
          agentUserId: agentId,
        });

        const resolutionNote = decision === 'approve'
          ? `Loja "${profile.business_name}" aprovada no Mercado Local.`
          : `Solicitação de loja "${profile.business_name}" rejeitada. Motivo: ${reason || 'Não informado.'}`;

        const resolvedTicket = await supportService.resolveTicket(
          ticketId,
          agentId,
          resolutionNote,
          decision === 'approve' ? 'Loja aprovada.' : 'Loja rejeitada.'
        );

        _emitSupportEvent(SUPPORT_EVENTS.TICKET_RESOLVED, {
          ticketId, agentId, action: decision, sellerProfileId, timestamp: Date.now(),
        }, resolvedTicket.userId);

        logger.info(`executeTicketAction: loja ${decision}d`, { ticketId, agentId, sellerProfileId });
        return res.status(200).json({
          success: true,
          data: resolvedTicket.toPlainObject(),
          action: decision,
          sellerProfile: profile,
        });
      }

      return res.status(400).json({
        success: false,
        message: `Ação "${actionRequired}" não tem handler automático. Use os endpoints do domínio diretamente.`,
      });
    } catch (err) {
      logger.error('Error in SupportController.executeTicketAction', { error: err.message, ticketId, agentId });
      res.status(500).json({ success: false, message: err.message || 'Erro ao executar ação do ticket.' });
    }
  }

  // ── Resposta do usuário ao ticket (acessível ao dono do ticket) ──────────
  async userReplyToTicket(req, res) {
    const { ticketId } = req.params;
    const userId = req.user.uid;
    const { message } = req.body;

    try {
      if (!ticketId) {
        return res.status(400).json({ success: false, message: 'Ticket ID is required.' });
      }
      if (!message || !message.trim()) {
        return res.status(400).json({ success: false, message: 'Message is required.' });
      }

      const ticket = await SupportTicket.getById(ticketId);
      if (!ticket) {
        return res.status(404).json({ success: false, message: 'Ticket not found.' });
      }
      // Apenas o dono do ticket pode responder
      if (ticket.userId !== userId) {
        return res.status(403).json({ success: false, message: 'You can only reply to your own tickets.' });
      }
      // Não pode responder a tickets fechados
      if (['resolved', 'closed'].includes(ticket.status)) {
        return res.status(400).json({ success: false, message: 'Cannot reply to a resolved or closed ticket.' });
      }

      const userReply = {
        type: 'user_reply',
        sender: 'user',
        content: message.trim(),
        userId,
        timestamp: new Date().toISOString(),
      };

      const updateData = {
        conversationHistory: [...(ticket.conversationHistory || []), userReply],
        status: ticket.status === 'waiting_user_response' ? 'pending' : ticket.status,
        updatedAt: new Date().toISOString(),
      };

      const updatedTicket = await SupportTicket.update(ticketId, updateData);
      const ticketWithAgentInfo = await addAgentInfoToTicket(updatedTicket);

      _emitSupportEvent(SUPPORT_EVENTS.TICKET_UPDATED, {
        ticketId,
        userId,
        timestamp: Date.now(),
      }, ticket.assignedTo);

      logger.info('User replied to ticket', { ticketId, userId, newStatus: updateData.status });
      res.status(200).json({ success: true, data: ticketWithAgentInfo });
    } catch (error) {
      logger.error('Error in SupportController.userReplyToTicket', { error: error.message, ticketId, userId });
      res.status(500).json({ success: false, message: error.message || 'Failed to reply to ticket.' });
    }
  }

  async createMacro(req, res) {
    const { title, body, category } = req.body;
    const agentId = req.user.uid;
    try {
      if (!title || !body) {
        return res.status(400).json({ success: false, message: 'title and body are required.' });
      }
      const macro = await supportService.createMacro({ title, body, category }, agentId);
      res.status(201).json({ success: true, data: macro });
    } catch (error) {
      logger.error('Error in SupportController.createMacro', { error: error.message });
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new SupportController();