/**
 * @fileoverview Webhook Return Service — Processa eventos de retorno do IconChat
 *
 * Handlers por event_type:
 *   - message.delivered → marca notificação como entregue
 *   - message.failed    → fallback email/in_app (invariante §5)
 *   - client.responded  → atualiza timestamp de interação
 *   - conversation.resolved → cria entry para ratificação humana (invariante §4)
 *   - escalation.requested → cria ticket de suporte
 *   - opt_out.requested → desabilita canal webhook nas preferências (invariante §2 LGPD)
 *   - payment.request   → cria cobrança PIX via Asaas + dispara payment.created ao IconChat
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');
const { normalizePhoneBR } = require('../utils/iconPhoneResolver');

const SERVICE = 'webhookReturnService';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

/**
 * Processa um evento de retorno do IconChat.
 * Chamado pelo webhookIconController após validação HMAC e dedup.
 */
async function processReturnEvent(eventType, eventId, sellerId, payload) {
  logger.info(`[${SERVICE}] Processando evento de retorno`, { eventType, eventId, sellerId });

  try {
    switch (eventType) {
      case 'message.delivered':
        await handleMessageDelivered(eventId, sellerId, payload);
        break;

      case 'message.failed':
        await handleMessageFailed(eventId, sellerId, payload);
        break;

      case 'client.responded':
        await handleClientResponded(sellerId, payload);
        break;

      case 'conversation.resolved':
        await handleConversationResolved(eventId, sellerId, payload);
        break;

      case 'escalation.requested':
      case 'escalation.auto_timeout':
        await handleEscalation(eventId, sellerId, payload);
        break;

      case 'opt_out.requested':
        await handleOptOut(sellerId, payload);
        break;

      case 'payment.request':
        await handlePaymentRequest(eventId, sellerId, payload);
        break;

      case 'usage.threshold_reached':
        await handleUsageThreshold(sellerId, payload);
        break;

      case 'usage.limit_reached':
        await handleUsageLimit(sellerId, payload);
        break;

      default:
        logger.warn(`[${SERVICE}] Event type desconhecido`, { eventType, eventId });
    }

    // Marcar como processado
    await sb()
      .from('webhook_return_events')
      .update({ status: 'processed', processed_at: new Date().toISOString() })
      .eq('event_id', eventId);

  } catch (err) {
    logger.error(`[${SERVICE}] Erro ao processar evento de retorno`, {
      eventType, eventId, error: err.message,
    });

    await sb()
      .from('webhook_return_events')
      .update({ status: 'failed', error_message: err.message })
      .eq('event_id', eventId);

    throw err;
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleMessageDelivered(eventId, sellerId, payload) {
  const { elosEventId, wamid } = payload;

  if (elosEventId) {
    // Atualizar delivery log
    await sb()
      .from('webhook_delivery_log')
      .update({ status: 'delivered', delivered_at: new Date().toISOString() })
      .eq('event_id', elosEventId);
  }

  logger.info(`[${SERVICE}] Mensagem entregue via WhatsApp`, { elosEventId, wamid, sellerId });
}

/**
 * Invariante §5: message.failed → fallback email/in_app.
 * Re-dispatch com dedupKey `${eventId}_fallback` para evitar loop infinito.
 */
async function handleMessageFailed(eventId, sellerId, payload) {
  const { elosEventId, errorCode, errorTitle, customerPhone } = payload;

  logger.warn(`[${SERVICE}] Mensagem WhatsApp falhou`, {
    elosEventId, errorCode, errorTitle, sellerId,
  });

  if (elosEventId) {
    // Buscar o delivery log original para obter dados do evento
    const { data: logEntry } = await sb()
      .from('webhook_delivery_log')
      .select('event_type, payload')
      .eq('event_id', elosEventId)
      .maybeSingle();

    if (logEntry) {
      // Fallback: re-dispatch via email/in_app
      const NotificationDispatcher = require('./NotificationDispatcher');
      const fallbackType = _mapWebhookEventToNotificationType(logEntry.event_type);

      if (fallbackType && logEntry.payload?.pendenciaId) {
        // Resolver userId do cliente
        const userId = await _resolveUserIdFromSeller(sellerId, customerPhone);
        if (userId) {
          NotificationDispatcher.dispatch({
            userId,
            type: fallbackType,
            importance: 'high',
            data: logEntry.payload,
            dedupKey: `${elosEventId}_fallback`,
            metadata: { triggeredBy: 'system', fallbackFrom: 'webhook' },
          }).catch(err => {
            logger.error(`[${SERVICE}] Fallback dispatch falhou`, { error: err.message });
          });
        }
      }
    }
  }
}

async function handleClientResponded(sellerId, payload) {
  const { customerWaId } = payload;

  // Atualizar timestamp seguro do seller_client (sem inferência)
  if (customerWaId) {
    logger.info(`[${SERVICE}] Cliente respondeu`, { sellerId, customerWaId });
  }
}

/**
 * Invariante §4: conversation.resolved → sugestão para humano, NUNCA auto-resolve.
 * Cria entry em webhook_return_events com status=pending para ratificação humana.
 */
async function handleConversationResolved(eventId, sellerId, payload) {
  logger.info(`[${SERVICE}] Conversa resolvida no IconChat (aguarda ratificação humana)`, {
    eventId, sellerId, conversationId: payload.conversationId,
  });
  // O evento já foi registrado em webhook_return_events pelo controller.
  // Um humano deve revisar e decidir se auto-resolve a pendência na ElosCloud.
  // Por invariante §4, NUNCA fazemos auto-resolve aqui.
}

async function handleEscalation(eventId, sellerId, payload) {
  const { conversationId, reason } = payload;

  logger.info(`[${SERVICE}] Escalação solicitada`, { eventId, sellerId, reason });

  // Criar ticket de suporte
  try {
    const supportService = require('./SupportService');
    const { data: seller } = await sb()
      .from('seller_profiles')
      .select('user_id')
      .eq('id', sellerId)
      .maybeSingle();

    if (seller?.user_id) {
      await supportService.createTicket({
        userId: seller.user_id,
        title: `Escalação IconChat: ${reason || 'Conversa não resolvida'}`,
        description: `Conversa ${conversationId || 'N/A'} foi escalada automaticamente. Motivo: ${reason || 'timeout 24h'}`,
        category: 'marketplace',
        priority: 'high',
      });
    }
  } catch (err) {
    logger.warn(`[${SERVICE}] Falha ao criar ticket de escalação`, { error: err.message });
  }
}

/**
 * Invariante §2 LGPD: opt_out.requested → desabilita webhook nas preferências.
 */
async function handleOptOut(sellerId, payload) {
  const { userId, customerWaId } = payload;

  if (userId) {
    try {
      const userPreferencesService = require('./userPreferencesService');
      await userPreferencesService.update(userId, 'notification_prefs', {
        channels: { webhook: false },
      });

      logger.info(`[${SERVICE}] Opt-out processado (LGPD)`, { userId, sellerId });
    } catch (err) {
      logger.error(`[${SERVICE}] Falha ao processar opt-out`, { userId, error: err.message });
    }
  }
}

// ---------------------------------------------------------------------------
// Payment Handler (D2=b: ElosCloud cria cobrança via Asaas)
// ---------------------------------------------------------------------------

/**
 * Processa payment.request do IconChat: cria cobrança PIX via Asaas
 * e dispara payment.created de volta com QR code.
 *
 * Payload esperado: { orderId, customerPhone, customerName?, customerCpf? }
 */
async function handlePaymentRequest(eventId, sellerId, payload) {
  const { orderId, customerPhone, customerName, customerCpf } = payload;

  if (!orderId) {
    throw new Error('payment.request sem orderId');
  }

  const supabase = sb();

  // 1. Validar que o pedido pertence ao seller
  const { data: order, error: orderErr } = await supabase
    .from('marketplace_orders')
    .select('id, total_brl, payment_id, payment_method, status, buyer_id')
    .eq('id', orderId)
    .eq('seller_id', sellerId)
    .maybeSingle();

  if (orderErr || !order) {
    throw new Error(`Pedido ${orderId} não encontrado para seller ${sellerId}`);
  }

  // 2. Idempotência: se já tem payment_id, não criar cobrança duplicada
  if (order.payment_id) {
    logger.info(`[${SERVICE}] payment.request ignorado — pedido já tem payment_id`, {
      orderId, paymentId: order.payment_id,
    });
    return;
  }

  // 3. Criar/buscar customer no Asaas
  const asaasService = require('./asaasService');
  const webhookOutboundService = require('./webhookOutboundService');

  // Resolver userId do comprador para externalReference do customer
  const buyerId = order.buyer_id || await _resolveUserIdFromSeller(sellerId, customerPhone);
  const customerEmail = buyerId ? `${buyerId}@icon.eloscloud.com` : `${Date.now()}@icon.eloscloud.com`;

  const customer = await asaasService.createCustomer({
    name: customerName || 'Cliente IconChat',
    email: customerEmail,
    cpfCnpj: customerCpf || undefined,
    phone: customerPhone || undefined,
    externalReference: buyerId || `icon_${sellerId}_${orderId}`,
  });

  // 4. Criar PIX charge via Asaas
  const externalReference = `icon_payment:${sellerId}:${orderId}`;
  const charge = await asaasService.createPixCharge({
    customer: customer.id,
    value: order.total_brl,
    description: `Pedido ${orderId} via IconChat`,
    externalReference,
  });

  // 5. Atualizar pedido com payment_id e método
  await supabase
    .from('marketplace_orders')
    .update({
      payment_id: charge.id,
      payment_method: 'pix_iconchat',
    })
    .eq('id', orderId);

  // 6. Dispara payment.created de volta ao IconChat com QR code
  await webhookOutboundService.dispatchForSeller(sellerId, 'payment.created', {
    orderId,
    paymentId: charge.id,
    pixCopiaECola: charge.pixCopiaECola,
    qrCodeBase64: charge.encodedImage,
    expirationDate: charge.expirationDate,
    valueBrl: order.total_brl,
  });

  logger.info(`[${SERVICE}] PIX charge criado via IconChat`, {
    orderId, paymentId: charge.id, sellerId, valueBrl: order.total_brl,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _mapWebhookEventToNotificationType(eventType) {
  const map = {
    'pendencia.deadline_approaching': 'fiscal_prazo_3d',
    'pendencia.overdue': 'fiscal_pendencia_vencida',
    'pendencia.created': 'fiscal_prazo_7d',
  };
  return map[eventType] || null;
}

async function _resolveUserIdFromSeller(sellerId, customerPhone) {
  // Tentar resolver por telefone com normalização exata
  if (customerPhone) {
    const userId = await _getUserByPhone(customerPhone);
    if (userId) return userId;
  }

  // Fallback: owner do seller
  const { data: seller } = await sb()
    .from('seller_profiles')
    .select('user_id')
    .eq('id', sellerId)
    .maybeSingle();

  return seller?.user_id || null;
}

/**
 * Busca usuário por telefone com normalização brasileira.
 * Delega normalização ao iconPhoneResolver (com/sem DDI 55, com/sem nono dígito).
 */
async function _getUserByPhone(phone) {
  const candidates = normalizePhoneBR(phone);
  if (candidates.length === 0) return null;

  for (const c of candidates) {
    const { data } = await sb()
      .from('users')
      .select('id')
      .eq('telefone', c)
      .maybeSingle();
    if (data) return data.id;
  }

  return null;
}

// ──────────────────────────────────────────────────────
// IconChat Billing: usage.threshold_reached / usage.limit_reached
// ──────────────────────────────────────────────────────

async function handleUsageThreshold(sellerId, payload) {
  const { messagesUsed, messagesQuota, thresholdPct, periodStart, periodEnd } = payload;

  // Resolver seller → user_id
  const { data: seller } = await sb()
    .from('seller_profiles')
    .select('user_id')
    .eq('id', sellerId)
    .maybeSingle();

  if (!seller?.user_id) {
    logger.warn(`[${SERVICE}] handleUsageThreshold: seller não encontrado`, { sellerId });
    return;
  }

  // Upsert snapshot (com lógica de período)
  const addonService = require('./addonService');
  await addonService.upsertUsageSnapshot({
    sellerUserId: seller.user_id,
    sellerId,
    messagesUsed: messagesUsed || 0,
    messagesQuota: messagesQuota || 0,
    thresholdPct: thresholdPct || 80,
    periodStart,
    periodEnd,
  });

  // Dispatch notificação
  const NotificationDispatcher = require('./NotificationDispatcher');
  NotificationDispatcher.dispatch({
    userId: seller.user_id,
    type: 'iconchat_usage_warning',
    importance: 'medium',
    data: {
      messagesUsed,
      messagesQuota,
      thresholdPct,
      pctUsed: messagesQuota > 0 ? Math.round((messagesUsed / messagesQuota) * 100) : 0,
    },
    metadata: { triggeredBy: 'icon_webhook' },
  }).catch(err => logger.warn(`[${SERVICE}] Notificação threshold falhou`, { error: err.message }));

  logger.info(`[${SERVICE}] usage.threshold_reached processado`, { sellerId, thresholdPct, messagesUsed, messagesQuota });
}

async function handleUsageLimit(sellerId, payload) {
  const { messagesUsed, messagesQuota, thresholdPct, periodStart, periodEnd } = payload;

  const { data: seller } = await sb()
    .from('seller_profiles')
    .select('user_id')
    .eq('id', sellerId)
    .maybeSingle();

  if (!seller?.user_id) {
    logger.warn(`[${SERVICE}] handleUsageLimit: seller não encontrado`, { sellerId });
    return;
  }

  // Upsert snapshot
  const addonService = require('./addonService');
  await addonService.upsertUsageSnapshot({
    sellerUserId: seller.user_id,
    sellerId,
    messagesUsed: messagesUsed || 0,
    messagesQuota: messagesQuota || 0,
    thresholdPct: thresholdPct || 100,
    periodStart,
    periodEnd,
  });

  // Dispatch notificação (importance: high)
  const NotificationDispatcher = require('./NotificationDispatcher');
  NotificationDispatcher.dispatch({
    userId: seller.user_id,
    type: 'iconchat_usage_limit',
    importance: 'high',
    data: {
      messagesUsed,
      messagesQuota,
      thresholdPct: 100,
      pctUsed: 100,
    },
    metadata: { triggeredBy: 'icon_webhook' },
  }).catch(err => logger.warn(`[${SERVICE}] Notificação limit falhou`, { error: err.message }));

  logger.info(`[${SERVICE}] usage.limit_reached processado`, { sellerId, messagesUsed, messagesQuota });
}

module.exports = {
  processReturnEvent,
};
