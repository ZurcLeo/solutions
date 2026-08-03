/**
 * @fileoverview governanceService — ElosCloud [GOV-001]
 * Governança comunitária de EloCoins: propostas, votação ponderada
 * por nível de gamificação e tesouraria (ledger append-only).
 */

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const SERVICE = 'governanceService';

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
  logger.error(`Erro em ${fn}: ${err.message}`, {
    service: SERVICE, function: fn, error: err.message, ...extra,
  });
}

// ──────────────────────────────────────────────────────
// Internal: get user gamification level
// ──────────────────────────────────────────────────────

async function _getUserLevel(userId) {
  const { data, error } = await sb()
    .from('user_gamification')
    .select('level')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    logError('_getUserLevel', error, { userId });
    return 1;
  }

  return data?.level || 1;
}

// ──────────────────────────────────────────────────────
// Internal: fire gamification event (fire-and-forget)
// ──────────────────────────────────────────────────────

async function _fireGamificationEvent(event, userId, metadata = {}) {
  try {
    const gamificationService = require('./gamificationService');
    await gamificationService.triggerEvent(event, userId, metadata);
  } catch (err) {
    logger.warn(`governanceService: gamification event '${event}' falhou (non-blocking)`, {
      service: SERVICE, userId, error: err.message,
    });
  }
}

// ──────────────────────────────────────────────────────
// 1. createProposal
// ──────────────────────────────────────────────────────

/**
 * Cria uma nova proposta de governança (status: draft).
 * Requisito: usuário deve ter nível >= 3 de gamificação.
 *
 * @param {string} userId
 * @param {Object} params
 * @param {string} params.title
 * @param {string} params.description
 * @param {string} params.type — policy_change|fund_allocation|burn_event|community_initiative
 * @param {number} [params.votingDays=7]
 * @param {number} [params.quorum=10]
 * @returns {Object} proposal
 */
async function createProposal(userId, { title, description, type, votingDays = 7, quorum = 10 }) {
  log('createProposal', 'Criando proposta de governança', { userId, type });

  // Verificar nível mínimo
  const level = await _getUserLevel(userId);
  if (level < 3) {
    const err = new Error('Nível mínimo 3 é necessário para criar propostas');
    err.statusCode = 403;
    err.code = 'INSUFFICIENT_LEVEL';
    throw err;
  }

  const { data, error } = await sb()
    .from('governance_proposals')
    .insert({
      proposer_id:     userId,
      title,
      description,
      proposal_type:   type,
      quorum_required: quorum,
      execution_data:  { voting_days: votingDays },
    })
    .select()
    .single();

  if (error) {
    logError('createProposal', error, { userId });
    throw error;
  }

  // Gamification: fire-and-forget
  _fireGamificationEvent('proposal_created', userId, { proposalId: data.id });

  log('createProposal', 'Proposta criada com sucesso', { proposalId: data.id });
  return data;
}

// ──────────────────────────────────────────────────────
// 2. openProposal
// ──────────────────────────────────────────────────────

/**
 * Abre uma proposta para votação.
 * Apenas o proposer pode abrir; status deve ser 'draft'.
 *
 * @param {string} proposalId
 * @param {string} userId
 * @returns {Object} updated proposal
 */
async function openProposal(proposalId, userId) {
  log('openProposal', 'Abrindo proposta para votação', { proposalId, userId });

  // Buscar proposta
  const { data: proposal, error: fetchErr } = await sb()
    .from('governance_proposals')
    .select('*')
    .eq('id', proposalId)
    .single();

  if (fetchErr || !proposal) {
    const err = new Error('Proposta não encontrada');
    err.statusCode = 404;
    throw err;
  }

  if (proposal.proposer_id !== userId) {
    const err = new Error('Apenas o autor pode abrir a proposta');
    err.statusCode = 403;
    throw err;
  }

  if (proposal.status !== 'draft') {
    const err = new Error(`Proposta não pode ser aberta — status atual: ${proposal.status}`);
    err.statusCode = 400;
    throw err;
  }

  const votingDays = proposal.execution_data?.voting_days || 7;
  const now = new Date();
  const votingEndsAt = new Date(now.getTime() + votingDays * 24 * 60 * 60 * 1000);

  const { data, error } = await sb()
    .from('governance_proposals')
    .update({
      status:           'open',
      voting_starts_at: now.toISOString(),
      voting_ends_at:   votingEndsAt.toISOString(),
    })
    .eq('id', proposalId)
    .select()
    .single();

  if (error) {
    logError('openProposal', error, { proposalId });
    throw error;
  }

  log('openProposal', 'Proposta aberta para votação', { proposalId, votingEndsAt });
  return data;
}

