/**
 * @fileoverview Security Analytics Controller
 * @module controllers/securityController
 */

const SmartSecurityService = require('../services/SmartSecurityService');
const { getFirestore } = require('../firebaseAdmin');
const { logger } = require('../logger');

const db = getFirestore();

class SecurityController {
  /**
   * Dashboard de métricas de segurança em tempo real
   */
  static async getDashboard(req, res) {
    try {
      const timeRange = req.query.timeRange || '24h';
      const userId = req.user?.uid;

      // Se user específico ou admin geral
      const isAdmin = req.user?.roles?.includes('admin') || 
                     req.user?.permissions?.includes('security:view_analytics');

      if (!isAdmin && !userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const dashboard = await SecurityController._buildSecurityDashboard(
        isAdmin ? null : userId, 
        timeRange
      );

      logger.info('Security dashboard accessed', {
        controller: 'SecurityController',
        method: 'getDashboard',
        userId,
        isAdmin,
        timeRange
      });

      res.json(dashboard);

    } catch (error) {
      logger.error('Error building security dashboard', {
        controller: 'SecurityController',
        method: 'getDashboard',
        error: error.message,
        userId: req.user?.uid
      });

      res.status(500).json({ 
        error: 'Failed to load security dashboard',
        details: error.message 
      });
    }
  }

  /**
   * Análise de risco de um usuário específico
   */
  static async getUserRiskAnalysis(req, res) {
    try {
      const targetUserId = req.params.userId;
      const requestingUserId = req.user?.uid;

      // Verificar permissões
      const isAdmin = req.user?.roles?.includes('admin');
      const isSelfAnalysis = targetUserId === requestingUserId;

      if (!isAdmin && !isSelfAnalysis) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const riskProfile = await SmartSecurityService.calculateUserRiskScore(targetUserId);
      const recentEvents = await SecurityController._getRecentSecurityEvents(targetUserId, 7);

      const analysis = {
        userId: targetUserId,
        riskProfile,
        recentEvents: recentEvents.slice(0, 10), // Últimos 10 eventos
        recommendations: SecurityController._generateSecurityRecommendations(
          riskProfile, 
          recentEvents
        ),
        summary: {
          totalEvents: recentEvents.length,
          riskTrend: SecurityController._calculateRiskTrend(recentEvents),
          lastActivity: recentEvents[0]?.timestamp || null
        }
      };

      logger.info('User risk analysis requested', {
        controller: 'SecurityController',
        method: 'getUserRiskAnalysis',
        targetUserId,
        requestingUserId,
        isAdmin,
        riskLevel: riskProfile.riskLevel
      });

      res.json(analysis);

    } catch (error) {
      logger.error('Error getting user risk analysis', {
        controller: 'SecurityController',
        method: 'getUserRiskAnalysis',
        error: error.message,
        targetUserId: req.params.userId
      });

      res.status(500).json({ 
        error: 'Failed to analyze user risk',
        details: error.message 
      });
    }
  }

  /**
   * Eventos de segurança em tempo real
   */
  static async getSecurityEvents(req, res) {
    try {
      const { 
        limit = 50, 
        eventType, 
        userId, 
        riskLevel,
        startDate,
        endDate 
      } = req.query;

      const isAdmin = req.user?.roles?.includes('admin');
      
      if (!isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      let query = db.collection('securityEvents')
        .orderBy('timestamp', 'desc')
        .limit(parseInt(limit));

      // Aplicar filtros
      if (eventType) {
        query = query.where('eventType', '==', eventType);
      }

      if (userId) {
        query = query.where('userId', '==', userId);
      }

      if (startDate) {
        query = query.where('timestamp', '>=', new Date(startDate));
      }

      if (endDate) {
        query = query.where('timestamp', '<=', new Date(endDate));
      }

      const snapshot = await query.get();
      const events = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp.toDate().toISOString()
      }));

      // Filtrar por riskLevel se especificado (post-query filtering)
      const filteredEvents = riskLevel ? 
        events.filter(event => event.data?.riskLevel === riskLevel) : 
        events;

      const response = {
        events: filteredEvents,
        total: filteredEvents.length,
        filters: {
          eventType,
          userId,
          riskLevel,
          startDate,
          endDate
        },
        summary: SecurityController._summarizeEvents(filteredEvents)
      };

      logger.info('Security events requested', {
        controller: 'SecurityController',
        method: 'getSecurityEvents',
        requestingUserId: req.user.uid,
        eventsCount: filteredEvents.length,
        filters: { eventType, userId, riskLevel }
      });

      res.json(response);

    } catch (error) {
      logger.error('Error getting security events', {
        controller: 'SecurityController',
        method: 'getSecurityEvents',
        error: error.message,
        userId: req.user?.uid
      });

      res.status(500).json({ 
        error: 'Failed to retrieve security events',
        details: error.message 
      });
    }
  }

  /**
   * Relatório de segurança personalizado
   */
  static async generateSecurityReport(req, res) {
    try {
      const { 
        reportType = 'weekly',
        format = 'json',
        includeSummary = true,
        includeCharts = false 
      } = req.query;

      const isAdmin = req.user?.roles?.includes('admin');
      
      if (!isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const report = await SecurityController._generateReport(
        reportType, 
        {
          includeSummary,
          includeCharts
        }
      );

      if (format === 'json') {
        res.json(report);
      } else if (format === 'csv') {
        // TODO: Implementar export CSV
        res.set('Content-Type', 'text/csv');
        res.set('Content-Disposition', `attachment; filename="security-report-${Date.now()}.csv"`);
        res.send(SecurityController._convertToCSV(report));
      } else {
        res.status(400).json({ error: 'Unsupported format' });
      }

      logger.info('Security report generated', {
        controller: 'SecurityController',
        method: 'generateSecurityReport',
        requestingUserId: req.user.uid,
        reportType,
        format
      });

    } catch (error) {
      logger.error('Error generating security report', {
        controller: 'SecurityController',
        method: 'generateSecurityReport',
        error: error.message,
        userId: req.user?.uid
      });

      res.status(500).json({ 
        error: 'Failed to generate security report',
        details: error.message 
      });
    }
  }

  /**
   * Ação manual de segurança (bloquear usuário, resetar score, etc.)
   */
  static async executeSecurityAction(req, res) {
    try {
      const { action, targetUserId, reason, duration } = req.body;

      const isAdmin = req.user?.roles?.includes('admin') || 
                     req.user?.permissions?.includes('security:execute_actions');
      
      if (!isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const result = await SecurityController._executeSecurityAction({
        action,
        targetUserId,
        reason,
        duration,
        executedBy: req.user.uid,
        executedAt: new Date()
      });

      logger.info('Security action executed', {
        controller: 'SecurityController',
        method: 'executeSecurityAction',
        action,
        targetUserId,
        executedBy: req.user.uid,
        reason
      });

      res.json({
        success: true,
        action,
        targetUserId,
        result,
        executedAt: new Date().toISOString(),
        executedBy: req.user.uid
      });

    } catch (error) {
      logger.error('Error executing security action', {
        controller: 'SecurityController',
        method: 'executeSecurityAction',
        error: error.message,
        action: req.body?.action,
        targetUserId: req.body?.targetUserId
      });

      res.status(500).json({ 
        error: 'Failed to execute security action',
        details: error.message 
      });
    }
  }

  // Métodos auxiliares privados
  static async _buildSecurityDashboard(userId, timeRange) {
    const timeRangeMs = SecurityController._parseTimeRange(timeRange);
    const startDate = new Date(Date.now() - timeRangeMs);

    let query = db.collection('securityEvents')
      .where('timestamp', '>=', startDate);

    if (userId) {
      query = query.where('userId', '==', userId);
    }

    const snapshot = await query.get();
    const events = snapshot.docs.map(doc => doc.data());

    return {
      period: {
        timeRange,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString()
      },
      summary: {
        totalEvents: events.length,
        riskDistribution: SecurityController._getRiskDistribution(events),
        topEventTypes: SecurityController._getTopEventTypes(events),
        affectedUsers: [...new Set(events.map(e => e.userId))].length
      },
      trends: {
        eventsOverTime: SecurityController._getEventsOverTime(events, timeRange),
        riskScoreTrend: SecurityController._getRiskScoreTrend(events)
      },
      alerts: SecurityController._getActiveAlerts(events),
      recommendations: SecurityController._getDashboardRecommendations(events)
    };
  }

  static async _getRecentSecurityEvents(userId, days) {
    const startDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
    
    const snapshot = await db.collection('securityEvents')
      .where('userId', '==', userId)
      .where('timestamp', '>=', startDate)
      .orderBy('timestamp', 'desc')
      .get();

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp.toDate()
    }));
  }

  static _generateSecurityRecommendations(riskProfile, recentEvents) {
    const recommendations = [];

    if (riskProfile.riskLevel === 'HIGH') {
      recommendations.push({
        type: 'ENABLE_2FA',
        priority: 'HIGH',
        message: 'Enable two-factor authentication for additional security'
      });
    }

    if (riskProfile.components?.deviceRisk > 0.7) {
      recommendations.push({
        type: 'VERIFY_DEVICES',
        priority: 'MEDIUM',
        message: 'Review and verify all registered devices'
      });
    }

    return recommendations;
  }

  static _parseTimeRange(timeRange) {
    const ranges = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };
    
    return ranges[timeRange] || ranges['24h'];
  }

  // Outros métodos auxiliares...
  static _calculateRiskTrend(events) { return 'stable'; }
  static _summarizeEvents(events) { return { byType: {}, byRisk: {} }; }
  static _generateReport(type, options) { return { type, generated: new Date() }; }
  static _convertToCSV(report) { return 'CSV data'; }
  static _executeSecurityAction(params) { return { success: true }; }
  static _getRiskDistribution(events) { return { LOW: 0, MEDIUM: 0, HIGH: 0 }; }
  static _getTopEventTypes(events) { return []; }
  static _getEventsOverTime(events, range) { return []; }
  static _getRiskScoreTrend(events) { return []; }
  static _getActiveAlerts(events) { return []; }
  static _getDashboardRecommendations(events) { return []; }
}

module.exports = SecurityController;