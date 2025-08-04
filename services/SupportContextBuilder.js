const User = require('../models/User');
const Caixinhas = require('../models/Caixinhas');
const Contribuicao = require('../models/Contribuicao');
const Payment = require('../models/Payment');
const Wallet = require('../models/Wallet');
const Transacao = require('../models/Transacao');
const Emprestimos = require('../models/Emprestimos');
const BankAccount = require('../models/BankAccount');
const Dispute = require('../models/Dispute');
const { logger } = require('../logger');

class SupportContextBuilder {
  static async buildContext(userId, category, module, issueType, additionalData = {}) {
    logger.info(`Building support context for user ${userId}`, {
      category, module, issueType, service: 'SupportContextBuilder'
    });

    try {
      const context = {
        user: await this.getUserInfo(userId),
        timestamp: new Date().toISOString(),
        category,
        module,
        issueType,
        additionalData
      };

      // Add category-specific context
      switch (category) {
        case 'financial':
          context.financial = await this.buildFinancialContext(userId, module, additionalData);
          break;
        case 'caixinha':
          context.caixinha = await this.buildCaixinhaContext(userId, module, additionalData);
          break;
        case 'loan':
          context.loan = await this.buildLoanContext(userId, module, additionalData);
          break;
        case 'account':
          context.account = await this.buildAccountContext(userId, module, additionalData);
          break;
        case 'technical':
          context.technical = await this.buildTechnicalContext(userId, module, additionalData);
          break;
        case 'security':
          context.security = await this.buildSecurityContext(userId, module, additionalData);
          break;
        default:
          context.general = await this.buildGeneralContext(userId, module, additionalData);
      }

      // Add recent activity across all modules
      context.recentActivity = await this.getRecentActivity(userId);

      // Clean undefined values from context recursively
      return this.cleanUndefinedValues(context);
    } catch (error) {
      logger.error('Error building support context', {
        error: error.message, userId, category, module, issueType
      });
      // Return minimal context on error
      return {
        user: { id: userId },
        error: 'Failed to build complete context',
        timestamp: new Date().toISOString(),
        category,
        module,
        issueType
      };
    }
  }

  static async getUserInfo(userId) {
    try {
      const user = await User.getById(userId);
      if (!user) return { id: userId, status: 'not_found' };

      // Safely handle potentially undefined values
      const userInfo = {
        id: userId,
        name: user.nome || user.displayName || 'Usuário',
        email: user.email || '',
        phone: user.telefone || '',
        photoURL: user.fotoDoPerfil || '',
        isVerified: user.isVerified || false,
        roles: user.roles || [],
        status: user.status || 'active'
      };

      // Only include createdAt if it's not undefined
      if (user.createdAt) {
        userInfo.createdAt = user.createdAt;
      }

      return userInfo;
    } catch (error) {
      logger.warn('Failed to get user info for support context', { userId, error: error.message });
      return { id: userId, status: 'error' };
    }
  }

  static async buildFinancialContext(userId, module, additionalData) {
    const context = {};

    try {
      // Wallet information
      if (['wallet', 'payment', 'transaction'].includes(module)) {
        context.wallet = await this.getWalletInfo(userId);
        context.recentTransactions = await this.getRecentTransactions(userId, 10);
        context.recentPayments = await this.getRecentPayments(userId, 5);
      }

      // Bank account info
      if (['payment', 'withdrawal'].includes(module)) {
        context.bankAccounts = await this.getBankAccounts(userId);
      }

      // Specific transaction or payment context
      if (additionalData.transactionId) {
        context.specificTransaction = await this.getTransactionDetails(additionalData.transactionId);
      }
      if (additionalData.paymentId) {
        context.specificPayment = await this.getPaymentDetails(additionalData.paymentId);
      }

      // Financial summary
      context.summary = {
        totalBalance: context.wallet?.saldo || 0,
        pendingTransactions: (context.recentTransactions || []).filter(t => t.status === 'pending').length,
        failedPayments: (context.recentPayments || []).filter(p => p.status === 'failed').length
      };

    } catch (error) {
      logger.error('Error building financial context', { error: error.message, userId, module });
      context.error = 'Failed to load financial data';
    }

    return context;
  }