// ──────────────────────────────────────────────────────
// 3. castVote
// ──────────────────────────────────────────────────────

/**
 * Registra voto em uma proposta.
 * Voting power = nível de gamificação do votante.
 * UPSERT: se o usuário já votou, atualiza o voto.
 *
 * @param {string} proposalId
 * @param {string} userId
 * @param {string} vote — for|against|abstain
 * @param {string} [reason]
 * @returns {Object} vote record
 */
async function castVote(proposalId, userId, vote, reason) {
  log('castVote', 'Registrando voto', { proposalId, userId, vote });

  // Buscar proposta e verificar janela de votação
  const { data: proposal, error: fetchErr } = await sb()
    .from('governance_proposals')
    .select('status, voting_starts_at, voting_ends_at')
    .eq('id', proposalId)
    .single();

  if (fetchErr || !proposal) {
    const err = new Error('Proposta não encontrada');
    err.statusCode = 404;
    throw err;
  }

  if (proposal.status !== 'open') {
    const err = new Error('Proposta não está aberta para votação');
    err.statusCode = 400;
    throw err;
  }

  const now = new Date();
  if (proposal.voting_ends_at && new Date(proposal.voting_ends_at) < now) {
    const err = new Error('Período de votação encerrado');
    err.statusCode = 400;
    err.code = 'VOTING_CLOSED';
    throw err;
  }

  // Verificar se o proposer está tentando votar na própria proposta
  // (permitido — governança aberta)

  // Calcular voting power baseado no nível
  const level = await _getUserLevel(userId);
  const votingPower = Math.max(1, level);

  // Verificar se já votou (para UPSERT correto)
  const { data: existingVote } = await sb()
    .from('governance_votes')
    .select('id, vote, voting_power')
    .eq('proposal_id', proposalId)
    .eq('voter_id', userId)
    .maybeSingle();

  let voteRecord;

  if (existingVote) {
    // Atualizar voto existente — precisa ajustar contadores
    const { data, error } = await sb()
      .from('governance_votes')
      .update({ vote, voting_power: votingPower, reason })
      .eq('id', existingVote.id)
      .select()
      .single();

    if (error) {
      logError('castVote', error, { proposalId, userId });
      throw error;
    }
    voteRecord = data;

    // Ajustar contadores da proposta (remover voto antigo, somar novo)
    await _recalculateVoteCounts(proposalId);
  } else {
    // Inserir novo voto
    const { data, error } = await sb()
      .from('governance_votes')
      .insert({
        proposal_id:  proposalId,
        voter_id:     userId,
        vote,
        voting_power: votingPower,
        reason,
      })
      .select()
      .single();

    if (error) {
      logError('castVote', error, { proposalId, userId });
      throw error;
    }
    voteRecord = data;

    // Incrementar contador na proposta
    if (vote === 'for') {
      await sb().rpc('increment_field', { table_name: 'governance_proposals', field_name: 'votes_for', row_id: proposalId, amount: votingPower }).catch(() => {});
    } else if (vote === 'against') {
      await sb().rpc('increment_field', { table_name: 'governance_proposals', field_name: 'votes_against', row_id: proposalId, amount: votingPower }).catch(() => {});
    }

    // Fallback: always recalculate to be sure
    await _recalculateVoteCounts(proposalId);

    // Gamification: fire-and-forget
    _fireGamificationEvent('governance_voted', userId, { proposalId });
  }

  log('castVote', 'Voto registrado', { proposalId, userId, votingPower });
  return voteRecord;
}

// ──────────────────────────────────────────────────────
// Internal: recalculate vote counts on proposal
// ──────────────────────────────────────────────────────

async function _recalculateVoteCounts(proposalId) {
  const { data: votes, error } = await sb()
    .from('governance_votes')
    .select('vote, voting_power')
    .eq('proposal_id', proposalId);

  if (error) {
    logError('_recalculateVoteCounts', error, { proposalId });
    return;
  }

  let votesFor = 0;
  let votesAgainst = 0;

  for (const v of votes || []) {
    if (v.vote === 'for') votesFor += v.voting_power;
    else if (v.vote === 'against') votesAgainst += v.voting_power;
  }

  await sb()
    .from('governance_proposals')
    .update({ votes_for: votesFor, votes_against: votesAgainst })
    .eq('id', proposalId);
}

// ──────────────────────────────────────────────────────
// 4. tallyVotes
// ──────────────────────────────────────────────────────

/**
 * Contabiliza os votos de uma proposta e determina o resultado.
 * Pode ser chamado após o fim da janela de votação.
 *
 * @param {string} proposalId
 * @returns {Object} { status, votesFor, votesAgainst, totalVoters, quorumMet }
 */
