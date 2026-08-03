/**
 * @fileoverview Serviço de suspensão de usuários e sellers da ElosCloud.
 *
 * Suspensão é diferente de moderação de visibilidade:
 *   - Moderação (visibility_multiplier): reduz alcance do conteúdo
 *   - Suspensão: bloqueia o acesso à plataforma completamente
 *
 * Suspensões podem ser temporárias (com duration_days) ou permanentes.
 * Auto-expiração é verificada pelo middleware requireActiveUser.
 *
 * @module services/suspensionService
 */

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const VALID_CATEGORIES = [
  'fake_news', 'hate_speech', 'spam', 'fraud',
  'harassment', 'terms_violation', 'other',
];

/**
 * Suspende um usuário.
 * @param {string} userId - ID do usuário a suspender
 * @param {Object} params
 * @param {string} params.reason - Motivo (min 5 chars)
 * @param {string} params.category - Categoria da infração
 * @param {number|null} params.durationDays - Duração em dias (null = permanente)
 * @param {string} adminId - ID do admin que aplica a suspensão
 * @returns {Object} Suspensão criada
 */
async function suspendUser(userId, { reason, category = 'other', durationDays = null }, adminId) {
  if (!userId) throw new Error('userId é obrigatório');
  if (!reason || reason.length < 5) throw new Error('Motivo deve ter no mínimo 5 caracteres');
  if (!VALID_CATEGORIES.includes(category)) {
    throw new Error(`Categoria inválida. Válidas: ${VALID_CATEGORIES.join(', ')}`);
  }
  if (userId === adminId) throw new Error('Admin não pode suspender a si mesmo');

  const supabase = getSupabaseClient();

  // Verificar se já existe suspensão ativa
  const { data: existing } = await supabase
    .from('user_suspensions')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();

  if (existing) {
    throw new Error('Usuário já possui uma suspensão ativa');
  }

  const expiresAt = durationDays
    ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const { data, error } = await supabase
    .from('user_suspensions')
    .insert({
      user_id: userId,
      reason,
      category,
      suspended_by: adminId,
      duration_days: durationDays,
      expires_at: expiresAt,
      status: 'active',
    })
    .select()
    .single();

  if (error) {
    logger.error('[suspensionService] suspendUser error:', error);
    throw new Error('Erro ao criar suspensão');
  }

  // Atualizar flag no users (redundância — trigger faz isso, mas garante)
  await supabase
    .from('users')
    .update({ is_suspended: true })
    .eq('id', userId);

  logger.info(`[suspensionService] User ${userId} suspended by ${adminId}. Category: ${category}. Duration: ${durationDays || 'permanent'} days`);

  // Dispatch notification for webhook integration
  try {
    const notificationDispatcher = require('./NotificationDispatcher');
    notificationDispatcher.dispatch({
      userId,
      type: 'suspension_created',
      importance: 'high',
      data: { userId, reason, category, sellerId: null, userName: null },
      dedupKey: `suspension_${data.id}`,
      metadata: { triggeredBy: adminId },
    }).catch(() => {});
  } catch (_) { /* best-effort */ }

  return data;
}

/**
 * Levanta (remove) uma suspensão.
 * @param {string} suspensionId - ID da suspensão
 * @param {string} adminId - ID do admin que levanta
 * @param {string} liftReason - Motivo da remoção
 */
async function liftSuspension(suspensionId, adminId, liftReason) {
  if (!suspensionId) throw new Error('suspensionId é obrigatório');
  if (!liftReason || liftReason.length < 5) throw new Error('Motivo da remoção deve ter no mínimo 5 caracteres');

  const supabase = getSupabaseClient();

  const { data: suspension, error: fetchErr } = await supabase
    .from('user_suspensions')
    .select('id, user_id, status')
    .eq('id', suspensionId)
    .single();

  if (fetchErr || !suspension) throw new Error('Suspensão não encontrada');
  if (suspension.status !== 'active') throw new Error('Suspensão já foi encerrada');

  const { error } = await supabase
    .from('user_suspensions')
    .update({
      status: 'lifted',
      lifted_at: new Date().toISOString(),
      lifted_by: adminId,
      lift_reason: liftReason,
    })
    .eq('id', suspensionId);

  if (error) {
    logger.error('[suspensionService] liftSuspension error:', error);
    throw new Error('Erro ao levantar suspensão');
  }

  // Atualizar flag no users
  await supabase
    .from('users')
    .update({ is_suspended: false })
    .eq('id', suspension.user_id);

  logger.info(`[suspensionService] Suspension ${suspensionId} lifted by ${adminId}`);

  return { success: true, userId: suspension.user_id };
}

/**
 * Verifica se um usuário está suspenso. Também expira suspensões vencidas.
 * @param {string} userId
 * @returns {{ suspended: boolean, suspension: Object|null }}
 */
