'use strict';

// services/contestService.js
// CONTEST-BACK-001 — Serviço de Concursos Colaborativos
// Tabelas: contest_teams, contest_team_members, contest_challenges,
//          contest_submissions, contest_leaderboard

const { logger }             = require('../logger');
const { getSupabaseClient }  = require('../config/supabase');
const { _requireOwner, _requireAccess } = require('./gamesService');

const SERVICE = 'contestService';

function log(method, msg, extra = {}) {
  logger.info(`[${SERVICE}] ${method}: ${msg}`, { service: SERVICE, method, ...extra });
}

function logErr(method, err, extra = {}) {
  logger.error(`[${SERVICE}] ${method}: ${err.message}`, {
    service: SERVICE, method, error: err.message, stack: err.stack, ...extra,
  });
}

// ── Helpers internos ──────────────────────────────────────────────────────

/**
 * Verifica se o jogo é do tipo CHALLENGE. Retorna o jogo ou lança erro.
 */
async function _requireContest(sb, gameId, userId) {
  const game = await _requireAccess(sb, gameId, userId);
  if (game.game_type !== 'CHALLENGE') {
    throw new Error('Este jogo não é um concurso colaborativo');
  }
  if (game.status === 'cancelled') {
    throw new Error('Este concurso foi cancelado');
  }
  return game;
}

/**
 * Enriquece lista de membros com dados da tabela users.
 */
async function _enrichMembers(sb, members) {
  if (!members || members.length === 0) return [];

  const userIds = [...new Set(members.map(m => m.user_id))];
  const { data: users } = await sb
    .from('users')
    .select('id, full_name, username, avatar_url')
    .in('id', userIds);

  const userMap = {};
  for (const u of (users || [])) userMap[u.id] = u;

  return members.map(m => ({
    ...m,
    display_name: userMap[m.user_id]?.full_name || userMap[m.user_id]?.username || null,
    photo_url:    userMap[m.user_id]?.avatar_url || null,
    username:     userMap[m.user_id]?.username   || null,
  }));
}

// ── Teams ─────────────────────────────────────────────────────────────────

/**
 * Cria um time em um concurso. O criador se torna capitão.
 */
const createTeam = async (contestId, userId, teamName, maxMembers = 5) => {
  try {
    log('createTeam', 'Criando time', { contestId, userId, teamName });

    const sb = getSupabaseClient();
    const game = await _requireContest(sb, contestId, userId);

    if (game.status !== 'open') {
      throw new Error('Só é possível criar times em concursos abertos');
    }

    // Verifica se o usuário já é capitão ou membro de outro time neste concurso
    const { data: existingMember } = await sb
      .from('contest_team_members')
      .select('id, team_id')
      .eq('user_id', userId)
      .in('team_id', sb
        .from('contest_teams')
        .select('id')
        .eq('contest_id', contestId)
      );

    // Fallback: query direta
    const { data: existingTeams } = await sb
      .from('contest_teams')
      .select('id')
      .eq('contest_id', contestId);

    const teamIds = (existingTeams || []).map(t => t.id);

    if (teamIds.length > 0) {
      const { data: memberCheck } = await sb
        .from('contest_team_members')
        .select('id')
        .eq('user_id', userId)
        .in('team_id', teamIds)
        .limit(1);

      if (memberCheck && memberCheck.length > 0) {
        throw new Error('Você já pertence a um time neste concurso');
      }
    }

    // Cria o time
    const { data: team, error: teamErr } = await sb
      .from('contest_teams')
      .insert({
        contest_id: contestId,
        team_name:  teamName,
        captain_id: userId,
        max_members: maxMembers,
      })
      .select()
      .single();

    if (teamErr) {
      if (teamErr.message?.includes('unique') || teamErr.message?.includes('duplicate')) {
        throw new Error('Já existe um time com esse nome neste concurso');
      }
      throw teamErr;
    }

    // Adiciona o criador como captain
    const { error: memberErr } = await sb
      .from('contest_team_members')
      .insert({
        team_id: team.id,
        user_id: userId,
        role:    'captain',
      });

    if (memberErr) throw memberErr;

    // Gamification: fire-and-forget
    setImmediate(async () => {
      try {
        const gamificationService = require('./gamificationService');
        await gamificationService.triggerEvent('contest_team_created', userId, { contestId });
      } catch (err) {
        logger.warn(`[${SERVICE}] Falha no trigger contest_team_created`, { error: err.message });
      }
    });

    log('createTeam', 'Time criado', { teamId: team.id });
    return { ...team, members: [{ user_id: userId, role: 'captain' }] };
  } catch (err) {
    logErr('createTeam', err, { contestId, userId });
    throw err;
  }
};

