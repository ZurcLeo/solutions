const vm     = require('vm');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

/**
 * Máximo de PRs automáticos permitidos por arquivo por semana.
 */
const MAX_PRS_PER_FILE_PER_WEEK = 3;

/**
 * Flows que exigem revisão humana.
 */
const HUMAN_APPROVAL_FLOWS = new Set(['payment', 'auth']);

/**
 * AutofixGuard — Migrado para Supabase (PostgreSQL)
 */
class AutofixGuard {
  /**
   * Trava 1: verifica cota semanal.
   */
  async canOpenPR(filePath) {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return false;

      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const { count, error } = await supabase
        .from('qa_autofixes')
        .select('*', { count: 'exact', head: true })
        .eq('file_path', filePath)
        .gte('created_at', since)
        .in('status', ['opened', 'merged']);

      if (error) throw error;

      if (count >= MAX_PRS_PER_FILE_PER_WEEK) {
        logger.warn('AutofixGuard: limite semanal de PRs atingido para arquivo', {
          service: 'AutofixGuard', filePath, prsThisWeek: count,
        });
        return false;
      }
      return true;
    } catch (err) {
      logger.error('AutofixGuard: erro ao verificar cota de PRs', {
        service: 'AutofixGuard', filePath, error: err.message,
      });
      return false;
    }
  }

  requiresHumanApproval(flowId) {
    return HUMAN_APPROVAL_FLOWS.has(flowId);
  }

  async validatePatch(filePath, oldCode, newCode) {
    try {
      const GitHubService = require('./GitHubService');

      if (!GitHubService._isConfigured()) {
        logger.warn('AutofixGuard: GitHubService não configurado', { service: 'AutofixGuard' });
        return false;
      }

      const { content } = await GitHubService.getFileContent(filePath);

      if (!content.includes(oldCode)) {
        logger.warn('AutofixGuard: patch não aplicável — oldCode não encontrado', { service: 'AutofixGuard', filePath });
        return false;
      }

      const patched = content.replace(oldCode, newCode);

      if (filePath.endsWith('.js')) {
        try {
          new vm.Script(patched);
        } catch (syntaxErr) {
          logger.warn('AutofixGuard: patch gerou sintaxe inválida', { service: 'AutofixGuard', filePath, syntaxError: syntaxErr.message });
          return false;
        }
      }

      return true;
    } catch (err) {
      logger.error('AutofixGuard: erro inesperado na validação', { service: 'AutofixGuard', filePath, error: err.message });
      return false;
    }
  }

  async recordPROpened(filePath, prUrl, fix) {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;

      await supabase.from('qa_autofixes').insert([{
        file_path:  filePath,
        pr_url:     prUrl,
        flow_id:    fix.flowId,
        step_id:    fix.stepId,
        status:     'opened'
      }]);
    } catch (err) {
      logger.warn('AutofixGuard: falha ao registrar PR no Supabase', { service: 'AutofixGuard', prUrl, error: err.message });
    }
  }

  async recordHumanApprovalNeeded(bug, reason) {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;

      await supabase.from('qa_autofix_pending').insert([{
        bug,
        reason,
        status: 'awaiting_review'
      }]);
      logger.info('AutofixGuard: revisão humana registrada no Supabase', { service: 'AutofixGuard', flow: bug.flow, step: bug.step });
    } catch (err) {
      logger.warn('AutofixGuard: falha ao registrar pendência humana', { service: 'AutofixGuard', error: err.message });
    }
  }
}

module.exports = new AutofixGuard();
