// /Users/leocruz/Documents/Projects/eloscloud/backend/eloscloudapp/models/SupportTicket.js
const { getFirestore, FieldValue } = require('../firebaseAdmin');
const { logger } = require('../logger');
const db = getFirestore();

const TICKETS_COLLECTION = 'supportTickets';

// Support Categories and Issue Types
const SUPPORT_CATEGORIES = {
  FINANCIAL: {
    name: 'financial',
    modules: ['wallet', 'payment', 'transaction', 'mercadopago', 'stripe'],
    issues: {
      PAYMENT_FAILED: 'payment_failed',
      BALANCE_INCORRECT: 'balance_incorrect',
      REFUND_NEEDED: 'refund_needed',
      WITHDRAWAL_FAILED: 'withdrawal_failed',
      CHARGE_DISPUTE: 'charge_dispute'
    }
  },
  CAIXINHA: {
    name: 'caixinha',
    modules: ['caixinha', 'contribution', 'groups'],
    issues: {
      CANT_CONTRIBUTE: 'cant_contribute',
      MEMBER_ISSUE: 'member_issue',
      PAYOUT_PROBLEM: 'payout_problem',
      GROUP_ACCESS: 'group_access',
      INVITE_PROBLEM: 'invite_problem'
    }
  },
  LOAN: {
    name: 'loan',
    modules: ['loan', 'emprestimo'],
    issues: {
      APPROVAL_DELAYED: 'approval_delayed',
      PAYMENT_ISSUE: 'payment_issue',
      TERMS_DISPUTE: 'terms_dispute',
      INTEREST_CALCULATION: 'interest_calculation'
    }
  },
  ACCOUNT: {
    name: 'account',
    modules: ['auth', 'profile', 'user'],
    issues: {
      LOGIN_FAILED: 'login_failed',
      ACCOUNT_LOCKED: 'account_locked',
      DATA_UPDATE_FAILED: 'data_update_failed',
      VERIFICATION_ISSUE: 'verification_issue',
      PASSWORD_RESET: 'password_reset'
    }
  },
  TECHNICAL: {
    name: 'technical',
    modules: ['app', 'api', 'system'],
    issues: {
      APP_CRASH: 'app_crash',
      SYNC_ERROR: 'sync_error',
      PERFORMANCE_ISSUE: 'performance_issue',
      API_ERROR: 'api_error',
      FEATURE_NOT_WORKING: 'feature_not_working'
    }
  },
  SECURITY: {
    name: 'security',
    modules: ['auth', 'account', 'fraud'],
    issues: {
      ACCOUNT_COMPROMISED: 'account_compromised',
      SUSPICIOUS_ACTIVITY: 'suspicious_activity',
      FRAUD_REPORT: 'fraud_report',
      UNAUTHORIZED_ACCESS: 'unauthorized_access'
    }
  },
  GENERAL: {
    name: 'general',
    modules: ['app', 'support'],
    issues: {
      FEATURE_REQUEST: 'feature_request',
      GENERAL_INQUIRY: 'general_inquiry',
      FEEDBACK: 'feedback',
      OTHER: 'other'
    }
  }
};

class SupportTicket {
  constructor(data) {
    this.id = data.id; // Firestore document ID
    this.userId = data.userId; // User who needs support
    this.userName = data.userName;
    this.userEmail = data.userEmail;
    this.userPhotoURL = data.userPhotoURL;
    
    // Ticket Classification
    this.category = data.category || 'general'; // financial, caixinha, loan, account, technical, security, general
    this.module = data.module || 'app'; // Specific module where issue occurred
    this.issueType = data.issueType || 'other'; // Specific issue type
    
    // Ticket Status and Priority
    this.status = data.status || 'pending'; // pending, assigned, in_progress, resolved, closed
    this.priority = data.priority || 'medium'; // low, medium, high, urgent
    
    // Content and Context
    this.title = data.title || 'Solicitação de Suporte';
    this.description = data.description || '';
    this.context = data.context || {}; // Module-specific context data
    
    // Conversation Integration (Optional)
    this.conversationId = data.conversationId || null; // Only if initiated via AI chat
    this.conversationHistory = data.conversationHistory || [];
    
    // Assignment and Resolution
    this.assignedTo = data.assignedTo || null; // Agent's UID
    this.assignedAt = data.assignedAt || null;
    this.resolvedAt = data.resolvedAt || null;
    this.closedAt = data.closedAt || null;
    this.resolutionSummary = data.resolutionSummary || '';
    
    // Tracking and Notes
    this.notes = data.notes || []; // [{ agentId, note, timestamp, type }] - Legacy format
    this.internalNotes = data.internalNotes || []; // [{ agentId, agentName, note, timestamp, type, id }] - Internal notes
    this.tags = data.tags || []; // Additional classification tags
    
    // Technical Info
    this.userAgent = data.userAgent || '';
    this.deviceInfo = data.deviceInfo || {};
    this.sessionData = data.sessionData || {};
    this.errorLogs = data.errorLogs || [];
    
    // Timestamps
    this.createdAt = data.createdAt || FieldValue.serverTimestamp();
    this.updatedAt = data.updatedAt || FieldValue.serverTimestamp();
    
    // Legacy fields for backward compatibility
    this.requestedAt = data.requestedAt || data.createdAt || FieldValue.serverTimestamp();
    this.lastMessageSnippet = data.lastMessageSnippet || this.description.substring(0, 100) || '';
  }

