const asaasService = require('../services/asaasService');
const ledgerService = require('../services/ledgerService');
const emailService = require('../services/emailService');
const userPaymentMethodService = require('../services/userPaymentMethodService');
const { logger } = require('../logger');
const crypto = require('crypto');
const bookingPaymentService = require('../services/bookingPaymentService');
const deliveryPaymentService = require('../services/deliveryPaymentService');
const dlqService = require('../services/dlqService');
const { getSupabaseClient } = require('../config/supabase');
const { createClient } = require('@supabase/supabase-js');

// ─── Asaas Webhook ────────────────────────────────────────────────────────────

/**
 * Webhook do Asaas para notificações de pagamento.
 * Rota: POST /api/webhook/asaas
 */
exports.asaasWebhook = async (req, res) => {
  const { event, payment } = req.body;

  logger.info('Webhook Asaas recebido', {
    controller: 'WebhookController',
    method: 'asaasWebhook',
    event,
    paymentId: payment?.id,
    externalReference: payment?.externalReference,
    action: 'ASAAS_WEBHOOK_RECEIVED'
  });

  // Validar token antes de qualquer coisa
  if (!asaasService.validateWebhookToken(req)) {
    return res.status(401).json({ error: 'Token inválido' });
  }

  try {
    await exports._processAsaasEvent(event, payment);
  } catch (error) {
    logger.error('Erro no processamento do webhook Asaas', {
      controller: 'WebhookController',
      method: 'asaasWebhook',
      event,
      paymentId: payment?.id,
      error: error.message,
      action: 'ASAAS_WEBHOOK_PROCESSING_ERROR'
    });
    // Salvar na DLQ para retry automático
    setImmediate(() => dlqService.saveFailedEvent(event, payment, error));
    return res.status(200).json({ status: 'received', warning: 'processing_error' });
  }

  return res.status(200).json({ status: 'received' });
};

/**
 * Processa eventos de pagamento do Asaas.
 * Roteamento por externalReference para identificar o domínio.
 */