/**
 * Entra em um time existente (verifica capacidade).
 */
const joinTeam = async (teamId, userId) => {
  try {
    log('joinTeam', 'Entrando no time', { teamId, userId });

    const sb = getSupabaseClient();

    // Busca o time
    const { data: team, error: teamErr } = await sb
      .from('contest_teams')
      .select('*, contest_id')
      .eq('id', teamId)
      .maybeSingle();

    if (teamErr) throw teamErr;
    if (!team) throw new Error('Time não encontrado');

    // Verifica acesso ao concurso
    await _requireContest(sb, team.contest_id, userId);

    // Verifica se já é membro de algum time neste concurso
    const { data: existingTeams } = await sb
      .from('contest_teams')
      .select('id')
      .eq('contest_id', team.contest_id);

    const teamIds = (existingTeams || []).map(t => t.id);

    if (teamIds.length > 0) {
      const { data: memberCheck } = await sb
        .from('contest_team_members')
        .select('id')
        .eq('user_id', userId)
        .in('team_id', teamIds)
        .limit(1);

      if (memberCheck && memberCheck.length > 0) {
        throw new Error('Você já pertence a um time neste concurso');
      }
    }

    // Verifica capacidade
    const { data: currentMembers, error: countErr } = await sb
      .from('contest_team_members')
      .select('id')
      .eq('team_id', teamId);

    if (countErr) throw countErr;

    if ((currentMembers || []).length >= team.max_members) {
      throw new Error('Time lotado — número máximo de membros atingido');
    }

    // Insere membro
    const { data: member, error: memberErr } = await sb
      .from('contest_team_members')
      .insert({
        team_id: teamId,
        user_id: userId,
        role:    'member',
      })
      .select()
      .single();

    if (memberErr) {
      if (memberErr.message?.includes('unique') || memberErr.message?.includes('duplicate')) {
        throw new Error('Você já é membro deste time');
      }
      throw memberErr;
    }

    log('joinTeam', 'Membro adicionado ao time', { teamId, userId });
    return member;
  } catch (err) {
    logErr('joinTeam', err, { teamId, userId });
    throw err;
  }
};

/**
 * Sai de um time. Capitão não pode sair se houver outros membros.
 */
const leaveTeam = async (teamId, userId) => {
  try {
    log('leaveTeam', 'Saindo do time', { teamId, userId });

    const sb = getSupabaseClient();

    // Busca o time
    const { data: team, error: teamErr } = await sb
      .from('contest_teams')
      .select('*')
      .eq('id', teamId)
      .maybeSingle();

    if (teamErr) throw teamErr;
    if (!team) throw new Error('Time não encontrado');

    // Verifica se é membro
    const { data: membership, error: memErr } = await sb
      .from('contest_team_members')
      .select('id, role')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .maybeSingle();

    if (memErr) throw memErr;
    if (!membership) throw new Error('Você não pertence a este time');

    // Capitão não pode sair se houver outros membros
    if (membership.role === 'captain') {
      const { data: otherMembers } = await sb
        .from('contest_team_members')
        .select('id')
        .eq('team_id', teamId)
        .neq('user_id', userId);

      if (otherMembers && otherMembers.length > 0) {
        throw new Error('O capitão não pode sair enquanto o time tiver outros membros. Transfira a liderança ou remova os membros primeiro.');
      }
    }

    // Remove membro
    const { error: delErr } = await sb
      .from('contest_team_members')
      .delete()
      .eq('team_id', teamId)
      .eq('user_id', userId);

    if (delErr) throw delErr;

    // Se era o último membro (capitão sozinho), deleta o time
    if (membership.role === 'captain') {
      const { data: remaining } = await sb
        .from('contest_team_members')
        .select('id')
        .eq('team_id', teamId)
        .limit(1);

      if (!remaining || remaining.length === 0) {
        await sb.from('contest_teams').delete().eq('id', teamId);
        log('leaveTeam', 'Time deletado (sem membros)', { teamId });
      }
    }

    log('leaveTeam', 'Membro saiu do time', { teamId, userId });
    return { left: true };
  } catch (err) {
    logErr('leaveTeam', err, { teamId, userId });
    throw err;
  }
};

/**
 * Lista times de um concurso com membros enriquecidos.
 */