  static get CATEGORIES() {
    return SUPPORT_CATEGORIES;
  }

  static getCategoryByModule(module) {
    for (const category of Object.values(SUPPORT_CATEGORIES)) {
      if (category.modules.includes(module)) {
        return category.name;
      }
    }
    return 'general';
  }

  static getIssuesByCategory(categoryName) {
    const category = Object.values(SUPPORT_CATEGORIES).find(cat => cat.name === categoryName);
    return category ? category.issues : SUPPORT_CATEGORIES.GENERAL.issues;
  }

  static _getCollection() {
    return db.collection(TICKETS_COLLECTION);
  }

  toPlainObject() {
    const obj = { ...this };
    // Convert Firestore Timestamps to ISO strings if they are resolved
    if (obj.requestedAt && obj.requestedAt.toDate) obj.requestedAt = obj.requestedAt.toDate().toISOString();
    if (obj.assignedAt && obj.assignedAt.toDate) obj.assignedAt = obj.assignedAt.toDate().toISOString();
    if (obj.resolvedAt && obj.resolvedAt.toDate) obj.resolvedAt = obj.resolvedAt.toDate().toISOString();
    if (obj.closedAt && obj.closedAt.toDate) obj.closedAt = obj.closedAt.toDate().toISOString();
    if (obj.updatedAt && obj.updatedAt.toDate) obj.updatedAt = obj.updatedAt.toDate().toISOString();
    return obj;
  }

  static async create(ticketData) {
    const docRef = this._getCollection().doc();
    const newTicket = new SupportTicket({
      ...ticketData,
      id: docRef.id,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      // Maintain backward compatibility
      requestedAt: FieldValue.serverTimestamp()
    });

    const dataToSave = { ...newTicket };
    delete dataToSave.id; // Firestore generates ID

    await docRef.set(dataToSave);
    logger.info('Support ticket created', { 
      ticketId: docRef.id, 
      userId: newTicket.userId,
      category: newTicket.category,
      module: newTicket.module,
      issueType: newTicket.issueType,
      conversationId: newTicket.conversationId // May be null
    });
    
    // Fetch the created doc to get resolved timestamps
    const createdDoc = await docRef.get();
    return new SupportTicket({ ...createdDoc.data(), id: createdDoc.id });
  }

  static async getById(ticketId) {
    const doc = await this._getCollection().doc(ticketId).get();
    if (!doc.exists) {
      logger.warn('Support ticket not found', { ticketId });
      return null;
    }
    return new SupportTicket({ ...doc.data(), id: doc.id });
  }

  static async update(ticketId, updateData) {
    const dataWithTimestamp = {
      ...updateData,
      updatedAt: FieldValue.serverTimestamp()
    };
    
    logger.info('SupportTicket.update - Starting update', { 
      ticketId, 
      updateData: {
        ...updateData,
        conversationHistoryLength: updateData.conversationHistory?.length,
        internalNotesLength: updateData.internalNotes?.length
      }
    });
    
    await this._getCollection().doc(ticketId).update(dataWithTimestamp);
    
    logger.info('SupportTicket.update - Firestore update completed', { 
      ticketId, 
      status: updateData.status,
      hasConversationHistory: !!updateData.conversationHistory,
      hasInternalNotes: !!updateData.internalNotes
    });
    
    const updatedTicket = await this.getById(ticketId);
    
    logger.info('SupportTicket.update - Retrieved updated ticket', { 
      ticketId,
      conversationHistoryLength: updatedTicket.conversationHistory?.length || 0,
      notesLength: updatedTicket.notes?.length || 0,
      internalNotesLength: updatedTicket.internalNotes?.length || 0
    });
    
    return updatedTicket;
  }

