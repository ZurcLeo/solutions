'use strict';

/**
 * @fileoverview Addon Service — Gerencia add-ons opcionais de sellers (IconChat billing module).
 *
 * Funções:
 *   - getSellerIconChatQuota: verifica acesso por plano ou add-on
 *   - activateAddon / deactivateAddon: toggle add-on para T1
 *   - processScheduledDeactivations: usado pelo cron diário
 *   - reconcileAddonForPlanChange: ajusta add-on em upgrade/downgrade
 *   - upsertUsageSnapshot / getUsageSnapshot: snapshots de uso via webhook
 */

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const SERVICE = 'AddonService';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

// ── Constantes ────────────────────────────────────────────────
const ADDON_ICONCHAT_SLUG = 'iconchat';
const ADDON_ICONCHAT_MONTHLY = 29.90;
const ADDON_ICONCHAT_ANNUAL = 299.00;
const ADDON_ICONCHAT_QUOTA = 300;
const ADDON_ICONCHAT_HARD_CAP_PCT = 150;
const FREE_TIER_ICONCHAT_QUOTA = 50;

// ── Quota ─────────────────────────────────────────────────────

/**
 * Determina se o seller tem acesso ao IconChat e qual a franquia.
 * Prioridade: plano incluso (T2/T3) → add-on ativo (T1) → sem acesso.
 *
 * @returns {{ hasAccess, source, quota, hardCapPct }}
 */
async function getSellerIconChatQuota(sellerUserId) {
  const subscriptionService = require('./subscriptionService');
  const subscription = await subscriptionService.getActiveSubscription(sellerUserId);

  if (subscription?.plan_slug) {
    const plan = await subscriptionService.getPlanBySlug(subscription.plan_slug);

    // T2/T3: incluso no plano
    if (plan?.iconchat_included) {
      return {
        hasAccess: true,
        source: 'plan',
        quota: plan.iconchat_message_quota,
        hardCapPct: Number(plan.iconchat_hard_cap_pct) || ADDON_ICONCHAT_HARD_CAP_PCT,
      };
    }
  }

  // Check add-on ativo
  const addon = await _getActiveAddon(sellerUserId);
  if (addon) {
    return {
      hasAccess: true,
      source: 'addon',
      quota: ADDON_ICONCHAT_QUOTA,
      hardCapPct: ADDON_ICONCHAT_HARD_CAP_PCT,
    };
  }

  // Free tier: sellers com Trust 2+ e WhatsApp podem usar IconChat com quota limitada
  return {
    hasAccess: true,
    source: 'free_tier',
    quota: FREE_TIER_ICONCHAT_QUOTA,
    hardCapPct: ADDON_ICONCHAT_HARD_CAP_PCT,
  };
}

// ── Ativação / Desativação ────────────────────────────────────

/**
 * Ativa o add-on IconChat para um seller T1.
 * Valida que o seller tem plano T1 (add-on não faz sentido para T0, T2/T3 já inclui).
 */
