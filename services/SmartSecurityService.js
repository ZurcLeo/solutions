/**
 * @fileoverview Smart Security Service - AI-powered fraud detection
 * @module services/SmartSecurityService
 */

const { logger } = require('../logger');
const { getFirestore } = require('../firebaseAdmin');
const NodeCache = require('node-cache');

const db = getFirestore();

// Cache para armazenar patterns de comportamento
const behaviorCache = new NodeCache({ stdTTL: 3600 }); // 1 hora
const velocityCache = new NodeCache({ stdTTL: 300 }); // 5 minutos

class SmartSecurityService {
  constructor() {
    this.riskThresholds = {
      LOW: 0.3,
      MEDIUM: 0.6,
      HIGH: 0.8,
      CRITICAL: 0.9
    };
  }

  /**
   * QUICK WIN #1: Smart Velocity Detection
   * Detecta padrões suspeitos de velocidade em transações/ações
   */
  async analyzeVelocityPattern(userId, action, amount = null) {
    try {
      const cacheKey = `velocity_${userId}_${action}`;
      let userActions = velocityCache.get(cacheKey) || [];

      const currentAction = {
        action,
        amount,
        timestamp: new Date(),
        ip: this.getCurrentIP(), // TODO: Get from request context
        userAgent: this.getCurrentUserAgent() // TODO: Get from request context
      };

      userActions.push(currentAction);
      
      // Manter apenas ações dos últimos 5 minutos
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      userActions = userActions.filter(a => new Date(a.timestamp) > fiveMinutesAgo);
      
      velocityCache.set(cacheKey, userActions);

      // Análise de risco baseada em velocity
      const riskScore = await this.calculateVelocityRisk(userActions, action, amount);
      
      // Log para analytics
      await this.logSecurityEvent(userId, 'VELOCITY_ANALYSIS', {
        action,
        amount,
        actionsCount: userActions.length,
        riskScore,
        timeWindow: '5min'
      });

      return {
        allowed: riskScore < this.riskThresholds.HIGH,
        riskScore,
        riskLevel: this.getRiskLevel(riskScore),
        actions: userActions.length,
        recommendation: this.getRecommendation(riskScore, action)
      };

    } catch (error) {
      logger.error('Error analyzing velocity pattern', {
        service: 'SmartSecurityService',
        method: 'analyzeVelocityPattern',
        userId,
        action,
        error: error.message
      });
      
      // Em caso de erro, permitir mas logar
      return { allowed: true, riskScore: 0, riskLevel: 'UNKNOWN' };
    }
  }

  /**
   * Calcula risk score baseado em padrões de velocidade
   */
  async calculateVelocityRisk(actions, currentAction, amount) {
    if (actions.length === 0) return 0;

    let riskScore = 0;

    // Fator 1: Frequência de ações (peso: 40%)
    const frequencyRisk = Math.min(actions.length / 20, 1) * 0.4;
    riskScore += frequencyRisk;

    // Fator 2: Padrão de timing (peso: 30%)
    const timingRisk = this.analyzeTimingPatterns(actions) * 0.3;
    riskScore += timingRisk;

    // Fator 3: Variação de valores (peso: 20%)
    if (amount && currentAction !== 'login') {
      const amountRisk = this.analyzeAmountPatterns(actions, amount) * 0.2;
      riskScore += amountRisk;
    }

    // Fator 4: Diversidade de IPs/UserAgents (peso: 10%)
    const diversityRisk = this.analyzeDiversityPatterns(actions) * 0.1;
    riskScore += diversityRisk;

    return Math.min(riskScore, 1);
  }