  static async buildCaixinhaContext(userId, module, additionalData) {
    const context = {};

    try {
      // User's caixinhas
      context.userCaixinhas = await this.getUserCaixinhas(userId);
      context.recentContributions = await this.getRecentContributions(userId, 10);
      
      // Specific caixinha context
      if (additionalData.caixinhaId) {
        context.specificCaixinha = await this.getCaixinhaDetails(additionalData.caixinhaId, userId);
      }

      // Member information
      context.membershipSummary = {
        totalCaixinhas: context.userCaixinhas?.length || 0,
        activeCaixinhas: (context.userCaixinhas || []).filter(c => c.status === 'active').length,
        totalContributions: context.recentContributions?.length || 0
      };

    } catch (error) {
      logger.error('Error building caixinha context', { error: error.message, userId, module });
      context.error = 'Failed to load caixinha data';
    }

    return context;
  }

  static async buildLoanContext(userId, module, additionalData) {
    const context = {};

    try {
      context.userLoans = await this.getUserLoans(userId);
      
      if (additionalData.loanId) {
        context.specificLoan = await this.getLoanDetails(additionalData.loanId);
      }

      context.loanSummary = {
        totalLoans: context.userLoans?.length || 0,
        activeLoans: (context.userLoans || []).filter(l => l.status === 'active').length,
        overdueLoans: (context.userLoans || []).filter(l => l.status === 'overdue').length
      };

    } catch (error) {
      logger.error('Error building loan context', { error: error.message, userId, module });
      context.error = 'Failed to load loan data';
    }

    return context;
  }

  static async buildAccountContext(userId, module, additionalData) {
    const context = {};

    try {
      const user = await User.getById(userId);
      if (user) {
        context.accountInfo = {
          accountAge: this.calculateAccountAge(user.createdAt),
          verificationStatus: user.isVerified,
          lastLogin: user.lastLogin,
          profileCompletion: this.calculateProfileCompletion(user)
        };
      }

    } catch (error) {
      logger.error('Error building account context', { error: error.message, userId, module });
      context.error = 'Failed to load account data';
    }

    return context;
  }

  static async buildTechnicalContext(userId, module, additionalData) {
    const context = {
      deviceInfo: additionalData.deviceInfo || {},
      userAgent: additionalData.userAgent || '',
      sessionData: additionalData.sessionData || {},
      errorLogs: additionalData.errorLogs || []
    };

    return context;
  }

  static async buildSecurityContext(userId, module, additionalData) {
    const context = {};

    try {
      // Recent login activity
      context.recentActivity = await this.getSecurityActivity(userId);
      
      // Account security status
      const user = await User.getById(userId);
      if (user) {
        context.securityStatus = {
          twoFactorEnabled: user.twoFactorEnabled || false,
          lastPasswordChange: user.lastPasswordChange,
          suspiciousActivity: false // TODO: Implement suspicious activity detection
        };
      }

    } catch (error) {
      logger.error('Error building security context', { error: error.message, userId, module });
      context.error = 'Failed to load security data';
    }

    return context;
  }

  static async buildGeneralContext(userId, module, additionalData) {
    return {
      module,
      additionalData,
      userActivity: await this.getBasicUserActivity(userId)
    };
  }

  // Helper methods for data retrieval
  static async getWalletInfo(userId) {
    try {
      return await Wallet.getByUserId(userId);
    } catch (error) {
      logger.warn('Failed to get wallet info', { userId, error: error.message });
      return null;
    }
  }

  static async getRecentTransactions(userId, limit = 10) {
    try {
      return await Transacao.getByUserId(userId, limit);
    } catch (error) {
      logger.warn('Failed to get recent transactions', { userId, error: error.message });
      return [];
    }
  }

  static async getRecentPayments(userId, limit = 5) {
    try {
      return await Payment.getByUserId(userId, limit);
    } catch (error) {
      logger.warn('Failed to get recent payments', { userId, error: error.message });
      return [];
    }
  }

  static async getBankAccounts(userId) {
    try {
      return await BankAccount.getByUserId(userId);
    } catch (error) {
      logger.warn('Failed to get bank accounts', { userId, error: error.message });
      return [];
    }
  }

