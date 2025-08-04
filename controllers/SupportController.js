// /Users/leocruz/Documents/Projects/eloscloud/backend/eloscloudapp/controllers/SupportController.js
const supportService = require('../services/SupportService');
const SupportTicket = require('../models/SupportTicket');
const { logger } = require('../logger');

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
    const agentId = req.user.uid; // Agent assigning to themselves, or admin can specify in body
    // const { agentIdToAssign } = req.body; // If admin assigns to a specific agent

    try {
      if (!ticketId) {
        return res.status(400).json({ success: false, message: 'Ticket ID is required.' });
      }
      const ticket = await supportService.assignTicket(ticketId, agentId /* or agentIdToAssign */);
      const ticketWithAgentInfo = await addAgentInfoToTicket(ticket);
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
      
      // Enhanced resolution with summary
      const ticket = await supportService.resolveTicket(ticketId, agentId, resolutionNotes, resolutionSummary);
      const ticketWithAgentInfo = await addAgentInfoToTicket(ticket);
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

      // Check if agent can access this ticket (assigned to them or has general permission)
      const canAccess = ticket.assignedTo === agentId || 
                       req.user.roles?.includes('admin') ||
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
      
      logger.info('SupportController.updateTicket - Ticket updated successfully', { 
        ticketId,
        updatedConversationHistoryLength: updatedTicket.conversationHistory?.length,
        updatedNotesLength: updatedTicket.notes?.length,
        updatedInternalNotesLength: updatedTicket.internalNotes?.length
      });
      
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
}

module.exports = new SupportController();