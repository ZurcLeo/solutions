/**
 * dlqService — Dead Letter Queue para webhooks PIX Asaas.
 *
 * Camadas de reconciliação (PAY-H0-004):
 *   1. Webhook real-time (webhookController) — caminho feliz
 *   2. Este serviço (DLQ) — retry a cada 1h para eventos que falharam
 *   3. Scan periódico a cada 6h — verifica caixinhas ativas contra a API Asaas
 *
 * Tabela: pending_webhook_events (migration 20260614000001_pix_dlq_schema.sql)
 */
const { logger } = require('../logger');
const { getSupabaseClient } = require('../config/supabase');

// Backoff exponencial em minutos: tentativa 2=5min, 3=30min, 4=2h, 5=6h
const RETRY_DELAYS_MIN = [0, 5, 30, 120, 360];
const MAX_ATTEMPTS = 5;

// ─── Escrita ──────────────────────────────────────────────────────────────────

/**
 * Salva um webhook com falha na DLQ para retry posterior.
 * Idempotente: se o payment_id já estiver na DLQ, não insere novamente.
 */
async function saveFailedEvent(eventType, payment, error) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    // Extrair campos indexáveis do externalReference (formato: caixinhaId:userId)
    let caixinhaId = null;
    let userId = null;
    if (payment?.externalReference?.includes(':') &&
        !payment.externalReference.startsWith('validate:') &&
        !payment.externalReference.startsWith('marketplace_order_')) {
      const parts = payment.externalReference.split(':');
      if (parts.length === 2) {
        [caixinhaId, userId] = parts;
      }
    }

    const { error: insertErr } = await supabase
      .from('pending_webhook_events')
      .insert({
        event_type:  eventType,
        payload:     { event: eventType, payment },
        status:      'pending',
        attempts:    1,
        last_error:  error?.message || String(error),
        payment_id:  payment?.id || null,
        caixinha_id: caixinhaId,
        user_id:     userId,
        next_retry_at: _nextRetryAt(1)
      })
      .onConflict('payment_id')   // idx_pwe_payment_id_unique — ignora duplicatas
      .ignore();

    if (insertErr) {
      logger.error('Falha ao salvar evento na DLQ', {
        service: 'dlqService', method: 'saveFailedEvent',
        paymentId: payment?.id, error: insertErr.message
      });
    } else {
      logger.warn('Evento PIX salvo na DLQ para retry', {
        service: 'dlqService', method: 'saveFailedEvent',
        paymentId: payment?.id, caixinhaId, userId,
        eventType, retryAt: _nextRetryAt(1)
      });
    }
  } catch (err) {
    // DLQ não deve lançar erros — só loga
    logger.error('Erro crítico ao salvar na DLQ', {
      service: 'dlqService', method: 'saveFailedEvent', error: err.message
    });
  }
}

/**
 * Salva um evento com externalReference não roteável.
 * Status `unroutable` é terminal — nunca entra no retry loop.
 * Idempotente: se o payment_id já estiver na DLQ, não insere novamente.
 */
async function saveUnroutableEvent(eventType, payment, reason) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const { error: insertErr } = await supabase
      .from('pending_webhook_events')
      .insert({
        event_type:    eventType,
        payload:       { event: eventType, payment },
        status:        'unroutable',
        attempts:      0,
        max_attempts:  0,
        last_error:    reason || 'externalReference não roteável',
        payment_id:    payment?.id || null,
        caixinha_id:   null,
        user_id:       null,
        next_retry_at: new Date().toISOString()
      })
      .onConflict('payment_id')
      .ignore();

    if (insertErr) {
      logger.error('Falha ao salvar evento unroutable na DLQ', {
        service: 'dlqService', method: 'saveUnroutableEvent',
        paymentId: payment?.id, error: insertErr.message
      });
    } else {
      logger.warn('Evento unroutable salvo na DLQ (sem retry)', {
        service: 'dlqService', method: 'saveUnroutableEvent',
        paymentId: payment?.id, eventType, reason
      });
    }
  } catch (err) {
    logger.error('Erro crítico ao salvar unroutable na DLQ', {
      service: 'dlqService', method: 'saveUnroutableEvent', error: err.message
    });
  }
}

