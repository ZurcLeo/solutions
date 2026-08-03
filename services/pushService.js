const webpush = require('web-push');
const { logger } = require('../logger');
const { getSupabaseClient } = require('../config/supabase');

const sb = () => getSupabaseClient();

const SERVICE = 'pushService';

// Configurar VAPID keys no boot
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT     || 'mailto:contato@eloscloud.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  logger.info(`${SERVICE}: VAPID keys configuradas`);
} else {
  logger.warn(`${SERVICE}: VAPID keys não configuradas — push desabilitado`);
}

/**
 * Salva ou atualiza uma subscription de push notification para o usuário.
 * Upsert: se o endpoint já existe para o usuário, reativa e atualiza.
 *
 * @param {string} userId
 * @param {Object} subscription - W3C PushSubscription object {endpoint, keys: {p256dh, auth}}
 * @param {Object} deviceInfo - {deviceName, deviceType}
 */
async function saveSubscription(userId, subscription, deviceInfo = {}) {
  const fn = 'saveSubscription';
  const supabase = sb();
  if (!supabase) {
    logger.warn(`${SERVICE}.${fn}: Supabase indisponível`);
    return { success: false, error: 'database_unavailable' };
  }

  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return { success: false, error: 'invalid_subscription' };
  }

  try {
    const { data, error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          user_id: userId,
          endpoint: subscription.endpoint,
          subscription: subscription,
          device_name: deviceInfo.deviceName || null,
          device_type: deviceInfo.deviceType || 'web',
          active: true,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,endpoint' }
      )
      .select('id')
      .single();

    if (error) throw error;

    logger.info(`${SERVICE}.${fn}: Subscription salva`, { userId, subscriptionId: data.id });
    return { success: true, subscriptionId: data.id };
  } catch (err) {
    logger.error(`${SERVICE}.${fn}: Falha ao salvar subscription`, { userId, error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Desativa uma subscription específica pelo endpoint (soft-delete).
 */
async function removeSubscription(userId, endpoint) {
  const fn = 'removeSubscription';
  const supabase = sb();
  if (!supabase) return { success: false, error: 'database_unavailable' };

  try {
    const { error } = await supabase
      .from('push_subscriptions')
      .update({ active: false })
      .eq('user_id', userId)
      .eq('endpoint', endpoint);

    if (error) throw error;

    logger.info(`${SERVICE}.${fn}: Subscription desativada`, { userId });
    return { success: true };
  } catch (err) {
    logger.error(`${SERVICE}.${fn}: Falha ao remover subscription`, { userId, error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Desativa todas as subscriptions de um usuário.
 */
async function removeAllSubscriptions(userId) {
  const fn = 'removeAllSubscriptions';
  const supabase = sb();
  if (!supabase) return { success: false, error: 'database_unavailable' };

  try {
    const { error } = await supabase
      .from('push_subscriptions')
      .update({ active: false })
      .eq('user_id', userId);

    if (error) throw error;

    logger.info(`${SERVICE}.${fn}: Todas subscriptions desativadas`, { userId });
    return { success: true };
  } catch (err) {
    logger.error(`${SERVICE}.${fn}: Falha`, { userId, error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Envia push notification para todos os dispositivos ativos de um usuário.
 *
 * LGPD: O payload.body NUNCA deve conter dados sensíveis (valores, nomes de terceiros).
 * Apenas alertas genéricos + deep link para ver detalhes no app.
 *
 * @param {string} userId
 * @param {Object} payload - { title, body, url, type, jobId }
 * @returns {Promise<{success: boolean, sent: number, failed: number}>}
 */
async function sendToUser(userId, payload) {
  const fn = 'sendToUser';
  const supabase = sb();

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    logger.warn(`${SERVICE}.${fn}: VAPID keys não configuradas, push ignorado`);
    return { success: true, sent: 0, failed: 0 };
  }

  if (!supabase) {
    logger.warn(`${SERVICE}.${fn}: Supabase indisponível`);
    return { success: false, sent: 0, failed: 0, error: 'database_unavailable' };
  }

  // Buscar subscriptions ativas do usuário
  const { data: subs, error: fetchErr } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, subscription')
    .eq('user_id', userId)
    .eq('active', true);

  if (fetchErr) {
    logger.error(`${SERVICE}.${fn}: Erro ao buscar subscriptions`, { userId, error: fetchErr.message });
    return { success: false, sent: 0, failed: 0, error: fetchErr.message };
  }

  if (!subs || subs.length === 0) {
    logger.debug(`${SERVICE}.${fn}: Nenhuma subscription ativa para usuário`, { userId });
    return { success: true, sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  const appUrl = process.env.APP_URL || 'https://eloscloud.com';

  const pushPayload = JSON.stringify({
    title: payload.title || 'ElosCloud',
    body: payload.body || 'Você tem uma nova notificação',
    url: payload.url || '/',
    type: payload.type || 'generic',
    jobId: payload.jobId || '',
    icon: `${appUrl}/logo192.png`,
    badge: `${appUrl}/favicon.ico`,
  });

  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub.subscription, pushPayload);
      sent++;

      // Atualizar last_used_at (fire-and-forget)
      supabase
        .from('push_subscriptions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', sub.id)
        .then(() => {})
        .catch(() => {});
    } catch (sendErr) {
      failed++;

      // 410 Gone ou 404 = subscription expirada/inválida → desativar
      if (sendErr.statusCode === 410 || sendErr.statusCode === 404) {
        logger.warn(`${SERVICE}.${fn}: Subscription expirada (${sendErr.statusCode}), desativando`, {
          endpoint: sub.endpoint.slice(0, 60) + '...',
        });
        _handleInvalidSubscription(sub.id).catch(() => {});
      } else {
        logger.warn(`${SERVICE}.${fn}: Falha ao enviar push`, {
          statusCode: sendErr.statusCode,
          error: sendErr.message,
        });
      }
    }
  }

  logger.info(`${SERVICE}.${fn}: Push enviado`, { userId, sent, failed, total: subs.length });
  return { success: sent > 0 || failed === 0, sent, failed };
}

/**
 * Desativa subscription inválida no banco.
 */
async function _handleInvalidSubscription(subscriptionId) {
  const supabase = sb();
  if (!supabase) return;

  await supabase
    .from('push_subscriptions')
    .update({ active: false })
    .eq('id', subscriptionId);
}

/**
 * Retorna a chave pública VAPID para o frontend.
 */
function getVapidPublicKey() {
  return VAPID_PUBLIC_KEY;
}

module.exports = {
  saveSubscription,
  removeSubscription,
  removeAllSubscriptions,
  sendToUser,
  getVapidPublicKey,
};
