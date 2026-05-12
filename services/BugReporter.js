const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

/**
 * Persiste resultados de runs do QA Orchestrator no PostgreSQL (Supabase).
 * 
 * Substitui a implementação anterior do Firestore para unificar a fonte de verdade.
 */
class BugReporter {
  /**
   * Salva o run completo no Supabase.
   *
   * @param {object} runData
   * @param {string} runData.runId
   * @param {string} runData.triggeredBy  - 'cron' | 'manual' | 'deploy_hook'
   * @param {Date}   runData.startedAt
   * @param {object} runData.claudeReport - Interpretação do Claude
   * @param {Array}  runData.rawResults   - Resultados brutos de cada flow
   */
  static async saveRun(runData) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      logger.error('BugReporter: Supabase client não disponível. Run não será salvo.', { runId: runData.runId });
      return;
    }

    const { runId, triggeredBy, startedAt, claudeReport, rawResults } = runData;

    try {
      // 1. Inserir na tabela principal qa_runs
      const { error: runError } = await supabase
        .from('qa_runs')
        .insert([{
          run_id:       runId,
          triggered_by: triggeredBy || 'manual',
          started_at:   startedAt   || new Date().toISOString(),
          completed_at: new Date().toISOString(),
          health_score: claudeReport?.healthScore ?? null,
          summary:      claudeReport?.summary     ?? 'Interpretação indisponível',
          total_flows:  rawResults.length,
          passed_flows: rawResults.filter(r => r.passed).length,
          failed_flows: rawResults.filter(r => !r.passed).length,
          from_cache:   claudeReport?.fromCache   ?? false
        }]);

      if (runError) throw runError;

      // 2. Inserir Bugs
      const bugs = [
        ...(claudeReport?.criticalBugs || []).map(b => ({ ...b, severity: 'critical' })),
        ...(claudeReport?.minorBugs    || []).map(b => ({ ...b, severity: 'minor'    })),
      ].map(bug => ({
        run_id:         runId,
        flow:           bug.flow,
        step:           bug.step,
        severity:       bug.severity,
        error:          bug.error,
        affected_users: bug.affectedUsers,
        suggested_fix:  bug.suggestedFix
      }));

      if (bugs.length > 0) {
        const { error: bugsError } = await supabase.from('qa_run_bugs').insert(bugs);
        if (bugsError) logger.error('BugReporter: Erro ao salvar bugs', { runId, error: bugsError.message });
      }

      // 3. Inserir Steps
      const steps = rawResults.flatMap(flowResult =>
        flowResult.steps.map(step => ({
          run_id:         runId,
          flow_id:        flowResult.flowId,
          step_name:      step.name,
          success:        step.success,
          duration:       step.duration,
          correlation_id: step.correlationId,
          artifacts:      BugReporter._sanitize(step.artifacts || []),
          error:          step.error         || null,
          error_detail:   step.errorDetail   || null
        }))
      );

      if (steps.length > 0) {
        // Inserir em lotes se houver muitos (opcional, mas bom para robustez)
        const { error: stepsError } = await supabase.from('qa_run_steps').insert(steps);
        if (stepsError) logger.error('BugReporter: Erro ao salvar steps', { runId, error: stepsError.message });
      }

      logger.info('BugReporter: run salvo no Supabase', {
        service:      'BugReporter',
        runId,
        healthScore:  claudeReport?.healthScore,
        bugsFound:    bugs.length,
      });

      return runId;

    } catch (err) {
      logger.error('BugReporter.saveRun: falha ao persistir no Supabase', {
        runId,
        error: err.message
      });
      throw err;
    }
  }

  /**
   * Busca os N runs mais recentes.
   */
  static async listRecent(limit = 20) {
    const supabase = getSupabaseClient();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from('qa_runs')
      .select('*')
      .order('completed_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('BugReporter.listRecent: erro ao buscar runs', { error: error.message });
      return [];
    }

    // Mapear para o formato esperado pelo frontend (se necessário)
    return data.map(r => ({
      ...r,
      runId: r.run_id,
      healthScore: r.health_score,
      completedAt: r.completed_at,
      passedFlows: r.passed_flows,
      totalFlows: r.total_flows
    }));
  }

  /**
   * Busca um run completo incluindo bugs e steps.
   */
  static async getRunDetail(runId) {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    // Busca o run principal
    const { data: run, error: runError } = await supabase
      .from('qa_runs')
      .select('*')
      .eq('run_id', runId)
      .single();

    if (runError || !run) return null;

    // Busca bugs e steps em paralelo
    const [bugsRes, stepsRes] = await Promise.all([
      supabase.from('qa_run_bugs').select('*').eq('run_id', runId).order('reported_at', { ascending: true }),
      supabase.from('qa_run_steps').select('*').eq('run_id', runId).order('recorded_at', { ascending: true })
    ]);

    return {
      ...run,
      runId:         run.run_id,
      healthScore:   run.health_score,
      completedAt:   run.completed_at,
      passedFlows:   run.passed_flows,
      totalFlows:    run.total_flows,
      bugs:  (bugsRes.data || []).map(b => ({
        ...b,
        affectedUsers: b.affected_users,
        suggestedFix:  b.suggested_fix
      })),
      steps: (stepsRes.data || []).map(s => ({
        ...s,
        flowId:        s.flow_id,
        stepName:      s.step_name,
        correlationId: s.correlation_id,
        errorDetail:   s.error_detail
      }))
    };
  }

  /**
   * Retorna o healthScore do run mais recente.
   */
  static async getLatestHealthScore() {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    const { data, error } = await supabase
      .from('qa_runs')
      .select('health_score, run_id, completed_at, passed_flows, total_flows')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return null;

    return {
      healthScore:  data.health_score,
      runId:        data.run_id,
      completedAt:  data.completed_at,
      passedFlows:  data.passed_flows,
      totalFlows:   data.total_flows
    };
  }

  /**
   * Remove recursivamente valores `undefined`.
   */
  static _sanitize(value) {
    if (value === undefined) return null;
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(BugReporter._sanitize);
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, BugReporter._sanitize(v)])
    );
  }

  /**
   * Retorna os bugs de runs recentes para detecção de recorrência.
   */
  static async getRecentBugs(daysBack = 7) {
    const supabase = getSupabaseClient();
    if (!supabase) return [];

    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('qa_run_bugs')
      .select('*, qa_runs!inner(started_at)')
      .gt('qa_runs.started_at', cutoff)
      .order('reported_at', { ascending: false });

    if (error) {
      logger.error('BugReporter.getRecentBugs: erro', { error: error.message });
      return [];
    }

    return data.map(b => ({
      ...b,
      runId: b.run_id,
      affectedUsers: b.affected_users,
      suggested_fix: b.suggested_fix
    }));
  }
}

module.exports = BugReporter;
