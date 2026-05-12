// utils/healthUtils.js
const { logger } = require('../logger');
const healthConfig = require('../config/health/healthConfig');
const serviceWeights = require('../config/health/serviceWeights');

/**
 * Evaluates a metric value against defined thresholds
 * @param {number} value - The metric value to evaluate
 * @param {Object} thresholds - Object containing warning and error thresholds
 * @returns {string} - Status level: 'healthy', 'warning', or 'error'
 */
const evaluateThreshold = (value, thresholds) => {
    if (value >= thresholds.error) {
        return 'error';
    } else if (value >= thresholds.warning) {
        return 'warning';
    }
    return 'healthy';
};

/**
 * Determina o status operacional baseado no health score.
 */
const getOverallStatus = (score) => {
  if (score >= 95) return 'operational';
  if (score >= 80) return 'degraded';
  if (score >= 50) return 'partial_outage';
  if (score >= 10) return 'major_outage';
  return 'critical_outage';
};

/**
 * Calcula o health score ponderado do sistema.
 */
const determineOverallStatus = (checks) => {
  let score = 100;
  let totalConfidence = 0;
  let checksCount = 0;
  const categorizedServices = {};

  // Inicializa categorias
  Object.keys(serviceWeights.categories).forEach(cat => {
    categorizedServices[cat] = {
      label: serviceWeights.categories[cat].label,
      services: []
    };
  });

  for (const [serviceName, check] of Object.entries(checks)) {
    const config = serviceWeights.services[serviceName];
    if (!config) continue;

    checksCount++;
    const impact = config.impact || 0.1;
    const latency = parseFloat(check.responseTime) || 0;
    const latencyThreshold = config.latencyThreshold || 1000;
    
    let penalty = 0;
    let severity = 'none';

    // 1. Hard Failure Penalty
    if (check.status === 'error' || check.status === 'down') {
      penalty = impact * 100;
      severity = 'hard';
    } 
    // 2. Latency Penalty (Soft Degradation)
    else if (latency > latencyThreshold) {
      const slowRatio = Math.min(latency / latencyThreshold, 5); // Max 5x threshold
      penalty = impact * (slowRatio * 10); 
      severity = 'soft';
    }

    // Se falha de infra crítica, score zera
    if (severity === 'hard' && impact === 1.0) {
      score = 0;
    } else {
      score -= penalty;
    }

    // Confidence Level (simplificado para o exemplo)
    const confidence = check.status === 'error' ? 0.5 : 1.0;
    totalConfidence += confidence;

    // Adiciona à categoria
    categorizedServices[config.category].services.push({
      name: serviceName,
      status: check.status,
      latency: latency,
      impact: impact,
      severity: severity,
      details: check.details || check.error
    });
  }

  const finalScore = Math.max(0, Math.round(score));
  const confidenceLevel = checksCount > 0 ? (totalConfidence / checksCount).toFixed(2) : 1.0;

  return {
    health_score: finalScore,
    overall_status: getOverallStatus(finalScore),
    confidence: parseFloat(confidenceLevel),
    timestamp: new Date().toISOString(),
    categories: Object.keys(categorizedServices)
      .sort((a, b) => serviceWeights.categories[a].order - serviceWeights.categories[b].order)
      .map(cat => ({
        id: cat,
        ...categorizedServices[cat]
      }))
  };
};

/**
 * Logs the status of a service
 * @param {string} serviceName - Name of the service 
 * @param {Object} status - Status result from the service check
 */
const logServiceStatus = (serviceName, status) => {
    if (status.status === 'error') {
        logger.error(`🔴 Health check for ${serviceName}: ERROR`, {
            service: 'healthUtils',
            function: 'logServiceStatus',
            serviceName,
            status: status.status,
            details: status.details || status.error
        });
    } else if (status.status === 'warning' || status.status === 'degraded') {
        logger.warn(`🟠 Health check for ${serviceName}: ${status.status.toUpperCase()}`, {
            service: 'healthUtils',
            function: 'logServiceStatus',
            serviceName,
            status: status.status,
            details: status.details
        });
    } else {
        logger.info(`🟢 Health check for ${serviceName}: HEALTHY`, {
            service: 'healthUtils',
            function: 'logServiceStatus',
            serviceName,
            status: status.status
        });
    }
};

// Track last alert time to prevent alert storms
let lastAlertTime = 0;

/**
 * Sends alerts for unhealthy services if configured
 * @param {Object} healthStatus - Health status report
 */
const sendAlertsIfNeeded = (healthStatus) => {
    // Skip if alerts are disabled
    if (!healthConfig.monitoring.enableAlerts) {
        return;
    }
    
    // Check if we should alert based on threshold
    const shouldAlert = 
        healthStatus.status === 'error' || 
        (healthConfig.monitoring.alertThreshold === 'warning' && healthStatus.status === 'warning');
    
    if (!shouldAlert) {
        return;
    }
    
    // Prevent alert storms by checking the time interval
    const now = Date.now();
    if (now - lastAlertTime < healthConfig.monitoring.alertInterval) {
        logger.info('Alert suppressed due to rate limiting', {
            service: 'healthUtils',
            function: 'sendAlertsIfNeeded',
            timeSinceLastAlert: (now - lastAlertTime) / 1000 + 's'
        });
        return;
    }
    
    // Update last alert time
    lastAlertTime = now;
    
    // Log the alert (in a real system, this would send to configured channels)
    logger.warn(`🚨 HEALTH ALERT: System status is ${healthStatus.status.toUpperCase()}`, {
        service: 'healthUtils',
        function: 'sendAlertsIfNeeded',
        status: healthStatus.status,
        timestamp: healthStatus.timestamp,
        unhealthyServices: healthStatus.unhealthyServices || []
    });
    
    // Here you would implement code to send to Slack, email, etc.
    // For example:
    /*
    if (healthConfig.monitoring.alertChannels.includes('slack')) {
        sendSlackAlert(healthStatus);
    }
    
    if (healthConfig.monitoring.alertChannels.includes('email')) {
        sendEmailAlert(healthStatus);
    }
    */
};