exports._processAsaasEvent = async (event, payment) => {
  if (!payment?.id) {
    logger.warn('Webhook Asaas sem payment.id', {
      controller: 'WebhookController', method: '_processAsaasEvent', event,
    });
    return;
  }

  const ref = payment.externalReference || '';

  // ─── PAYMENT_AUTHORIZED ─────────────────────────────────────────────
  if (event === 'PAYMENT_AUTHORIZED') {
    // Booking: externalReference = "booking:{id}"
    if (ref.startsWith('booking:')) {
      await bookingPaymentService.confirmAuthorization(payment.id);
      logger.info('Booking hold autorizado via webhook Asaas', {
        controller: 'WebhookController', paymentId: payment.id, ref,
      });
      return;
    }

    // Stay: externalReference = "stay:{id}"
    if (ref.startsWith('stay:')) {
      const stayId = ref.split(':')[1];
      const sbService = _getServiceClient();
      await sbService.from('property_stays')
        .update({ payment_status: 'authorized', status: 'confirmed' })
        .eq('id', stayId)
        .eq('status', 'pending_payment');
      logger.info('Stay hold autorizado via webhook Asaas', {
        controller: 'WebhookController', paymentId: payment.id, stayId,
      });
      return;
    }

    // Carona seat: externalReference = "carona_seat:{seatId}"
    if (ref.startsWith('carona_seat:')) {
      const seatId = ref.split(':')[1];
      const caronaService = require('../services/caronaService');
      await caronaService.confirmSeatPayment(seatId, payment.id);
      logger.info('Carona seat autorizado via webhook Asaas', {
        controller: 'WebhookController', paymentId: payment.id, seatId,
      });
      return;
    }

    // Freight extra: externalReference = "freight_extra:{orderId}:{adjId}"
    if (ref.startsWith('freight_extra:')) {
      const parts = ref.split(':');
      const adjustmentId = parts[2];
      if (adjustmentId) {
        await deliveryPaymentService.confirmExtraChargePayment(payment.id, adjustmentId);
        logger.info('Freight extra charge autorizado via webhook Asaas', {
          controller: 'WebhookController', paymentId: payment.id, adjustmentId,
        });
      }
      return;
    }

    logger.info('PAYMENT_AUTHORIZED sem routing — ignorado', {
      controller: 'WebhookController', paymentId: payment.id, ref,
    });
    return;
  }

  // ─── PAYMENT_CONFIRMED / PAYMENT_RECEIVED ───────────────────────────
  if (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED') {
    if (!ref) {
      logger.warn('Webhook Asaas sem externalReference', {
        controller: 'WebhookController', paymentId: payment.id, event,
      });
      return;
    }

    // Cobrança de comissão billing: "billing:{sellerUserId}:{balanceId}"
    if (ref.startsWith('billing:')) {
      const parts = ref.split(':');
      const sellerUserId = parts[1];
      const balanceId = parts[2];
      if (sellerUserId && balanceId) {
        setImmediate(async () => {
          try {
            const { getSupabaseClient } = require('../config/supabase');
            const supabase = getSupabaseClient();
            if (!supabase) return;

            // Zerar balance e resetar ciclo de pagamento
            await supabase
              .from('seller_billing_balance')
              .update({
                balance_brl: 0,
                unpaid_cycles: 0,
                is_blocked: false,
                pending_payment_id: null,
                last_paid_at: new Date().toISOString(),
              })
              .eq('id', balanceId)
              .eq('seller_user_id', sellerUserId);

            // Registrar evento de pagamento no billing_events
            await supabase.from('billing_events').insert({
              seller_user_id: sellerUserId,
              billing_mode: 'commission_payment',
              commission_brl: payment.value,
              sale_date: new Date().toISOString(),
            });

            // Notificar seller
            const NotificationDispatcher = require('../services/NotificationDispatcher');
            NotificationDispatcher.dispatch({
              userId: sellerUserId,
              type: 'billing_paid',
              importance: 'medium',
              data: { amount: payment.value, paymentId: payment.id },
              dedupKey: `billing_paid_${payment.id}`,
              metadata: { triggeredBy: 'system' },
            }).catch(() => {});

            logger.info('Billing commission payment confirmed', {
              controller: 'WebhookController', paymentId: payment.id,
              sellerUserId, balanceId, amount: payment.value,
            });
          } catch (err) {
            logger.error('Billing payment processing failed', {
              controller: 'WebhookController', paymentId: payment.id,
              sellerUserId, error: err.message,
            });
          }
        });
      }
      return;
    }

    // Pagamento de assinatura: "subscription:{userId}:{planSlug}:{cycle}"
    if (ref.startsWith('subscription:')) {
      const parts = ref.split(':');
      const userId = parts[1];
      const planSlug = parts[2];
      const cycle = parts[3] || 'monthly';
      if (userId && planSlug) {
        setImmediate(async () => {
          try {
            const subscriptionService = require('../services/subscriptionService');

            // Ativa assinatura: cria record + atualiza seller_profiles
            await subscriptionService.createSubscription(userId, planSlug, cycle, payment.id);

            // Notificar seller
            const NotificationDispatcher = require('../services/NotificationDispatcher');
            NotificationDispatcher.dispatch({
              userId,
              type: 'subscription_activated',
              importance: 'high',
              data: { planSlug, paymentId: payment.id, value: payment.value },
              dedupKey: `subscription_activated_${payment.id}`,
              metadata: { triggeredBy: 'system' },
            }).catch(() => {});

            logger.info('Subscription payment confirmed — plan activated', {
              controller: 'WebhookController', paymentId: payment.id,
              userId, planSlug, cycle, amount: payment.value,
            });
          } catch (err) {
            logger.error('Subscription payment processing failed', {
              controller: 'WebhookController', paymentId: payment.id,
              userId, planSlug, error: err.message,
            });
          }
        });
      }
      return;
    }

    // Validação de conta bancária: "validate:{methodId}:{userId}"
    if (ref.startsWith('validate:')) {
      await exports._processPaymentMethodValidation(payment);
      return;
    }

    // Pagamento IconChat: "icon_payment:{sellerId}:{orderId}"
    if (ref.startsWith('icon_payment:')) {
      const parts = ref.split(':');
      const sellerId = parts[1];
      const orderId = parts[2];
      if (sellerId && orderId) {
        const marketplaceService = require('../services/marketplaceService');
        await marketplaceService.handlePixPaymentConfirmed(orderId);

        // Notificar IconChat: payment.confirmed (enriquecido com dados do pedido)
        setImmediate(async () => {
          try {
            const webhookOutboundService = require('../services/webhookOutboundService');
            const supabase = getSupabaseClient();

            let clientName = 'Cliente';
            let clientPhone = null;
            let amount = null;

            if (supabase) {
              const { data: order } = await supabase
                .from('marketplace_orders')
                .select('total_brl, buyer_id, guest_buyer_id, buyer_snapshot')
                .eq('id', orderId)
                .single();

              if (order) {
                // Formatar valor como string BRL (ex: "R$ 45,90")
                if (order.total_brl != null) {
                  amount = `R$ ${Number(order.total_brl).toFixed(2).replace('.', ',')}`;
                }

                // Resolver nome e telefone do comprador
                const snap = order.buyer_snapshot;
                if (snap && typeof snap === 'object' && snap.full_name) {
                  clientName = snap.full_name;
                  clientPhone = snap.phone || null;
                }

                // Fallback: buscar do users (comprador registrado) ou guest_buyers (visitante)
                if (order.buyer_id && (!clientPhone || clientName === 'Cliente')) {
                  const { data: buyer } = await supabase
                    .from('users')
                    .select('full_name, telefone')
                    .eq('id', order.buyer_id)
                    .maybeSingle();
                  if (buyer) {
                    if (!clientName || clientName === 'Cliente') clientName = buyer.full_name || clientName;
                    if (!clientPhone) clientPhone = buyer.telefone || null;
                  }
                } else if (order.guest_buyer_id && (!clientPhone || clientName === 'Cliente')) {
                  const { data: guest } = await supabase
                    .from('guest_buyers')
                    .select('full_name, phone')
                    .eq('id', order.guest_buyer_id)
                    .maybeSingle();
                  if (guest) {
                    if (!clientName || clientName === 'Cliente') clientName = guest.full_name || clientName;
                    if (!clientPhone) clientPhone = guest.phone || null;
                  }
                }
              }
            }

            await webhookOutboundService.dispatchForSeller(sellerId, 'payment.confirmed', {
              orderId,
              paymentId: payment.id,
              status: 'confirmed',
              clientName,
              amount,
              clientPhone,
            });
          } catch (err) {
            logger.warn('IconChat payment.confirmed dispatch falhou', {
              controller: 'WebhookController', orderId, sellerId, error: err.message,
            });
          }
        });

        logger.info('IconChat payment confirmed via Asaas', {
          controller: 'WebhookController', paymentId: payment.id, sellerId, orderId,
        });
      }
      return;
    }

    // Pedido marketplace: "marketplace_order_{orderId}"
    if (ref.startsWith('marketplace_order_')) {
      const orderId = ref.replace('marketplace_order_', '');
      const marketplaceService = require('../services/marketplaceService');
      await marketplaceService.handlePixPaymentConfirmed(orderId);

      // Trust Passport — liquidação testemunhada (witnessed) via webhook Asaas
      // Idempotente: ON CONFLICT (order_id, user_id, event_type) DO NOTHING
      setImmediate(async () => {
        try {
          const trustMarketplaceService = require('../services/trustMarketplaceService');
          const supabase = getSupabaseClient();
          if (!supabase) return;

          const { data: order } = await supabase
            .from('marketplace_orders')
            .select('id, buyer_id, total_brl, payment_method, buyer_confirmed, seller_id, seller_profiles!inner(user_id)')
            .eq('id', orderId)
            .single();

          if (!order) return;

          const sellerUserId = order.seller_profiles.user_id;
          const orderForTrust = {
            id: order.id,
            buyer_id: order.buyer_id,
            total_brl: order.total_brl,
            payment_method: order.payment_method,
            buyer_confirmed: order.buyer_confirmed,
            seller_user_id: sellerUserId,
          };
          const opts = { settlement_ref: payment.id };

          await trustMarketplaceService.recordMarketplaceTrust(orderForTrust, sellerUserId, 'seller', 'witnessed', opts);
          // Null-guard: guest orders have buyer_id=NULL — skip buyer trust event
          if (order.buyer_id) {
            await trustMarketplaceService.recordMarketplaceTrust(orderForTrust, order.buyer_id, 'buyer', 'witnessed', opts);
          }
        } catch (err) {
          logger.warn('Trust marketplace witnessed falhou (webhook)', {
            controller: 'WebhookController', orderId, error: err.message,
          });
        }
      });

      return;
    }

    // Bilhete de rifa: "raffle_{gameId}_ticket_{ticketNumber}"
    if (ref.startsWith('raffle_')) {
      const raffleGamesService = require('../services/raffleGamesService');
      await raffleGamesService.confirmPayment(payment.id);
      logger.info('Bilhete de rifa confirmado via webhook Asaas', {
        controller: 'WebhookController', paymentId: payment.id, ref,
      });
      return;
    }

    // Legacy elocoins: path REMOVED (2026-07-09) — double-credit vulnerability (no idempotency).
    // New purchases use elcoin: path via eloCoinPackageService with app-level dedup.
    // Any in-flight elocoins: webhooks will be logged and ignored.
    if (ref.startsWith('elocoins:')) {
      logger.warn('Legacy elocoins: webhook received — path removed, ignoring', {
        controller: 'WebhookController', paymentId: payment.id, ref, event,
      });
      return;
    }

    // Booking/Stay/Carona confirmados (já autorizados antes — noop na maioria dos casos)
    if (ref.startsWith('booking:') || ref.startsWith('stay:') || ref.startsWith('carona_seat:')) {
      logger.info('Pagamento confirmado para domínio já roteado em AUTHORIZED', {
        controller: 'WebhookController', paymentId: payment.id, ref, event,
      });
      return;
    }

    // Caixinha PIX: externalReference = "{caixinhaId}:{userId}"
    const parts = ref.split(':');
    if (parts.length === 2) {
      const [caixinhaId, userId] = parts;

      logger.info('Creditando membro via webhook Asaas', {
        controller: 'WebhookController', paymentId: payment.id, caixinhaId, userId,
        amount: payment.value, event,
      });

      const result = await ledgerService.creditMember({
        caixinhaId, userId,
        amount: payment.value,
        paymentId: payment.id,
        description: `PIX confirmado — ${event}`,
      });

      if (result.alreadyProcessed) {
        logger.info('Webhook duplicado ignorado pelo ledger', {
          controller: 'WebhookController', paymentId: payment.id,
        });
        return;
      }

      // Atualizar last_transaction_at
      setImmediate(async () => {
        const supabase = getSupabaseClient();
        if (supabase) {
          await supabase.from('caixinhas')
            .update({ last_transaction_at: new Date().toISOString() })
            .eq('id', caixinhaId).catch(() => {});
        }
      });

      logger.info('Crédito registrado com sucesso via webhook Asaas', {
        controller: 'WebhookController', txId: result.txId, paymentId: payment.id,
        caixinhaId, userId, amount: payment.value,
      });
      return;
    }

    logger.error('ALERTA: Pagamento recebido com externalReference não roteável', {
      controller: 'WebhookController', ref, paymentId: payment.id, event,
      value: payment.value, severity: 'financial_alert'
    });
    await dlqService.saveUnroutableEvent(event, payment,
      `externalReference não reconhecido: ${ref}`
    );
    return;
  }

  // ─── PAYMENT_REFUNDED ────────────────────────────────────────────────
  if (event === 'PAYMENT_REFUNDED') {
    if (ref.startsWith('booking:')) {
      const bookingId = ref.split(':')[1];
      const sbService = _getServiceClient();
      await sbService.from('service_bookings')
        .update({ payment_status: 'refunded' })
        .eq('id', bookingId);
      logger.info('Booking refunded via webhook Asaas', {
        controller: 'WebhookController', paymentId: payment.id, bookingId,
      });
      return;
    }

    if (ref.startsWith('stay:')) {
      const stayId = ref.split(':')[1];
      const sbService = _getServiceClient();
      await sbService.from('property_stays')
        .update({ payment_status: 'refunded' })
        .eq('id', stayId);
      logger.info('Stay refunded via webhook Asaas', {
        controller: 'WebhookController', paymentId: payment.id, stayId,
      });
      return;
    }

    if (ref.startsWith('carona_seat:')) {
      const seatId = ref.split(':')[1];
      const sbService = _getServiceClient();
      await sbService.from('carona_seats')
        .update({ payment_status: 'refunded' })
        .eq('id', seatId);
      logger.info('Carona seat refunded via webhook Asaas', {
        controller: 'WebhookController', paymentId: payment.id, seatId,
      });
      return;
    }

    // IconChat payment refund: "icon_payment:{sellerId}:{orderId}"
    if (ref.startsWith('icon_payment:')) {
      const parts = ref.split(':');
      const sellerId = parts[1];
      const orderId = parts[2];
      if (sellerId && orderId) {
        setImmediate(async () => {
          try {
            const webhookOutboundService = require('../services/webhookOutboundService');
            await webhookOutboundService.dispatchForSeller(sellerId, 'payment.refunded', {
              orderId,
              paymentId: payment.id,
              status: 'refunded',
            });
          } catch (err) {
            logger.warn('IconChat payment.refunded dispatch falhou', {
              controller: 'WebhookController', orderId, sellerId, error: err.message,
            });
          }
        });
        logger.info('IconChat payment refunded via Asaas', {
          controller: 'WebhookController', paymentId: payment.id, sellerId, orderId,
        });
      }
      return;
    }

    logger.info('PAYMENT_REFUNDED sem routing específico', {
      controller: 'WebhookController', paymentId: payment.id, ref,
    });
    return;
  }

  // ─── Outros eventos ─────────────────────────────────────────────────
  logger.info('Evento Asaas não tratado', {
    controller: 'WebhookController', event, paymentId: payment.id,
  });
};

