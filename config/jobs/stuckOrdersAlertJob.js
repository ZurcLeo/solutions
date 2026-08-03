'use strict';

/**
 * stuckOrdersAlertJob — Cron a cada 6 horas (0 *​/6 * * *).
 *
 * Detecta pedidos do marketplace travados (pending/awaiting_payment/paid/preparing)
 * sem atualizacao ha mais de 24 horas e alerta todos os admins via
 * notificacao in-app + email.
 *
 * ADM-027
 */

const cron = require('node-cron');
const { logger } = require('../../logger');

const JOB_NAME = 'stuckOrdersAlertJob';
let _started = false;

async function _runOnce() {
  logger.info(`[${JOB_NAME}] Verificando pedidos travados`, {
    service: JOB_NAME, action: 'STUCK_ORDERS_CHECK_START',
  });

  try {
    const { getSupabaseClient } = require('../../config/supabase');
    const supabase = getSupabaseClient();
    if (!supabase) {
      logger.warn(`[${JOB_NAME}] Supabase client indisponivel, pulando`);
      return { alerted: 0 };
    }

    // Busca pedidos travados ha mais de 24h
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: stuckOrders, error } = await supabase
      .from('marketplace_orders')
      .select('id, status, updated_at, created_at, buyer_id, seller_id')
      .in('status', ['pending', 'awaiting_payment', 'paid', 'preparing'])
      .lt('updated_at', cutoff)
      .is('deleted_at', null)
      .order('updated_at', { ascending: true });

    if (error) throw error;

    if (!stuckOrders || stuckOrders.length === 0) {
      logger.info(`[${JOB_NAME}] Nenhum pedido travado encontrado`, {
        service: JOB_NAME, action: 'STUCK_ORDERS_CHECK_CLEAN',
      });
      return { alerted: 0 };
    }

    const count = stuckOrders.length;
    const oldestOrder = stuckOrders[0]; // ja ordenado por updated_at ASC
    const oldestAgeMs = Date.now() - new Date(oldestOrder.updated_at).getTime();
    const oldestAgeHours = Math.round(oldestAgeMs / (1000 * 60 * 60));

    // Metadata limitada a 5 pedidos
    const ordersMetadata = stuckOrders.slice(0, 5).map(o => ({
      id: o.id,
      status: o.status,
      updated_at: o.updated_at,
    }));

    // ── Buscar admin user IDs ──────────────────────────────────────────────
    const { data: adminRoles, error: rolesError } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role_id', 'admin');

    if (rolesError) {
      logger.error(`[${JOB_NAME}] Erro ao buscar admins`, {
        service: JOB_NAME, action: 'STUCK_ORDERS_ADMIN_QUERY_ERROR',
        error: rolesError.message,
      });
      throw rolesError;
    }

    const adminUserIds = [...new Set((adminRoles || []).map(r => r.user_id))];

    if (adminUserIds.length === 0) {
      logger.warn(`[${JOB_NAME}] Nenhum admin encontrado para notificar`, {
        service: JOB_NAME, action: 'STUCK_ORDERS_NO_ADMINS',
      });
      return { alerted: 0 };
    }

    // ── Notificacao in-app para cada admin ─────────────────────────────────
    const notificationDispatcher = require('../../services/NotificationDispatcher');

    for (const adminUserId of adminUserIds) {
      notificationDispatcher.dispatch({
        userId: adminUserId,
        type: 'admin_stuck_orders_alert',
        importance: 'high',
        data: {
          count,
          oldestOrderAge: oldestAgeHours,
          orders: ordersMetadata,
          message: `${count} pedido(s) travado(s) ha mais de 24h. O mais antigo esta ha ${oldestAgeHours}h sem progresso.`,
          url: '/admin/pedidos',
        },
        metadata: { triggeredBy: 'system' },
        dedupKey: `stuck_orders_alert_${new Date().toISOString().slice(0, 13)}`, // dedup por hora
      }).catch(err => {
        logger.error(`[${JOB_NAME}] Erro ao notificar admin ${adminUserId}`, {
          service: JOB_NAME, action: 'STUCK_ORDERS_NOTIFY_ERROR',
          adminUserId, error: err.message,
        });
      });
    }

    // ── Email para admin ───────────────────────────────────────────────────
    try {
      const emailService = require('../../services/emailService');
      const adminEmail = process.env.ADMIN_ALERT_EMAIL || 'suporte@eloscloud.com';

      const orderList = stuckOrders.slice(0, 10).map(o => {
        const ageMs = Date.now() - new Date(o.updated_at).getTime();
        const ageH = Math.round(ageMs / (1000 * 60 * 60));
        return `  - Pedido ${o.id} (${o.status}) — parado ha ${ageH}h`;
      }).join('\n');

      await emailService.sendEmail({
        to: adminEmail,
        subject: `[ElosCloud] ALERTA: ${count} pedido(s) travado(s) ha mais de 24h`,
        templateType: 'padrao',
        data: {
          subject: `Pedidos Travados — ${count} pedido(s)`,
          content: `Existem ${count} pedidos travados ha mais de 24h. O mais antigo esta ha ${oldestAgeHours}h sem progresso.\n\n${orderList}\n\nAcesse /admin/pedidos para resolver.`,
        },
      });

      logger.info(`[${JOB_NAME}] Email de alerta enviado`, {
        service: JOB_NAME, action: 'STUCK_ORDERS_EMAIL_SENT',
        to: adminEmail, count,
      });
    } catch (emailErr) {
      logger.warn(`[${JOB_NAME}] Falha ao enviar email de alerta (notificacoes in-app ja enviadas)`, {
        service: JOB_NAME, action: 'STUCK_ORDERS_EMAIL_ERROR',
        error: emailErr.message,
      });
    }

    logger.warn(`[${JOB_NAME}] Alerta enviado: ${count} pedidos travados`, {
      service: JOB_NAME, action: 'STUCK_ORDERS_ALERT_SENT',
      count,
      oldestAgeHours,
      adminCount: adminUserIds.length,
    });

    return { alerted: count, adminsNotified: adminUserIds.length };
  } catch (err) {
    logger.error(`[${JOB_NAME}] Erro na verificacao de pedidos travados`, {
      service: JOB_NAME, action: 'STUCK_ORDERS_CHECK_ERROR', error: err.message,
    });
    throw err;
  }
}

function startStuckOrdersAlertJob() {
  if (_started) return;
  _started = true;

  // A cada 6 horas (00:00, 06:00, 12:00, 18:00)
  cron.schedule('0 */6 * * *', () => {
    _runOnce().catch(() => {});
  }, { timezone: 'America/Sao_Paulo' });

  logger.info(`[${JOB_NAME}] Job iniciado (cron: a cada 6h)`, {
    service: JOB_NAME, action: 'STUCK_ORDERS_ALERT_JOB_REGISTERED',
  });
}

function stopStuckOrdersAlertJob() {
  _started = false;
}

module.exports = { startStuckOrdersAlertJob, stopStuckOrdersAlertJob, _runOnce };
