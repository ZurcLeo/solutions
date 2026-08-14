/**
 * @fileoverview sellerTeamService — ElosCloud Seller Team Members
 * Gerencia sub-usuários (equipe) de lojas no Mercado Local.
 * Roles: owner(3) > manager(2) > employee(1)
 *
 * Delegações externas:
 *   - game-agent     → gamificationService.triggerEvent
 *   - email-agent    → NotificationDispatcher (convite)
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger }            = require('../logger');
const gamificationService   = require('./gamificationService');
const notificationDispatcher = require('./NotificationDispatcher');

const SERVICE = 'sellerTeamService';

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

const ROLE_LEVEL = { owner: 3, manager: 2, employee: 1, removed: 0 };

const DEFAULT_PERMISSIONS = {
  owner: {
    can_manage_clients: true, can_manage_pendencias: true, can_view_financials: true, can_manage_team: true,
    can_manage_catalog: true, can_manage_orders: true, can_manage_settings: true, can_manage_billing: true,
  },
  manager: {
    can_manage_clients: true, can_manage_pendencias: true, can_view_financials: true, can_manage_team: false,
    can_manage_catalog: true, can_manage_orders: true, can_manage_settings: false, can_manage_billing: false,
  },
  employee: {
    can_manage_clients: false, can_manage_pendencias: true, can_view_financials: false, can_manage_team: false,
    can_manage_catalog: false, can_manage_orders: true, can_manage_settings: false, can_manage_billing: false,
  },
};

const SAFE_COLS = 'id, seller_id, user_id, role, status, active, invited_by, validation_status, validated_at, joined_at, permissions, created_at, updated_at';

// ──────────────────────────────────────────────────────
// Core functions
// ──────────────────────────────────────────────────────

/**
 * Seed owner — chamado automaticamente ao criar seller_profile.
 * Idempotente (ON CONFLICT DO NOTHING no banco, aqui faz check primeiro).
 */
async function seedOwner(sellerId, userId) {
  log('seedOwner', 'Seeding owner como team member', { sellerId, userId });

  const { data: existing } = await sb()
    .from('seller_team_members')
    .select('id')
    .eq('seller_id', sellerId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) {
    log('seedOwner', 'Owner já existe como team member', { sellerId, userId });
    return existing;
  }

  const { data, error } = await sb()
    .from('seller_team_members')
    .insert({
      seller_id:         sellerId,
      user_id:           userId,
      role:              'owner',
      status:            'active',
      active:            true,
      invited_by:        userId,
      validation_status: 'validated',
      validated_at:      new Date().toISOString(),
      joined_at:         new Date().toISOString(),
      permissions:       DEFAULT_PERMISSIONS.owner,
    })
    .select(SAFE_COLS)
    .single();

  if (error) throw new Error(`Erro ao seed owner: ${error.message}`);
  return data;
}

/**
 * Convida membro para a equipe. Requer role >= manager do caller.
 * Se o usuário não está registrado na plataforma, cria um business_invite
 * como porta de entrada (D6) — o convidado recebe email e pode se registrar.
 */
