/**
 * Calculador de Severidade de Incidentes (Heurística Local)
 * @module utils/severityCalculator
 */

const SEVERITY = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL'
};

/**
 * Calcula a severidade de uma requisição ou erro baseado em regras de negócio e performance.
 * @param {Object} sreContext - Contexto sanitizado da requisição
 * @param {Object} responseData - Dados da resposta (status, duration)
 * @param {Error} [error] - Erro capturado, se houver
 * @returns {Object} { level, reason }
 */
function calculateSeverity(sreContext, responseData = {}, error = null) {
  const { status, durationMs } = responseData;
  const body = sreContext.body || {};
  const amount = Number(body.amount || body.valor || 0);

  // 1. CRITICAL: Falhas sistêmicas ou de altíssimo impacto
  if (status === 500 && amount > 500) {
    return { level: SEVERITY.CRITICAL, reason: 'Internal Server Error on high value transaction' };
  }
  if (durationMs > 30000) { // > 30 segundos
    return { level: SEVERITY.CRITICAL, reason: 'Request Timeout / Extreme Latency' };
  }
  if (error && error.message && error.message.includes('MERCADOPAGO_ACCESS_TOKEN')) {
    return { level: SEVERITY.CRITICAL, reason: 'Configuration Secret Missing' };
  }

  // 2. HIGH: Problemas de negócio, segurança ou performance grave
  if (status === 401 || status === 403) {
    return { level: SEVERITY.HIGH, reason: 'Security/Auth Violation' };
  }
  if (status >= 500) {
    return { level: SEVERITY.HIGH, reason: 'Internal Server Error' };
  }
  if (durationMs > 10000) { // > 10 segundos
    return { level: SEVERITY.HIGH, reason: 'High Latency' };
  }
  if (amount > 1000) {
    return { level: SEVERITY.HIGH, reason: 'High value transaction' };
  }
  if (error && error.name === 'ValidationError') {
    // Erros de validação em transações de valor alto são HIGH
    if (amount > 100) return { level: SEVERITY.HIGH, reason: 'Validation error on relevant amount' };
  }

  // 3. MEDIUM: Erros esperados mas que merecem atenção
  if (status >= 400 && status < 500) {
    // 429 (Rate Limit) ou 400 (Bad Request)
    return { level: SEVERITY.MEDIUM, reason: `Client Error (${status})` };
  }
  if (durationMs > 3000) { // > 3 segundos
    return { level: SEVERITY.MEDIUM, reason: 'Moderate Latency' };
  }

  // 4. LOW: Operação normal ou erros triviais
  return { level: SEVERITY.LOW, reason: 'Standard operation' };
}

module.exports = {
  calculateSeverity,
  SEVERITY
};