  static async findByConversationId(conversationId, status = null) {
    let query = this._getCollection().where('conversationId', '==', conversationId);
    if (status) {
      query = query.where('status', '==', status);
    }
    const snapshot = await query.orderBy('createdAt', 'desc').get();
    if (snapshot.empty) return [];
    return snapshot.docs.map(doc => new SupportTicket({ ...doc.data(), id: doc.id }));
  }

  static async findByUserId(userId, status = null, limit = 20) {
    let query = this._getCollection().where('userId', '==', userId);
    if (status) {
      query = query.where('status', '==', status);
    }
    const snapshot = await query.orderBy('createdAt', 'desc').limit(limit).get();
    if (snapshot.empty) return [];
    return snapshot.docs.map(doc => new SupportTicket({ ...doc.data(), id: doc.id }));
  }

  static async findByCategory(category, status = null, limit = 20) {
    let query = this._getCollection().where('category', '==', category);
    if (status) {
      query = query.where('status', '==', status);
    }
    const snapshot = await query.orderBy('createdAt', 'desc').limit(limit).get();
    if (snapshot.empty) return [];
    return snapshot.docs.map(doc => new SupportTicket({ ...doc.data(), id: doc.id }));
  }

  static async findByModule(module, status = null, limit = 20) {
    let query = this._getCollection().where('module', '==', module);
    if (status) {
      query = query.where('status', '==', status);
    }
    const snapshot = await query.orderBy('createdAt', 'desc').limit(limit).get();
    if (snapshot.empty) return [];
    return snapshot.docs.map(doc => new SupportTicket({ ...doc.data(), id: doc.id }));
  }

  static async getTicketsByStatus(status, limit = 20) {
    const snapshot = await this._getCollection()
        .where('status', '==', status)
        .orderBy('createdAt', 'asc')
        .limit(limit)
        .get();
    return snapshot.docs.map(doc => new SupportTicket({ ...doc.data(), id: doc.id }));
  }

  static async getTicketsByPriority(priority, limit = 20) {
    const snapshot = await this._getCollection()
        .where('priority', '==', priority)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
    return snapshot.docs.map(doc => new SupportTicket({ ...doc.data(), id: doc.id }));
  }

  static async getAnalytics(timeRange = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - timeRange);
    
    const snapshot = await this._getCollection()
        .where('createdAt', '>=', startDate)
        .get();
    
    const tickets = snapshot.docs.map(doc => new SupportTicket({ ...doc.data(), id: doc.id }));
    
    return {
      total: tickets.length,
      byStatus: this._groupBy(tickets, 'status'),
      byCategory: this._groupBy(tickets, 'category'),
      byPriority: this._groupBy(tickets, 'priority'),
      byModule: this._groupBy(tickets, 'module'),
      avgResolutionTime: this._calculateAvgResolutionTime(tickets.filter(t => t.resolvedAt))
    };
  }

  static _groupBy(array, key) {
    return array.reduce((result, item) => {
      const group = item[key] || 'unknown';
      result[group] = (result[group] || 0) + 1;
      return result;
    }, {});
  }

  static _calculateAvgResolutionTime(resolvedTickets) {
    if (resolvedTickets.length === 0) return 0;
    
    const totalTime = resolvedTickets.reduce((sum, ticket) => {
      const created = ticket.createdAt.toDate ? ticket.createdAt.toDate() : new Date(ticket.createdAt);
      const resolved = ticket.resolvedAt.toDate ? ticket.resolvedAt.toDate() : new Date(ticket.resolvedAt);
      return sum + (resolved.getTime() - created.getTime());
    }, 0);
    
    return Math.round(totalTime / resolvedTickets.length / (1000 * 60 * 60)); // Hours
  }

  static async getTicketsByAgent(agentId, status = 'assigned', limit = 20) {
    const snapshot = await this._getCollection()
        .where('assignedTo', '==', agentId)
        .where('status', '==', status)
        .orderBy('assignedAt', 'desc')
        .limit(limit)
        .get();
    return snapshot.docs.map(doc => new SupportTicket({ ...doc.data(), id: doc.id }));
  }

  static async getAllTickets(limit = 50, status = null) {
    let query = this._getCollection();
    
    if (status) {
      query = query.where('status', '==', status);
    }
    
    const snapshot = await query
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
    
    return snapshot.docs.map(doc => new SupportTicket({ ...doc.data(), id: doc.id }));
  }
}

module.exports = SupportTicket;