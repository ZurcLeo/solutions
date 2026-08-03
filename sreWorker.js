const cron = require('node-cron');
const SreAgentService = require('./services/SreAgentService');
const { checkPublicServices } = require('./services/healthService');
const healthHistoryService = require('./services/healthHistoryService');
const { getSupabaseClient } = require('./config/supabase');
const { logger } = require('./logger');
const bookingService        = require('./services/bookingService');
const bookingPaymentService = require('./services/bookingPaymentService');

/**
 * Booking Expiration Worker
 * Roda a cada 15 minutos — expira bookings pending sem resposta do prestador.
 * [SCHED-001] DA-SCHED-004: bookings expiram em 2h.
 */
function startBookingExpirationWorker() {
  logger.info('Booking Expiration Worker: Starting... (every 15 minutes)');

  cron.schedule('*/15 * * * *', async () => {
    try {
      const result = await bookingService.runExpirationJob();
      if (result.count > 0) {
        logger.info(`Booking Expiration Worker: ${result.count} booking(s) expirado(s)`);
        // Processar void dos holds Stripe
        if (result.expired.length > 0) {
          const voidResult = await bookingPaymentService.voidExpiredBookings(result.expired);
          if (voidResult.voided > 0 || voidResult.errors.length > 0) {
            logger.info(`Booking Expiration Worker: Stripe voids — ${voidResult.voided} sucesso, ${voidResult.errors.length} erro(s)`, {
              errors: voidResult.errors,
            });
          }
        }
      }
    } catch (error) {
      logger.error('Booking Expiration Worker: Falha no job de expiração', { error: error.message });
    }
  });
}

/**
 * SRE Diagnostic Worker
 * Roda 2x ao dia (06:00 e 18:00 UTC):
 *   1. Processa incidentes pendentes de diagnóstico via IA
 *   2. Captura snapshot do Health Score e persiste em health_history
 *   3. Limpa logs antigos de deposit_context_logs (> 7 dias)
 */
function startSreWorker() {
  logger.info('SRE Diagnostic Worker: Starting... (scheduled 2x/day at 06:00 and 18:00 UTC)');

  cron.schedule('0 6,18 * * *', async () => {
    logger.info('SRE Diagnostic Worker: Running scheduled cycle');

    // 1. Diagnósticos SRE
    try {
      const processedCount = await SreAgentService.processPendingIncidents(5);
      if (processedCount > 0) {
        logger.info(`SRE Diagnostic Worker: Processed ${processedCount} incidents`);
      }
    } catch (error) {
      logger.error('SRE Diagnostic Worker: Incident processing failed', { error: error.message });
    }

    // 2. Snapshot periódico de Health Score → health_history
    try {
      const health = await checkPublicServices();
      if (health.healthScore !== undefined) {
        await healthHistoryService.saveSnapshot({
          healthScore:      health.healthScore,
          overallStatus:    health.overallStatus,
          confidence:       health.confidence,
          dependencies:     health.dependencies,
          latencyPenalties: health.latencyPenalties,
        });
        logger.info(`SRE Diagnostic Worker: Health snapshot saved (score=${health.healthScore}, status=${health.overallStatus})`);
      }
    } catch (error) {
      logger.error('SRE Diagnostic Worker: Health snapshot failed', { error: error.message });
    }

    // 3. Limpeza de deposit_context_logs com mais de 7 dias
    try {
      const client = getSupabaseClient();
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { count, error } = await client
        .from('deposit_context_logs')
        .delete({ count: 'exact' })
        .lt('created_at', cutoff);
      if (error) throw error;
      if (count > 0) {
        logger.info(`SRE Diagnostic Worker: Cleaned up ${count} old entries from deposit_context_logs`);
      }
    } catch (error) {
      logger.error('SRE Diagnostic Worker: Log cleanup failed', { error: error.message });
    }
  });
}

/**
 * Group Booking Worker
 * Roda a cada 15 minutos — confirma turmas que atingiram mínimo e cancela turmas
 * cujo deadline expirou sem atingir min_capacity.
 * [SCHED-CAP-004] + [SCHED-CAP-006]
 */
function startGroupBookingWorker() {
  logger.info('Group Booking Worker: Starting... (every 15 minutes)');

  cron.schedule('*/15 * * * *', async () => {
    try {
      // 1. Confirmar turmas que atingiram mínimo [SCHED-CAP-004]
      const confirmResult = await bookingService.runGroupConfirmationJob();
      if (confirmResult.confirmed > 0) {
        logger.info(`Group Booking Worker: ${confirmResult.confirmed} booking(s) confirmado(s) em ${confirmResult.slots} slot(s)`);
      }

      // 2. Cancelar turmas que passaram do deadline sem mínimo [SCHED-CAP-006]
      const cancelResult = await bookingService.runGroupDeadlineJob();
      if (cancelResult.cancelled > 0) {
        logger.info(`Group Booking Worker: ${cancelResult.cancelled} pré-reserva(s) cancelada(s) em ${cancelResult.slots} slot(s), ${cancelResult.voided} hold(s) liberado(s)`);
      }

      // 3. Expirar waitlist entries cujo slot já passou [SCHED-CAP-013]
      const bookingWaitlistService = require('./services/bookingWaitlistService');
      const wlResult = await bookingWaitlistService.runWaitlistExpirationJob();
      if (wlResult.expired > 0) {
        logger.info(`Group Booking Worker: ${wlResult.expired} waitlist entries expirado(s)`);
      }
    } catch (error) {
      logger.error('Group Booking Worker: Falha no job', { error: error.message });
    }
  });
}

module.exports = { startSreWorker, startBookingExpirationWorker, startGroupBookingWorker };
