/**
 * @fileoverview Exemplos de como integrar o Smart Security System
 * @module examples/securityIntegration
 */

const { 
  velocityCheck, 
  deviceCheck, 
  transactionAnalysis, 
  riskScoring, 
  securityLogging 
} = require('../middlewares/smartSecurity');

// ====================================
// EXEMPLO 1: INTEGRAÇÃO EM ROTAS DE PAGAMENTO
// ====================================

/*
// routes/payments.js
const express = require('express');
const router = express.Router();

// Aplicar middleware de segurança em transações
router.post('/create', 
  verifyToken,                           // Autenticação
  deviceCheck,                           // Check device fingerprint
  velocityCheck('payment'),              // Check velocity de pagamentos
  transactionAnalysis,                   // Análise de padrões
  riskScoring,                          // Score de risco geral
  securityLogging,                      // Log de contexto
  PaymentController.createPayment       // Controller final
);

// Para PIX - mais restritivo
router.post('/pix', 
  verifyToken,
  deviceCheck,
  velocityCheck('pix_payment'),         // Mais restritivo para PIX
  transactionAnalysis,
  riskScoring,
  (req, res, next) => {
    // Verificação adicional para PIX
    if (req.securityContext?.riskProfile?.riskLevel === 'HIGH') {
      return res.status(202).json({
        message: 'PIX transaction requires additional verification',
        requiresApproval: true,
        estimatedTime: '10-30 minutes'
      });
    }
    next();
  },
  securityLogging,
  PaymentController.createPixPayment
);
*/

// ====================================
// EXEMPLO 2: INTEGRAÇÃO EM CAIXINHAS
// ====================================

/*
// routes/caixinha.js

// Contribuição para caixinha
router.post('/:caixinhaId/contribute',
  verifyToken,
  deviceCheck,
  velocityCheck('caixinha_contribution'),
  transactionAnalysis,
  riskScoring,
  securityLogging,
  CaixinhaController.contribute
);

// Criação de nova caixinha (ação sensível)
router.post('/create',
  verifyToken,
  deviceCheck,
  velocityCheck('caixinha_creation'),
  (req, res, next) => {
    // Restrições especiais para criação de caixinhas
    const riskLevel = req.securityContext?.riskProfile?.riskLevel;
    
    if (riskLevel === 'HIGH' || riskLevel === 'CRITICAL') {
      return res.status(403).json({
        error: 'Account verification required to create caixinhas',
        riskLevel,
        contactSupport: true
      });
    }
    next();
  },
  securityLogging,
  CaixinhaController.create
);
*/

// ====================================
// EXEMPLO 3: INTEGRAÇÃO EM AUTENTICAÇÃO
// ====================================

/*
// routes/auth.js

// Login com análise de device
router.post('/login',
  rateLimiter,                          // Rate limit básico
  deviceCheck,                          // Análise de dispositivo
  velocityCheck('login'),               // Velocity de logins
  (req, res, next) => {
    // Logic de segurança para login
    const deviceAnalysis = req.securityContext?.device;
    
    if (!deviceAnalysis?.isKnownDevice && deviceAnalysis?.riskScore > 0.7) {
      // Dispositivo novo com alto risco
      req.requireEmailVerification = true;
      req.securityNotice = 'New device detected. Email verification required.';
    }
    
    next();
  },
  securityLogging,
  AuthController.login
);

// Registro de usuário
router.post('/register',
  rateLimiter,
  deviceCheck,
  velocityCheck('registration'),
  (req, res, next) => {
    // Verificações para registro
    const velocityAnalysis = req.securityContext?.velocity;
    
    if (velocityAnalysis?.riskLevel === 'HIGH') {
      return res.status(429).json({
        error: 'Too many registration attempts. Please try again later.',
        retryAfter: 3600
      });
    }
    
    next();
  },
  securityLogging,
  AuthController.register
);
*/

// ====================================
// EXEMPLO 4: MIDDLEWARE CUSTOMIZADO
// ====================================