async function tallyVotes(proposalId) {
  log('tallyVotes', 'Contabilizando votos', { proposalId });

  const { data: proposal, error: fetchErr } = await sb()
    .from('governance_proposals')
    .select('*')
    .eq('id', proposalId)
    .single();

  if (fetchErr || !proposal) {
    const err = new Error('Proposta não encontrada');
    err.statusCode = 404;
    throw err;
  }

  if (!['open', 'voting'].includes(proposal.status)) {
    const err = new Error(`Proposta não está em votação — status: ${proposal.status}`);
    err.statusCode = 400;
    throw err;
  }

  // Recalcular para garantir precisão
  await _recalculateVoteCounts(proposalId);

  // Re-fetch após recalcular
  const { data: updated } = await sb()
    .from('governance_proposals')
    .select('votes_for, votes_against, quorum_required')
    .eq('id', proposalId)
    .single();

  // Contar votantes distintos
  const { count: totalVoters } = await sb()
    .from('governance_votes')
    .select('id', { count: 'exact', head: true })
    .eq('proposal_id', proposalId);

  const quorumMet = (totalVoters || 0) >= (updated?.quorum_required || 10);
  const votesFor = updated?.votes_for || 0;
  const votesAgainst = updated?.votes_against || 0;

  let newStatus;
  if (!quorumMet) {
    // Se a votação já encerrou mas não atingiu quórum → rejeitada
    const now = new Date();
    if (proposal.voting_ends_at && new Date(proposal.voting_ends_at) < now) {
      newStatus = 'rejected';
    } else {
      // Votação ainda aberta — não decide
      return {
        status: proposal.status,
        votesFor,
        votesAgainst,
        totalVoters: totalVoters || 0,
        quorumMet: false,
        message: 'Quórum não atingido — votação ainda aberta',
      };
    }
  } else {
    newStatus = votesFor > votesAgainst ? 'approved' : 'rejected';
  }

  // Atualizar status
  await sb()
    .from('governance_proposals')
    .update({ status: newStatus })
    .eq('id', proposalId);

  log('tallyVotes', `Resultado: ${newStatus}`, { proposalId, votesFor, votesAgainst, totalVoters });

  return {
    status: newStatus,
    votesFor,
    votesAgainst,
    totalVoters: totalVoters || 0,
    quorumMet,
  };
}

// ──────────────────────────────────────────────────────
// 5. executeProposal (admin-only)
// ──────────────────────────────────────────────────────

/**
 * Executa uma proposta aprovada. Apenas admin.
 *
 * @param {string} proposalId
 * @param {string} adminUserId
 * @returns {Object} updated proposal
 */
async function executeProposal(proposalId, adminUserId) {
  log('executeProposal', 'Executando proposta aprovada', { proposalId, adminUserId });

  const { data: proposal, error: fetchErr } = await sb()
    .from('governance_proposals')
    .select('*')
    .eq('id', proposalId)
    .single();

  if (fetchErr || !proposal) {
    const err = new Error('Proposta não encontrada');
    err.statusCode = 404;
    throw err;
  }

  if (proposal.status !== 'approved') {
    const err = new Error(`Proposta não está aprovada — status: ${proposal.status}`);
    err.statusCode = 400;
    throw err;
  }

  // Marcar como executada
  const { data, error } = await sb()
    .from('governance_proposals')
    .update({
      status:      'executed',
      executed_at: new Date().toISOString(),
      execution_data: {
        ...proposal.execution_data,
        executed_by: adminUserId,
        executed_at: new Date().toISOString(),
      },
    })
    .eq('id', proposalId)
    .select()
    .single();

  if (error) {
    logError('executeProposal', error, { proposalId });
    throw error;
  }

  // Registrar transação no tesouro se for fund_allocation ou burn_event
  if (['fund_allocation', 'burn_event'].includes(proposal.proposal_type)) {
    const txType = proposal.proposal_type === 'burn_event' ? 'burn' : 'proposal_execution';
    await recordTreasuryTransaction(
      txType,
      proposal.execution_data?.amount || 0,
      `Execução de proposta: ${proposal.title}`,
      proposalId,
      { proposal_type: proposal.proposal_type, admin: adminUserId }
    ).catch(err => logError('executeProposal', err, { context: 'treasury_record' }));
  }

  log('executeProposal', 'Proposta executada', { proposalId });
  return data;
}

// ──────────────────────────────────────────────────────
// 6. getProposal
// ──────────────────────────────────────────────────────

/**
 * Retorna uma proposta com detalhes de votos.
 *
 * @param {string} proposalId
 * @returns {Object} proposal with votes
 */