// ─── Asaas: validação de conta bancária global ────────────────────────────────

/**
 * Processa pagamento PIX de validação de user_payment_methods.
 * externalReference = "validate:{methodId}:{userId}"
 */
exports._processPaymentMethodValidation = async (payment) => {
  const parts = payment.externalReference.split(':');
  if (parts.length !== 3) {
    logger.warn('externalReference de validação mal formatado', {
      controller: 'WebhookController', ref: payment.externalReference,
    });
    return;
  }

  const [, methodId, userId] = parts;

  logger.info('Processando validação de conta bancária global via Asaas', {
    controller: 'WebhookController', paymentId: payment.id, methodId, userId,
  });

  try {
    await userPaymentMethodService.confirmValidation(methodId, userId, payment.id);

    try {
      const NotificationDispatcher = require('../services/NotificationDispatcher');
      await NotificationDispatcher.dispatch({
        userId,
        type: 'payment_method_validated',
        importance: 'medium',
        data: { methodId, message: 'Sua conta bancária foi validada e está pronta para uso.' },
        metadata: { triggeredBy: 'system', correlationId: payment.id },
      });
    } catch (notifErr) {
      logger.warn('Falha ao notificar validação de conta', { error: notifErr.message, userId });
    }

    logger.info('Conta bancária global validada via webhook Asaas', {
      controller: 'WebhookController', methodId, userId, paymentId: payment.id,
    });
  } catch (err) {
    logger.error('Erro ao confirmar validação de conta bancária', {
      controller: 'WebhookController', methodId, userId, paymentId: payment.id, error: err.message,
    });
  }
};

