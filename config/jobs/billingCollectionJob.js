'use strict';

/**
 * billingCollectionJob — Cron job diario 07:00 BRT.
 *
 * Cobra sellers no modo basico (5% comissao acumulada).
 * Gatilhos de cobranca:
 *   - Saldo >= R$300 (cobranca imediata)
 *   - 30 dias desde ultima cobranca
 * Bloqueio: apos 2 ciclos nao pagos, seller é bloqueado.
 *
 * Integração PIX: cria cobrança via Asaas com externalReference "billing:{sellerUserId}:{balanceId}".
 * Quando o PIX é pago, o webhook Asaas zera o balance (via webhookController routing).
 */

const cron = require('node-cron');
const { logger } = require('../../logger');

const JOB_NAME = 'billingCollectionJob';
const BALANCE_THRESHOLD = 300.00;
const MAX_UNPAID_CYCLES = 2;
let _started = false;

async function _runOnce() {
  logger.info(`[${JOB_NAME}] Iniciando cobranca de modo basico`, {
    service: JOB_NAME, action: 'BILLING_COLLECTION_START',
  });

  try {
    const { getSupabaseClient } = require('../../config/supabase');
    const supabase = getSupabaseClient();
    const now = new Date();

    // Busca balances para cobrar: saldo >= 300 OU next_billing_at vencido
    const { data: balances } = await supabase
      .from('seller_billing_balance')
      .select('*')
      .eq('is_blocked', false)
      .gt('balance_brl', 0);

    if (!balances?.length) {
      logger.info(`[${JOB_NAME}] Nenhum saldo para cobrar`, {
        service: JOB_NAME, action: 'BILLING_COLLECTION_SKIP',
      });
      return { billed: 0, blocked: 0 };
    }

    let billed = 0;
    let blocked = 0;

    for (const balance of balances) {
      const balanceBrl = Number(balance.balance_brl);
      const shouldBill =
        balanceBrl >= BALANCE_THRESHOLD ||
        (balance.next_billing_at && new Date(balance.next_billing_at) <= now);

      if (!shouldBill) continue;

      // Verificar se já existe cobrança pendente para este ciclo (idempotência)
      if (balance.pending_payment_id) {
        logger.info(`[${JOB_NAME}] Cobrança já pendente, ignorando`, {
          service: JOB_NAME, sellerUserId: balance.seller_user_id,
          paymentId: balance.pending_payment_id,
        });
        continue;
      }

      // Criar cobrança PIX via Asaas
      let paymentId = null;
      try {
        paymentId = await _createBillingCharge(balance.seller_user_id, balanceBrl, balance.id);
      } catch (chargeErr) {
        logger.error(`[${JOB_NAME}] Falha ao criar cobrança PIX`, {
          service: JOB_NAME, sellerUserId: balance.seller_user_id,
          balance: balanceBrl, error: chargeErr.message,
        });
        // Continua com o fluxo legacy (incrementa unpaid_cycles)
      }

      const newUnpaidCycles = paymentId
        ? (balance.unpaid_cycles || 0) // Não incrementa se cobrança criada com sucesso
        : (balance.unpaid_cycles || 0) + 1;
      const shouldBlock = newUnpaidCycles >= MAX_UNPAID_CYCLES;

      const updateData = {
        last_billed_at: now.toISOString(),
        next_billing_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        is_blocked: shouldBlock,
      };

      if (paymentId) {
        updateData.pending_payment_id = paymentId;
      } else {
        updateData.unpaid_cycles = newUnpaidCycles;
      }

      const { error } = await supabase
        .from('seller_billing_balance')
        .update(updateData)
        .eq('id', balance.id);

      if (!error) {
        billed++;
        if (shouldBlock) {
          blocked++;
          logger.warn(`[${JOB_NAME}] Seller bloqueado por inadimplencia`, {
            service: JOB_NAME,
            sellerUserId: balance.seller_user_id,
            unpaidCycles: newUnpaidCycles,
            balance: balanceBrl,
          });

          // Dispatch billing_overdue notification
          try {
            const notificationDispatcher = require('../../services/NotificationDispatcher');
            notificationDispatcher.dispatch({
              userId: balance.seller_user_id,
              type: 'billing_overdue',
              importance: 'high',
              data: {
                userId: balance.seller_user_id,
                sellerId: balance.seller_id || null,
                balance: balanceBrl,
                unpaidCycles: newUnpaidCycles,
              },
              dedupKey: `billing_overdue_${balance.id}_${newUnpaidCycles}`,
              metadata: {},
            }).catch(() => {});
          } catch (_) { /* best-effort */ }
        }
      }

      logger.info(`[${JOB_NAME}] Cobranca gerada`, {
        service: JOB_NAME,
        sellerUserId: balance.seller_user_id,
        balance: balanceBrl,
        paymentId,
      });
    }

    logger.info(`[${JOB_NAME}] Cobranca concluida`, {
      service: JOB_NAME, action: 'BILLING_COLLECTION_DONE',
      billed, blocked,
    });

    return { billed, blocked };
  } catch (err) {
    logger.error(`[${JOB_NAME}] Erro na cobranca`, {
      service: JOB_NAME, action: 'BILLING_COLLECTION_ERROR', error: err.message,
    });
    throw err;
  }
}

/**
 * Cria cobrança PIX via Asaas para o seller.
 * externalReference = "billing:{sellerUserId}:{balanceId}"
 * @returns {string|null} paymentId do Asaas
 */
async function _createBillingCharge(sellerUserId, amountBrl, balanceId) {
  const asaasService = require('../../services/asaasService');
  const { getSupabaseClient } = require('../../config/supabase');
  const supabase = getSupabaseClient();

  // Buscar dados do seller para criar/buscar customer no Asaas
  const { data: user } = await supabase
    .from('users')
    .select('id, nome, email, cpf, telefone')
    .eq('id', sellerUserId)
    .maybeSingle();

  if (!user) {
    throw new Error(`Usuário ${sellerUserId} não encontrado`);
  }

  // Criar/buscar customer no Asaas (idempotente via externalReference)
  const customer = await asaasService.createCustomer({
    name: user.nome || 'Vendedor ElosCloud',
    email: user.email,
    cpfCnpj: user.cpf || undefined,
    phone: user.telefone || undefined,
    externalReference: sellerUserId,
  });

  // Criar cobrança PIX
  const externalReference = `billing:${sellerUserId}:${balanceId}`;
  const charge = await asaasService.createPixCharge({
    customer: customer.id,
    value: amountBrl,
    description: `Comissão ElosCloud — saldo acumulado de ${amountBrl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
    externalReference,
  });

  logger.info(`[${JOB_NAME}] Cobrança PIX criada`, {
    service: JOB_NAME,
    sellerUserId,
    paymentId: charge.id,
    amount: amountBrl,
    externalReference,
  });

  return charge.id;
}

function startBillingCollectionJob() {
  if (_started) return;
  _started = true;

  // Diario as 07:00 BRT
  cron.schedule('0 7 * * *', () => {
    _runOnce().catch(() => {});
  }, { timezone: 'America/Sao_Paulo' });

  logger.info(`[${JOB_NAME}] Job iniciado (cron: diario 07:00 BRT)`, {
    service: JOB_NAME, action: 'BILLING_COLLECTION_JOB_REGISTERED',
  });
}

function stopBillingCollectionJob() {
  _started = false;
}

module.exports = { startBillingCollectionJob, stopBillingCollectionJob, _runOnce };
