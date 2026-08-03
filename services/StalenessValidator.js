const { getSupabaseClient } = require('../config/supabase');
const { logger }            = require('../logger');

// =============================================================================
// Mapa de classificação de steps por impacto financeiro e severidade técnica.
// Usado tanto na inserção (AutofixGuard) quanto no scoring (validateAll).
//
// financial_impact: NONE | LOW | MEDIUM | HIGH | CRITICAL
//   → define dormancy_threshold e ceiling do staleness_score
//   → HIGH/CRITICAL bloqueiam auto-arquivo (score fica abaixo de 80)
//
// severity: P0 | P1 | P2 | P3
//   → multiplica o score base (P0 = ×0.6 — mais difícil de resolver)
//
// dormancy_threshold_days: null = sem auto-arquivo possível para este step
// =============================================================================
const STEP_CLASSIFICATION = {
  // --- health ---
  'health:check_public_health':              { financial_impact: 'NONE',     severity: 'P0', dormancy_threshold_days: 7  },
  'health:validate_dependency_pings':        { financial_impact: 'NONE',     severity: 'P0', dormancy_threshold_days: 7  },
  'health:verify_monitoring_active':         { financial_impact: 'NONE',     severity: 'P1', dormancy_threshold_days: 7  },

  // --- auth (acesso = controle financeiro indireto; HIGH em todos) ---
  'auth:exchange_custom_token':              { financial_impact: 'HIGH',     severity: 'P0', dormancy_threshold_days: 30 },
  'auth:get_current_user':                   { financial_impact: 'HIGH',     severity: 'P0', dormancy_threshold_days: 30 },
  'auth:check_session':                      { financial_impact: 'HIGH',     severity: 'P0', dormancy_threshold_days: 30 },
  'auth:refresh_token':                      { financial_impact: 'HIGH',     severity: 'P1', dormancy_threshold_days: 30 },

  // --- invite ---
  'invite:generate_invite':                  { financial_impact: 'LOW',      severity: 'P1', dormancy_threshold_days: 14 },
  'invite:list_sent_invites':                { financial_impact: 'LOW',      severity: 'P2', dormancy_threshold_days: 14 },
  'invite:view_invite':                      { financial_impact: 'LOW',      severity: 'P2', dormancy_threshold_days: 14 },
  'invite:check_invite_public':              { financial_impact: 'LOW',      severity: 'P2', dormancy_threshold_days: 14 },
  'invite:cancel_invite':                    { financial_impact: 'LOW',      severity: 'P2', dormancy_threshold_days: 14 },

  // --- caixinha ---
  'caixinha:create_caixinha':                { financial_impact: 'MEDIUM',   severity: 'P1', dormancy_threshold_days: 21 },
  'caixinha:get_caixinha_by_id':             { financial_impact: 'MEDIUM',   severity: 'P2', dormancy_threshold_days: 21 },
  'caixinha:list_user_caixinhas':            { financial_impact: 'MEDIUM',   severity: 'P2', dormancy_threshold_days: 21 },
  'caixinha:add_contribuicao':               { financial_impact: 'HIGH',     severity: 'P1', dormancy_threshold_days: 30 },
  'caixinha:list_contribuicoes':             { financial_impact: 'MEDIUM',   severity: 'P2', dormancy_threshold_days: 21 },
  'caixinha:invite_caixinha_member':         { financial_impact: 'MEDIUM',   severity: 'P1', dormancy_threshold_days: 21 },
  'caixinha:accept_caixinha_invite':         { financial_impact: 'MEDIUM',   severity: 'P1', dormancy_threshold_days: 21 },
  'caixinha:list_members':                   { financial_impact: 'LOW',      severity: 'P2', dormancy_threshold_days: 14 },
  'caixinha:generate_report':                { financial_impact: 'HIGH',     severity: 'P2', dormancy_threshold_days: 30 },
  'caixinha:delete_caixinha':                { financial_impact: 'HIGH',     severity: 'P1', dormancy_threshold_days: 30 },

  // --- financial (PIX, ledger) ---
  'financial:simulate_pix_deposit':          { financial_impact: 'HIGH',     severity: 'P0', dormancy_threshold_days: 30 },
  'financial:verify_ledger_balance':         { financial_impact: 'HIGH',     severity: 'P0', dormancy_threshold_days: 30 },
  'financial:create_and_buy_raffle':         { financial_impact: 'CRITICAL', severity: 'P1', dormancy_threshold_days: null },
  'financial:verify_debit_balance':          { financial_impact: 'HIGH',     severity: 'P0', dormancy_threshold_days: 30 },

  // --- webhook (idempotência e créditos automáticos) ---
  'webhook:setup_caixinha_for_webhook':      { financial_impact: 'MEDIUM',   severity: 'P2', dormancy_threshold_days: 21 },
  'webhook:simulate_asaas_webhook_credit':   { financial_impact: 'HIGH',     severity: 'P0', dormancy_threshold_days: 30 },
  'webhook:verify_initial_credit':           { financial_impact: 'HIGH',     severity: 'P0', dormancy_threshold_days: 30 },
  'webhook:simulate_duplicate_webhook':      { financial_impact: 'HIGH',     severity: 'P1', dormancy_threshold_days: 30 },
  'webhook:verify_idempotency_protection':   { financial_impact: 'HIGH',     severity: 'P0', dormancy_threshold_days: 30 },
  'webhook:test_invalid_webhook_token':      { financial_impact: 'HIGH',     severity: 'P1', dormancy_threshold_days: 30 },

  // --- loan (CRITICAL: operações irreversíveis de alto valor) ---
  'loan:create_loan_enabled_caixinha':       { financial_impact: 'HIGH',     severity: 'P2', dormancy_threshold_days: 30 },
  'loan:seed_caixinha_funds':                { financial_impact: 'HIGH',     severity: 'P2', dormancy_threshold_days: 30 },
  'loan:add_member_for_loan':                { financial_impact: 'MEDIUM',   severity: 'P2', dormancy_threshold_days: 21 },
  'loan:request_loan':                       { financial_impact: 'CRITICAL', severity: 'P1', dormancy_threshold_days: null },
  'loan:approve_loan':                       { financial_impact: 'CRITICAL', severity: 'P0', dormancy_threshold_days: null },
  'loan:make_loan_payment':                  { financial_impact: 'CRITICAL', severity: 'P1', dormancy_threshold_days: null },
  'loan:verify_loan_final_status':           { financial_impact: 'HIGH',     severity: 'P1', dormancy_threshold_days: 30 },

  // --- social (sem impacto financeiro) ---
  'social:request_connection':               { financial_impact: 'NONE',     severity: 'P3', dormancy_threshold_days: 7  },
  'social:accept_connection':                { financial_impact: 'NONE',     severity: 'P3', dormancy_threshold_days: 7  },
  'social:create_social_post':               { financial_impact: 'NONE',     severity: 'P3', dormancy_threshold_days: 7  },
  'social:like_post':                        { financial_impact: 'NONE',     severity: 'P3', dormancy_threshold_days: 7  },
  'social:comment_on_post':                  { financial_impact: 'NONE',     severity: 'P3', dormancy_threshold_days: 7  },
  'social:verify_post_interactions':         { financial_impact: 'NONE',     severity: 'P3', dormancy_threshold_days: 7  },

  // --- notification ---
  'notification:trigger_notification_event':    { financial_impact: 'LOW',  severity: 'P2', dormancy_threshold_days: 14 },
  'notification:verify_notification_received':  { financial_impact: 'LOW',  severity: 'P2', dormancy_threshold_days: 14 },
  'notification:verify_dispatcher_job':         { financial_impact: 'LOW',  severity: 'P2', dormancy_threshold_days: 14 },
  'notification:mark_notification_as_read':     { financial_impact: 'LOW',  severity: 'P3', dormancy_threshold_days: 14 },
};