// ─── Svix Signature Validation Helper ─────────────────────────────────────────

/**
 * Valida assinatura Svix (usada por webhooks do Resend).
 * @param {Object} req - Express request
 * @param {string} secretEnvVar - Nome da env var com o secret
 * @returns {{ valid: boolean, reason?: string }}
 */
function _validateSvixSignature(req, secretEnvVar) {
  const secret = process.env[secretEnvVar];
  if (!secret) return { valid: true }; // sem secret = skip validação (dev)

  const svixId = req.headers['svix-id'];
  const svixTimestamp = req.headers['svix-timestamp'];
  const svixSignature = req.headers['svix-signature'];

  if (!svixId || !svixTimestamp || !svixSignature) {
    return { valid: false, reason: 'headers svix ausentes' };
  }

  const tsSeconds = parseInt(svixTimestamp, 10);
  if (Math.abs(Date.now() / 1000 - tsSeconds) > 300) {
    return { valid: false, reason: 'timestamp fora da janela' };
  }

  const payload = JSON.stringify(req.body);
  const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const computedSig = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  const signatures = svixSignature.split(' ').map(s => s.replace(/^v1,/, ''));
  const isValid = signatures.some(sig => sig === computedSig);

  if (!isValid) {
    return { valid: false, reason: 'assinatura inválida' };
  }

  return { valid: true };
}

