'use strict';

/**
 * billingTierCheckJob — Cron job diario 06:00 BRT.
 *
 * Verifica todos os sellers com assinatura ativa e recomenda
 * upgrade/downgrade baseado no faturamento dos ultimos 30 dias.
 * Nao faz auto-switch — apenas loga recomendacoes.
 */

const cron = require('node-cron');
const { logger } = require('../../logger');

const JOB_NAME = 'billingTierCheckJob';
let _started = false;

async function _runOnce() {
  logger.info(`[${JOB_NAME}] Iniciando verificacao de tier`, {
    service: JOB_NAME, action: 'TIER_CHECK_START',
  });

  try {
    const { getSupabaseClient } = require('../../config/supabase');
    const subscriptionService = require('../../services/subscriptionService');
    const supabase = getSupabaseClient();

    // Busca sellers com assinatura ativa
    const { data: activeSubscriptions } = await supabase
      .from('user_subscriptions')
      .select('user_id, plan_slug')
      .eq('status', 'active')
      .not('plan_slug', 'is', null);

    if (!activeSubscriptions?.length) {
      logger.info(`[${JOB_NAME}] Nenhuma assinatura ativa encontrada`, {
        service: JOB_NAME, action: 'TIER_CHECK_SKIP',
      });
      return { checked: 0, recommendations: 0 };
    }

    let recommendations = 0;

    for (const sub of activeSubscriptions) {
      try {
        const eligibility = await subscriptionService.checkTierEligibility(sub.user_id);
        if (eligibility.action !== 'keep') {
          recommendations++;
          logger.info(`[${JOB_NAME}] Recomendacao de ${eligibility.action}`, {
            service: JOB_NAME,
            userId: sub.user_id,
            current: eligibility.current,
            recommended: eligibility.recommended,
          });
        }
      } catch (err) {
        logger.warn(`[${JOB_NAME}] Erro ao verificar tier de ${sub.user_id}`, {
          error: err.message,
        });
      }
    }

    logger.info(`[${JOB_NAME}] Verificacao concluida`, {
      service: JOB_NAME, action: 'TIER_CHECK_DONE',
      checked: activeSubscriptions.length, recommendations,
    });

    return { checked: activeSubscriptions.length, recommendations };
  } catch (err) {
    logger.error(`[${JOB_NAME}] Erro na verificacao de tier`, {
      service: JOB_NAME, action: 'TIER_CHECK_ERROR', error: err.message,
    });
    throw err;
  }
}

function startBillingTierCheckJob() {
  if (_started) return;
  _started = true;

  // Diario as 06:00 BRT
  cron.schedule('0 6 * * *', () => {
    _runOnce().catch(() => {});
  }, { timezone: 'America/Sao_Paulo' });

  logger.info(`[${JOB_NAME}] Job iniciado (cron: diario 06:00 BRT)`, {
    service: JOB_NAME, action: 'TIER_CHECK_JOB_REGISTERED',
  });
}

function stopBillingTierCheckJob() {
  _started = false;
}

module.exports = { startBillingTierCheckJob, stopBillingTierCheckJob, _runOnce };
