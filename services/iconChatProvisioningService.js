'use strict';

const crypto = require('crypto');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');
const iconPinExchangeService = require('./iconPinExchangeService');

const TAG = 'iconChatProvisioningService';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

// ──────────────────────────────────────────────────────
// Pré-requisitos: removidos — qualquer seller ativo pode provisionar
// Plano Brasileirinho NÃO é obrigatório — sellers sem plano recebem free tier (50 msg)
// ──────────────────────────────────────────────────────

async function checkPrerequisites() {
  return { ok: true, checks: {} };
}

// ──────────────────────────────────────────────────────
// Status
// ──────────────────────────────────────────────────────

async function getIconChatStatus(userId, sellerId) {
  const { data, error } = await sb()
    .from('webhook_subscriptions')
    .select('id, seller_id, is_active, events_enabled, icon_tenant_id, admin_confirmed_at, franchise_pending, created_at')
    .eq('seller_id', sellerId)
    .eq('provider', 'icon_chat')
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error(`[${TAG}] getIconChatStatus error`, { error: error.message, sellerId });
    throw error;
  }

  if (data) {
    return {
      provisioned: true,
      is_active: data.is_active,
      admin_confirmed: !!data.admin_confirmed_at,
      franchise_pending: !!data.franchise_pending,
      created_at: data.created_at,
      events_enabled: data.events_enabled,
      subscription_id: data.id,
    };
  }

  // Não provisionado — retorna checks
  const prereqs = await checkPrerequisites(userId);
  return { provisioned: false, ...prereqs };
}

// ──────────────────────────────────────────────────────
// Provisionar — is_active=false até admin confirmar
// ──────────────────────────────────────────────────────

async function provisionIconChat(userId, sellerId) {
  const prereqs = await checkPrerequisites(userId);
  if (!prereqs.ok) {
    const err = new Error('PREREQUISITES_NOT_MET');
    err.checks = prereqs.checks;
    throw err;
  }

  const hmacSecret = crypto.randomBytes(32).toString('hex');
  const endpointUrl = process.env.ICON_WEBHOOK_URL || 'https://iconchat.com.br/api/webhook/eloscloud';
  const callbackUrl = process.env.ELOS_CALLBACK_URL || 'https://eloscloud-api.fly.dev/api/icon';
  const iconTenantId = sellerId; // seller_id = tenant identifier no IconChat

  const { data, error } = await sb()
    .from('webhook_subscriptions')
    .insert({
      seller_id: sellerId,
      endpoint_url: endpointUrl,
      provider: 'icon_chat',
      hmac_secret: hmacSecret,
      is_active: false, // Pendente até admin confirmar
      events_enabled: [
        'order.created', 'order.status_changed', 'order.cancelled',
        'delivery.assigned', 'delivery.status_changed',
        'catalog.updated', 'catalog.price_changed',
        'seller.status_changed', 'seller.hours_changed',
        'payment.request', 'payment.created', 'payment.confirmed', 'payment.refunded',
        'ml.question.received', 'ml.message.received', 'ml.order.created', 'ml.order.updated',
      ],
      icon_tenant_id: iconTenantId,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('ALREADY_PROVISIONED');
    }
    logger.error(`[${TAG}] provisionIconChat insert error`, { error: error.message, sellerId });
    throw error;
  }

  // Fire-and-forget: notifica admin
  _notifyAdmin({ action: 'provision', sellerId, subscriptionId: data.id, callbackUrl, iconTenantId })
    .catch(err => logger.error(`[${TAG}] _notifyAdmin failed`, { error: err.message }));

  // Resolve franchise info (quota + período) para enviar ao IconChat no provisionamento
  let franchise = null;
  let franchisePending = false;
  try {
    const addonService = require('./addonService');
    const subscriptionService = require('./subscriptionService');
    const quota = await addonService.getSellerIconChatQuota(userId);
    const sub = await subscriptionService.getActiveSubscription(userId);

    if (quota.hasAccess) {
      franchise = {
        quota: quota.quota,
        hardCapPct: quota.hardCapPct,
        periodStart: sub?.current_period_start || new Date().toISOString(),
        periodEnd: sub?.current_period_end || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      };
    }
  } catch (err) {
    // CRITICAL: Do NOT silently swallow — franchise failure means IconChat will operate
    // without billing enforcement. Mark as pending so adminConfirm retries.
    franchisePending = true;
    logger.error(`[${TAG}] FRANCHISE_SETUP_FAILED — seller provisionado SEM billing enforcement`, {
      error: err.message,
      userId,
      sellerId,
      subscriptionId: data.id,
      action: 'franchise will be retried on adminConfirm',
    });
  }

  // Persist franchise_pending flag so adminConfirm knows to retry
  if (franchisePending) {
    await sb()
      .from('webhook_subscriptions')
      .update({ franchise_pending: true, updated_at: new Date().toISOString() })
      .eq('id', data.id)
      .then(() => {})
      .catch(updateErr => {
        // Column may not exist yet if migration hasn't run — log but don't block
        logger.warn(`[${TAG}] Could not persist franchise_pending flag (migration pending?)`, {
          error: updateErr.message, subscriptionId: data.id,
        });
      });
  }

  // ICON-PIN: retorna PIN efemero em vez do secret raw
  const pinResult = await iconPinExchangeService.createPinExchange(
    sellerId,
    data.id,
    { hmacSecret, callbackUrl, iconTenantId, ...(franchise && { franchise }) }
  );

  return {
    subscriptionId: data.id,
    pin: pinResult.pin,
    maskedHmac: pinResult.maskedHmac,
    expiresAt: pinResult.expiresAt,
    callbackUrl,
    iconTenantId,
    franchise,
    franchisePending,
  };
}

