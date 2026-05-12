const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

/**
 * Persiste o contexto de log no PostgreSQL (Supabase)
 * @param {Object} sreContext - Contexto sanitizado
 * @param {Object} options - Dados adicionais (status, etc)
 */
async function saveContextLog(sreContext) {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    const { error } = await client
      .from('deposit_context_logs')
      .insert([{
        correlation_id: sreContext.correlation_id,
        user_hash: sreContext.userHash,
        severity: sreContext.severity,
        severity_reason: sreContext.severity_reason,
        duration_ms: parseFloat(sreContext.duration_ms),
        status_code: sreContext.status_code,
        method: sreContext.method,
        path: sreContext.path,
        metadata_snapshot: sreContext, // Salva o snapshot completo no JSONB
        created_at: sreContext.api_received_at
      }]);

    if (error) {
      logger.error('Error persisting SRE context log to Supabase', {
        service: 'SreRepository',
        error: error.message,
        correlation_id: sreContext.correlation_id
      });
    }
  } catch (err) {
    logger.error('Unexpected error in SreRepository', {
      service: 'SreRepository',
      error: err.message
    });
  }
}

/**
 * Recupera os logs recentes (usado pelo dashboard)
 * @param {Object} filters - Filtros de severidade e limite
 */
async function getRecentLogs(filters = {}) {
  const client = getSupabaseClient();
  if (!client) return [];

  const { severity, limit = 50 } = filters;

  let query = client
    .from('deposit_context_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (severity) {
    query = query.eq('severity', severity);
  }

  const { data, error } = await query;

  if (error) {
    logger.error('Error fetching SRE logs', { service: 'SreRepository', error: error.message });
    return [];
  }

  return data;
}

/**
 * Busca logs que ainda não possuem diagnóstico da IA.
 * Prioriza MEDIUM/HIGH/CRITICAL ou qualquer erro >= 400.
 * @param {number} limit 
 */
async function getPendingDiagnostics(limit = 5) {
  const client = getSupabaseClient();
  if (!client) return [];

  // Primeiro tentamos buscar erros explícitos (status >= 400)
  const { data, error } = await client
    .from('deposit_context_logs')
    .select('*')
    .or('status_code.gte.400,severity.in.(MEDIUM,HIGH,CRITICAL)')
    .is('ai_diagnosis', null)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    logger.error('Error fetching pending diagnostics', { service: 'SreRepository', error: error.message });
    return [];
  }

  if (data.length > 0) {
    logger.info(`SreRepository: Found ${data.length} pending incidents for diagnosis`, { service: 'SreRepository' });
  }

  return data;
}

/**
* Atualiza um log com o diagnóstico gerado pela IA.
 * @param {string} correlation_id 
 * @param {Object} diagnosisResult 
 */
async function updateDiagnosis(correlation_id, diagnosisResult) {
  const client = getSupabaseClient();
  if (!client) return;

  const { error } = await client
    .from('deposit_context_logs')
    .update({ 
      ai_diagnosis: diagnosisResult.ai_diagnosis,
      diagnosed_at: diagnosisResult.diagnosed_at
    })
    .eq('correlation_id', correlation_id);

  if (error) {
    logger.error('Error updating AI diagnosis', { 
      service: 'SreRepository', 
      error: error.message,
      correlation_id 
    });
  }
}

/**
 * Registra o feedback do desenvolvedor (Accept/Reject) para treinar a IA (Few-shot).
 * @param {Object} feedbackData - { correlation_id, feedback (accept/reject), comment, rca, classification }
 */
async function saveFeedback(feedbackData) {
  const client = getSupabaseClient();
  if (!client) return;

  const { error } = await client
    .from('ai_feedback_loop')
    .insert([{
      correlation_id: feedbackData.correlation_id,
      feedback_type: feedbackData.feedback, // 'accept' ou 'reject'
      developer_comment: feedbackData.comment,
      ai_classification: feedbackData.classification,
      ai_rca: feedbackData.rca,
      created_at: new Date().toISOString()
    }]);

  if (error) {
    logger.error('Error saving AI feedback', { service: 'SreRepository', error: error.message });
    throw error;
  }
}

module.exports = {
  saveContextLog,
  getRecentLogs,
  getPendingDiagnostics,
  updateDiagnosis,
  saveFeedback
};