// ─── Resend Delivery Webhook ──────────────────────────────────────────────────

/**
 * Webhook para eventos de delivery do Resend (sent, delivered, bounced, complained).
 * Rota: POST /api/webhook/resend-delivery
 */
exports.resendDeliveryWebhook = async (req, res) => {
  // Responder 200 imediatamente para não travar o webhook
  res.status(200).json({ status: 'received' });

  setImmediate(async () => {
    try {
      const validation = _validateSvixSignature(req, 'RESEND_DELIVERY_WEBHOOK_SECRET');
      if (!validation.valid) {
        logger.warn(`Resend delivery: ${validation.reason}`, { controller: 'WebhookController' });
        return;
      }

      const { type, data } = req.body;
      if (!type || !data) return;

      const emailDeliveryService = require('../services/emailDeliveryService');
      await emailDeliveryService.processEvent(type, data);

      logger.info('Resend delivery event processado', {
        controller: 'WebhookController', eventType: type, messageId: data.email_id || data.id,
      });
    } catch (error) {
      logger.error('Resend delivery: erro no processamento', {
        controller: 'WebhookController', error: error.message,
      });
    }
  });
};

// ─── Resend Inbound Email Webhook ─────────────────────────────────────────────

/**
 * Webhook para recebimento de emails inbound via Resend.
 * Rota: POST /api/webhook/resend-inbound
 */