async function activateAddon(sellerUserId, sellerId, billingCycle = 'monthly') {
  const subscriptionService = require('./subscriptionService');
  const subscription = await subscriptionService.getActiveSubscription(sellerUserId);
  const plan = subscription?.plan_slug
    ? await subscriptionService.getPlanBySlug(subscription.plan_slug)
    : null;

  // Validação: só T1 pode ativar add-on (T2/T3 já inclui, T0 não tem plano pago)
  if (!plan || plan.tier !== 1) {
    throw new Error('Add-on IconChat disponível apenas para o plano Brasileirinho T1.');
  }

  // Check se já tem add-on ativo
  const existing = await _getActiveAddon(sellerUserId);
  if (existing) {
    throw new Error('Add-on IconChat já está ativo.');
  }

  // Reativar add-on inativo se existir
  const { data: inactive } = await sb()
    .from('seller_addons')
    .select('id, status')
    .eq('seller_user_id', sellerUserId)
    .eq('addon_slug', ADDON_ICONCHAT_SLUG)
    .eq('status', 'inactive')
    .maybeSingle();

  let addon;
  if (inactive) {
    const { data, error } = await sb()
      .from('seller_addons')
      .update({
        status: 'active',
        billing_cycle: billingCycle,
        activated_at: new Date().toISOString(),
        deactivates_at: null,
        deactivated_at: null,
      })
      .eq('id', inactive.id)
      .select()
      .single();

    if (error) throw new Error(`Erro ao reativar add-on: ${error.message}`);
    addon = data;
  } else {
    const price = billingCycle === 'annual' ? ADDON_ICONCHAT_ANNUAL : ADDON_ICONCHAT_MONTHLY;
    const { data, error } = await sb()
      .from('seller_addons')
      .insert({
        seller_user_id: sellerUserId,
        seller_id: sellerId,
        addon_slug: ADDON_ICONCHAT_SLUG,
        monthly_price_brl: ADDON_ICONCHAT_MONTHLY,
        annual_price_brl: ADDON_ICONCHAT_ANNUAL,
        billing_cycle: billingCycle,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') throw new Error('Add-on IconChat já está ativo.');
      throw new Error(`Erro ao ativar add-on: ${error.message}`);
    }
    addon = data;
  }

  // Atualizar valor da assinatura no Asaas
  await _updateAsaasSubscriptionValue(sellerUserId);

  // Provisionar IconChat se ainda não provisionado
  try {
    const iconChatProvisioningService = require('./iconChatProvisioningService');
    const status = await iconChatProvisioningService.getIconChatStatus(sellerUserId, sellerId);
    if (!status.provisioned) {
      logger.info(`[${SERVICE}] IconChat não provisionado — provisioning será feito separadamente`, { sellerUserId, sellerId });
    }
  } catch (err) {
    logger.warn(`[${SERVICE}] Check de provisioning falhou (não-bloqueante)`, { error: err.message });
  }

  // Emitir franchise.renew com reason=addon_activated
  await _emitFranchiseForAddon(sellerUserId, sellerId, 'addon_activated');

  logger.info(`[${SERVICE}] Add-on IconChat ativado`, { sellerUserId, sellerId, billingCycle });

  return addon;
}

/**
 * Desativa o add-on IconChat.
 * Status → pending_deactivation, IA segue ativa até fim do ciclo pago.
 */
async function deactivateAddon(sellerUserId) {
  const addon = await _getActiveAddon(sellerUserId);
  if (!addon) {
    throw new Error('Nenhum add-on IconChat ativo para desativar.');
  }

  // Determinar fim do ciclo para deactivates_at
  const subscriptionService = require('./subscriptionService');
  const subscription = await subscriptionService.getActiveSubscription(sellerUserId);
  const deactivatesAt = subscription?.current_period_end || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await sb()
    .from('seller_addons')
    .update({
      status: 'pending_deactivation',
      deactivates_at: deactivatesAt,
    })
    .eq('id', addon.id)
    .select()
    .single();

  if (error) throw new Error(`Erro ao desativar add-on: ${error.message}`);

  // Atualizar valor da assinatura no Asaas imediatamente
  // (próxima fatura não inclui add-on)
  await _updateAsaasSubscriptionValue(sellerUserId);

  logger.info(`[${SERVICE}] Add-on IconChat em pending_deactivation`, {
    sellerUserId, deactivatesAt,
  });

  return data;
}

/**
 * Lista add-ons ativos (ou pending_deactivation) do seller.
 */
async function getActiveAddons(sellerUserId) {
  const { data, error } = await sb()
    .from('seller_addons')
    .select('*')
    .eq('seller_user_id', sellerUserId)
    .in('status', ['active', 'pending_deactivation'])
    .order('created_at', { ascending: false });

  if (error) {
    logger.warn(`[${SERVICE}] Erro ao listar add-ons`, { sellerUserId, error: error.message });
    return [];
  }

  return data || [];
}

/**
 * Processa desativações agendadas (cron diário).
 * Chamado pelo addonDeactivationJob.
 */
async function processScheduledDeactivations() {
  const now = new Date().toISOString();

  const { data: pending, error } = await sb()
    .from('seller_addons')
    .select('id, seller_user_id, seller_id, addon_slug')
    .eq('status', 'pending_deactivation')
    .lte('deactivates_at', now);

  if (error) {
    logger.error(`[${SERVICE}] Erro ao buscar desativações agendadas`, { error: error.message });
    return { processed: 0 };
  }

  if (!pending || pending.length === 0) return { processed: 0 };

  let processed = 0;

  for (const addon of pending) {
    try {
      await sb()
        .from('seller_addons')
        .update({
          status: 'inactive',
          deactivated_at: now,
        })
        .eq('id', addon.id);

      // Dispatch notificação
      const NotificationDispatcher = require('./NotificationDispatcher');
      const { data: seller } = await sb()
        .from('seller_profiles')
        .select('user_id')
        .eq('id', addon.seller_id)
        .maybeSingle();

      if (seller?.user_id) {
        NotificationDispatcher.dispatch({
          userId: seller.user_id,
          type: 'iconchat_addon_deactivated',
          importance: 'low',
          data: { addonSlug: addon.addon_slug },
          metadata: { triggeredBy: 'system' },
        }).catch(err => logger.warn(`[${SERVICE}] Notificação falhou`, { error: err.message }));
      }

      processed++;
    } catch (err) {
      logger.error(`[${SERVICE}] Erro ao desativar add-on ${addon.id}`, { error: err.message });
    }
  }

  logger.info(`[${SERVICE}] Desativações processadas`, { processed, total: pending.length });
  return { processed };
}

// ── Reconciliação de plano ────────────────────────────────────

/**
 * Ajusta add-on quando o seller muda de plano.
 *
 * - T1+addon → T2: desativa addon (T2 inclui)
 * - T2 → T1: NÃO auto-ativa addon (seller precisa ativar manualmente)
 * - T2/T3 → T0: desativa addon + provisioning
 */
async function reconcileAddonForPlanChange(sellerUserId, sellerId, oldSlug, newSlug) {
  const subscriptionService = require('./subscriptionService');
  const oldPlan = await subscriptionService.getPlanBySlug(oldSlug);
  const newPlan = await subscriptionService.getPlanBySlug(newSlug);

  if (!oldPlan || !newPlan) return;

  const addon = await _getActiveAddon(sellerUserId);

  // Upgrade T1+addon → T2/T3 (inclui IconChat): desativa addon
  if (addon && newPlan.iconchat_included) {
    await sb()
      .from('seller_addons')
      .update({ status: 'inactive', deactivated_at: new Date().toISOString() })
      .eq('id', addon.id);

    logger.info(`[${SERVICE}] Add-on desativado por upgrade para plano que inclui IconChat`, {
      sellerUserId, oldSlug, newSlug,
    });

    // Emitir franchise.renew com reason=plan_change (atualiza quota, mantém contador)
    await _emitFranchiseForAddon(sellerUserId, sellerId, 'plan_change');

    // Notificação
    const NotificationDispatcher = require('./NotificationDispatcher');
    NotificationDispatcher.dispatch({
      userId: sellerUserId,
      type: 'iconchat_usage_warning',
      importance: 'low',
      data: {
        message: `IconChat agora incluso no seu plano ${newPlan.name}. Add-on desativado automaticamente.`,
      },
      metadata: { triggeredBy: 'system' },
    }).catch(() => {});
  }

  // Downgrade T2/T3 → T0 (cancelamento): desativa tudo
  if (newPlan.tier === 0 && oldPlan.tier >= 2) {
    if (addon) {
      await sb()
        .from('seller_addons')
        .update({ status: 'inactive', deactivated_at: new Date().toISOString() })
        .eq('id', addon.id);
    }
  }
}

// ── Usage Snapshots ───────────────────────────────────────────

/**
 * Upsert do snapshot de uso do IconChat.
 * Lógica de período: se period_start do payload > snapshot existente, reseta last_threshold_pct.
 */
async function upsertUsageSnapshot({ sellerUserId, sellerId, messagesUsed, messagesQuota, thresholdPct, periodStart, periodEnd }) {
  const supabase = sb();

  // Buscar snapshot existente
  const { data: existing } = await supabase
    .from('iconchat_usage_snapshots')
    .select('id, period_start, last_threshold_pct')
    .eq('seller_user_id', sellerUserId)
    .maybeSingle();

  // Determinar last_threshold_pct correto
  let newThresholdPct = thresholdPct;

  if (existing) {
    const existingPeriodStart = existing.period_start ? new Date(existing.period_start).getTime() : 0;
    const payloadPeriodStart = periodStart ? new Date(periodStart).getTime() : 0;

    if (payloadPeriodStart > existingPeriodStart) {
      // Período novo: reseta threshold
      newThresholdPct = thresholdPct;
    } else {
      // Mesmo período: só atualiza se threshold é maior
      newThresholdPct = Math.max(existing.last_threshold_pct || 0, thresholdPct);
    }

    // Upsert: update existente
    const { error } = await supabase
      .from('iconchat_usage_snapshots')
      .update({
        messages_used: messagesUsed,
        messages_quota: messagesQuota,
        last_threshold_pct: newThresholdPct,
        period_start: periodStart,
        period_end: periodEnd,
        source: 'webhook',
      })
      .eq('id', existing.id);

    if (error) {
      logger.error(`[${SERVICE}] Erro ao atualizar usage snapshot`, { sellerUserId, error: error.message });
    }
  } else {
    // Insert novo
    const { error } = await supabase
      .from('iconchat_usage_snapshots')
      .insert({
        seller_user_id: sellerUserId,
        seller_id: sellerId,
        messages_used: messagesUsed,
        messages_quota: messagesQuota,
        last_threshold_pct: newThresholdPct,
        period_start: periodStart,
        period_end: periodEnd,
        source: 'webhook',
      });

    if (error) {
      logger.error(`[${SERVICE}] Erro ao inserir usage snapshot`, { sellerUserId, error: error.message });
    }
  }
}

/**
 * Retorna o snapshot de uso atual do seller.
 */
async function getUsageSnapshot(sellerUserId) {
  const { data, error } = await sb()
    .from('iconchat_usage_snapshots')
    .select('*')
    .eq('seller_user_id', sellerUserId)
    .maybeSingle();

  if (error) {
    logger.warn(`[${SERVICE}] Erro ao buscar usage snapshot`, { sellerUserId, error: error.message });
    return null;
  }

  return data;
}

/**
 * Retorna o custo mensal dos add-ons ativos do seller.
 * Usado por subscriptionService.calcularMensalidade.
 */
async function getAddonsMonthlyCost(sellerUserId) {
  const addons = await getActiveAddons(sellerUserId);
  let total = 0;

  for (const addon of addons) {
    if (addon.status === 'active' || addon.status === 'pending_deactivation') {
      total += Number(addon.monthly_price_brl) || 0;
    }
  }

  return Math.round(total * 100) / 100;
}

// ── Helpers privados ──────────────────────────────────────────

async function _getActiveAddon(sellerUserId) {
  const { data } = await sb()
    .from('seller_addons')
    .select('*')
    .eq('seller_user_id', sellerUserId)
    .eq('addon_slug', ADDON_ICONCHAT_SLUG)
    .in('status', ['active', 'pending_deactivation'])
    .maybeSingle();

  return data || null;
}

/**
 * Atualiza o valor da assinatura no Asaas para refletir add-ons.
 */
async function _updateAsaasSubscriptionValue(sellerUserId) {
  try {
    const subscriptionService = require('./subscriptionService');
    const asaasService = require('./asaasService');

    const subscription = await subscriptionService.getActiveSubscription(sellerUserId);
    if (!subscription?.payment_id) return;

    // Recalcular com add-ons
    const { data: seller } = await sb()
      .from('seller_profiles')
      .select('id')
      .eq('user_id', sellerUserId)
      .maybeSingle();

    if (!seller) return;

    const mensalidade = await subscriptionService.calcularMensalidade(seller.id);
    if (!mensalidade) return;

    await asaasService.updateSubscriptionValue(
      subscription.payment_id,
      mensalidade.total,
      `Brasileirinho ${mensalidade.plan_name} + add-ons — ElosCloud`
    );

    logger.info(`[${SERVICE}] Asaas subscription value atualizado`, {
      sellerUserId, newValue: mensalidade.total, paymentId: subscription.payment_id,
    });
  } catch (err) {
    logger.error(`[${SERVICE}] Falha ao atualizar valor no Asaas`, {
      sellerUserId, error: err.message,
    });
  }
}

/**
 * Emitir franchise.renew para o IconChat com a quota e período corretos.
 */
async function _emitFranchiseForAddon(sellerUserId, sellerId, reason) {
  try {
    const webhookOutboundService = require('./webhookOutboundService');
    const subscriptionService = require('./subscriptionService');

    const quota = await getSellerIconChatQuota(sellerUserId);
    if (!quota.hasAccess) return;

    const subscription = await subscriptionService.getActiveSubscription(sellerUserId);

    await webhookOutboundService.dispatchForSeller(sellerId, 'franchise.renew', {
      sellerId,
      quota: quota.quota,
      hardCapPct: quota.hardCapPct,
      periodStart: subscription?.current_period_start || new Date().toISOString(),
      periodEnd: subscription?.current_period_end || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      reason,
    });

    logger.info(`[${SERVICE}] franchise.renew emitido`, { sellerId, reason, quota: quota.quota });
  } catch (err) {
    logger.warn(`[${SERVICE}] Falha ao emitir franchise.renew`, { sellerId, reason, error: err.message });
  }
}

module.exports = {
  getSellerIconChatQuota,
  activateAddon,
  deactivateAddon,
  getActiveAddons,
  processScheduledDeactivations,
  reconcileAddonForPlanChange,
  upsertUsageSnapshot,
  getUsageSnapshot,
  getAddonsMonthlyCost,
  // Constants (exported for tests)
  ADDON_ICONCHAT_MONTHLY,
  ADDON_ICONCHAT_ANNUAL,
  ADDON_ICONCHAT_QUOTA,
  FREE_TIER_ICONCHAT_QUOTA,
};