const listTeams = async (contestId, userId) => {
  try {
    log('listTeams', 'Listando times', { contestId, userId });

    const sb = getSupabaseClient();
    await _requireContest(sb, contestId, userId);

    const { data: teams, error: teamsErr } = await sb
      .from('contest_teams')
      .select('*')
      .eq('contest_id', contestId)
      .order('score', { ascending: false });

    if (teamsErr) throw teamsErr;

    // Buscar membros de cada time
    const result = [];
    for (const team of (teams || [])) {
      const { data: members } = await sb
        .from('contest_team_members')
        .select('*')
        .eq('team_id', team.id)
        .order('joined_at', { ascending: true });

      const enriched = await _enrichMembers(sb, members || []);
      result.push({ ...team, members: enriched, member_count: enriched.length });
    }

    return result;
  } catch (err) {
    logErr('listTeams', err, { contestId, userId });
    throw err;
  }
};

/**
 * Detalhes de um time com membros enriquecidos.
 */
const getTeamDetails = async (teamId, userId) => {
  try {
    log('getTeamDetails', 'Buscando detalhes do time', { teamId, userId });

    const sb = getSupabaseClient();

    const { data: team, error: teamErr } = await sb
      .from('contest_teams')
      .select('*')
      .eq('id', teamId)
      .maybeSingle();

    if (teamErr) throw teamErr;
    if (!team) throw new Error('Time não encontrado');

    // Verifica acesso ao concurso
    await _requireContest(sb, team.contest_id, userId);

    // Membros
    const { data: members } = await sb
      .from('contest_team_members')
      .select('*')
      .eq('team_id', teamId)
      .order('joined_at', { ascending: true });

    const enrichedMembers = await _enrichMembers(sb, members || []);

    return { ...team, members: enrichedMembers, member_count: enrichedMembers.length };
  } catch (err) {
    logErr('getTeamDetails', err, { teamId, userId });
    throw err;
  }
};

// ── Challenges ────────────────────────────────────────────────────────────

/**
 * Cria um desafio em um concurso. Requer owner do concurso.
 */
const createChallenge = async (contestId, adminUserId, challengeData) => {
  try {
    log('createChallenge', 'Criando desafio', { contestId, adminUserId });

    const sb = getSupabaseClient();
    await _requireOwner(sb, contestId, adminUserId);

    // Verifica que é CHALLENGE type
    const { data: game } = await sb
      .from('games')
      .select('game_type, status')
      .eq('id', contestId)
      .maybeSingle();

    if (!game) throw new Error('Concurso não encontrado');
    if (game.game_type !== 'CHALLENGE') throw new Error('Este jogo não é um concurso colaborativo');
    if (!['draft', 'open'].includes(game.status)) {
      throw new Error('Só é possível criar desafios em concursos em rascunho ou abertos');
    }

    const { data: challenge, error } = await sb
      .from('contest_challenges')
      .insert({
        contest_id:        contestId,
        title:             challengeData.title,
        description:       challengeData.description || null,
        challenge_type:    challengeData.challenge_type || 'individual',
        points:            challengeData.points || 10,
        deadline:          challengeData.deadline || null,
        verification_type: challengeData.verification_type || 'self_report',
      })
      .select()
      .single();

    if (error) throw error;

    log('createChallenge', 'Desafio criado', { challengeId: challenge.id });
    return challenge;
  } catch (err) {
    logErr('createChallenge', err, { contestId, adminUserId });
    throw err;
  }
};

/**
 * Lista desafios de um concurso com contagem de submissões.
 */