exports.resendInboundWebhook = async (req, res) => {
  res.status(200).json({ status: 'received' });

  setImmediate(async () => {
    try {
      const validation = _validateSvixSignature(req, 'RESEND_WEBHOOK_SECRET');
      if (!validation.valid) {
        logger.warn(`Resend inbound: ${validation.reason}`, { controller: 'WebhookController' });
        return;
      }

      // 2. Verificar tipo de evento
      const { type, data } = req.body;
      if (type !== 'email.received') return;

      const emailId = data?.email_id;
      const from = data?.from;
      const subject = data?.subject;
      if (!emailId || !from) return;

      logger.info('Resend inbound: email recebido, buscando conteúdo', {
        controller: 'WebhookController', emailId, from, subject,
      });

      // 3. Buscar conteúdo completo via Resend API
      const axios = require('axios');
      const emailResponse = await axios.get(
        `https://api.resend.com/emails/received/${emailId}`,
        { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } }
      );
      const received = emailResponse.data;
      const htmlBody = received.html || '';
      const textBody = received.text || '';
      const toAddress = Array.isArray(received.to) ? received.to.join(', ') : (received.to || '');

      // 4. Encaminhar para suporte
      const forwardTo = process.env.EMAIL_SUPPORT_FORWARD || 'eloscloud@proton.me';
      const forwardSubject = `[Inbound] ${subject || '(sem assunto)'}`;
      const forwardContent = `
        <p><strong>De:</strong> ${from}</p>
        <p><strong>Para:</strong> ${toAddress}</p>
        <p><strong>Assunto original:</strong> ${subject || '(sem assunto)'}</p>
        <hr />
        ${htmlBody || `<pre>${textBody || '(sem conteúdo)'}</pre>`}
      `;

      await emailService.sendEmail({
        to: forwardTo,
        subject: forwardSubject,
        templateType: 'padrao',
        data: { subject: forwardSubject, content: forwardContent }
      });

      logger.info('Resend inbound: email encaminhado com sucesso', {
        controller: 'WebhookController', emailId, forwardTo, originalFrom: from,
      });
    } catch (error) {
      logger.error('Resend inbound: erro no processamento', {
        controller: 'WebhookController', error: error.message,
      });
    }
  });
};