async function inviteMember(sellerId, callerUserId, targetEmail, role = 'employee', permissions = null, targetName = null) {
  log('inviteMember', 'Convidando membro', { sellerId, callerUserId, targetEmail, role });

  if (role === 'owner') throw new Error('Não é possível convidar como owner');
  if (!['manager', 'employee'].includes(role)) throw new Error('Role inválida');

  // Verificar nível do caller
  const callerLevel = await getMemberRoleLevel(sellerId, callerUserId);
  if (callerLevel < ROLE_LEVEL.manager) {
    throw new Error('Permissão insuficiente — requer role manager ou superior');
  }

  // Não pode convidar alguém com role >= a sua
  if (ROLE_LEVEL[role] >= callerLevel) {
    throw new Error('Não é possível convidar alguém com role igual ou superior à sua');
  }

  // Buscar user pelo email
  const { data: targetUser } = await sb()
    .from('users')
    .select('id, full_name, email')
    .eq('email', targetEmail.toLowerCase())
    .maybeSingle();

  // ── Usuário NÃO registrado → criar business_invite (porta de entrada D6) ──
  if (!targetUser) {
    log('inviteMember', 'Usuário não registrado, criando business invite', { targetEmail });

    // Verificar convite pendente duplicado
    const { data: existingInvite } = await sb()
      .from('business_invites')
      .select('id, status')
      .eq('seller_id', sellerId)
      .eq('target_email', targetEmail.toLowerCase())
      .eq('status', 'pending')
      .maybeSingle();

    if (existingInvite) {
      throw new Error('Já existe um convite pendente para este email.');
    }

    const finalPerms = permissions || DEFAULT_PERMISSIONS[role] || {};

    const { data: invite, error: invErr } = await sb()
      .from('business_invites')
      .insert({
        seller_id:            sellerId,
        invited_by:           callerUserId,
        target_email:         targetEmail.toLowerCase(),
        proposed_role:        role,
        proposed_permissions: finalPerms,
      })
      .select('*')
      .single();

    if (invErr) throw new Error(`Erro ao criar convite: ${invErr.message}`);

    // Buscar nome da loja para notificação
    const { data: seller } = await sb()
      .from('seller_profiles')
      .select('business_name')
      .eq('id', sellerId)
      .single();

    // TODO: enviar email de convite para usuário não registrado
    log('inviteMember', 'Business invite criado para usuário não registrado', {
      sellerId, inviteId: invite.id, targetEmail,
    });

    return {
      ...invite,
      registered: false,
      invite_type: 'business_invite',
      seller_name: seller?.business_name || 'Loja',
      target_name: targetName,
    };
  }

  // Verificar se já é membro
  const { data: existing } = await sb()
    .from('seller_team_members')
    .select('id, status')
    .eq('seller_id', sellerId)
    .eq('user_id', targetUser.id)
    .maybeSingle();

  if (existing && existing.status === 'active') {
    throw new Error('Usuário já é membro ativo desta equipe');
  }

  const finalPerms = permissions || DEFAULT_PERMISSIONS[role] || {};

  // Upsert: se existia como removed/inactive, re-convida
  const memberData = {
    seller_id:         sellerId,
    user_id:           targetUser.id,
    role,
    status:            'pending',
    active:            false,
    invited_by:        callerUserId,
    validation_status: 'pending',
    permissions:       finalPerms,
  };

  let member;
  if (existing) {
    const { data, error } = await sb()
      .from('seller_team_members')
      .update(memberData)
      .eq('id', existing.id)
      .select(SAFE_COLS)
      .single();
    if (error) throw new Error(`Erro ao re-convidar: ${error.message}`);
    member = data;
  } else {
    const { data, error } = await sb()
      .from('seller_team_members')
      .insert(memberData)
      .select(SAFE_COLS)
      .single();
    if (error) throw new Error(`Erro ao convidar: ${error.message}`);
    member = data;
  }

  // Buscar nome da loja para notificação
  const { data: seller } = await sb()
    .from('seller_profiles')
    .select('business_name')
    .eq('id', sellerId)
    .single();

  // Notificação de convite (fire-and-forget)
  notificationDispatcher.dispatch({
    userId: targetUser.id,
    type: 'seller_team_invite',
    data: {
      sellerName: seller?.business_name || 'Loja',
      sellerId,
      inviterName: callerUserId,
      role,
      url: `/mercado/vendedor`,
    },
  }).catch(err => logError('inviteMember', err, { context: 'notification' }));

  log('inviteMember', 'Convite enviado', { sellerId, memberId: member.id });
  return { ...member, registered: true };
}

/**
 * Aceitar convite — o próprio usuário aceita.
 */
async function acceptInvite(sellerId, userId) {
  log('acceptInvite', 'Aceitando convite', { sellerId, userId });

  const { data: member, error: findErr } = await sb()
    .from('seller_team_members')
    .select(SAFE_COLS)
    .eq('seller_id', sellerId)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .maybeSingle();

  if (findErr || !member) throw new Error('Convite não encontrado ou já aceito');

  const { data, error } = await sb()
    .from('seller_team_members')
    .update({
      status:            'active',
      active:            true,
      validation_status: 'validated',
      validated_at:      new Date().toISOString(),
      joined_at:         new Date().toISOString(),
    })
    .eq('id', member.id)
    .select(SAFE_COLS)
    .single();

  if (error) throw new Error(`Erro ao aceitar convite: ${error.message}`);

  // Gamification: team_member_joined
  gamificationService.triggerEvent('team_member_joined', userId, { seller_id: sellerId })
    .catch(err => logError('acceptInvite', err, { context: 'gamification' }));

  // Notificar owner se seats excederam o incluído no plano
  _notifySeatCostIfNeeded(sellerId)
    .catch(err => logError('acceptInvite', err, { context: 'seat_cost_notification' }));

  return data;
}