async function getProposal(proposalId) {
  const { data: proposal, error } = await sb()
    .from('governance_proposals')
    .select(`
      *,
      proposer:users!governance_proposals_proposer_id_fkey(full_name, username, avatar_url)
    `)
    .eq('id', proposalId)
    .single();

  if (error || !proposal) {
    const err = new Error('Proposta não encontrada');
    err.statusCode = 404;
    throw err;
  }

  // Buscar votos
  const { data: votes } = await sb()
    .from('governance_votes')
    .select(`
      id, vote, voting_power, reason, created_at,
      voter:users!governance_votes_voter_id_fkey(full_name, username, avatar_url)
    `)
    .eq('proposal_id', proposalId)
    .order('created_at', { ascending: false });

  // Calcular tempo restante
  let timeRemaining = null;
  if (proposal.status === 'open' && proposal.voting_ends_at) {
    const diff = new Date(proposal.voting_ends_at).getTime() - Date.now();
    timeRemaining = diff > 0 ? diff : 0;
  }

  return {
    ...proposal,
    votes: votes || [],
    totalVoters: (votes || []).length,
    timeRemaining,
  };
}

// ──────────────────────────────────────────────────────
// 7. listProposals
// ──────────────────────────────────────────────────────

/**
 * Lista propostas paginadas, com filtro opcional por status.
 *
 * @param {Object} params
 * @param {string} [params.status]
 * @param {number} [params.page=1]
 * @param {number} [params.limit=10]
 * @returns {Object} { proposals, total, page, hasMore }
 */
async function listProposals({ status, page = 1, limit = 10 } = {}) {
  const offset = (page - 1) * limit;

  let query = sb()
    .from('governance_proposals')
    .select(`
      id, title, proposal_type, status, votes_for, votes_against,
      quorum_required, voting_starts_at, voting_ends_at, created_at,
      proposer:users!governance_proposals_proposer_id_fkey(full_name, username, avatar_url)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error, count } = await query;

  if (error) {
    logError('listProposals', error);
    throw error;
  }

  const total = count ?? 0;

  return {
    proposals: data || [],
    total,
    page,
    hasMore: offset + (data || []).length < total,
  };
}

// ──────────────────────────────────────────────────────
// 8. getTreasuryStats
// ──────────────────────────────────────────────────────

/**
 * Retorna estatísticas da tesouraria comunitária.
 *
 * @returns {Object} { totalSocialFund, totalBurned, totalGrants, totalExecutions, circulationEstimate }
 */
async function getTreasuryStats() {
  const { data: transactions, error } = await sb()
    .from('treasury_transactions')
    .select('transaction_type, amount');

  if (error) {
    logError('getTreasuryStats', error);
    throw error;
  }

  const stats = {
    totalSocialFund: 0,
    totalBurned: 0,
    totalGrants: 0,
    totalExecutions: 0,
  };

  for (const tx of transactions || []) {
    switch (tx.transaction_type) {
      case 'social_fund_deposit':
        stats.totalSocialFund += tx.amount;
        break;
      case 'burn':
        stats.totalBurned += tx.amount;
        break;
      case 'community_grant':
        stats.totalGrants += tx.amount;
        break;
      case 'proposal_execution':
        stats.totalExecutions += tx.amount;
        break;
    }
  }

  // Estimar circulação: total de coins no sistema (soma de todos elo_coins dos usuários)
  const { data: circulationData } = await sb()
    .from('user_gamification')
    .select('elo_coins');

  stats.circulationEstimate = (circulationData || []).reduce((sum, row) => sum + (row.elo_coins || 0), 0);

  return stats;
}

// ──────────────────────────────────────────────────────
// 9. recordTreasuryTransaction
// ──────────────────────────────────────────────────────

/**
 * Registra uma transação no ledger da tesouraria (append-only).
 *
 * @param {string} type — social_fund_deposit|burn|community_grant|proposal_execution
 * @param {number} amount
 * @param {string} description
 * @param {string} [referenceId]
 * @param {Object} [metadata={}]
 * @returns {Object} transaction record
 */
async function recordTreasuryTransaction(type, amount, description, referenceId, metadata = {}) {
  log('recordTreasuryTransaction', 'Registrando transação no tesouro', { type, amount });

  const { data, error } = await sb()
    .from('treasury_transactions')
    .insert({
      transaction_type: type,
      amount,
      description,
      reference_id:     referenceId || null,
      metadata,
    })
    .select()
    .single();

  if (error) {
    logError('recordTreasuryTransaction', error, { type, amount });
    throw error;
  }

  log('recordTreasuryTransaction', 'Transação registrada', { txId: data.id });
  return data;
}

module.exports = {
  createProposal,
  openProposal,
  castVote,
  tallyVotes,
  executeProposal,
  getProposal,
  listProposals,
  getTreasuryStats,
  recordTreasuryTransaction,
};