/**
 * Creates a health check payload with consistent structure
 * @param {string} status - Status of the check
 * @param {Object} details - Details of the check
 * @returns {Object} - Formatted health check result
 */
const createHealthResponse = (status, details = {}) => {
    return {
        status: status,
        timestamp: new Date().toISOString(),
        details: details
    };
};

/**
 * Formats error information for health check responses
 * @param {Error} error - The error object
 * @returns {Object} - Formatted error information
 */
const formatErrorForHealthResponse = (error) => {
    return {
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
};

// ---------------------------------------------------------------------------
// SRE Vision — Motor de Scoring Ponderado
// ---------------------------------------------------------------------------

/**
 * Calcula o Health Score ponderado (0–100) a partir dos resultados dos checks.
 *
 * Para cada serviço:
 *   baseScore  = 1.0 (healthy) | 0.5 (warning) | 0.0 (error)
 *   latencyMult= 1.0 → reduzido se latência > threshold (Soft Degradation)
 *   contribution = weight * baseScore * latencyMult
 *
 * score = (Σ contribution / Σ weight) * 100
 *
 * @param {Object} checks — mapa de { serviceName: { status, latencyMs } }
 * @returns {{ score: number, penalties: Object }}
 */
const calculateWeightedScore = (checks) => {
    const weights = serviceWeights.services;
    const penaltyMult = serviceWeights.latencyPenalty;

    let totalWeight = 0;
    let totalContribution = 0;
    const penalties = {};

    for (const [name, cfg] of Object.entries(weights)) {
        const check = checks[name];
        if (!check) continue;

        const weight = cfg.weight;
        totalWeight += weight;

        // Base score por status
        let base = check.status === 'healthy' ? 1.0
                 : check.status === 'warning'  ? 0.5
                 : 0.0;

        // Penalidade de latência (Soft Degradation)
        const latency = check.latencyMs || 0;
        let latencyFactor = 1.0;
        if (latency > cfg.latencyError) {
            latencyFactor = 1.0 - penaltyMult.error;
            penalties[name] = { level: 'error', latencyMs: latency, reduction: `${(penaltyMult.error * 100).toFixed(0)}%` };
        } else if (latency > cfg.latencyWarn) {
            latencyFactor = 1.0 - penaltyMult.warn;
            penalties[name] = { level: 'warn', latencyMs: latency, reduction: `${(penaltyMult.warn * 100).toFixed(0)}%` };
        }

        totalContribution += weight * base * latencyFactor;
    }

    const score = totalWeight > 0 ? Math.round((totalContribution / totalWeight) * 100) : 0;
    return { score, penalties };
};

/**
 * Mapeia um score numérico para a taxonomia de status operacional.
 *
 * @param {number} score — 0 a 100
 * @returns {{ status: string, emoji: string, description: string }}
 */
const mapScoreToStatus = (score) => {
    const t = serviceWeights.statusThresholds;

    if (score >= t.operational)    return { status: 'operational',    emoji: '🟢', description: 'Sistema operando em condições ideais.' };
    if (score >= t.degraded)       return { status: 'degraded',       emoji: '🟡', description: 'Sistema funcional, mas com latência elevada (Soft Degradation).' };
    if (score >= t.partial_outage) return { status: 'partial_outage', emoji: '🟠', description: 'Serviços não-críticos (Engajamento) estão fora do ar.' };
    if (score >= t.major_outage)   return { status: 'major_outage',   emoji: '🔴', description: 'Falha em serviços do Core Business (Caixinha/Asaas).' };
    return                                { status: 'critical_outage', emoji: '💀', description: 'Infra Crítica (DB/API) offline. Incidente de Prioridade 0 (P0).' };
};

/**
 * Calcula o Confidence Level do snapshot de health check.
 *
 * confidence = 1.0: todos os checks concluíram na primeira tentativa sem erro
 * confidence = 0.5: algum check retornou erro ou indicador de degradação
 * confidence = 0.0: nenhum check completou (falha total de monitoramento)
 *
 * @param {Object} checks — mapa de { serviceName: { status, latencyMs } }
 * @returns {number} — 0.0 | 0.5 | 1.0
 */
const computeConfidence = (checks) => {
    const results = Object.values(checks);
    if (results.length === 0) return 0.0;

    const errorCount = results.filter(c => c.status === 'error').length;

    if (errorCount === results.length) return 0.0;
    if (errorCount > 0)               return 0.5;
    return 1.0;
};

module.exports = {
    evaluateThreshold,
    determineOverallStatus,
    logServiceStatus,
    sendAlertsIfNeeded,
    createHealthResponse,
    formatErrorForHealthResponse,
    // SRE Vision
    calculateWeightedScore,
    mapScoreToStatus,
    computeConfidence,
};