  /**
   * QUICK WIN #2: Device Fingerprinting Inteligente
   */
  async analyzeDeviceFingerprint(userId, deviceInfo) {
    try {
      const fingerprintKey = `device_${userId}`;
      const knownDevices = behaviorCache.get(fingerprintKey) || [];

      const currentFingerprint = {
        ...deviceInfo,
        firstSeen: new Date(),
        lastSeen: new Date(),
        trustScore: 0
      };

      // Verificar se dispositivo já é conhecido
      const existingDevice = knownDevices.find(d => 
        this.compareDeviceFingerprints(d, currentFingerprint)
      );

      if (existingDevice) {
        existingDevice.lastSeen = new Date();
        existingDevice.trustScore = Math.min(existingDevice.trustScore + 0.1, 1);
        
        await this.logSecurityEvent(userId, 'KNOWN_DEVICE', {
          deviceId: this.generateDeviceId(currentFingerprint),
          trustScore: existingDevice.trustScore
        });

        return {
          isKnownDevice: true,
          trustScore: existingDevice.trustScore,
          riskLevel: 'LOW',
          deviceId: this.generateDeviceId(currentFingerprint)
        };
      } else {
        // Novo dispositivo - analisar risco
        knownDevices.push(currentFingerprint);
        behaviorCache.set(fingerprintKey, knownDevices);

        const riskScore = await this.calculateDeviceRisk(currentFingerprint, knownDevices);

        await this.logSecurityEvent(userId, 'NEW_DEVICE', {
          deviceId: this.generateDeviceId(currentFingerprint),
          riskScore,
          totalDevices: knownDevices.length
        });

        return {
          isKnownDevice: false,
          trustScore: 0,
          riskScore,
          riskLevel: this.getRiskLevel(riskScore),
          deviceId: this.generateDeviceId(currentFingerprint),
          requiresVerification: riskScore > this.riskThresholds.MEDIUM
        };
      }

    } catch (error) {
      logger.error('Error analyzing device fingerprint', {
        service: 'SmartSecurityService',
        method: 'analyzeDeviceFingerprint',
        userId,
        error: error.message
      });

      return { isKnownDevice: false, trustScore: 0, riskLevel: 'UNKNOWN' };
    }
  }

  /**
   * QUICK WIN #3: Pattern Analysis em Transações
   */
  async analyzeTransactionPatterns(userId, transactionData) {
    try {
      // Buscar histórico recente do usuário
      const userHistory = await this.getUserTransactionHistory(userId, 30); // 30 dias

      if (userHistory.length === 0) {
        // Usuário novo - score médio
        return {
          riskScore: 0.5,
          riskLevel: 'MEDIUM',
          reason: 'NEW_USER',
          recommendation: 'REQUIRE_ADDITIONAL_VERIFICATION'
        };
      }

      // Análise de padrões
      const patterns = {
        amountPattern: this.analyzeAmountPatterns(userHistory, transactionData.amount),
        timePattern: this.analyzeTimePatterns(userHistory, new Date()),
        recipientPattern: this.analyzeRecipientPatterns(userHistory, transactionData.recipient),
        frequencyPattern: this.analyzeFrequencyPatterns(userHistory)
      };

      // Calcular risk score combinado
      const riskScore = (
        patterns.amountPattern * 0.3 +
        patterns.timePattern * 0.2 +
        patterns.recipientPattern * 0.3 +
        patterns.frequencyPattern * 0.2
      );

      const analysis = {
        riskScore,
        riskLevel: this.getRiskLevel(riskScore),
        patterns,
        recommendation: this.getTransactionRecommendation(riskScore, patterns),
        requiresManualReview: riskScore > this.riskThresholds.HIGH
      };

      await this.logSecurityEvent(userId, 'TRANSACTION_ANALYSIS', {
        transactionId: transactionData.id,
        amount: transactionData.amount,
        riskScore,
        patterns
      });

      return analysis;

    } catch (error) {
      logger.error('Error analyzing transaction patterns', {
        service: 'SmartSecurityService',
        method: 'analyzeTransactionPatterns',
        userId,
        error: error.message
      });

      return { riskScore: 0.5, riskLevel: 'UNKNOWN' };
    }
  }

  /**
   * QUICK WIN #4: Sistema de Scoring de Risco em Tempo Real
   */
  async calculateUserRiskScore(userId) {
    try {
      const cacheKey = `risk_score_${userId}`;
      const cachedScore = behaviorCache.get(cacheKey);

      if (cachedScore) {
        return cachedScore;
      }

      // Componentes do risk score
      const components = {
        velocityRisk: await this.getVelocityRisk(userId),
        deviceRisk: await this.getDeviceRisk(userId),
        behaviorRisk: await this.getBehaviorRisk(userId),
        networkRisk: await this.getNetworkRisk(userId),
        historicalRisk: await this.getHistoricalRisk(userId)
      };

      // Pesos dos componentes
      const weights = {
        velocityRisk: 0.25,
        deviceRisk: 0.2,
        behaviorRisk: 0.25,
        networkRisk: 0.15,
        historicalRisk: 0.15
      };

      // Calcular score final
      const finalScore = Object.keys(components).reduce((score, key) => {
        return score + (components[key] * weights[key]);
      }, 0);

      const riskProfile = {
        userId,
        finalScore,
        riskLevel: this.getRiskLevel(finalScore),
        components,
        timestamp: new Date(),
        recommendations: this.getUserRecommendations(finalScore, components),
        restrictions: this.getUserRestrictions(finalScore, components)
      };

      // Cache por 10 minutos
      behaviorCache.set(cacheKey, riskProfile, 600);

      await this.logSecurityEvent(userId, 'RISK_SCORE_CALCULATED', {
        finalScore,
        components,
        riskLevel: riskProfile.riskLevel
      });

      return riskProfile;

    } catch (error) {
      logger.error('Error calculating user risk score', {
        service: 'SmartSecurityService',
        method: 'calculateUserRiskScore',
        userId,
        error: error.message
      });

      return {
        finalScore: 0.5,
        riskLevel: 'UNKNOWN',
        components: {},
        recommendations: ['MANUAL_REVIEW']
      };
    }
  }