const customSecurityMiddleware = (options = {}) => {
  return async (req, res, next) => {
    try {
      // Aplicar verificações baseadas na rota
      const { 
        requiresDeviceCheck = true,
        requiresVelocityCheck = true,
        requiresTransactionAnalysis = false,
        maxRiskLevel = 'HIGH',
        customAction = null
      } = options;

      // Executar checks condicionalmente
      if (requiresDeviceCheck) {
        await new Promise((resolve) => {
          deviceCheck(req, res, resolve);
        });
      }

      if (requiresVelocityCheck) {
        const actionType = customAction || req.route?.path || 'generic';
        await new Promise((resolve) => {
          velocityCheck(actionType)(req, res, resolve);
        });
      }

      if (requiresTransactionAnalysis) {
        await new Promise((resolve) => {
          transactionAnalysis(req, res, resolve);
        });
      }

      // Verificar nível máximo de risco
      const currentRiskLevel = req.securityContext?.riskProfile?.riskLevel;
      const riskLevels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
      
      if (riskLevels.indexOf(currentRiskLevel) > riskLevels.indexOf(maxRiskLevel)) {
        return res.status(403).json({
          error: `Risk level too high for this operation`,
          currentRiskLevel,
          maxAllowedRiskLevel: maxRiskLevel,
          recommendation: 'Please complete additional security verification'
        });
      }

      next();

    } catch (error) {
      console.error('Error in custom security middleware:', error);
      // Em caso de erro, permitir mas logar
      next();
    }
  };
};

// ====================================
// EXEMPLO 5: INTEGRAÇÃO NO INDEX.JS
// ====================================

/*
// Adicionar no index.js principal

// Importar rotas de security
const securityRoutes = require('./routes/security');

// Registrar rotas
app.use('/api/security', securityRoutes);

// Middleware global de logging de segurança (opcional)
app.use(securityLogging);
*/

// ====================================
// EXEMPLO 6: CONFIGURAÇÃO DE ALERTAS
// ====================================

const SecurityAlertService = {
  async checkForAlerts(securityContext) {
    const alerts = [];

    // Alert para high risk users
    if (securityContext?.riskProfile?.riskLevel === 'CRITICAL') {
      alerts.push({
        type: 'CRITICAL_RISK_USER',
        userId: securityContext.userId,
        message: 'User has critical risk score',
        action: 'IMMEDIATE_REVIEW_REQUIRED'
      });
    }

    // Alert para novos dispositivos suspeitos
    if (!securityContext?.device?.isKnownDevice && 
        securityContext?.device?.riskScore > 0.8) {
      alerts.push({
        type: 'SUSPICIOUS_NEW_DEVICE',
        userId: securityContext.userId,
        deviceId: securityContext.device.deviceId,
        message: 'High-risk new device detected',
        action: 'DEVICE_VERIFICATION_REQUIRED'
      });
    }

    // Alert para padrões de velocity suspeitos
    if (securityContext?.velocity?.riskLevel === 'HIGH' && 
        securityContext?.velocity?.actions > 15) {
      alerts.push({
        type: 'VELOCITY_ATTACK',
        userId: securityContext.userId,
        message: 'Potential velocity attack detected',
        action: 'TEMPORARY_RATE_LIMIT'
      });
    }

    return alerts;
  }
};

// ====================================
// EXEMPLO 7: DASHBOARD DE MONITORAMENTO
// ====================================

const SecurityDashboard = {
  async getRealTimeMetrics() {
    return {
      activeUsers: await this.getActiveUsers(),
      riskDistribution: await this.getRiskDistribution(),
      suspiciousActivities: await this.getSuspiciousActivities(),
      blockedAttempts: await this.getBlockedAttempts(),
      alerts: await this.getActiveAlerts()
    };
  },

  async getActiveUsers() {
    // Implementar busca de usuários ativos
    return { total: 0, byRiskLevel: {} };
  },

  async getRiskDistribution() {
    // Implementar distribuição de riscos
    return { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  },

  async getSuspiciousActivities() {
    // Implementar atividades suspeitas
    return [];
  },

  async getBlockedAttempts() {
    // Implementar tentativas bloqueadas
    return { total: 0, lastHour: 0 };
  },

  async getActiveAlerts() {
    // Implementar alertas ativos
    return [];
  }
};

module.exports = {
  customSecurityMiddleware,
  SecurityAlertService,
  SecurityDashboard
};