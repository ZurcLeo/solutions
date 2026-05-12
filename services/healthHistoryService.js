/**
 * healthHistoryService.js
 *
 * Persiste e consulta snapshots periódicos do Health Score no Supabase.
 * Usado pelo sreWorker para gravação e pelo SreAgentService para
 * análise de tendência (queda súbita vs. degradação lenta).
 */

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

/**
 * Salva um snapshot do health check na tabela health_history.
 *
 * @param {Object} params
 * @param {number} params.healthScore         — Score ponderado 0-100
 * @param {string} params.overallStatus       — Status operacional (operational, degraded, etc.)
 * @param {number} params.confidence          — Confidence level 0.0 | 0.5 | 1.0
 * @param {Object} params.dependencies        — Map de { serviceName: { status, latencyMs } }
 * @param {Object} [params.latencyPenalties]  — Penalidades de latência aplicadas (opcional)
 */
async function saveSnapshot({ healthScore, overallStatus, confidence, dependencies, latencyPenalties }) {
  const client = getSupabaseClient();
  if (!client) return;

  // Resumo compacto dos checks para a coluna JSONB
  const checksSummary = {};
  for (const [name, check] of Object.entries(dependencies || {})) {
    checksSummary[name] = {
      status:    check.status,
      latencyMs: check.latencyMs ?? null,
    };
  }

  const { error } = await client
    .from('health_history')
    .insert([{
      health_score:     healthScore,
      overall_status:   overallStatus,
      confidence_level: confidence,
      checks_summary:   checksSummary,
      penalties:        latencyPenalties || null,
      created_at:       new Date().toISOString(),
    }]);

  if (error) {
    logger.error('healthHistoryService: falha ao salvar snapshot', {
      service: 'healthHistoryService',
      error: error.message,
    });
  }
}

/**
 * Busca os últimos N snapshots confiáveis (confidence >= 0.7) para análise de tendência.
 *
 * @param {number} [limit=10]
 * @returns {Promise<Array>}
 */
async function getRecentHistory(limit = 10) {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from('health_history')
    .select('id, health_score, overall_status, confidence_level, checks_summary, penalties, created_at')
    .gte('confidence_level', 0.7)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('healthHistoryService: falha ao buscar histórico', {
      service: 'healthHistoryService',
      error: error.message,
    });
    return [];
  }

  return data;
}

/**
 * Analisa os últimos N snapshots e retorna um resumo de tendência.
 * Usado pelo SreAgentService para contextualizar diagnósticos.
 *
 * @param {number} [limit=10]
 * @returns {Promise<{ trend: 'stable'|'degrading'|'recovering'|'insufficient_data', avgScore: number, minScore: number, history: Array }>}
 */
async function getTrend(limit = 10) {
  const history = await getRecentHistory(limit);

  if (history.length < 3) {
    return { trend: 'insufficient_data', avgScore: null, minScore: null, history };
  }

  const scores = history.map(h => h.health_score);
  const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const minScore = Math.min(...scores);

  // Compara o score atual (primeiro registro, mais recente) com a média dos demais
  const currentScore = scores[0];
  const historicalAvg = Math.round(scores.slice(1).reduce((a, b) => a + b, 0) / (scores.length - 1));

  let trend;
  const delta = currentScore - historicalAvg;

  if (Math.abs(delta) <= 5)       trend = 'stable';
  else if (delta < -5)            trend = 'degrading';
  else                            trend = 'recovering';

  return { trend, avgScore, minScore, currentScore, historicalAvg, history };
}

module.exports = {
  saveSnapshot,
  getRecentHistory,
  getTrend,
};