  static async getUserCaixinhas(userId) {
    try {
      return await Caixinhas.getByUserId(userId);
    } catch (error) {
      logger.warn('Failed to get user caixinhas', { userId, error: error.message });
      return [];
    }
  }

  static async getRecentContributions(userId, limit = 10) {
    try {
      return await Contribuicao.getByUserId(userId, limit);
    } catch (error) {
      logger.warn('Failed to get recent contributions', { userId, error: error.message });
      return [];
    }
  }

  static async getUserLoans(userId) {
    try {
      return await Emprestimos.getByUserId(userId);
    } catch (error) {
      logger.warn('Failed to get user loans', { userId, error: error.message });
      return [];
    }
  }

  static async getRecentActivity(userId, days = 7) {
    const activities = [];
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    try {
      // Combine different types of recent activity
      const [transactions, contributions, payments] = await Promise.all([
        this.getRecentTransactions(userId, 5),
        this.getRecentContributions(userId, 5),
        this.getRecentPayments(userId, 5)
      ]);

      // Format as unified activity feed
      transactions.forEach(t => activities.push({
        type: 'transaction',
        timestamp: t.createdAt,
        description: `Transação ${t.tipo}: R$ ${t.valor}`,
        status: t.status
      }));

      contributions.forEach(c => activities.push({
        type: 'contribution',
        timestamp: c.createdAt,
        description: `Contribuição: R$ ${c.valor}`,
        status: c.status
      }));

      payments.forEach(p => activities.push({
        type: 'payment',
        timestamp: p.createdAt,
        description: `Pagamento: R$ ${p.amount}`,
        status: p.status
      }));

      return activities
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 10);

    } catch (error) {
      logger.warn('Failed to get recent activity', { userId, error: error.message });
      return [];
    }
  }

  // Utility methods
  static calculateAccountAge(createdAt) {
    if (!createdAt) return 0;
    const created = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
    const now = new Date();
    return Math.floor((now - created) / (1000 * 60 * 60 * 24)); // Days
  }

  static calculateProfileCompletion(user) {
    const fields = ['nome', 'email', 'telefone', 'fotoDoPerfil'];
    const completedFields = fields.filter(field => user[field] && user[field].trim() !== '');
    return Math.round((completedFields.length / fields.length) * 100);
  }

  static async getSecurityActivity(userId) {
    // TODO: Implement security activity tracking
    return [];
  }

  static async getBasicUserActivity(userId) {
    try {
      const user = await User.getById(userId);
      return {
        lastLogin: user?.lastLogin,
        accountStatus: user?.status || 'active'
      };
    } catch (error) {
      return {};
    }
  }

  // Specific item detail methods
  static async getTransactionDetails(transactionId) {
    try {
      return await Transacao.getById(transactionId);
    } catch (error) {
      logger.warn('Failed to get transaction details', { transactionId, error: error.message });
      return null;
    }
  }

  static async getPaymentDetails(paymentId) {
    try {
      return await Payment.getById(paymentId);
    } catch (error) {
      logger.warn('Failed to get payment details', { paymentId, error: error.message });
      return null;
    }
  }

  static async getCaixinhaDetails(caixinhaId, userId) {
    try {
      const caixinha = await Caixinhas.getById(caixinhaId);
      if (!caixinha) return null;

      // Get user's membership info in this caixinha
      const memberInfo = await this.getUserMembershipInCaixinha(caixinhaId, userId);

      return {
        ...caixinha,
        userMembership: memberInfo
      };
    } catch (error) {
      logger.warn('Failed to get caixinha details', { caixinhaId, userId, error: error.message });
      return null;
    }
  }

  static async getLoanDetails(loanId) {
    try {
      return await Emprestimos.getById(loanId);
    } catch (error) {
      logger.warn('Failed to get loan details', { loanId, error: error.message });
      return null;
    }
  }

  static async getUserMembershipInCaixinha(caixinhaId, userId) {
    // TODO: Implement membership details retrieval
    return {};
  }

  // Utility method to clean undefined values recursively
  static cleanUndefinedValues(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.cleanUndefinedValues(item)).filter(item => item !== undefined);
    }

    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = this.cleanUndefinedValues(value);
      }
    }

    return cleaned;
  }
}

module.exports = SupportContextBuilder;