// ──────────────────────────────────────────────────────
// Admin confirma configuração no IconChat
// ──────────────────────────────────────────────────────

async function adminConfirm(subscriptionId) {
  // Fetch full subscription to get seller context + franchise_pending flag
  const { data: sub, error: fetchErr } = await sb()
    .from('webhook_subscriptions')
    .select('id, seller_id, franchise_pending')
    .eq('id', subscriptionId)
    .eq('provider', 'icon_chat')
    .single();

  if (fetchErr || !sub) {
    if (fetchErr) logger.error(`[${TAG}] adminConfirm fetch error`, { error: fetchErr.message, subscriptionId });
    throw new Error('Subscription não encontrada.');
  }

  const { data, error } = await sb()
    .from('webhook_subscriptions')
    .update({
      is_active: true,
      admin_confirmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscriptionId)
    .eq('provider', 'icon_chat')
    .select('id, is_active, admin_confirmed_at')
    .single();

  if (error) {
    logger.error(`[${TAG}] adminConfirm error`, { error: error.message, subscriptionId });
    throw error;
  }

  if (!data) throw new Error('Subscription não encontrada.');

  // Always emit franchise.renew on admin confirm — this is the safety net for:
  // 1. Provisioning where franchise setup failed (franchise_pending = true)
  // 2. Normal provisioning where franchise data may have changed since provisioning
  // This ensures IconChat ALWAYS has billing enforcement before going active.
  const sellerId = sub.seller_id;
  let franchiseResult = null;
  try {
    franchiseResult = await _ensureFranchise(sellerId);
    // Clear franchise_pending flag if it was set
    if (sub.franchise_pending) {
      await sb()
        .from('webhook_subscriptions')
        .update({ franchise_pending: false, updated_at: new Date().toISOString() })
        .eq('id', subscriptionId);
      logger.info(`[${TAG}] franchise_pending resolved on adminConfirm`, { subscriptionId, sellerId });
    }
  } catch (franchiseErr) {
    // franchise.renew failed even on admin confirm — this is a CRITICAL state.
    // Seller is now active but without billing enforcement.
    // Log as critical error for ops monitoring — do NOT silently proceed.
    logger.error(`[${TAG}] CRITICAL: adminConfirm — franchise.renew FAILED. Seller active WITHOUT billing.`, {
      subscriptionId,
      sellerId,
      error: franchiseErr.message,
    });
    // Return with warning so admin is aware and can take manual action
    data.warning = 'FRANCHISE_NOT_CONFIGURED — seller ativo sem enforcement de billing. Ação manual necessária.';
  }

  logger.info(`[${TAG}] Admin confirmed IconChat`, { subscriptionId, franchiseEmitted: !!franchiseResult });
  return data;
}

// ──────────────────────────────────────────────────────
// Toggle ativo/inativo — só permite se admin já confirmou
// ──────────────────────────────────────────────────────

async function toggleIconChat(sellerId) {
  const { data: current, error: fetchErr } = await sb()
    .from('webhook_subscriptions')
    .select('id, is_active, admin_confirmed_at')
    .eq('seller_id', sellerId)
    .eq('provider', 'icon_chat')
    .single();

  if (fetchErr || !current) {
    throw new Error('Integração IconChat não encontrada para este seller.');
  }

  if (!current.admin_confirmed_at) {
    throw new Error('Integração aguardando configuração pelo administrador. Não é possível ativar antes da confirmação.');
  }

  const newActive = !current.is_active;

  const { data, error } = await sb()
    .from('webhook_subscriptions')
    .update({ is_active: newActive, updated_at: new Date().toISOString() })
    .eq('id', current.id)
    .select('id, is_active')
    .single();

  if (error) {
    logger.error(`[${TAG}] toggleIconChat error`, { error: error.message, sellerId });
    throw error;
  }

  return data;
}

// ──────────────────────────────────────────────────────
// Rotacionar Secret
// ──────────────────────────────────────────────────────

async function rotateSecret(userId, sellerId) {
  const prereqs = await checkPrerequisites(userId);
  if (!prereqs.ok) {
    const err = new Error('PREREQUISITES_NOT_MET');
    err.checks = prereqs.checks;
    throw err;
  }

  const { data: current, error: fetchErr } = await sb()
    .from('webhook_subscriptions')
    .select('id')
    .eq('seller_id', sellerId)
    .eq('provider', 'icon_chat')
    .single();

  if (fetchErr || !current) {
    throw new Error('Integração IconChat não encontrada para este seller.');
  }

  const newSecret = crypto.randomBytes(32).toString('hex');

  const { error } = await sb()
    .from('webhook_subscriptions')
    .update({ hmac_secret: newSecret, updated_at: new Date().toISOString() })
    .eq('id', current.id);

  if (error) {
    logger.error(`[${TAG}] rotateSecret error`, { error: error.message, sellerId });
    throw error;
  }

  // Fire-and-forget: notifica admin
  _notifyAdmin({ action: 'rotate_secret', sellerId, subscriptionId: current.id })
    .catch(err => logger.error(`[${TAG}] _notifyAdmin failed`, { error: err.message }));

  // ICON-PIN: retorna PIN efemero em vez do secret raw (D7)
  const callbackUrl = process.env.ELOS_CALLBACK_URL || 'https://eloscloud-api.fly.dev/api/icon';
  const pinResult = await iconPinExchangeService.createPinExchange(
    sellerId,
    current.id,
    { hmacSecret: newSecret, callbackUrl, iconTenantId: sellerId }
  );

  return {
    pin: pinResult.pin,
    maskedHmac: pinResult.maskedHmac,
    expiresAt: pinResult.expiresAt,
  };
}

// ──────────────────────────────────────────────────────
// Franchise enforcement helpers
// ──────────────────────────────────────────────────────

/**
 * Resolve franchise data for a seller and emit franchise.renew to IconChat.
 * Throws if franchise cannot be resolved or emitted — caller must handle.
 */
async function _ensureFranchise(sellerId) {
  const addonService = require('./addonService');
  const subscriptionService = require('./subscriptionService');
  const webhookOutboundService = require('./webhookOutboundService');

  // Get seller user_id from seller_profiles
  const { data: seller } = await sb()
    .from('seller_profiles')
    .select('user_id')
    .eq('id', sellerId)
    .single();

  if (!seller?.user_id) {
    throw new Error(`Seller profile não encontrado para seller_id=${sellerId}`);
  }

  const userId = seller.user_id;
  const quota = await addonService.getSellerIconChatQuota(userId);
  const sub = await subscriptionService.getActiveSubscription(userId);

  if (!quota.hasAccess) {
    throw new Error(`Seller ${sellerId} não tem acesso ao IconChat`);
  }

  const franchiseData = {
    sellerId,
    quota: quota.quota,
    hardCapPct: quota.hardCapPct,
    periodStart: sub?.current_period_start || new Date().toISOString(),
    periodEnd: sub?.current_period_end || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    reason: 'admin_confirm',
  };

  await webhookOutboundService.dispatchForSeller(sellerId, 'franchise.renew', franchiseData);

  logger.info(`[${TAG}] franchise.renew emitido via _ensureFranchise`, { sellerId, quota: quota.quota });
  return franchiseData;
}


/**
 * Manual retry for sellers provisioned without franchise enforcement.
 * Can be called from admin panel or reconciliation job.
 */
async function retryFranchiseSetup(sellerId) {
  const { data: sub } = await sb()
    .from('webhook_subscriptions')
    .select('id, seller_id, franchise_pending, is_active')
    .eq('seller_id', sellerId)
    .eq('provider', 'icon_chat')
    .single();

  if (!sub) {
    throw new Error(`Nenhuma subscription IconChat encontrada para seller ${sellerId}`);
  }

  const franchiseData = await _ensureFranchise(sellerId);

  // Clear pending flag
  if (sub.franchise_pending) {
    await sb()
      .from('webhook_subscriptions')
      .update({ franchise_pending: false, updated_at: new Date().toISOString() })
      .eq('id', sub.id);
  }

  logger.info(`[${TAG}] retryFranchiseSetup succeeded`, { sellerId, subscriptionId: sub.id });
  return { subscriptionId: sub.id, franchise: franchiseData };
}

// ──────────────────────────────────────────────────────
// Helper: notifica admin
// ──────────────────────────────────────────────────────

async function _notifyAdmin({ action, sellerId, subscriptionId, callbackUrl, iconTenantId }) {
  const emailService = require('./emailService');
  const adminEmail = process.env.ADMIN_ALERT_EMAIL || 'suporte@eloscloud.com';

  const subject = action === 'provision'
    ? `[IconChat] Nova integração pendente: seller ${sellerId}`
    : `[IconChat] Secret rotacionado: seller ${sellerId}`;

  const sqlHint = action === 'provision'
    ? `-- AÇÃO NECESSÁRIA: Configure no painel IconChat e confirme em /admin/webhooks\n-- Seller ID (tenant): ${iconTenantId}\n-- Callback URL: ${callbackUrl}\n-- Subscription ID: ${subscriptionId}`
    : `-- Secret rotacionado para subscription ${subscriptionId}\n-- Atualize o secret no painel IconChat para seller ${sellerId}`;

  await emailService.sendEmail({
    to: adminEmail,
    subject,
    templateType: 'generic',
    data: {
      title: subject,
      message: `Ação: ${action}\nSeller: ${sellerId}\nSubscription: ${subscriptionId}\n\n${sqlHint}`,
    },
  });
}

module.exports = {
  checkPrerequisites,
  getIconChatStatus,
  provisionIconChat,
  adminConfirm,
  toggleIconChat,
  rotateSecret,
  retryFranchiseSetup,
};