// ─── Processamento (chamado pelo reconciliationJob a cada 1h) ─────────────────

/**
 * Processa eventos pendentes da DLQ.
 * Busca eventos com status pending/failed e next_retry_at <= now.
 * Tenta re-processar via webhookController._processAsaasEvent.
 */
async function processQueue() {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  logger.info('DLQ: iniciando processamento da fila', { service: 'dlqService' });

  // Busca lote de até 50 eventos maduros
  const { data: events, error: fetchErr } = await supabase
    .from('pending_webhook_events')
    .select('*')
    .in('status', ['pending', 'failed'])
    .lte('next_retry_at', new Date().toISOString())
    .order('next_retry_at', { ascending: true })
    .limit(50);

  if (fetchErr) {
    logger.error('DLQ: falha ao buscar eventos pendentes', {
      service: 'dlqService', error: fetchErr.message
    });
    return;
  }

  if (!events?.length) {
    logger.info('DLQ: nenhum evento pendente', { service: 'dlqService' });
    return;
  }

  logger.info('DLQ: processando eventos pendentes', {
    service: 'dlqService', count: events.length
  });

  // Importa lazy para evitar dependência circular (webhookController → dlqService → webhookController)
  const webhookController = require('../controllers/webhookController');

  for (const ev of events) {
    await _processOne(supabase, webhookController, ev);
  }

  logger.info('DLQ: processamento concluído', {
    service: 'dlqService', processed: events.length
  });
}

async function _processOne(supabase, webhookController, ev) {
  // Marcar como processing (lock otimista — evita processamento duplo se job rodar em paralelo)
  const { error: lockErr } = await supabase
    .from('pending_webhook_events')
    .update({ status: 'processing' })
    .eq('id', ev.id)
    .eq('status', ev.status);  // só atualiza se ainda estiver no status esperado

  if (lockErr) {
    logger.warn('DLQ: falha ao adquirir lock do evento', {
      service: 'dlqService', eventId: ev.id, error: lockErr.message
    });
    return;
  }

  const { event: eventType, payment } = ev.payload || {};
  const nextAttempt = (ev.attempts || 1) + 1;

  try {
    await webhookController._processAsaasEvent(eventType, payment);

    // Sucesso
    await supabase
      .from('pending_webhook_events')
      .update({
        status:       'done',
        processed_at: new Date().toISOString(),
        attempts:     nextAttempt
      })
      .eq('id', ev.id);

    logger.info('DLQ: evento processado com sucesso', {
      service: 'dlqService', paymentId: ev.payment_id, attempt: nextAttempt
    });
  } catch (err) {
    const isExhausted = nextAttempt >= MAX_ATTEMPTS;

    await supabase
      .from('pending_webhook_events')
      .update({
        status:        isExhausted ? 'abandoned' : 'failed',
        attempts:      nextAttempt,
        last_error:    err.message,
        next_retry_at: isExhausted ? null : _nextRetryAt(nextAttempt)
      })
      .eq('id', ev.id);

    logger.error(`DLQ: falha na tentativa ${nextAttempt}${isExhausted ? ' — ABANDONADO' : ''}`, {
      service: 'dlqService',
      paymentId: ev.payment_id,
      caixinhaId: ev.caixinha_id,
      attempt: nextAttempt,
      isExhausted,
      error: err.message,
      action: isExhausted ? 'DLQ_EVENT_ABANDONED' : 'DLQ_EVENT_RETRY_SCHEDULED'
    });
  }
}

// ─── Scan periódico (chamado pelo reconciliationJob a cada 6h) ────────────────

/**
 * Verifica caixinhas com atividade recente (last_transaction_at nas últimas 24h)
 * contra a API Asaas — captura PIX que o webhook não entregou.
 */