async function checkSuspension(userId) {
  if (!userId) return { suspended: false, suspension: null };

  const supabase = getSupabaseClient();

  // Buscar suspensão ativa
  const { data, error } = await supabase
    .from('user_suspensions')
    .select('id, reason, category, duration_days, expires_at, created_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return { suspended: false, suspension: null };

  // Auto-expirar se vencida
  if (data.expires_at && new Date(data.expires_at) <= new Date()) {
    await supabase
      .from('user_suspensions')
      .update({ status: 'expired' })
      .eq('id', data.id);

    await supabase
      .from('users')
      .update({ is_suspended: false })
      .eq('id', userId);

    return { suspended: false, suspension: null };
  }

  return { suspended: true, suspension: data };
}

/**
 * Lista suspensões ativas na plataforma (paginada).
 * @param {Object} opts
 * @param {number} opts.page
 * @param {number} opts.limit
 * @param {string} opts.status - 'active' | 'lifted' | 'expired' | 'all'
 */
async function listSuspensions({ page = 1, limit = 20, status = 'active' } = {}) {
  const supabase = getSupabaseClient();
  const from = (page - 1) * limit;

  let query = supabase
    .from('user_suspensions')
    .select(`
      id, user_id, reason, category, suspended_by, status,
      duration_days, expires_at, lifted_at, lifted_by, lift_reason,
      created_at
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  if (status !== 'all') {
    query = query.eq('status', status);
  }

  const { data, count, error } = await query;

  if (error) {
    logger.error('[suspensionService] listSuspensions error:', error);
    throw new Error('Erro ao listar suspensões');
  }

  return {
    data: data || [],
    total: count || 0,
    page,
    totalPages: Math.ceil((count || 0) / limit),
  };
}

/**
 * Histórico de suspensões de um usuário.
 * @param {string} userId
 */
async function getUserSuspensionHistory(userId) {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('user_suspensions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('[suspensionService] getUserSuspensionHistory error:', error);
    throw new Error('Erro ao buscar histórico');
  }

  return data || [];
}

/**
 * Suspende um seller (altera status para 'suspended').
 * @param {string} sellerId
 * @param {string} reason
 * @param {string} adminId
 */
async function suspendSeller(sellerId, reason, adminId) {
  if (!sellerId) throw new Error('sellerId é obrigatório');
  if (!reason || reason.length < 5) throw new Error('Motivo deve ter no mínimo 5 caracteres');

  const supabase = getSupabaseClient();

  // Buscar status atual
  const { data: seller, error: fetchErr } = await supabase
    .from('seller_profiles')
    .select('id, status, user_id')
    .eq('id', sellerId)
    .single();

  if (fetchErr || !seller) throw new Error('Seller não encontrado');
  if (seller.status === 'suspended') throw new Error('Seller já está suspenso');

  // Atualizar status
  const { error } = await supabase
    .from('seller_profiles')
    .update({ status: 'suspended' })
    .eq('id', sellerId);

  if (error) {
    logger.error('[suspensionService] suspendSeller error:', error);
    throw new Error('Erro ao suspender seller');
  }

  // Registrar no log
  await supabase.from('seller_suspension_log').insert({
    seller_id: sellerId,
    action: 'suspended',
    reason,
    performed_by: adminId,
    previous_status: seller.status,
  });

  logger.info(`[suspensionService] Seller ${sellerId} suspended by ${adminId}`);

  return { success: true, sellerId, previousStatus: seller.status };
}

/**
 * Reativa um seller suspenso.
 * @param {string} sellerId
 * @param {string} reason
 * @param {string} adminId
 */
async function reactivateSeller(sellerId, reason, adminId) {
  if (!sellerId) throw new Error('sellerId é obrigatório');
  if (!reason || reason.length < 5) throw new Error('Motivo deve ter no mínimo 5 caracteres');

  const supabase = getSupabaseClient();

  const { data: seller, error: fetchErr } = await supabase
    .from('seller_profiles')
    .select('id, status')
    .eq('id', sellerId)
    .single();

  if (fetchErr || !seller) throw new Error('Seller não encontrado');
  if (seller.status !== 'suspended') throw new Error('Seller não está suspenso');

  const { error } = await supabase
    .from('seller_profiles')
    .update({ status: 'active' })
    .eq('id', sellerId);

  if (error) {
    logger.error('[suspensionService] reactivateSeller error:', error);
    throw new Error('Erro ao reativar seller');
  }

  await supabase.from('seller_suspension_log').insert({
    seller_id: sellerId,
    action: 'reactivated',
    reason,
    performed_by: adminId,
    previous_status: 'suspended',
  });

  logger.info(`[suspensionService] Seller ${sellerId} reactivated by ${adminId}`);

  return { success: true, sellerId };
}

/**
 * Lista sellers suspensos.
 */
async function listSuspendedSellers() {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('seller_profiles')
    .select('id, user_id, business_name, status')
    .eq('status', 'suspended');

  if (error) {
    logger.error('[suspensionService] listSuspendedSellers error:', error);
    return [];
  }

  return data || [];
}

module.exports = {
  suspendUser,
  liftSuspension,
  checkSuspension,
  listSuspensions,
  getUserSuspensionHistory,
  suspendSeller,
  reactivateSeller,
  listSuspendedSellers,
};