/**
 * Retorna as atribuições de service_availability de um membro da equipe,
 * com nome do serviço. Usado pelo frontend para avisar antes da remoção.
 */
async function getMemberAssignments(sellerId, targetUserId) {
  log('getMemberAssignments', 'Consultando atribuições', { sellerId, targetUserId });

  // Encontrar o team member record
  const { data: member } = await sb()
    .from('seller_team_members')
    .select('id')
    .eq('seller_id', sellerId)
    .eq('user_id', targetUserId)
    .eq('status', 'active')
    .maybeSingle();

  if (!member) return [];

  const { data, error } = await sb()
    .from('service_availability')
    .select('id, service_id, day_of_week, start_time, end_time')
    .eq('assigned_member_id', member.id)
    .eq('active', true);

  if (error) {
    logError('getMemberAssignments', error);
    return [];
  }

  if (!data || data.length === 0) return [];

  // Enriquecer com nomes dos serviços
  const serviceIds = [...new Set(data.map(a => a.service_id))];
  const { data: products } = await sb()
    .from('marketplace_products')
    .select('id, name')
    .in('id', serviceIds);

  const nameMap = (products || []).reduce((m, p) => { m[p.id] = p.name; return m; }, {});

  return data.map(a => ({
    ...a,
    service_name: nameMap[a.service_id] || 'Serviço',
  }));
}

/**
 * Remove membro da equipe. Owner pode remover qualquer um. Manager pode remover employee.
 * Se reassignTo for fornecido, reatribui as atribuições de disponibilidade ao novo membro.
 */
async function removeMember(sellerId, callerUserId, targetUserId, reassignTo = null) {
  log('removeMember', 'Removendo membro', { sellerId, callerUserId, targetUserId, reassignTo });

  if (callerUserId === targetUserId) throw new Error('Não é possível remover a si mesmo');

  const callerLevel = await getMemberRoleLevel(sellerId, callerUserId);
  const targetLevel = await getMemberRoleLevel(sellerId, targetUserId);

  if (callerLevel <= targetLevel) {
    throw new Error('Não é possível remover membro com role igual ou superior à sua');
  }

  const { data: member, error: findErr } = await sb()
    .from('seller_team_members')
    .select('id')
    .eq('seller_id', sellerId)
    .eq('user_id', targetUserId)
    .eq('status', 'active')
    .neq('role', 'owner')
    .maybeSingle();

  if (findErr || !member) throw new Error('Membro não encontrado ou não pode ser removido');

  const { data, error } = await sb()
    .from('seller_team_members')
    .update({
      status: 'removed',
      active: false,
      role:   'removed',
    })
    .eq('id', member.id)
    .select(SAFE_COLS)
    .single();

  if (error) throw new Error(`Erro ao remover membro: ${error.message}`);

  // [SCHED-TEAM] Reatribuir ou limpar atribuições de disponibilidade do membro removido.
  if (reassignTo) {
    // Encontrar o team member record do substituto
    const { data: replacementMember } = await sb()
      .from('seller_team_members')
      .select('id')
      .eq('seller_id', sellerId)
      .eq('user_id', reassignTo)
      .eq('status', 'active')
      .maybeSingle();

    const newMemberId = replacementMember?.id || null;
    await sb()
      .from('service_availability')
      .update({ assigned_member_id: newMemberId })
      .eq('assigned_member_id', member.id)
      .then(({ error: reassignErr }) => {
        if (reassignErr) logError('removeMember', reassignErr, { context: 'reassign_availability' });
        else log('removeMember', 'Atribuições reatribuídas', { from: member.id, to: newMemberId });
      });
  } else {
    await sb()
      .from('service_availability')
      .update({ assigned_member_id: null })
      .eq('assigned_member_id', member.id)
      .then(({ error: clearErr }) => {
        if (clearErr) logError('removeMember', clearErr, { context: 'clear_availability_assignments' });
        else log('removeMember', 'Atribuições de disponibilidade limpas', { memberId: member.id });
      });
  }

  // [EQP-024] Notificar membro removido
  const { data: seller } = await sb()
    .from('seller_profiles')
    .select('business_name, trading_name')
    .eq('id', sellerId)
    .maybeSingle();

  notificationDispatcher.dispatch('team_member_removed', targetUserId, {
    sellerId,
    businessName: seller?.trading_name || seller?.business_name || 'Negócio',
  }).catch(err => logError('removeMember', err, { context: 'notify_removed_member' }));

  return data;
}

