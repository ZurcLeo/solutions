/**
 * @fileoverview GamificationService — ElosCloud
 * Responsável por toda a lógica de gamificação:
 * XP, níveis, tarefas, selos, streaks e content boosts.
 * Usa Supabase (RPCs definidas em 20260514000002_gamification_schema.sql).
 */

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');
const { GAMIFICATION_EVENTS } = require('../config/socket/socketEvents');
const NotificationDispatcher = require('./NotificationDispatcher');

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

// Emite evento de gamificação via Socket.IO para o usuário (fire-and-forget)
function emitGamification(userId, event, data) {
  try {
    const socketManager = require('../config/socket/socketManager');
    socketManager.emitToUser(userId, event, data);
  } catch (_) {
    // Socket não bloqueia fluxo principal
  }
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
        celebrated,
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
      celebrated: us.celebrated ?? true,
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

    const taskToSeloMap = {
      'complete_profile':   'profile_complete',
      'first_login':        'welcome',
      'first_connection':   'first_elo',
      'create_first_caixinha': 'caixinha_founder',
      'streak_7days':       'week_warrior',
      'streak_30days':      'month_champion',
      'streak_100days':     'centenarian',
      'invite_5_friends':   'invite_squad',
      'make_5_connections': 'connector_5',
      'pay_on_time_3months': 'faithful_payer_3m',
      'pay_on_time_6months': 'faithful_payer_6m',
      'resolve_dispute':     'community_mediator',
      'verify_google_business': 'negocio_verificado_google',
    };

    if (result.success) {
      // 1. Socket emission (tempo real / UI)
      emitGamification(userId, GAMIFICATION_EVENTS.TASK_COMPLETED, {
        taskSlug,
        xpGranted: result.xp_granted,
        coinsGranted: result.coins_granted,
        message: result.message,
      });

      // 1b. Auto-grant selos vinculados a tarefas (Conquistas)
      const seloSlugToGrant = taskToSeloMap[taskSlug];
      if (seloSlugToGrant) {
        grantSelo(userId, seloSlugToGrant, 'system', `Missão concluída: ${taskSlug}`)
          .catch(err => logger.warn('Falha ao conceder selo automático por tarefa', { userId, taskSlug, seloSlugToGrant, error: err.message }));
      }

      // 2. Formal notification via Dispatcher (persistente)
      // Busca nome da tarefa para a notificação
      sb().from('gamification_tasks').select('name').eq('slug', taskSlug).single().then(({ data: task }) => {
        NotificationDispatcher.dispatch({
          userId,
          type: 'mission_completed',
          importance: 'low',
          data: {
            taskName: task?.name || taskSlug,
            xpGranted: result.xp_granted
          },
          metadata: { triggeredBy: 'system' }
        }).catch(() => {});
      }).catch(() => {});

      if (result.xp_granted > 0) {
        emitGamification(userId, GAMIFICATION_EVENTS.XP_GAINED, {
          xp: result.xp_granted,
          source: taskSlug,
        });
      }
      if (result.coins_granted > 0) {
        emitGamification(userId, GAMIFICATION_EVENTS.COINS_GAINED, { coins: result.coins_granted });
      }
      if (result.leveled_up) {
        emitGamification(userId, GAMIFICATION_EVENTS.LEVEL_UP, {
          newLevel: result.new_level,
        });

        // Notificação formal de Level Up
        sb().from('gamification_levels').select('name').eq('level_num', result.new_level).single().then(({ data: level }) => {
          NotificationDispatcher.dispatch({
            userId,
            type: 'level_up',
            importance: 'high',
            data: {
              newLevel: result.new_level,
              levelName: level?.name || 'Novo Nível'
            },
            metadata: { triggeredBy: 'system' }
          }).catch(() => {});
        }).catch(() => {});
      }
    } else if (result.message === 'Tarefa já concluída') {
      // Auto-healing (retroativo): tenta conceder o selo se a tarefa já estiver concluída
      // Útil para usuários que completaram missões antes da criação da regra de selo automático.
      const seloSlugToGrant = taskToSeloMap[taskSlug];
      if (seloSlugToGrant) {
        grantSelo(userId, seloSlugToGrant, 'system', `Missão previamente concluída: ${taskSlug}`)
          .catch(() => {}); // O grantSelo RPC é idempotente e falha silenciosamente se o selo já existir
      }
    }

    // Avalia selos de engajamento após cada task (fire-and-forget)
    checkEngagementSelos(userId).catch(() => {});

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
 * @param {string}      userId
 * @param {string}      taskSlug
 * @param {number}      amount   — quantas unidades incrementar (default 1)
 * @param {string|null} dedupKey — chave única para evitar dupla contagem (ex: "post:uuid").
 *                                 Se já constar em credited_ids, o incremento é ignorado.
 */
async function incrementTaskProgress(userId, taskSlug, amount = 1, dedupKey = null) {
  log('incrementTaskProgress', 'Incrementando progresso', { userId, taskSlug, amount, dedupKey });

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
      .select('id, progress, completions, status, credited_ids')
      .eq('user_id', userId)
      .eq('task_id', task.id)
      .single();

    // Dedup: ignora se a chave já foi creditada
    if (dedupKey && amount > 0) {
      const creditedIds = existing?.credited_ids || [];
      if (creditedIds.includes(dedupKey)) {
        log('incrementTaskProgress', 'Dedup: progresso já creditado', { userId, taskSlug, dedupKey });
        return {
          success: true,
          progress: existing?.progress || 0,
          target: task.target_count,
          completed: existing?.status === 'completed',
          dedupSkipped: true,
        };
      }
    }

    const currentProgress = existing?.progress || 0;
    const newProgress = Math.min(currentProgress + amount, task.target_count);
    const isComplete = newProgress >= task.target_count;

    // Payload base de update/insert (inclui credited_ids se houver dedupKey)
    const newCreditedIds = dedupKey
      ? [...(existing?.credited_ids || []), dedupKey]
      : undefined;

    if (existing) {
      await sb().from('user_tasks').update({
        progress: newProgress,
        status: isComplete ? 'completed' : 'in_progress',
        updated_at: new Date().toISOString(),
        ...(newCreditedIds !== undefined ? { credited_ids: newCreditedIds } : {}),
      }).eq('id', existing.id);
    } else {
      await sb().from('user_tasks').insert({
        user_id: userId,
        task_id: task.id,
        progress: newProgress,
        status: isComplete ? 'completed' : 'in_progress',
        credited_ids: newCreditedIds ?? [],
      });
    }

    // Emite progresso parcial (tarefas multi-etapa, antes de completar)
    if (!isComplete && task.target_count > 1) {
      emitGamification(userId, GAMIFICATION_EVENTS.TASK_PROGRESS, {
        taskSlug,
        taskName: task.name,
        progress: newProgress,
        target: task.target_count,
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

    emitGamification(userId, GAMIFICATION_EVENTS.STREAK_UPDATED, {
      streakDays: result.streak_days,
      longestStreak: result.longest_streak,
      streakBroken: result.streak_broken,
      bonusXP: result.bonus_xp,
    });

    // Completa tarefas de marco de streak quando o usuário atinge 7, 30 ou 100 dias
    const streakMilestones = { 7: 'streak_7days', 30: 'streak_30days', 100: 'streak_100days' };
    const milestoneSlug = streakMilestones[result.streak_days];
    if (milestoneSlug) {
      completeTask(userId, milestoneSlug).catch(err =>
        logger.warn('Falha ao completar tarefa de streak', { userId, milestoneSlug, error: err.message })
      );
    }

    // Avalia selos de engajamento após atualização de streak (fire-and-forget)
    checkEngagementSelos(userId).catch(() => {});

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

/**
 * Concede dias de streak freeze ao usuário.
 * Chamado automaticamente após contribuição paga.
 * 1 contribuição = 1 dia de proteção acumulável.
 */
async function grantStreakFreeze(userId, days = 1) {
  log('grantStreakFreeze', 'Concedendo streak freeze', { userId, days });
  try {
    const { data, error } = await sb().rpc('grant_streak_freeze', {
      p_user_id: userId,
      p_days:    days,
    });
    if (error) throw error;
    return { success: true, freezeDays: data };
  } catch (err) {
    logError('grantStreakFreeze', err, { userId });
    throw err;
  }
}

// ──────────────────────────────────────────────────────
// 3b. Selos de engajamento (apoiador/acelerador)
//     Avaliados após completeTask e updateDailyStreak
// ──────────────────────────────────────────────────────

/**
 * Verifica se o usuário atingiu critérios de engajamento para selos:
 * - apoiador_comunidade: 30+ dias de streak OU 50+ tasks completadas
 * - acelerador_impacto:  nível 7+ OU 100+ tasks OU 200+ dias de streak
 * Fire-and-forget: não bloqueia o fluxo principal.
 */
async function checkEngagementSelos(userId) {
  try {
    const { data: profile } = await sb()
      .from('user_gamification')
      .select('streak_days, longest_streak, tasks_completed, current_level')
      .eq('user_id', userId)
      .maybeSingle();

    if (!profile) return;

    const streakDays     = Math.max(profile.streak_days || 0, profile.longest_streak || 0);
    const tasksCompleted = profile.tasks_completed || 0;
    const currentLevel   = profile.current_level || 1;

    // apoiador_comunidade: 30+ dias streak OU 50+ tasks
    if (streakDays >= 30 || tasksCompleted >= 50) {
      grantSelo(userId, 'apoiador_comunidade', 'system', 'Engajamento comunitário consistente').catch(() => {});
    }

    // acelerador_impacto: nível 7+ OU 100+ tasks OU 200+ dias streak
    if (currentLevel >= 7 || tasksCompleted >= 100 || streakDays >= 200) {
      grantSelo(userId, 'acelerador_impacto', 'system', 'Engajamento de elite na comunidade').catch(() => {});
    }
  } catch (err) {
    logger.warn('checkEngagementSelos: falha não-bloqueante', { userId, error: err.message });
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

    if (result.success) {
      emitGamification(userId, GAMIFICATION_EVENTS.SELO_GRANTED, {
        seloSlug,
        xpBonus: result.xp_bonus,
        coinBonus: result.coin_bonus,
      });
      if (result.xp_bonus > 0) {
        emitGamification(userId, GAMIFICATION_EVENTS.XP_GAINED, { xp: result.xp_bonus });
      }
      if (result.coin_bonus > 0) {
        emitGamification(userId, GAMIFICATION_EVENTS.COINS_GAINED, { coins: result.coin_bonus });
      }

      // Notificação persistente — permite gerenciar o selo ao clicar depois
      try {
        const { data: seloInfo } = await sb().from('selos').select('name').eq('slug', seloSlug).maybeSingle();
        const seloName = seloInfo?.name || seloSlug;
        await NotificationDispatcher.dispatch({
          userId,
          type:       'new_selo',
          importance: 'high',
          data:       { seloSlug, seloName },
          metadata:   { triggeredBy: grantedBy },
          dedupKey:   `new_selo:${userId}:${seloSlug}`,
        });
      } catch (dispatchErr) {
        log('grantSelo', 'Falha ao despachar notificação de selo (não crítico)', { error: dispatchErr.message });
      }
    }

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

/**
 * Marca selos como celebrados (após exibição do modal).
 */
async function markSelosCelebrated(userId, userSeloIds) {
  log('markSelosCelebrated', 'Marcando selos como celebrados', { userId, count: userSeloIds.length });

  try {
    const { error } = await sb()
      .from('user_selos')
      .update({ celebrated: true })
      .in('id', userSeloIds)
      .eq('user_id', userId);

    if (error) throw error;
    return { success: true };
  } catch (err) {
    logError('markSelosCelebrated', err, { userId });
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
// 5b. Admin — Catálogo de Selos (CRUD)
// ──────────────────────────────────────────────────────

/**
 * Retorna todos os selos (inclusive inativos) — uso exclusivo admin.
 */
async function getAllSelosAdmin() {
  try {
    const { data, error } = await sb()
      .from('selos')
      .select('*')
      .order('sort_order');
    if (error) throw error;
    return { success: true, selos: data || [] };
  } catch (err) {
    logError('getAllSelosAdmin', err);
    throw err;
  }
}

/**
 * Cria um novo selo no catálogo.
 */
async function createSelo(data) {
  log('createSelo', 'Criando selo', { slug: data.slug });
  try {
    const { data: created, error } = await sb()
      .from('selos')
      .insert({
        slug: data.slug,
        name: data.name,
        description: data.description || null,
        category: data.category,
        tier: data.tier || 'bronze',
        icon_url: data.icon_url || null,
        color_hex: data.color_hex || '#CD7F32',
        is_active: data.is_active !== undefined ? data.is_active : true,
        is_platform_grant: data.is_platform_grant || false,
        grant_criteria: data.grant_criteria || {},
        xp_bonus: data.xp_bonus || 0,
        coin_bonus: data.coin_bonus || 0,
        is_unique: data.is_unique !== undefined ? data.is_unique : true,
        sort_order: data.sort_order || 0,
      })
      .select()
      .single();
    if (error) throw error;
    return { success: true, selo: created };
  } catch (err) {
    logError('createSelo', err);
    throw err;
  }
}

/**
 * Atualiza campos permitidos de um selo existente.
 */
async function updateSelo(id, data) {
  log('updateSelo', 'Atualizando selo', { id });
  const allowed = [
    'name', 'description', 'category', 'tier', 'icon_url', 'color_hex',
    'is_active', 'is_platform_grant', 'grant_criteria',
    'xp_bonus', 'coin_bonus', 'is_unique', 'sort_order',
  ];
  const updates = {};
  allowed.forEach(f => { if (data[f] !== undefined) updates[f] = data[f]; });

  try {
    const { data: updated, error } = await sb()
      .from('selos')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return { success: true, selo: updated };
  } catch (err) {
    logError('updateSelo', err, { id });
    throw err;
  }
}

/**
 * Alterna is_active de um selo.
 */
async function toggleSelo(id) {
  log('toggleSelo', 'Alternando status de selo', { id });
  try {
    const { data: current, error: readErr } = await sb()
      .from('selos')
      .select('is_active')
      .eq('id', id)
      .single();
    if (readErr) throw readErr;

    const { data: updated, error } = await sb()
      .from('selos')
      .update({ is_active: !current.is_active })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return { success: true, selo: updated };
  } catch (err) {
    logError('toggleSelo', err, { id });
    throw err;
  }
}

/**
 * Faz upload do ícone de um selo para o Supabase Storage.
 */
async function uploadSeloImage(id, fileBuffer, mimeType, originalName) {
  log('uploadSeloImage', 'Fazendo upload de imagem de selo', { id });
  try {
    const fileExt = (originalName || 'png').split('.').pop();
    const filePath = `selos/${id}-${Date.now()}.${fileExt}`;

    const { error: uploadError } = await sb()
      .storage
      .from('eloscloud-public')
      .upload(filePath, fileBuffer, { contentType: mimeType, upsert: true });
    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = sb()
      .storage
      .from('eloscloud-public')
      .getPublicUrl(filePath);

    const { data: updated, error: updateError } = await sb()
      .from('selos')
      .update({ icon_url: publicUrl })
      .eq('id', id)
      .select()
      .single();
    if (updateError) throw updateError;

    return { success: true, selo: updated };
  } catch (err) {
    logError('uploadSeloImage', err, { id });
    throw err;
  }
}

/**
 * Revoga um selo de um usuário (admin).
 * Decrementa selos_earned em user_gamification.
 */
async function revokeSelo(userId, userSeloId) {
  log('revokeSelo', 'Revogando selo de usuário', { userId, userSeloId });
  try {
    const { error: deleteError } = await sb()
      .from('user_selos')
      .delete()
      .eq('user_id', userId)
      .eq('id', userSeloId);
    if (deleteError) throw deleteError;

    // Decrementa contador (com proteção contra negativo)
    const { data: ug } = await sb()
      .from('user_gamification')
      .select('selos_earned')
      .eq('user_id', userId)
      .single();

    if (ug) {
      await sb()
        .from('user_gamification')
        .update({ selos_earned: Math.max((ug.selos_earned || 1) - 1, 0) })
        .eq('user_id', userId);
    }

    return { success: true };
  } catch (err) {
    logError('revokeSelo', err, { userId, userSeloId });
    throw err;
  }
}

/**
 * Lista usuários que possuem um determinado selo (paginado).
 */
async function getSeloHolders(seloId, page = 1, limit = 20) {
  log('getSeloHolders', 'Buscando portadores de selo', { seloId, page, limit });
  const offset = (page - 1) * limit;
  try {
    const { data, error, count } = await sb()
      .from('user_selos')
      .select(`
        id,
        granted_by,
        grant_reason,
        is_pinned,
        granted_at,
        users (
          id, nome, username, email, fotoDoPerfil
        )
      `, { count: 'exact' })
      .eq('selo_id', seloId)
      .order('granted_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    return {
      success: true,
      holders: data || [],
      total: count || 0,
      page,
      limit,
    };
  } catch (err) {
    logError('getSeloHolders', err, { seloId });
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
// 6b. Economia EloCoin — Gasto, Boost e Gorjeta
// ──────────────────────────────────────────────────────

/**
 * Gasta EloCoins via RPC atômica (spend_elo_coins).
 * Previne saldo negativo com FOR UPDATE no banco.
 * Se targetUserId fornecido, transfere as coins (gorjeta/presente).
 */
async function spendCoins(userId, amount, source, targetUserId = null, metadata = {}, burnAmount = 0) {
  log('spendCoins', 'Gastando EloCoins', { userId, amount, source, targetUserId, burnAmount });

  try {
    const { data, error } = await sb().rpc('spend_elo_coins', {
      p_user_id:        userId,
      p_amount:         amount,
      p_source:         source,
      p_target_user_id: targetUserId || null,
      p_metadata:       metadata,
      p_burn_amount:    burnAmount,
    });

    if (error) throw error;

    // RPC retorna JSONB diretamente (não array)
    const result = data || {};

    log('spendCoins', 'Gasto registrado', { userId, newBalance: result.new_balance });

    emitGamification(userId, GAMIFICATION_EVENTS.COINS_SPENT, {
      amount,
      source,
      newBalance:     result.new_balance,
      transactionId:  result.transaction_id,
    });

    if (targetUserId) {
      emitGamification(targetUserId, GAMIFICATION_EVENTS.COINS_GAINED, {
        coins:         amount,
        fromUserId:    userId,
        source,
        transactionId: result.target_transaction_id,
      });
    }

    return { success: true, ...result };
  } catch (err) {
    logError('spendCoins', err, { userId, amount, source });
    throw err;
  }
}

/**
 * Ativa boost de conteúdo comprando com EloCoins.
 * A RPC activate_content_boost gasta as coins E insere o boost
 * atomicamente — se o gasto falhar, o boost não é criado.
 */
async function boostContent(userId, contentType, contentId, durationHours, cost) {
  log('boostContent', 'Ativando boost de conteúdo', {
    userId, contentType, contentId, durationHours, cost,
  });

  try {
    const { data, error } = await sb().rpc('activate_content_boost', {
      p_user_id:        userId,
      p_content_type:   contentType,
      p_content_id:     contentId,
      p_duration_hours: durationHours,
      p_cost:           cost,
    });

    if (error) throw error;

    const result = data || {};

    log('boostContent', 'Boost ativado', { userId, boostId: result.boost_id });

    emitGamification(userId, GAMIFICATION_EVENTS.BOOST_ACTIVATED, {
      boostId:     result.boost_id,
      contentType: result.content_type,
      contentId:   result.content_id,
      expiresAt:   result.expires_at,
      newBalance:  result.new_balance,
    });

    emitGamification(userId, GAMIFICATION_EVENTS.COINS_SPENT, {
      amount:    cost,
      source:    'boost_purchase',
      newBalance: result.new_balance,
    });

    return { success: true, ...result };
  } catch (err) {
    logError('boostContent', err, { userId, contentType, contentId });
    throw err;
  }
}

/**
 * Envia gorjeta de EloCoins de um usuário para outro.
 * Aplica burn deflacionário de 5%: sender perde (amount + burn), receiver ganha (amount).
 * Três registros em xp_events: débito, burn e crédito.
 */
const TIP_BURN_RATE = 0.05;

async function tipUser(senderId, receiverId, amount) {
  const burnAmount = Math.ceil(amount * TIP_BURN_RATE);
  log('tipUser', 'Enviando gorjeta com burn', { senderId, receiverId, amount, burnAmount, totalDebit: amount + burnAmount });

  try {
    return await spendCoins(
      senderId,
      amount,
      'tip',
      receiverId,
      {
        description:        `Gorjeta enviada para ${receiverId} (+ ${burnAmount} EC burn)`,
        target_description: `Gorjeta recebida de ${senderId}`,
      },
      burnAmount,
    );
  } catch (err) {
    logError('tipUser', err, { senderId, receiverId, amount, burnAmount });
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
    'invite_sent':             ['first_invite', 'invite_5_friends'],
    'invite_accepted':         ['first_invite'],
    'caixinha_created':        ['create_first_caixinha'],
    'caixinha_joined':         ['join_caixinha'],
    'caixinha_invite_sent':    ['invite_to_caixinha'],
    'contribution_paid':       ['first_contribution'],
    'connection_made':         ['first_connection', 'make_5_connections'],
    'comment_posted':          ['comment_10_posts'],
    'gift_sent':               ['gift_sent'],
    'reaction_received':       ['receive_10_reactions'],
    'dispute_voted':           ['vote_dispute'],
    'dispute_resolved':        ['resolve_dispute'],
    'daily_access':            ['daily_login', 'first_login'],
    'identity_verified':       ['verify_identity'],
    'cnpj_verified':           ['verify_cnpj'],
    // [MKTPLACE-002] Mercado Local ElosCloud
    'seller_registered':       ['seller_profile_created'],
    'first_sale':              ['first_sale'],
    'purchase_made':           ['first_purchase'],
    'community_goal_supported':['community_supporter'],
    'review_given':            ['first_review'],
    // [SOCIAL-KYC] Moderação comunitária e Loja Social (GAME-MOD-002)
    'godfather_responsible':   ['godfather_responsible'],
    'community_kyc_verified':  ['community_kyc_verified'],
    'barter_completed':        ['barter_completed'],
    'barter_accepted':         ['barter_accepted'],
    // [DELIVERY-RATING-GAME] Avaliação tripartite de delivery
    'delivery_rating_submitted':        ['delivery_rating_first', 'delivery_rating_10'],
    'delivery_received_5star_rating':   ['delivery_rated_5stars'],
    'delivery_rating_cycle_completed':  ['delivery_rating_cycle_completed'],
    // [JOGOS-DB-003] Módulo de Jogos e Concursos
    'game_created':                     ['game_created'],
    'game_joined':                      ['game_joined'],
    'raffle_ticket_bought':             ['raffle_ticket_bought'],
    'selection_item_claimed':           ['selection_item_claimed'],
    'secret_friend_draw':               ['secret_friend_draw'],
    'game_host_completed':              ['game_host_completed'],
    // [BOLAO-P2] Bolao de Previsoes
    'prediction_entry_submitted':       ['prediction_entry_submitted'],
    'prediction_bonus_earned':          ['prediction_bonus_earned'],
    'prediction_exact_score':           ['prediction_exact_score'],
    'bolao_won':                        ['bolao_won'],
    // [CX-P2-M1] Empréstimos e temporada
    'loan_requested':                   ['request_first_loan'],
    'loan_approved':                    ['loan_approved'],
    'loan_paid':                        ['pay_first_loan'],
    'stay_completed':                   ['stay_completed'],
    'stay_hosted':                      ['stay_hosted'],
    // [AGORA-A2] Ágora Digital — Participação Cívica
    'relato_created':                   ['first_relato', 'relato_5_reports'],
    'relato_signed':                    ['sign_relato'],
    'relato_resolved':                  ['relato_resolved'],
    'enquete_voted':                    ['vote_enquete'],
    'enquete_created':                  ['create_enquete'],
    'informativo_liked':                ['like_informativo'],
    // [CARONA-C2] Carona Solidária — Mobilidade
    'carona_ride_offered':              ['first_carona_offered'],
    'carona_ride_completed_driver':     ['carona_10_rides_driver'],
    'carona_seat_booked':               ['carona_first_passenger'],
    'carona_received_5star':            ['carona_solidaria_5star'],
    'carona_recurring_active':          ['carona_recurring_week'],
    // [ICAL-SYNC] iCal Sync — Temporada / Marketplace
    'ical_sync_configured':             ['ical_sync_configured'],
    // [GP-3] Google Places × Mercado Local
    'google_place_verified':            ['verify_google_business'],
    // [VEH-001] Veículo Centralizado
    'vehicle_registered':               ['register_vehicle'],
    'vehicle_verified':                 ['register_vehicle'],
    // [VEH-PRICING VP-1] Manutenção de veículo
    'vehicle_maintenance_reported':     ['report_vehicle_maintenance'],
    // [GOV-001] Governança EloCoins DAO
    'proposal_created':                 ['create_proposal'],
    'governance_voted':                 ['vote_governance'],
    // [VISION-001] Vision Extraction
    'vision_extraction_used':           ['use_vision_extraction'],
    // [CONTEST-BACK-001] Concursos Colaborativos
    'contest_team_created':             ['contest_team_created'],
    'contest_challenge_completed':      ['contest_challenge_completed', 'contest_5_challenges'],
    'contest_won':                      ['contest_won'],
    // [DOC-001] Cofre de Documentos
    'vault_document_uploaded':            ['first_vault_upload'],
    'vault_document_shared':              ['vault_document_shared'],
    'vault_ai_analysis_completed':        ['vault_ai_analysis'],
  };

  // Resolve chave de dedup por slug de tarefa (evita dupla contagem em tarefas multi-etapa).
  // Retorna null para tarefas sem dedup ou quando metadata insuficiente.
  const dedupKeyResolver = {
    // Comentar no mesmo post conta apenas 1x — dedup por postId
    'comment_10_posts':     (meta) => meta.postId ? `post:${meta.postId}` : null,
    // Receber reação do mesmo usuário no mesmo post conta 1x — dedup por (senderId, postId)
    'receive_10_reactions': (meta) => (meta.senderId && meta.postId)
                                        ? `${meta.senderId}:${meta.postId}` : null,
  };

  const slugs = eventMap[event] || [];
  const results = [];

  for (const slug of slugs) {
    try {
      const dedupKey = dedupKeyResolver[slug]?.(metadata) ?? null;

      // Usamos incrementTaskProgress para suportar tanto tarefas de passo único
      // quanto tarefas progressivas (ex: make_5_connections).
      const result = await incrementTaskProgress(userId, slug, metadata.amount || 1, dedupKey);
      
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

  // Contribuição paga = 1 dia de streak freeze automático
  if (event === 'contribution_paid') {
    const freezeResult = await grantStreakFreeze(userId, 1).catch(() => null);
    if (freezeResult) results.push({ type: 'streak_freeze', ...freezeResult });
  }

  return results;
}

// ──────────────────────────────────────────────────────
// 8. Recálculo retroativo de progresso
// ──────────────────────────────────────────────────────

/**
 * Reconcilia user_tasks com os dados reais das tabelas de origem.
 * Cobre: posts, convites, conexões, comentários, reações recebidas.
 * Seguro para chamar múltiplas vezes (idempotente).
 * @param {string} userId
 */
async function recalculateProgress(userId) {
  log('recalculateProgress', 'Iniciando recálculo', { userId });

  await sb().rpc('init_user_gamification', { p_user_id: userId });

  // ── Contagens reais (paralelo) ───────────────────────
  const [postsResult, invitesResult, connectionsResult] = await Promise.all([
    sb().from('posts').select('*', { count: 'exact', head: true }).eq('usuario_id', userId),
    sb().from('invites').select('*', { count: 'exact', head: true })
      .eq('sender_id', userId).neq('status', 'canceled'),
    sb().from('user_connections').select('*', { count: 'exact', head: true })
      .or(`user_id.eq.${userId},connected_user_id.eq.${userId}`)
      .eq('status', 'active'),
  ]);

  const postsCount       = postsResult.count       || 0;
  const invitesCount     = invitesResult.count     || 0;
  const connectionsCount = connectionsResult.count || 0;

  // Comentários: conta posts únicos comentados (dedup igual ao triggerEvent)
  const { data: commentRows } = await sb()
    .from('comments').select('post_id').eq('usuario_id', userId);
  const commentsCount = new Set((commentRows || []).map(c => c.post_id)).size;

  // Reações recebidas em posts próprios
  let reactionsCount = 0;
  const { data: userPosts } = await sb().from('posts').select('id').eq('usuario_id', userId);
  const postIds = (userPosts || []).map(p => p.id);
  if (postIds.length > 0) {
    const { count } = await sb()
      .from('reactions').select('*', { count: 'exact', head: true }).in('post_id', postIds);
    reactionsCount = count || 0;
  }

  // ── Mapa slug → contagem real ────────────────────────
  const realCounts = {
    first_post:            postsCount,
    post_10_times:         postsCount,
    first_invite:          invitesCount,
    invite_5_friends:      invitesCount,
    first_connection:      connectionsCount,
    make_5_connections:    connectionsCount,
    comment_10_posts:      commentsCount,
    receive_10_reactions:  reactionsCount,
  };

  // ── Carrega tarefas e progresso atual ─────────────────
  const slugs = Object.keys(realCounts);

  const { data: tasks } = await sb()
    .from('gamification_tasks')
    .select('id, slug, name, target_count')
    .in('slug', slugs)
    .eq('is_active', true);

  if (!tasks?.length) {
    return { success: true, changes: [], noChanges: [], realCounts, recalculatedAt: new Date().toISOString() };
  }

  const { data: userTaskRows } = await sb()
    .from('user_tasks').select('*').eq('user_id', userId)
    .in('task_id', tasks.map(t => t.id));

  const userTaskMap = Object.fromEntries((userTaskRows || []).map(ut => [ut.task_id, ut]));

  // ── Reconcilia ────────────────────────────────────────
  const changes   = [];
  const noChanges = [];

  for (const task of tasks) {
    const realCount       = realCounts[task.slug] ?? 0;
    const ut              = userTaskMap[task.id];
    const currentProgress = ut?.progress || 0;
    const currentStatus   = ut?.status   || 'available';

    if (currentStatus === 'completed') {
      noChanges.push({ slug: task.slug, reason: 'already_completed', progress: currentProgress });
      continue;
    }

    if (realCount <= currentProgress) {
      noChanges.push({ slug: task.slug, reason: 'up_to_date', progress: currentProgress, realCount });
      continue;
    }

    const newProgress    = Math.min(realCount, task.target_count);
    const shouldComplete = newProgress >= task.target_count;

    if (shouldComplete) {
      const xpResult = await completeTask(userId, task.slug);
      changes.push({
        slug:             task.slug,
        name:             task.name,
        previousProgress: currentProgress,
        newProgress:      task.target_count,
        completed:        true,
        xpGranted:        xpResult.xpGranted   || 0,
        coinsGranted:     xpResult.coinsGranted || 0,
      });
    } else {
      if (ut) {
        await sb().from('user_tasks').update({
          progress:   newProgress,
          status:     'in_progress',
          updated_at: new Date().toISOString(),
        }).eq('user_id', userId).eq('task_id', task.id);
      } else {
        await sb().from('user_tasks').insert({
          user_id:      userId,
          task_id:      task.id,
          progress:     newProgress,
          status:       'in_progress',
          credited_ids: [],
        });
      }
      changes.push({
        slug:             task.slug,
        name:             task.name,
        previousProgress: currentProgress,
        newProgress,
        completed:        false,
      });
    }
  }

  log('recalculateProgress', `Recálculo concluído: ${changes.length} mudança(s)`, { userId });

  return {
    success:        true,
    recalculatedAt: new Date().toISOString(),
    realCounts,
    changes,
    noChanges,
  };
}

module.exports = {
  getUserGamification,
  getAllTasksWithProgress,
  completeTask,
  incrementTaskProgress,
  updateDailyStreak,
  grantStreakFreeze,
  grantSelo,
  toggleSeloPin,
  markSelosCelebrated,
  grantContentBoost,
  getActiveBoosts,
  getLeaderboard,
  getLevels,
  getAllSelos,
  triggerEvent,
  recalculateProgress,
  // [ELOC-001] Economia EloCoin
  spendCoins,
  boostContent,
  tipUser,
  // Admin — Catálogo de Selos
  getAllSelosAdmin,
  createSelo,
  updateSelo,
  toggleSelo,
  uploadSeloImage,
  revokeSelo,
  getSeloHolders,
};
