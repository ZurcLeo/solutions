/**
 * @fileoverview Smart Security Middleware - AI-powered security checks
 * @module middlewares/smartSecurity
 */

const SmartSecurityService = require('../services/SmartSecurityService');
const { logger } = require('../logger');

/**
 * Middleware para análise de velocidade de ações
 */
const velocityCheck = (action) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return next(); // Skip if no user authentication
      }

      // Extrair amount se disponível no body
      const amount = req.body?.amount || req.body?.valor || null;

      const analysis = await SmartSecurityService.analyzeVelocityPattern(
        userId, 
        action, 
        amount
      );

      if (!analysis.allowed) {
        logger.warn('Velocity check blocked action', {
          userId,
          action,
          riskScore: analysis.riskScore,
          actionsCount: analysis.actions,
          middleware: 'velocityCheck'
        });

        return res.status(429).json({
          error: 'Rate limit exceeded due to suspicious activity',
          riskLevel: analysis.riskLevel,
          recommendation: analysis.recommendation,
          retryAfter: 300 // 5 minutes
        });
      }

      // Adicionar informações de segurança ao request
      req.securityContext = {
        ...(req.securityContext || {}),
        velocity: analysis
      };

      next();

    } catch (error) {
      logger.error('Error in velocity check middleware', {
        error: error.message,
        userId: req.user?.uid,
        action,
        middleware: 'velocityCheck'
      });
      
      // Em caso de erro, permitir mas logar
      next();
    }
  };
};

/**
 * Middleware para análise de device fingerprinting
 */
const deviceCheck = async (req, res, next) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return next();
    }

    // Extrair informações do device
    const deviceInfo = {
      userAgent: req.get('User-Agent'),
      ip: req.ip || req.connection.remoteAddress,
      acceptLanguage: req.get('Accept-Language'),
      acceptEncoding: req.get('Accept-Encoding'),
      // Custom headers se enviados pelo frontend
      screenResolution: req.get('X-Screen-Resolution'),
      timezone: req.get('X-Timezone'),
      platform: req.get('X-Platform')
    };

    const analysis = await SmartSecurityService.analyzeDeviceFingerprint(userId, deviceInfo);

    // Se é dispositivo novo com alto risco, requer verificação adicional
    if (!analysis.isKnownDevice && analysis.requiresVerification) {
      logger.warn('New high-risk device detected', {
        userId,
        deviceId: analysis.deviceId,
        riskScore: analysis.riskScore,
        middleware: 'deviceCheck'
      });

      // Não bloquear imediatamente, mas marcar para verificação
      req.securityContext = {
        ...(req.securityContext || {}),
        device: analysis,
        requiresAdditionalVerification: true
      };
    } else {
      req.securityContext = {
        ...(req.securityContext || {}),
        device: analysis
      };
    }

    next();

  } catch (error) {
    logger.error('Error in device check middleware', {
      error: error.message,
      userId: req.user?.uid,
      middleware: 'deviceCheck'
    });
    next();
  }
};

/**
 * Middleware para análise de padrões de transação
 */
const transactionAnalysis = async (req, res, next) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return next();
    }

    // Verificar se é uma transação financeira
    const isFinancialAction = [
      '/api/payments',
      '/api/caixinha/contribute',
      '/api/loans',
      '/api/wallet'
    ].some(path => req.path.startsWith(path));

    if (!isFinancialAction) {
      return next();
    }

    const transactionData = {
      amount: req.body?.amount || req.body?.valor || 0,
      recipient: req.body?.recipient || req.body?.destinatario,
      type: req.body?.type || 'unknown',
      id: req.body?.id || 'temp_' + Date.now()
    };

    const analysis = await SmartSecurityService.analyzeTransactionPatterns(
      userId, 
      transactionData
    );

    if (analysis.requiresManualReview) {
      logger.warn('Transaction requires manual review', {
        userId,
        transactionId: transactionData.id,
        amount: transactionData.amount,
        riskScore: analysis.riskScore,
        middleware: 'transactionAnalysis'
      });

      return res.status(202).json({
        message: 'Transaction submitted for review',
        transactionId: transactionData.id,
        status: 'PENDING_REVIEW',
        riskLevel: analysis.riskLevel,
        estimatedReviewTime: '1-24 hours'
      });
    }

    req.securityContext = {
      ...(req.securityContext || {}),
      transaction: analysis
    };

    next();

  } catch (error) {
    logger.error('Error in transaction analysis middleware', {
      error: error.message,
      userId: req.user?.uid,
      middleware: 'transactionAnalysis'
    });
    next();
  }
};

/**
 * Middleware para scoring de risco geral do usuário
 */
const riskScoring = async (req, res, next) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return next();
    }

    // Executar apenas em rotas críticas
    const isCriticalRoute = [
      '/api/payments',
      '/api/auth',
      '/api/caixinha',
      '/api/loans'
    ].some(path => req.path.startsWith(path));

    if (!isCriticalRoute) {
      return next();
    }

    const riskProfile = await SmartSecurityService.calculateUserRiskScore(userId);

    // Aplicar restrições baseadas no score de risco
    if (riskProfile.riskLevel === 'CRITICAL') {
      logger.error('Critical risk user blocked', {
        userId,
        riskScore: riskProfile.finalScore,
        restrictions: riskProfile.restrictions,
        middleware: 'riskScoring'
      });

      return res.status(403).json({
        error: 'Account temporarily restricted due to security concerns',
        riskLevel: riskProfile.riskLevel,
        contactSupport: true,
        supportMessage: 'Please contact support for account review'
      });
    }

    if (riskProfile.riskLevel === 'HIGH') {
      // Adicionar headers de aviso
      res.set('X-Security-Warning', 'High risk activity detected');
      res.set('X-Requires-Verification', 'true');
    }

    req.securityContext = {
      ...(req.securityContext || {}),
      riskProfile
    };

    next();

  } catch (error) {
    logger.error('Error in risk scoring middleware', {
      error: error.message,
      userId: req.user?.uid,
      middleware: 'riskScoring'
    });
    next();
  }
};

/**
 * Middleware para logging de contexto de segurança
 */
const securityLogging = (req, res, next) => {
  // Override do res.json para capturar resposta
  const originalJson = res.json;
  res.json = function(data) {
    // Log do contexto de segurança se disponível
    if (req.securityContext && req.user?.uid) {
      logger.info('Security context logged', {
        userId: req.user.uid,
        path: req.path,
        method: req.method,
        securityContext: {
          velocity: req.securityContext.velocity ? {
            riskScore: req.securityContext.velocity.riskScore,
            riskLevel: req.securityContext.velocity.riskLevel,
            actionsCount: req.securityContext.velocity.actions
          } : undefined,
          device: req.securityContext.device ? {
            isKnownDevice: req.securityContext.device.isKnownDevice,
            trustScore: req.securityContext.device.trustScore,
            riskLevel: req.securityContext.device.riskLevel
          } : undefined,
          transaction: req.securityContext.transaction ? {
            riskScore: req.securityContext.transaction.riskScore,
            riskLevel: req.securityContext.transaction.riskLevel
          } : undefined,
          riskProfile: req.securityContext.riskProfile ? {
            finalScore: req.securityContext.riskProfile.finalScore,
            riskLevel: req.securityContext.riskProfile.riskLevel
          } : undefined
        },
        responseStatus: res.statusCode,
        responseTime: Date.now() - (req._startTime || Date.now())
      });
    }

    return originalJson.call(this, data);
  };

  req._startTime = Date.now();
  next();
};

module.exports = {
  velocityCheck,
  deviceCheck,
  transactionAnalysis,
  riskScoring,
  securityLogging
};