const getContestChallenges = async (contestId, userId) => {
  try {
    log('getContestChallenges', 'Listando desafios', { contestId, userId });

    const sb = getSupabaseClient();
    await _requireContest(sb, contestId, userId);

    const { data: challenges, error } = await sb
      .from('contest_challenges')
      .select('*')
      .eq('contest_id', contestId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Contar submissões por desafio
    const result = [];
    for (const ch of (challenges || [])) {
      const { data: subs } = await sb
        .from('contest_submissions')
        .select('id, status')
        .eq('challenge_id', ch.id);

      const submissions = subs || [];
      const submissionCount = submissions.length;
      const approvedCount   = submissions.filter(s => s.status === 'approved').length;
      const pendingCount    = submissions.filter(s => s.status === 'pending').length;

      // Verifica se o usuário já submeteu
      const { data: userSub } = await sb
        .from('contest_submissions')
        .select('id, status, points_awarded')
        .eq('challenge_id', ch.id)
        .eq('user_id', userId)
        .maybeSingle();

      result.push({
        ...ch,
        submission_count: submissionCount,
        approved_count:   approvedCount,
        pending_count:    pendingCount,
        my_submission:    userSub || null,
      });
    }

    return result;
  } catch (err) {
    logErr('getContestChallenges', err, { contestId, userId });
    throw err;
  }
};

// ── Submissions ──────────────────────────────────────────────────────────

/**
 * Submete prova de conclusão de um desafio.
 */
const submitProof = async (challengeId, userId, { proofUrl, proofType, teamId }) => {
  try {
    log('submitProof', 'Submetendo prova', { challengeId, userId });

    const sb = getSupabaseClient();

    // Busca o desafio
    const { data: challenge, error: chErr } = await sb
      .from('contest_challenges')
      .select('*, contest_id')
      .eq('id', challengeId)
      .maybeSingle();

    if (chErr) throw chErr;
    if (!challenge) throw new Error('Desafio não encontrado');

    // Verifica acesso ao concurso
    await _requireContest(sb, challenge.contest_id, userId);

    // Verifica status do desafio
    if (challenge.status !== 'active') {
      throw new Error('Este desafio não está mais ativo');
    }

    // Verifica deadline
    if (challenge.deadline && new Date(challenge.deadline) < new Date()) {
      throw new Error('O prazo para este desafio já expirou');
    }

    // Se é desafio de time, verifica que o usuário pertence ao time
    if (challenge.challenge_type === 'team' && teamId) {
      const { data: membership } = await sb
        .from('contest_team_members')
        .select('id')
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .maybeSingle();

      if (!membership) {
        throw new Error('Você não pertence a este time');
      }
    }

    // Determina status baseado no verification_type
    let initialStatus = 'pending';
    let initialPoints = 0;
    if (challenge.verification_type === 'self_report') {
      initialStatus = 'approved';
      initialPoints = challenge.points;
    }

    const { data: submission, error } = await sb
      .from('contest_submissions')
      .insert({
        challenge_id:   challengeId,
        user_id:        userId,
        team_id:        teamId || null,
        proof_url:      proofUrl || null,
        proof_type:     proofType || 'text',
        status:         initialStatus,
        points_awarded: initialPoints,
        reviewed_at:    initialStatus === 'approved' ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (error) {
      if (error.message?.includes('unique') || error.message?.includes('duplicate')) {
        throw new Error('Você já submeteu prova para este desafio');
      }
      throw error;
    }

    // Se auto-aprovado (self_report), atualiza score do time e dispara gamificação
    if (initialStatus === 'approved') {
      await _updateTeamScore(sb, teamId, initialPoints);
      await _refreshLeaderboard(sb, challenge.contest_id);

      // Gamification: fire-and-forget
      setImmediate(async () => {
        try {
          const gamificationService = require('./gamificationService');
          await gamificationService.triggerEvent('contest_challenge_completed', userId, {
            contestId: challenge.contest_id,
            challengeId,
          });
        } catch (err) {
          logger.warn(`[${SERVICE}] Falha no trigger contest_challenge_completed`, { error: err.message });
        }
      });
    }

    log('submitProof', 'Prova submetida', { submissionId: submission.id, status: initialStatus });
    return submission;
  } catch (err) {
    logErr('submitProof', err, { challengeId, userId });
    throw err;
  }
};

/**
 * Revisa uma submissão (owner/admin). Aprova ou rejeita + atribui pontos.
 */
const reviewSubmission = async (submissionId, adminUserId, { approved, pointsAwarded }) => {
  try {
    log('reviewSubmission', 'Revisando submissão', { submissionId, adminUserId, approved });

    const sb = getSupabaseClient();

    // Busca a submissão com join ao desafio
    const { data: submission, error: subErr } = await sb
      .from('contest_submissions')
      .select('*, challenge_id')
      .eq('id', submissionId)
      .maybeSingle();

    if (subErr) throw subErr;
    if (!submission) throw new Error('Submissão não encontrada');

    if (submission.status !== 'pending') {
      throw new Error('Esta submissão já foi revisada');
    }

    // Busca o desafio para verificar owner
    const { data: challenge } = await sb
      .from('contest_challenges')
      .select('contest_id, points')
      .eq('id', submission.challenge_id)
      .maybeSingle();

    if (!challenge) throw new Error('Desafio não encontrado');

    // Verifica que é owner do concurso
    await _requireOwner(sb, challenge.contest_id, adminUserId);

    const finalPoints = approved ? (pointsAwarded || challenge.points) : 0;
    const newStatus   = approved ? 'approved' : 'rejected';

    const { data: updated, error: updErr } = await sb
      .from('contest_submissions')
      .update({
        status:         newStatus,
        reviewed_by:    adminUserId,
        reviewed_at:    new Date().toISOString(),
        points_awarded: finalPoints,
      })
      .eq('id', submissionId)
      .select()
      .single();

    if (updErr) throw updErr;

    // Se aprovado, atualiza score do time e leaderboard
    if (approved) {
      await _updateTeamScore(sb, submission.team_id, finalPoints);
      await _refreshLeaderboard(sb, challenge.contest_id);

      // Gamification: fire-and-forget
      setImmediate(async () => {
        try {
          const gamificationService = require('./gamificationService');
          await gamificationService.triggerEvent('contest_challenge_completed', submission.user_id, {
            contestId: challenge.contest_id,
            challengeId: submission.challenge_id,
          });
        } catch (err) {
          logger.warn(`[${SERVICE}] Falha no trigger contest_challenge_completed`, { error: err.message });
        }
      });
    }

    log('reviewSubmission', `Submissão ${newStatus}`, { submissionId, points: finalPoints });
    return updated;
  } catch (err) {
    logErr('reviewSubmission', err, { submissionId, adminUserId });
    throw err;
  }
};

// ── Leaderboard ──────────────────────────────────────────────────────────

/**
 * Atualiza o score do time (acumula pontos).
 */
async function _updateTeamScore(sb, teamId, points) {
  if (!teamId || !points) return;

  try {
    const { data: team } = await sb
      .from('contest_teams')
      .select('score')
      .eq('id', teamId)
      .maybeSingle();

    if (team) {
      await sb
        .from('contest_teams')
        .update({ score: (team.score || 0) + points })
        .eq('id', teamId);
    }
  } catch (err) {
    logger.warn(`[${SERVICE}] _updateTeamScore: ${err.message}`, { teamId, points });
  }
}

/**
 * Recalcula o leaderboard de um concurso a partir das submissões aprovadas.
 */
async function _refreshLeaderboard(sb, contestId) {
  try {
    // Individual: soma de pontos por usuário
    const { data: userScores } = await sb
      .from('contest_submissions')
      .select('user_id, points_awarded, challenge_id')
      .eq('status', 'approved')
      .in('challenge_id', sb
        .from('contest_challenges')
        .select('id')
        .eq('contest_id', contestId)
      );

    // Fallback: precisa do contest_id no join
    const { data: challenges } = await sb
      .from('contest_challenges')
      .select('id')
      .eq('contest_id', contestId);

    const challengeIds = (challenges || []).map(c => c.id);

    if (challengeIds.length === 0) return;

    const { data: submissions } = await sb
      .from('contest_submissions')
      .select('user_id, team_id, points_awarded')
      .eq('status', 'approved')
      .in('challenge_id', challengeIds);

    if (!submissions || submissions.length === 0) {
      // Limpa leaderboard existente
      await sb.from('contest_leaderboard').delete().eq('contest_id', contestId);
      return;
    }

    // Agrega por usuário
    const userMap = {};
    const teamMap = {};
    for (const sub of submissions) {
      // Individual
      if (!userMap[sub.user_id]) userMap[sub.user_id] = 0;
      userMap[sub.user_id] += sub.points_awarded;

      // Time
      if (sub.team_id) {
        if (!teamMap[sub.team_id]) teamMap[sub.team_id] = 0;
        teamMap[sub.team_id] += sub.points_awarded;
      }
    }

    // Ordena e rankeia
    const userEntries = Object.entries(userMap)
      .sort((a, b) => b[1] - a[1])
      .map(([id, points], i) => ({
        contest_id:  contestId,
        entity_type: 'user',
        entity_id:   id,
        total_points: points,
        rank:        i + 1,
        updated_at:  new Date().toISOString(),
      }));

    const teamEntries = Object.entries(teamMap)
      .sort((a, b) => b[1] - a[1])
      .map(([id, points], i) => ({
        contest_id:  contestId,
        entity_type: 'team',
        entity_id:   id,
        total_points: points,
        rank:        i + 1,
        updated_at:  new Date().toISOString(),
      }));

    // Limpa e reinsere
    await sb.from('contest_leaderboard').delete().eq('contest_id', contestId);

    const allEntries = [...userEntries, ...teamEntries];
    if (allEntries.length > 0) {
      await sb.from('contest_leaderboard').insert(allEntries);
    }
  } catch (err) {
    logger.warn(`[${SERVICE}] _refreshLeaderboard: ${err.message}`, { contestId });
  }
}

/**
 * Retorna o leaderboard de um concurso.
 */
const getLeaderboard = async (contestId, userId, entityType) => {
  try {
    log('getLeaderboard', 'Buscando leaderboard', { contestId, userId, entityType });

    const sb = getSupabaseClient();
    await _requireContest(sb, contestId, userId);

    let query = sb
      .from('contest_leaderboard')
      .select('*')
      .eq('contest_id', contestId)
      .order('rank', { ascending: true });

    if (entityType) {
      query = query.eq('entity_type', entityType);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Enriquecer com dados do usuário/time
    const enriched = [];
    for (const entry of (data || [])) {
      if (entry.entity_type === 'user') {
        const { data: user } = await sb
          .from('users')
          .select('id, full_name, username, avatar_url')
          .eq('id', entry.entity_id)
          .maybeSingle();

        enriched.push({
          ...entry,
          display_name: user?.full_name || user?.username || null,
          photo_url:    user?.avatar_url || null,
          username:     user?.username   || null,
        });
      } else if (entry.entity_type === 'team') {
        const { data: team } = await sb
          .from('contest_teams')
          .select('id, team_name, captain_id')
          .eq('id', entry.entity_id)
          .maybeSingle();

        enriched.push({
          ...entry,
          team_name:  team?.team_name || null,
          captain_id: team?.captain_id || null,
        });
      } else {
        enriched.push(entry);
      }
    }

    return enriched;
  } catch (err) {
    logErr('getLeaderboard', err, { contestId, userId });
    throw err;
  }
};

/**
 * Força recálculo do leaderboard (endpoint admin).
 */
const refreshLeaderboard = async (contestId, userId) => {
  try {
    log('refreshLeaderboard', 'Recalculando leaderboard', { contestId, userId });

    const sb = getSupabaseClient();
    await _requireOwner(sb, contestId, userId);

    await _refreshLeaderboard(sb, contestId);

    log('refreshLeaderboard', 'Leaderboard recalculado', { contestId });
    return { refreshed: true };
  } catch (err) {
    logErr('refreshLeaderboard', err, { contestId, userId });
    throw err;
  }
};

/**
 * Retorna submissões pendentes de revisão para o owner.
 */
const getPendingSubmissions = async (contestId, userId) => {
  try {
    log('getPendingSubmissions', 'Listando submissões pendentes', { contestId, userId });

    const sb = getSupabaseClient();
    await _requireOwner(sb, contestId, userId);

    const { data: challenges } = await sb
      .from('contest_challenges')
      .select('id')
      .eq('contest_id', contestId);

    const challengeIds = (challenges || []).map(c => c.id);

    if (challengeIds.length === 0) return [];

    const { data: submissions, error } = await sb
      .from('contest_submissions')
      .select('*')
      .eq('status', 'pending')
      .in('challenge_id', challengeIds)
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Enriquecer com dados do usuário e desafio
    const enriched = [];
    for (const sub of (submissions || [])) {
      const { data: user } = await sb
        .from('users')
        .select('id, full_name, username, avatar_url')
        .eq('id', sub.user_id)
        .maybeSingle();

      const { data: challenge } = await sb
        .from('contest_challenges')
        .select('title, points, challenge_type')
        .eq('id', sub.challenge_id)
        .maybeSingle();

      enriched.push({
        ...sub,
        display_name:    user?.full_name || user?.username || null,
        photo_url:       user?.avatar_url || null,
        challenge_title: challenge?.title || null,
        challenge_points: challenge?.points || 0,
        challenge_type:  challenge?.challenge_type || null,
      });
    }

    return enriched;
  } catch (err) {
    logErr('getPendingSubmissions', err, { contestId, userId });
    throw err;
  }
};

module.exports = {
  // Teams
  createTeam,
  joinTeam,
  leaveTeam,
  listTeams,
  getTeamDetails,
  // Challenges
  createChallenge,
  getContestChallenges,
  // Submissions
  submitProof,
  reviewSubmission,
  getPendingSubmissions,
  // Leaderboard
  getLeaderboard,
  refreshLeaderboard,
};