// ─── Melhor Envio Tracking Webhook ───────────────────────────────────────────

/**
 * Webhook do Melhor Envio para atualizacoes de rastreio.
 * Rota: POST /api/webhook/melhor-envio
 * Nao requer auth JWT — validacao via shared secret (query param ou header).
 */
exports.melhorEnvioWebhook = async (req, res) => {
  const TAG = '[WebhookController.melhorEnvioWebhook]';

  // Validate shared secret
  const secret = req.query.secret || req.headers['x-melhor-envio-secret'];
  if (secret !== process.env.ME_WEBHOOK_SECRET) {
    logger.warn(`${TAG} Token invalido`, { action: 'ME_WEBHOOK_INVALID_TOKEN' });
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Always return 200 quickly to avoid retries
  res.status(200).json({ status: 'received' });

  // Process async
  setImmediate(async () => {
    try {
      const { event, data } = req.body || {};
      if (!data?.id) {
        logger.warn(`${TAG} Payload sem data.id — ignorado`, { action: 'ME_WEBHOOK_NO_ID', event });
        return;
      }

      logger.info(`${TAG} Processando evento`, {
        action: 'ME_WEBHOOK_PROCESSING',
        event,
        meOrderId: data.id,
      });

      // Find shipping_order by me_order_id
      const supabase = getSupabaseClient();
      if (!supabase) {
        logger.warn(`${TAG} Supabase indisponivel`, { action: 'ME_WEBHOOK_NO_SUPABASE' });
        return;
      }

      const { data: shippingOrder, error: queryErr } = await supabase
        .from('shipping_orders')
        .select('id, order_id, me_order_id, status, tracking_code')
        .eq('me_order_id', data.id)
        .maybeSingle();

      if (queryErr) {
        logger.error(`${TAG} Erro ao buscar shipping_order`, {
          action: 'ME_WEBHOOK_QUERY_ERROR',
          meOrderId: data.id,
          error: queryErr.message,
        });
        return;
      }

      if (!shippingOrder) {
        logger.warn(`${TAG} shipping_order nao encontrada para me_order_id`, {
          action: 'ME_WEBHOOK_ORDER_NOT_FOUND',
          meOrderId: data.id,
        });
        return;
      }

      // Use shared processTrackingUpdate helper
      const { processTrackingUpdate } = require('../config/jobs/shippingTrackingPollerJob');
      const result = await processTrackingUpdate(shippingOrder, data);

      logger.info(`${TAG} Webhook processado`, {
        action: 'ME_WEBHOOK_PROCESSED',
        meOrderId: data.id,
        shippingOrderId: shippingOrder.id,
        updated: result.updated,
        newStatus: result.newStatus,
        newEventsCount: result.newEventsCount,
      });
    } catch (err) {
      logger.error(`${TAG} Erro processando webhook ME`, {
        action: 'ME_WEBHOOK_ERROR',
        error: err.message,
      });
    }
  });
};

// ─── Helper ──────────────────────────────────────────────────────────────────

function _getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados.');
  return createClient(url, key, { auth: { persistSession: false } });
}