  // Métodos auxiliares
  analyzeTimingPatterns(actions) {
    if (actions.length < 2) return 0;

    const intervals = [];
    for (let i = 1; i < actions.length; i++) {
      const interval = new Date(actions[i].timestamp) - new Date(actions[i-1].timestamp);
      intervals.push(interval);
    }

    // Detectar padrões muito uniformes (suspeito de bot)
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, interval) => {
      return sum + Math.pow(interval - avgInterval, 2);
    }, 0) / intervals.length;

    // Se variância muito baixa = comportamento robótico
    const uniformityRisk = variance < 1000 ? 0.8 : 0; // 1 segundo de variância

    // Se intervalos muito curtos = velocidade suspeita
    const speedRisk = avgInterval < 2000 ? 0.7 : 0; // 2 segundos médio

    return Math.max(uniformityRisk, speedRisk);
  }

  compareDeviceFingerprints(device1, device2) {
    const score = 
      (device1.userAgent === device2.userAgent ? 0.4 : 0) +
      (device1.screenResolution === device2.screenResolution ? 0.2 : 0) +
      (device1.timezone === device2.timezone ? 0.2 : 0) +
      (device1.language === device2.language ? 0.2 : 0);

    return score > 0.7; // 70% similarity threshold
  }

  generateDeviceId(fingerprint) {
    const data = JSON.stringify(fingerprint);
    return require('crypto').createHash('md5').update(data).digest('hex');
  }

  getRiskLevel(score) {
    if (score >= this.riskThresholds.CRITICAL) return 'CRITICAL';
    if (score >= this.riskThresholds.HIGH) return 'HIGH';
    if (score >= this.riskThresholds.MEDIUM) return 'MEDIUM';
    return 'LOW';
  }

  getRecommendation(riskScore, action) {
    if (riskScore >= this.riskThresholds.CRITICAL) {
      return 'BLOCK_ACTION';
    }
    if (riskScore >= this.riskThresholds.HIGH) {
      return 'REQUIRE_2FA';
    }
    if (riskScore >= this.riskThresholds.MEDIUM) {
      return 'ADDITIONAL_VERIFICATION';
    }
    return 'ALLOW';
  }

  async logSecurityEvent(userId, eventType, data) {
    try {
      await db.collection('securityEvents').add({
        userId,
        eventType,
        data,
        timestamp: new Date(),
        service: 'SmartSecurityService'
      });
    } catch (error) {
      logger.error('Failed to log security event', { userId, eventType, error: error.message });
    }
  }

  // Placeholder methods - implementar baseado nos dados disponíveis
  async getUserTransactionHistory(userId, days) {
    // TODO: Implementar busca no histórico de transações
    return [];
  }

  async getVelocityRisk(userId) {
    const actions = velocityCache.get(`velocity_${userId}`) || [];
    return Math.min(actions.length / 10, 1); // Normalizar para 0-1
  }

  getCurrentIP() {
    // TODO: Get from request context
    return '127.0.0.1';
  }

  getCurrentUserAgent() {
    // TODO: Get from request context
    return 'Unknown';
  }

  // Outros métodos auxiliares...
  analyzeAmountPatterns(history, currentAmount) { return 0.3; }
  analyzeTimePatterns(history, currentTime) { return 0.2; }
  analyzeRecipientPatterns(history, recipient) { return 0.1; }
  analyzeFrequencyPatterns(history) { return 0.2; }
  analyzeDiversityPatterns(actions) { return 0.1; }
  calculateDeviceRisk(fingerprint, devices) { return 0.4; }
  getDeviceRisk(userId) { return 0.3; }
  getBehaviorRisk(userId) { return 0.2; }
  getNetworkRisk(userId) { return 0.1; }
  getHistoricalRisk(userId) { return 0.2; }
  getTransactionRecommendation(score, patterns) { return 'ALLOW'; }
  getUserRecommendations(score, components) { return ['MONITOR']; }
  getUserRestrictions(score, components) { return []; }
}

module.exports = new SmartSecurityService();