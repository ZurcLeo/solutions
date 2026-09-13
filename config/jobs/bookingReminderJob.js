'use strict';

/**
 * bookingReminderJob — Cron a cada 30 minutos.
 *
 * Dispara lembretes de agendamento para clientes:
 *   - D-1: agendamentos confirmados para as proximas ~24h
 *   - H-2: agendamentos confirmados para as proximas ~2h
 *
 * Dedup via dedupKey evita duplicatas entre execucoes.
 * Apenas bookings com client_id (usuarios cadastrados) sao notificados.
 *
 * RECALL-001 / RECALL-002
 */

const cron = require('node-cron');
const { logger } = require('../../logger');

const JOB_NAME = 'bookingReminderJob';
let _started = false;

/**
 * Formata endereco a partir dos campos do seller_profiles.
 */
function _formatAddress(seller) {
  if (!seller) return '';
  const parts = [
    seller.address_logradouro,
    seller.address_numero,
    seller.address_complemento,
  ].filter(Boolean).join(', ');
  const cityState = [
    seller.address_neighborhood,
    seller.address_city,
    seller.address_state,
  ].filter(Boolean).join(' - ');
  return [parts, cityState].filter(Boolean).join(' — ') || '';
}

/**
 * Formata data e hora para exibicao em pt-BR (timezone Sao Paulo).
 */
function _formatDateTime(isoString) {
  const dt = new Date(isoString);
  const date = dt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const time = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  return { date, time };
}

async function _runOnce() {
  logger.info(`[${JOB_NAME}] Verificando agendamentos para lembrete`, {
    service: JOB_NAME, action: 'BOOKING_REMINDER_CHECK_START',
  });

  try {
    const { getSupabaseClient } = require('../../config/supabase');
    const supabase = getSupabaseClient();
    if (!supabase) {
      logger.warn(`[${JOB_NAME}] Supabase client indisponivel, pulando`);
      return { reminders1d: 0, reminders2h: 0 };
    }

    const now = new Date();

    // ── D-1: agendamentos entre 23h e 25h a partir de agora ─────────
    const d1Start = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString();
    const d1End   = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString();

    const { data: d1Bookings, error: d1Error } = await supabase
      .from('service_bookings')
      .select('id, client_id, service_id, scheduled_at')
      .eq('status', 'confirmed')
      .gte('scheduled_at', d1Start)
      .lte('scheduled_at', d1End)
      .not('client_id', 'is', null);

    if (d1Error) {
      logger.error(`[${JOB_NAME}] Erro ao buscar bookings D-1`, {
        service: JOB_NAME, error: d1Error.message,
      });
    }

    // ── H-2: agendamentos entre 1h30 e 2h30 a partir de agora ──────
    const h2Start = new Date(now.getTime() + 1.5 * 60 * 60 * 1000).toISOString();
    const h2End   = new Date(now.getTime() + 2.5 * 60 * 60 * 1000).toISOString();

    const { data: h2Bookings, error: h2Error } = await supabase
      .from('service_bookings')
      .select('id, client_id, service_id, scheduled_at')
      .eq('status', 'confirmed')
      .gte('scheduled_at', h2Start)
      .lte('scheduled_at', h2End)
      .not('client_id', 'is', null);

    if (h2Error) {
      logger.error(`[${JOB_NAME}] Erro ao buscar bookings H-2`, {
        service: JOB_NAME, error: h2Error.message,
      });
    }

    const allBookings = [
      ...((d1Bookings || []).map(b => ({ ...b, reminderType: '1d' }))),
      ...((h2Bookings || []).map(b => ({ ...b, reminderType: '2h' }))),
    ];

    if (allBookings.length === 0) {
      logger.info(`[${JOB_NAME}] Nenhum agendamento para lembrete`, {
        service: JOB_NAME, action: 'BOOKING_REMINDER_CHECK_CLEAN',
      });
      return { reminders1d: 0, reminders2h: 0 };
    }

    // ── Batch-lookup de servicos (marketplace_products) ─────────────
    const serviceIds = [...new Set(allBookings.map(b => b.service_id).filter(Boolean))];
    const serviceMap = {};

    if (serviceIds.length > 0) {
      const { data: services } = await supabase
        .from('marketplace_products')
        .select('id, name, seller_id')
        .in('id', serviceIds);

      if (services) for (const s of services) serviceMap[s.id] = s;
    }

    // ── Batch-lookup de sellers (seller_profiles) ───────────────────
    const sellerIds = [...new Set(Object.values(serviceMap).map(s => s.seller_id).filter(Boolean))];
    const sellerMap = {};

    if (sellerIds.length > 0) {
      const { data: sellers } = await supabase
        .from('seller_profiles')
        .select('id, trading_name, business_name, address_logradouro, address_numero, address_complemento, address_neighborhood, address_city, address_state')
        .in('id', sellerIds);

      if (sellers) for (const s of sellers) sellerMap[s.id] = s;
    }

    // ── Dispatch notifications ──────────────────────────────────────
    const notificationDispatcher = require('../../services/NotificationDispatcher');
    let reminders1d = 0;
    let reminders2h = 0;

    for (const booking of allBookings) {
      const service = serviceMap[booking.service_id];
      const seller  = service?.seller_id ? sellerMap[service.seller_id] : null;

      const serviceName = service?.name || 'Servico';
      const sellerName  = seller?.trading_name || seller?.business_name || 'Prestador';
      const address     = _formatAddress(seller);
      const { date, time } = _formatDateTime(booking.scheduled_at);

      const type    = booking.reminderType === '2h' ? 'booking_reminder_2h' : 'booking_reminder_1d';
      const dedupKey = `booking_reminder_${booking.id}_${booking.reminderType}`;

      notificationDispatcher.dispatch({
        userId:     booking.client_id,
        type,
        importance: 'high',
        data: {
          serviceName,
          sellerName,
          sellerId:  service?.seller_id || null,
          startTime: booking.scheduled_at,
          date,
          time,
          address,
          bookingId: booking.id,
        },
        metadata: { triggeredBy: 'system' },
        dedupKey,
      }).catch(err => {
        logger.warn(`[${JOB_NAME}] Falha ao enviar lembrete ${booking.reminderType} para booking ${booking.id}`, {
          service: JOB_NAME, action: 'BOOKING_REMINDER_DISPATCH_ERROR',
          bookingId: booking.id, clientId: booking.client_id, error: err.message,
        });
      });

      if (booking.reminderType === '1d') reminders1d++;
      else reminders2h++;
    }

    logger.info(`[${JOB_NAME}] Lembretes enviados`, {
      service: JOB_NAME, action: 'BOOKING_REMINDER_SENT',
      reminders1d, reminders2h,
    });

    return { reminders1d, reminders2h };
  } catch (err) {
    logger.error(`[${JOB_NAME}] Erro no job de lembretes`, {
      service: JOB_NAME, action: 'BOOKING_REMINDER_CHECK_ERROR', error: err.message,
    });
    throw err;
  }
}

function startBookingReminderJob() {
  if (_started) return;
  _started = true;

  // A cada 30 minutos
  cron.schedule('*/30 * * * *', () => {
    _runOnce().catch(() => {});
  }, { timezone: 'America/Sao_Paulo' });

  logger.info(`[${JOB_NAME}] Job iniciado (cron: a cada 30min)`, {
    service: JOB_NAME, action: 'BOOKING_REMINDER_JOB_REGISTERED',
  });
}

function stopBookingReminderJob() {
  _started = false;
}

module.exports = { startBookingReminderJob, stopBookingReminderJob, _runOnce };