/**
 * Atualiza role e/ou permissões de um membro. Requer role > target.
 */
async function updateMemberRole(sellerId, callerUserId, targetUserId, newRole, newPermissions) {
  log('updateMemberRole', 'Atualizando role', { sellerId, callerUserId, targetUserId, newRole });

  if (newRole === 'owner') throw new Error('Não é possível promover a owner');

  const callerLevel = await getMemberRoleLevel(sellerId, callerUserId);
  const targetLevel = await getMemberRoleLevel(sellerId, targetUserId);

  if (callerLevel <= targetLevel) {
    throw new Error('Não é possível alterar membro com role igual ou superior à sua');
  }

  if (newRole && ROLE_LEVEL[newRole] >= callerLevel) {
    throw new Error('Não é possível promover membro a role igual ou superior à sua');
  }

  const updateData = {};
  if (newRole) updateData.role = newRole;
  if (newPermissions) updateData.permissions = newPermissions;

  if (Object.keys(updateData).length === 0) {
    throw new Error('Nenhuma alteração fornecida');
  }

  const { data, error } = await sb()
    .from('seller_team_members')
    .update(updateData)
    .eq('seller_id', sellerId)
    .eq('user_id', targetUserId)
    .neq('role', 'owner')
    .select(SAFE_COLS)
    .single();

  if (error) throw new Error(`Erro ao atualizar role: ${error.message}`);
  return data;
}

/**
 * Lista membros da equipe (ativos e pending).
 */
async function listTeamMembers(sellerId) {
  log('listTeamMembers', 'Listando equipe', { sellerId });

  const { data, error } = await sb()
    .from('seller_team_members')
    .select(`
      ${SAFE_COLS},
      users:user_id (id, full_name, email, avatar_url)
    `)
    .eq('seller_id', sellerId)
    .in('status', ['active', 'pending'])
    .order('role', { ascending: false })
    .order('joined_at', { ascending: true });

  if (error) throw new Error(`Erro ao listar equipe: ${error.message}`);
  return data || [];
}

/**
 * Verifica se um user tem uma permissão específica no seller.
 */