async function periodicReconciliation() {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  logger.info('Reconciliação periódica: iniciando scan de caixinhas ativas', {
    service: 'dlqService', method: 'periodicReconciliation'
  });

  // Caixinhas com atividade nas últimas 24h e subconta ativa
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: caixinhas, error: fetchErr } = await supabase
    .from('caixinhas')
    .select('id, asaas_wallet_id, last_transaction_at')
    .eq('asaas_subconta_status', 'active')
    .gte('last_transaction_at', since)
    .not('asaas_wallet_id', 'is', null)
    .limit(100);

  if (fetchErr) {
    logger.error('Reconciliação periódica: falha ao buscar caixinhas', {
      service: 'dlqService', error: fetchErr.message
    });
    return;
  }

  if (!caixinhas?.length) {
    logger.info('Reconciliação periódica: nenhuma caixinha ativa nas últimas 24h', {
      service: 'dlqService'
    });
    return;
  }

  logger.info('Reconciliação periódica: verificando caixinhas', {
    service: 'dlqService', count: caixinhas.length
  });

  const asaasService = require('./asaasService');
  const ledgerService = require('./ledgerService');

  for (const caixinha of caixinhas) {
    try {
      await _reconcileCaixinha(supabase, asaasService, ledgerService, caixinha, since);
    } catch (err) {
      logger.error('Reconciliação periódica: falha em caixinha individual', {
        service: 'dlqService', caixinhaId: caixinha.id, error: err.message
      });
    }
  }

  // Cleanup mensal: apagar eventos done/abandoned com mais de 30 dias
  await supabase.rpc('cleanup_pending_webhook_events').catch(() => {});

  logger.info('Reconciliação periódica: concluída', { service: 'dlqService' });
}

async function _reconcileCaixinha(supabase, asaasService, ledgerService, caixinha, since) {
  // Busca pagamentos confirmados no Asaas desde last_transaction_at
  // Nota: Asaas não tem endpoint de "pagamentos por walletId" diretamente;
  // usamos os eventos já salvos na DLQ com caixinha_id correspondente.
  const { data: pendingForCaixinha } = await supabase
    .from('pending_webhook_events')
    .select('payment_id, payload, attempts')
    .eq('caixinha_id', caixinha.id)
    .in('status', ['pending', 'failed', 'abandoned'])
    .limit(20);

  if (!pendingForCaixinha?.length) return;

  logger.info('Reconciliação periódica: eventos pendentes para caixinha', {
    service: 'dlqService',
    caixinhaId: caixinha.id,
    count: pendingForCaixinha.length
  });

  for (const ev of pendingForCaixinha) {
    try {
      // Confirmar status no Asaas antes de creditar
      const status = await asaasService.getPaymentStatus(ev.payment_id);
      if (status.status !== 'RECEIVED' && status.status !== 'CONFIRMED') continue;

      // Buscar userId do payload original
      const payment = ev.payload?.payment;
      if (!payment?.externalReference) continue;

      const parts = payment.externalReference.split(':');
      if (parts.length !== 2) continue;
      const [, userId] = parts;

      const result = await ledgerService.creditMember({
        caixinhaId: caixinha.id,
        userId,
        amount: payment.value,
        paymentId: ev.payment_id,
        description: 'PIX reconciliado — scan periódico'
      });

      if (!result.alreadyProcessed) {
        // Marcar como done na DLQ
        await supabase
          .from('pending_webhook_events')
          .update({ status: 'done', processed_at: new Date().toISOString() })
          .eq('payment_id', ev.payment_id);

        logger.info('Reconciliação periódica: crédito efetuado', {
          service: 'dlqService', caixinhaId: caixinha.id, userId, paymentId: ev.payment_id
        });
      }
    } catch (err) {
      logger.warn('Reconciliação periódica: falha ao reconciliar pagamento individual', {
        service: 'dlqService', paymentId: ev.payment_id, error: err.message
      });
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _nextRetryAt(attempt) {
  // attempt=1 (1ª falha) → retry em 5min, attempt=2 → 30min, etc.
  const delayMin = RETRY_DELAYS_MIN[Math.min(attempt, RETRY_DELAYS_MIN.length - 1)];
  return new Date(Date.now() + delayMin * 60 * 1000).toISOString();
}

module.exports = { saveFailedEvent, saveUnroutableEvent, processQueue, periodicReconciliation };