// Fallback conservador para steps não mapeados
const DEFAULT_CLASSIFICATION = { financial_impact: 'MEDIUM', severity: 'P2', dormancy_threshold_days: 21 };

// Teto do staleness_score por impacto financeiro.
// HIGH/CRITICAL nunca chegam a 80 (limiar de auto-arquivo) com Sinal 1 sozinho.
const SCORE_CEILING = { HIGH: 65, CRITICAL: 50 };

// Multiplicador do score base por severidade técnica.
// P0 é mais difícil de confirmar como resolvido — exige mais evidências.
const SEVERITY_MULTIPLIER = { P0: 0.6, P1: 0.8, P2: 1.0, P3: 1.2 };

// Statuses que indicam item arquivado (excluídos do validateAll)
const ARCHIVED_STATUSES = new Set(['auto_archived', 'human_archived']);

// Máximo de entradas em state_history antes de truncar (oldest-first)
const STATE_HISTORY_MAX = 50;

// Versão do algoritmo: incrementar a cada fase (P1.0, P2.0, etc.)
const ALGORITHM_VERSION = 'P1.0';

class StalenessValidator {

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  /**
   * Entry point principal — chamado assincronamente após cada QA run.
   *
   * Percorre todos os pending fixes não arquivados, cruza com os resultados
   * brutos do run (rawResults) e atualiza contadores + staleness score.
   *
   * SKIPPED e steps não encontrados são tratados como neutro (não alteram contadores).
   *
   * @param {Array} rawResults - array de resultados de _runFlows()
   * @returns {Promise<void>}
   */
  async validateAll(rawResults) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      logger.warn('StalenessValidator: Supabase não disponível — validação ignorada', {
        service: 'StalenessValidator',
      });
      return;
    }

    // 1. Constrói lookup "flowId:stepName" → PASSED|FAILED (SKIPPED ausente = neutro)
    const stepLookup = this._buildStepLookup(rawResults);
    const stepsRun   = Object.keys(stepLookup).length;

    // 2. Busca todos os itens não arquivados
    const items = await this._fetchActiveItems(supabase);
    if (!items.length) {
      logger.info('StalenessValidator: nenhum item ativo para validar', { service: 'StalenessValidator' });
      return;
    }

    logger.info('StalenessValidator: iniciando validação de staleness', {
      service:   'StalenessValidator',
      itemCount: items.length,
      stepsRun,
      algorithm: ALGORITHM_VERSION,
    });

    // 3. Calcula atualizações para cada item
    const now     = new Date().toISOString();
    const updates = [];

    for (const item of items) {
      const update = this._computeItemUpdate(item, stepLookup, now);
      if (update) updates.push(update);
    }

    if (!updates.length) {
      logger.info('StalenessValidator: todos os steps foram SKIPPED ou fluxos não rodaram', {
        service: 'StalenessValidator', itemCount: items.length,
      });
      return;
    }

    // 4. Persiste em lote
    await this._batchUpdate(supabase, updates);

    const resolved  = updates.filter(u => u.staleness_status === 'likely_resolved').length;
    const active    = updates.filter(u => u.staleness_status === 'active').length;
    const ambiguous = updates.filter(u => u.staleness_status === 'ambiguous').length;

    logger.info('StalenessValidator: validação concluída', {
      service:        'StalenessValidator',
      updatedItems:   updates.length,
      likelyResolved: resolved,
      active,
      ambiguous,
      algorithm:      ALGORITHM_VERSION,
    });
  }

  /**
   * Retorna a classificação de um step pelo flowId:stepId.
   * Exportado para uso em AutofixGuard na hora da inserção.
   *
   * @param {string|null} flowId
   * @param {string|null} stepId
   * @returns {{ financial_impact: string, severity: string, dormancy_threshold_days: number|null }}
   */
  classifyStep(flowId, stepId) {
    if (!flowId || !stepId) return { ...DEFAULT_CLASSIFICATION };
    const key = `${flowId}:${stepId}`;
    return STEP_CLASSIFICATION[key]
      ? { ...STEP_CLASSIFICATION[key] }
      : { ...DEFAULT_CLASSIFICATION };
  }

  // ---------------------------------------------------------------------------
  // PRIVATE — DATA LAYER
  // ---------------------------------------------------------------------------

  /**
   * Constrói um lookup dos steps executados neste run.
   * Apenas PASSED e FAILED são incluídos.
   * SKIPPED (success undefined/null) não é adicionado — ausência = neutro.
   */
  _buildStepLookup(rawResults) {
    const lookup = {};
    for (const flow of (rawResults || [])) {
      for (const step of (flow.steps || [])) {
        if (step.success === true) {
          lookup[`${flow.flowId}:${step.name}`] = 'PASSED';
        } else if (step.success === false) {
          lookup[`${flow.flowId}:${step.name}`] = 'FAILED';
        }
        // success === undefined | null → SKIPPED → não inserido no lookup
      }
    }
    return lookup;
  }

  /**
   * Busca todos os itens de qa_autofix_pending que não estão arquivados.
   * Inclui rows com staleness_status NULL (itens legados pré-migração).
   */
  async _fetchActiveItems(supabase) {
    const { data, error } = await supabase
      .from('qa_autofix_pending')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      logger.error('StalenessValidator: erro ao buscar itens pendentes', {
        service: 'StalenessValidator', error: error.message,
      });
      return [];
    }

    // Filtra em memória para lidar corretamente com NULL (NOT IN em SQL exclui NULLs)
    return (data || []).filter(item => !ARCHIVED_STATUSES.has(item.staleness_status));
  }

  /**
   * Persiste as atualizações calculadas.
   * Usa Promise.allSettled para que falhas individuais não cancelem o lote.
   */
  async _batchUpdate(supabase, updates) {
    const results = await Promise.allSettled(
      updates.map(({ id, ...fields }) =>
        supabase
          .from('qa_autofix_pending')
          .update(fields)
          .eq('id', id)
      )
    );

    const failures = results.filter(r =>
      r.status === 'rejected' || r.value?.error != null
    );

    if (failures.length) {
      logger.warn('StalenessValidator: falhas parciais no batch update', {
        service:      'StalenessValidator',
        failCount:    failures.length,
        successCount: updates.length - failures.length,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // PRIVATE — SCORE & STATUS COMPUTATION
  // ---------------------------------------------------------------------------

  /**
   * Calcula o payload de atualização para um único item.
   * Retorna null se o step foi SKIPPED ou se o flow não rodou (sem IO a fazer).
   */
  _computeItemUpdate(item, stepLookup, now) {
    const key        = `${item.flow_id}:${item.step_id}`;
    const stepStatus = stepLookup[key]; // 'PASSED' | 'FAILED' | undefined

    // Neutro: step não executado neste run → não atualizar contadores
    if (!stepStatus) return null;

    const update = { id: item.id };

    if (stepStatus === 'PASSED') {
      update.consecutive_pass_count  = (item.consecutive_pass_count  || 0) + 1;
      update.total_pass_count        = (item.total_pass_count        || 0) + 1;
      update.total_execution_count   = (item.total_execution_count   || 0) + 1;
      update.last_actual_execution_at = now;
      // last_seen_active_at não é alterado em PASSED (mantém data da última falha)
    } else { // FAILED
      update.consecutive_pass_count  = 0; // reset: sequência de passes quebrada
      update.total_execution_count   = (item.total_execution_count   || 0) + 1;
      update.last_seen_active_at      = now;
      update.last_actual_execution_at = now;
    }

    // Backfill de classificação para itens legados (sem financial_impact)
    const classification = this.classifyStep(item.flow_id, item.step_id);
    if (!item.financial_impact) {
      update.financial_impact        = classification.financial_impact;
      update.severity                = classification.severity;
      update.dormancy_threshold_days = classification.dormancy_threshold_days;
    }

    // Snapshot do item com valores recém-calculados para o scoring
    const snapshot = {
      ...item,
      consecutive_pass_count: update.consecutive_pass_count,
      last_seen_active_at:    update.last_seen_active_at || item.last_seen_active_at,
    };

    // Scoring e status
    const effectiveClassification = {
      financial_impact:        update.financial_impact        || item.financial_impact        || DEFAULT_CLASSIFICATION.financial_impact,
      severity:                update.severity                || item.severity                || DEFAULT_CLASSIFICATION.severity,
      dormancy_threshold_days: update.dormancy_threshold_days ?? item.dormancy_threshold_days ?? DEFAULT_CLASSIFICATION.dormancy_threshold_days,
    };

    update.staleness_score      = this._computeScore(snapshot, effectiveClassification);
    update.staleness_status     = this._computeStatus(snapshot, update.staleness_score);
    update.staleness_reason     = this._buildReason(snapshot, update.staleness_score, stepStatus, effectiveClassification);
    update.staleness_updated_at = now;

    // Append to state_history (cap at STATE_HISTORY_MAX entries, oldest first)
    const stateEntry = {
      action:                 stepStatus === 'PASSED' ? 'step_passed' : 'step_failed',
      changed_at:             now,
      consecutive_pass_count: update.consecutive_pass_count,
      score:                  update.staleness_score,
      status:                 update.staleness_status,
      algorithm:              ALGORITHM_VERSION,
    };
    const existing          = Array.isArray(item.state_history) ? item.state_history : [];
    update.state_history    = [...existing, stateEntry].slice(-STATE_HISTORY_MAX);

    return update;
  }

  /**
   * Score 0-100 baseado em Sinal 1 (QA pass count) + Sinal 3 (temporal decay).
   * Sinal 2 (code drift) será adicionado em P2.
   *
   * Modificadores aplicados nesta ordem:
   *   1. Base por consecutive_pass_count
   *   2. Temporal decay por last_seen_active_at vs dormancy_threshold
   *   3. Severity multiplier (P0-P3)
   *   4. Financial impact ceiling (HIGH≤65, CRITICAL≤50)
   */
  _computeScore(item, classification) {
    const passCount  = item.consecutive_pass_count || 0;
    const { severity, financial_impact, dormancy_threshold_days } = classification;

    // 1. Base: evidência de QA
    let base = 0;
    if      (passCount >= 7) base = 65;
    else if (passCount >= 5) base = 55;
    else if (passCount >= 3) base = 40;
    else if (passCount >= 1) base = 20;

    // 2. Temporal: quanto tempo desde a última falha real
    let temporal = 0;
    if (dormancy_threshold_days !== null) {
      const ref        = item.last_seen_active_at
        ? new Date(item.last_seen_active_at)
        : new Date(item.created_at || Date.now());
      const daysSince  = (Date.now() - ref.getTime()) / 86400000;
      const threshold  = dormancy_threshold_days || 21;

      if      (daysSince > threshold * 2)      temporal = 15;
      else if (daysSince > threshold)          temporal = 10;
      else if (daysSince > threshold / 2)      temporal = 5;
      else if (daysSince < 3)                  temporal = -20;
    }

    let score = base + temporal;

    // 3. Severity multiplier
    const multiplier = SEVERITY_MULTIPLIER[severity] ?? 1.0;
    score = Math.round(score * multiplier);

    // 4. Financial impact ceiling (protege HIGH/CRITICAL de auto-arquivo por Sinal 1 isolado)
    const ceiling = SCORE_CEILING[financial_impact];
    if (ceiling !== undefined) score = Math.min(score, ceiling);

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Determina staleness_status a partir do score e do histórico de falhas.
   *
   * active           → falhou recentemente (< 2 dias) OU score < 20 sem passes
   * likely_resolved  → score ≥ 60 e sem falha recente
   * ambiguous        → score 40-59 (sinais contraditórios)
   * awaiting_review  → score < 40 sem sinal claro (estado padrão/novo)
   */
  _computeStatus(item, score) {
    // Falha recente: status 'active' imediato, independente do score
    if (item.last_seen_active_at) {
      const daysSinceFailed = (Date.now() - new Date(item.last_seen_active_at).getTime()) / 86400000;
      if (daysSinceFailed < 2) return 'active';
    }

    if (score >= 60) return 'likely_resolved';
    if (score >= 40) return 'ambiguous';
    if (score < 20 && item.consecutive_pass_count === 0 && item.last_seen_active_at) return 'active';

    // Fallback: mantém status anterior se existir, senão awaiting_review
    return item.staleness_status || 'awaiting_review';
  }

  /**
   * Constrói um texto legível de justificativa para o score atual.
   * Exibido no dashboard ao lado do confidence badge.
   */
  _buildReason(item, score, stepStatus, classification) {
    const parts = [];
    const { financial_impact, severity, dormancy_threshold_days } = classification;

    if (stepStatus === 'FAILED') {
      parts.push('Step reprovado nesta execução');
    } else {
      const count = item.consecutive_pass_count || 0;
      if (count >= 1) parts.push(`Aprovado ${count}× consecutivo${count > 1 ? 's' : ''} (execução real)`);
    }

    if (item.last_seen_active_at) {
      const days = Math.floor((Date.now() - new Date(item.last_seen_active_at).getTime()) / 86400000);
      if (days > 0) parts.push(`Último falhou há ${days} dia${days !== 1 ? 's' : ''}`);
    } else if (!item.last_seen_active_at && (item.consecutive_pass_count || 0) === 0) {
      parts.push('Nunca executado desde o registro');
    }

    parts.push(`Impacto: ${financial_impact} · Sev: ${severity}`);

    if (dormancy_threshold_days === null) {
      parts.push('Auto-arquivo bloqueado (step crítico)');
    }

    parts.push(`Score ${ALGORITHM_VERSION}: ${score}/100`);

    return parts.join(' · ');
  }
}

module.exports = new StalenessValidator();
