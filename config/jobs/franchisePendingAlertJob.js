'use strict';

/**
 * franchisePendingAlertJob — Cron job diario 09:00 BRT.
 *
 * Verifica webhook_subscriptions com franchise_pending = true
 * ha mais de 24 horas e envia alerta ao admin por email.
 */

const cron = require('node-cron');
const { logger } = require('../../logger');

const JOB_NAME = 'franchisePendingAlertJob';
let _started = false;

async function _runOnce() {
  logger.info(`[${JOB_NAME}] Verificando franchise_pending stale`, {
    service: JOB_NAME, action: 'FRANCHISE_PENDING_CHECK_START',
  });

  try {
    const { getSupabaseClient } = require('../../config/supabase');
    const supabase = getSupabaseClient();
    if (!supabase) {
      logger.warn(`[${JOB_NAME}] Supabase client indisponivel, pulando`);
      return { alerted: 0 };
    }

    // Busca subscriptions com franchise_pending=true ha mais de 24h
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: stale, error } = await supabase
      .from('webhook_subscriptions')
      .select('id, seller_id, provider, endpoint_url, updated_at, created_at')
      .eq('franchise_pending', true)
      .lt('updated_at', cutoff);

    if (error) throw error;

    if (!stale || stale.length === 0) {
      logger.info(`[${JOB_NAME}] Nenhuma franchise_pending stale encontrada`, {
        service: JOB_NAME, action: 'FRANCHISE_PENDING_CHECK_CLEAN',
      });
      return { alerted: 0 };
    }

    // Envia alerta ao admin
    const emailService = require('../../services/emailService');
    const adminEmail = process.env.ADMIN_ALERT_EMAIL || 'suporte@eloscloud.com';

    const sellerList = stale.map(s =>
      `  - Seller ${s.seller_id} (sub ${s.id}) — pendente desde ${new Date(s.updated_at).toLocaleString('pt-BR')}`
    ).join('\n');

    await emailService.sendEmail({
      to: adminEmail,
      subject: `[ElosCloud] ALERTA: ${stale.length} franchise_pending stale (>24h)`,
      templateType: 'generic',
      data: {
        title: `Franchise Pending Stale — ${stale.length} subscription(s)`,
        message: `As seguintes subscriptions estao com franchise_pending = true ha mais de 24 horas:\n\n${sellerList}\n\nAcao: Verifique no painel /admin/testes (aba IconChat) e use o botao "Retry" ou investigue manualmente.`,
      },
    });

    logger.warn(`[${JOB_NAME}] Alerta enviado: ${stale.length} franchise_pending stale`, {
      service: JOB_NAME, action: 'FRANCHISE_PENDING_ALERT_SENT',
      count: stale.length,
      sellerIds: stale.map(s => s.seller_id),
    });

    return { alerted: stale.length };
  } catch (err) {
    logger.error(`[${JOB_NAME}] Erro na verificacao de franchise_pending`, {
      service: JOB_NAME, action: 'FRANCHISE_PENDING_CHECK_ERROR', error: err.message,
    });
    throw err;
  }
}

function startFranchisePendingAlertJob() {
  if (_started) return;
  _started = true;

  // Diario as 09:00 BRT (apos addon deactivation 08:30)
  cron.schedule('0 9 * * *', () => {
    _runOnce().catch(() => {});
  }, { timezone: 'America/Sao_Paulo' });

  logger.info(`[${JOB_NAME}] Job iniciado (cron: diario 09:00 BRT)`, {
    service: JOB_NAME, action: 'FRANCHISE_PENDING_ALERT_JOB_REGISTERED',
  });
}

function stopFranchisePendingAlertJob() {
  _started = false;
}

module.exports = { startFranchisePendingAlertJob, stopFranchisePendingAlertJob, _runOnce };
