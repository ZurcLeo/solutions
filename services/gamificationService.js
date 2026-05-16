/**
 * @fileoverview GamificationService — ElosCloud
 * Responsável por toda a lógica de gamificação:
 * XP, níveis, tarefas, selos, streaks e content boosts.
 * Usa Supabase (RPCs definidas em 20260514000002_gamification_schema.sql).
 */

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const SERVICE = 'gamificationService';

// ──────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

function log(fn, msg, extra = {}) {
  logger.info(msg, { service: SERVICE, function: fn, ...extra });
}

function logError(fn, err, extra = {}) {
  logger.error(`Erro em ${fn}: ${err.message}`, { service: SERVICE, function: fn, error: err.message, ...extra });
}

// ──────────────────────────────────────────────────────
// 1. Estado do usuário
// ──────────────────────────────────────────────────────

/**
 * Retorna o estado completo de gamificação do usuário
 * (nível, XP, streak, coins, selos, progresso de tarefas).
 */
async function getUserGamification(userId) {
  log('getUserGamification', 'Buscando estado de gamificação', { userId });

  try {
    // Garante que o registro existe
    await sb().rpc('init_user_gamification', { p_user_id: userId });

    // Estado principal via view
    const { data: state, error: stateErr } = await sb()
      .from('v_user_gamification')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (stateErr) throw stateErr;

    // Selos do usuário com dados do catálogo
    const { data: userSelos, error: selosErr } = await sb()
      .from('user_selos')
      .select(`
        id,
        granted_by,
        grant_reason,
        is_pinned,
        granted_at,
        selos (
          id, slug, name, description, category,
          tier, icon_url, color_hex, xp_bonus, coin_bonus
        )
      `)
      .eq('user_id', userId)
      .order('granted_at', { ascending: false });

    if (selosErr) throw selosErr;

    // Normaliza selos
    const selos = (userSelos || []).map(us => ({
      ...us.selos,
      user_selo_id: us.id,
      granted_by: us.granted_by,
      grant_reason: us.grant_reason,
      is_pinned: us.is_pinned,
      granted_at: us.granted_at,
      earned: true,
    }));

    // Tarefas: catálogo completo com progresso do usuário mesclado
    const { tasks } = await getAllTasksWithProgress(userId);

    return {
      success: true,
      gamification: state,
      selos,
      tasks,
    };
  } catch (err) {
    logError('getUserGamification', err, { userId });
    throw err;
  }
}

// ──────────────────────────────────────────────────────
// 2. Tarefas
// ──────────────────────────────────────────────────────

/**
 * Retorna todas as tarefas disponíveis + progresso do usuário.
 * Inicializa registros user_tasks para tarefas novas.
 */
async function getAllTasksWithProgress(userId) {
  log('getAllTasksWithProgress', 'Buscando tarefas', { userId });

  try {
    // Catálogo completo
    const { data: catalog, error: catErr } = await sb()
      .from('gamification_tasks')
      .select('*')
      .eq('is_active', true)
      .order('sort_order');

    if (catErr) throw catErr;

    // Progresso do usuário
    const { data: userProgress, error: progErr } = await sb()
      .from('user_tasks')
      .select('*')
      .eq('user_id', userId);

    if (progErr) throw progErr;

    const progressMap = Object.fromEntries(
      (userProgress || []).map(ut => [ut.task_id, ut])
    );

    // Mescla catálogo + progresso
    const tasks = catalog.map(task => {
      const prog = progressMap[task.id] || {};
      return {
        ...task,
        status: prog.status || 'available',
        progress: prog.progress || 0,
        completions: prog.completions || 0,
        last_completed_at: prog.last_completed_at || null,
        xp_granted_total: prog.xp_granted_total || 0,
      };
    });

    return { success: true, tasks };
  } catch (err) {
    logError('getAllTasksWithProgress', err, { userId });
    throw err;
  }
}

/**
 * Marca uma tarefa como completada via RPC (valida cooldown, max_completions, etc.).
 * Retorna XP ganho, se subiu de nível e novo nível.
 */
async function completeTask(userId, taskSlug) {
  log('completeTask', 'Completando tarefa', { userId, taskSlug });

  try {
    const { data, error } = await sb().rpc('complete_task', {
      p_user_id: userId,
      p_task_slug: taskSlug,
    });

    if (error) throw error;

    const result = data?.[0] || {};
    log('completeTask', 'Tarefa processada', { userId, taskSlug, result });

    return {
      success: result.success,
      message: result.message,
      xpGranted: result.xp_granted,
      coinsGranted: result.coins_granted,
      leveledUp: result.leveled_up,
      newLevel: result.new_level,
    };
  } catch (err) {
    logError('completeTask', err, { userId, taskSlug });
    throw err;
  }
}