async function checkPermission(sellerId, userId, permission) {
  const { data: member } = await sb()
    .from('seller_team_members')
    .select('role, permissions')
    .eq('seller_id', sellerId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('active', true)
    .maybeSingle();

  if (!member) return false;
  if (member.role === 'owner') return true;
  return member.permissions?.[permission] === true;
}

/**
 * Retorna as permissões padrão para um role.
 */
function defaultPermissionsFor(role) {
  return DEFAULT_PERMISSIONS[role] || {};
}

// ──────────────────────────────────────────────────────
// Helpers internos
// ──────────────────────────────────────────────────────

async function getMemberRoleLevel(sellerId, userId) {
  // Owner direto via seller_profiles
  const { data: seller } = await sb()
    .from('seller_profiles')
    .select('id')
    .eq('id', sellerId)
    .eq('user_id', userId)
    .maybeSingle();

  if (seller) return ROLE_LEVEL.owner;

  // Team member
  const { data: member } = await sb()
    .from('seller_team_members')
    .select('role')
    .eq('seller_id', sellerId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('active', true)
    .maybeSingle();

  return member ? (ROLE_LEVEL[member.role] || 0) : 0;
}

// ── Internal: notificar owner se seats ultrapassaram incluídos ───────────────
const SEATS_INCLUIDOS = 2;

async function _notifySeatCostIfNeeded(sellerId) {
  const { count } = await sb()
    .from('seller_team_members')
    .select('id', { count: 'exact', head: true })
    .eq('seller_id', sellerId)
    .eq('status', 'active');

  const seatsAtivos = count || 0;
  if (seatsAtivos <= SEATS_INCLUIDOS) return;

  // Busca owner
  const { data: seller } = await sb()
    .from('seller_profiles')
    .select('user_id, billing_mode, business_name')
    .eq('id', sellerId)
    .single();

  if (!seller || seller.billing_mode !== 'monthly') return;

  const custoSeats = (seatsAtivos - SEATS_INCLUIDOS) * 9.90;

  notificationDispatcher.dispatch('seller_seat_cost_changed', seller.user_id, {
    seats_ativos:  seatsAtivos,
    custo_seats:   custoSeats,
    sellerName:    seller.business_name,
  }).catch(err => logError('_notifySeatCostIfNeeded', err, { context: 'dispatch' }));
}

/**
 * Lista convites pendentes recebidos pelo usuário (cross-seller).
 * Retorna convites com dados da loja e do remetente.
 */
async function getMyPendingInvites(userId) {
  log('getMyPendingInvites', 'Listando convites pendentes do usuário', { userId });

  const { data, error } = await sb()
    .from('seller_team_members')
    .select(`
      ${SAFE_COLS},
      seller_profiles (
        id,
        business_name,
        category,
        user_id
      )
    `)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Erro ao listar convites: ${error.message}`);

  const invites = data || [];
  if (invites.length === 0) return [];

  // Enriquecer com dados do remetente
  const inviterIds = [...new Set(invites.map(i => i.invited_by).filter(Boolean))];
  const { data: inviters } = await sb()
    .from('users')
    .select('id, full_name, username, avatar_url')
    .in('id', inviterIds);

  const inviterMap = (inviters || []).reduce((m, u) => { m[u.id] = u; return m; }, {});

  return invites.map(invite => ({
    ...invite,
    inviter: inviterMap[invite.invited_by] || null,
  }));
}

/**
 * Recusa convite de equipe. O próprio convidado recusa.
 */
async function declineInvite(sellerId, userId) {
  log('declineInvite', 'Recusando convite', { sellerId, userId });

  const { data: invite } = await sb()
    .from('seller_team_members')
    .select('id, status')
    .eq('seller_id', sellerId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!invite) throw new Error('Convite não encontrado');
  if (invite.status !== 'pending') throw new Error('Convite já foi respondido');

  const { data, error } = await sb()
    .from('seller_team_members')
    .update({ status: 'removed', active: false, role: 'removed' })
    .eq('id', invite.id)
    .select(SAFE_COLS)
    .single();

  if (error) throw new Error(`Erro ao recusar convite: ${error.message}`);

  log('declineInvite', 'Convite recusado', { sellerId, userId });
  return data;
}

/**
 * [EQP-025] Membro sai voluntariamente da equipe. Owner não pode sair.
 */
async function leaveTeam(sellerId, userId) {
  log('leaveTeam', 'Membro saindo voluntariamente', { sellerId, userId });

  const { data: member, error: findErr } = await sb()
    .from('seller_team_members')
    .select('id, role')
    .eq('seller_id', sellerId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();

  if (findErr || !member) throw new Error('Você não é membro ativo desta equipe');
  if (member.role === 'owner') throw new Error('Owner não pode sair da própria equipe');

  const { data, error } = await sb()
    .from('seller_team_members')
    .update({ status: 'removed', active: false, role: 'removed' })
    .eq('id', member.id)
    .select(SAFE_COLS)
    .single();

  if (error) throw new Error(`Erro ao sair da equipe: ${error.message}`);

  // Limpar atribuições de disponibilidade
  await sb()
    .from('service_availability')
    .update({ assigned_member_id: null })
    .eq('assigned_member_id', member.id)
    .then(({ error: clearErr }) => {
      if (clearErr) logError('leaveTeam', clearErr, { context: 'clear_availability_assignments' });
    });

  // Notificar owner
  try {
    const { data: owner } = await sb()
      .from('seller_team_members')
      .select('user_id')
      .eq('seller_id', sellerId)
      .eq('role', 'owner')
      .eq('status', 'active')
      .maybeSingle();

    if (owner) {
      await notificationDispatcher.dispatch({
        type: 'team_member_left',
        userId: owner.user_id,
        data: { sellerId, leftUserId: userId },
      });
    }
  } catch (err) {
    logError('leaveTeam', err, { context: 'notify_owner' });
  }

  log('leaveTeam', 'Membro saiu com sucesso', { sellerId, userId });
  return data;
}

module.exports = {
  seedOwner,
  inviteMember,
  acceptInvite,
  declineInvite,
  removeMember,
  leaveTeam,
  updateMemberRole,
  listTeamMembers,
  getMyPendingInvites,
  getMemberAssignments,
  checkPermission,
  defaultPermissionsFor,
  ROLE_LEVEL,
};