/**
 * Incrementa o progresso de uma tarefa multi-etapa.
 */
async function incrementTaskProgress(userId, taskSlug, amount = 1) {
  log('incrementTaskProgress', 'Incrementando progresso', { userId, taskSlug, amount });

  try {
    // Busca task e progresso atual
    const { data: task, error: taskErr } = await sb()
      .from('gamification_tasks')
      .select('id, target_count, xp_reward, coin_reward, name')
      .eq('slug', taskSlug)
      .eq('is_active', true)
      .single();

    if (taskErr || !task) throw new Error(`Tarefa '${taskSlug}' não encontrada`);

    // Upsert no progresso
    const { data: existing } = await sb()
      .from('user_tasks')
      .select('id, progress, completions, status')
      .eq('user_id', userId)
      .eq('task_id', task.id)
      .single();

    const currentProgress = existing?.progress || 0;
    const newProgress = Math.min(currentProgress + amount, task.target_count);
    const isComplete = newProgress >= task.target_count;

    if (existing) {
      await sb().from('user_tasks').update({
        progress: newProgress,
        status: isComplete ? 'completed' : 'in_progress',
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id);
    } else {
      await sb().from('user_tasks').insert({
        user_id: userId,
        task_id: task.id,
        progress: newProgress,
        status: isComplete ? 'completed' : 'in_progress',
      });
    }

    // Se completou, dispara o RPC para conceder XP
    let xpResult = null;
    if (isComplete && (!existing || existing.status !== 'completed')) {
      xpResult = await completeTask(userId, taskSlug);
    }

    return {
      success: true,
      progress: newProgress,
      target: task.target_count,
      completed: isComplete,
      xpResult,
    };
  } catch (err) {
    logError('incrementTaskProgress', err, { userId, taskSlug });
    throw err;
  }
}

// ──────────────────────────────────────────────────────
// 3. Streak
// ──────────────────────────────────────────────────────

/**
 * Atualiza o streak diário do usuário via RPC.
 * Deve ser chamado no login/acesso diário.
 */
async function updateDailyStreak(userId) {
  log('updateDailyStreak', 'Atualizando streak', { userId });

  try {
    const { data, error } = await sb().rpc('update_daily_streak', {
      p_user_id: userId,
    });

    if (error) throw error;

    const result = data?.[0] || {};
    return {
      success: true,
      streakDays: result.streak_days,
      longestStreak: result.longest_streak,
      streakBroken: result.streak_broken,
      bonusXP: result.bonus_xp,
    };
  } catch (err) {
    logError('updateDailyStreak', err, { userId });
    throw err;
  }
}

// ──────────────────────────────────────────────────────
// 4. Selos
// ──────────────────────────────────────────────────────

/**
 * Concede um selo ao usuário (por slug).
 * Pode ser chamado internamente ou via admin.
 */
async function grantSelo(userId, seloSlug, grantedBy = 'system', reason = null) {
  log('grantSelo', 'Concedendo selo', { userId, seloSlug, grantedBy });

  try {
    const { data, error } = await sb().rpc('grant_selo', {
      p_user_id: userId,
      p_selo_slug: seloSlug,
      p_granted_by: grantedBy,
      p_reason: reason,
    });

    if (error) throw error;

    const result = data?.[0] || {};
    return {
      success: result.success,
      message: result.message,
      xpBonus: result.xp_bonus,
      coinBonus: result.coin_bonus,
    };
  } catch (err) {
    logError('grantSelo', err, { userId, seloSlug });
    throw err;
  }
}

/**
 * Altera o pin de um selo no perfil do usuário.
 */
async function toggleSeloPin(userId, userSeloId, isPinned) {
  log('toggleSeloPin', 'Alterando pin de selo', { userId, userSeloId, isPinned });

  try {
    const { error } = await sb()
      .from('user_selos')
      .update({ is_pinned: isPinned })
      .eq('id', userSeloId)
      .eq('user_id', userId); // segurança: só o próprio usuário

    if (error) throw error;

    return { success: true };
  } catch (err) {
    logError('toggleSeloPin', err, { userId, userSeloId });
    throw err;
  }
}

// ──────────────────────────────────────────────────────
// 5. Content Boosts
// ──────────────────────────────────────────────────────

/**
 * Cria um boost de conteúdo para um usuário/post.
 * Chamado pelo algoritmo de engajamento (ai-agent).
 */
async function grantContentBoost(userId, postId, boostType, options = {}) {
  log('grantContentBoost', 'Concedendo content boost', { userId, postId, boostType });

  try {
    const { data, error } = await sb()
      .from('content_boosts')
      .insert({
        user_id: userId,
        post_id: postId || null,
        boost_type: boostType,
        boost_factor: options.boostFactor || 1.5,
        reason: options.reason || null,
        granted_by: options.grantedBy || 'system',
        expires_at: options.expiresAt || null,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;

    // Concede o selo de plataforma correspondente ao tipo de boost
    const seloMap = {
      featured: 'trending_content',
      trending: 'trending_content',
      community_pick: 'community_voice',
      platform_highlight: 'platform_champion',
    };
    const seloSlug = seloMap[boostType];
    if (seloSlug) {
      await grantSelo(userId, seloSlug, 'platform', options.reason).catch(() => {
        // Selo já existe — não é erro
      });
    }

    return { success: true, boost: data };
  } catch (err) {
    logError('grantContentBoost', err, { userId, postId, boostType });
    throw err;
  }
}

/**
 * Retorna boosts ativos de um usuário ou post.
 */
async function getActiveBoosts(userId, postId = null) {
  try {
    let query = sb()
      .from('content_boosts')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

    if (postId) query = query.eq('post_id', postId);

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;

    return { success: true, boosts: data || [] };
  } catch (err) {
    logError('getActiveBoosts', err, { userId, postId });
    throw err;
  }
}

// ──────────────────────────────────────────────────────
// 6. Leaderboard & Catálogos
// ──────────────────────────────────────────────────────

async function getLeaderboard(limit = 20) {
  try {
    const { data, error } = await sb()
      .from('v_leaderboard')
      .select('*')
      .limit(limit);

    if (error) throw error;
    return { success: true, leaderboard: data || [] };
  } catch (err) {
    logError('getLeaderboard', err);
    throw err;
  }
}

async function getLevels() {
  try {
    const { data, error } = await sb()
      .from('gamification_levels')
      .select('*')
      .order('level_num');

    if (error) throw error;
    return { success: true, levels: data || [] };
  } catch (err) {
    logError('getLevels', err);
    throw err;
  }
}

async function getAllSelos() {
  try {
    const { data, error } = await sb()
      .from('selos')
      .select('*')
      .eq('is_active', true)
      .order('sort_order');

    if (error) throw error;
    return { success: true, selos: data || [] };
  } catch (err) {
    logError('getAllSelos', err);
    throw err;
  }
}

// ──────────────────────────────────────────────────────
// 7. Trigger automático por evento de domínio
//    Chamado por outros serviços ao detectar ações
// ──────────────────────────────────────────────────────

/**
 * Gateway para disparar tarefas automaticamente baseado em eventos.
 * Ex: quando um pagamento é confirmado → chama triggerEvent('payment_confirmed', userId)
 */
async function triggerEvent(event, userId, metadata = {}) {
  log('triggerEvent', `Evento: ${event}`, { userId, metadata });

  const eventMap = {
    'user_created':            ['first_login'],
    'profile_completed':       ['complete_profile'],
    'avatar_uploaded':         ['upload_avatar'],
    'email_verified':          ['verify_email'],
    'first_post_created':      ['first_post', 'post_10_times'],
    'invite_sent':             ['first_invite'],
    'invite_accepted':         ['first_invite', 'invite_5_friends'],
    'caixinha_created':        ['create_first_caixinha'],
    'caixinha_joined':         ['join_caixinha'],
    'contribution_paid':       ['first_contribution'],
    'connection_made':         ['first_connection', 'make_5_connections'],
    'comment_posted':          ['comment_10_posts'],
    'reaction_received':       ['receive_10_reactions'],
    'dispute_voted':           ['vote_dispute'],
    'dispute_resolved':        ['resolve_dispute'],
    'daily_access':            ['daily_login'],
  };

  const slugs = eventMap[event] || [];
  const results = [];

  for (const slug of slugs) {
    try {
      // Usamos incrementTaskProgress para suportar tanto tarefas de passo único
      // quanto tarefas progressivas (ex: make_5_connections).
      const result = await incrementTaskProgress(userId, slug, metadata.amount || 1);
      
      if (result.success) {
        results.push({
          slug,
          success: true,
          completed: result.completed,
          progress: result.progress,
          target: result.target,
          ...(result.xpResult || {})
        });
      }
    } catch (err) {
      // Ignora falhas individuais (ex: tarefa já completa ou cooldown)
      log('triggerEvent', `Aviso: slug '${slug}' não processado: ${err.message}`, { userId });
    }
  }

  // Streak na cada acesso diário
  if (event === 'daily_access') {
    const streakResult = await updateDailyStreak(userId).catch(() => null);
    if (streakResult) results.push({ type: 'streak', ...streakResult });
  }

  return results;
}

module.exports = {
  getUserGamification,
  getAllTasksWithProgress,
  completeTask,
  incrementTaskProgress,
  updateDailyStreak,
  grantSelo,
  toggleSeloPin,
  grantContentBoost,
  getActiveBoosts,
  getLeaderboard,
  getLevels,
  getAllSelos,
  triggerEvent,
};
