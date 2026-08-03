/**
 * @fileoverview businessInviteService — ElosCloud Business Invites
 * Convite combinado plataforma + equipe (BIZ-004).
 * Se o convidado não é usuário, gera token de registro (porta de entrada D6).
 *
 * Decisão D6: invited_by deve ter Trust Passport nível >= 2 para criar business_invites.
 *
 * Delegações externas:
 *   - trust-agent      → trustPassportService.getPassport (nível check)
 *   - marketplace-agent → sellerTeamService.inviteMember / acceptInvite
 *   - email-agent       → NotificationDispatcher (convite email)
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger }            = require('../logger');
const sellerTeamService     = require('./sellerTeamService');
const notificationDispatcher = require('./NotificationDispatcher');

const SERVICE = 'businessInviteService';

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

const MIN_TRUST_LEVEL_FOR_INVITE = 2;

// ──────────────────────────────────────────────────────
// Core functions
// ──────────────────────────────────────────────────────

/**
 * Cria business invite. Verifica Trust Level do invitador (D6: nível >= 2).
 * Se target_email já é usuário, vincula target_user_id.
 * Se não é usuário, gera invite_token para registro (porta de entrada).
 */
async function createBusinessInvite(sellerId, invitedByUserId, email, role = 'employee', permissions = null) {
  log('createBusinessInvite', 'Criando convite de negócio', { sellerId, invitedByUserId, email, role });

  if (!['manager', 'employee'].includes(role)) {
    throw new Error('Role inválida. Deve ser manager ou employee.');
  }

  // D6: Verificar Trust Passport nível >= 2
  const trustPassportService = require('./trustPassportService');
  let passport;
  try {
    passport = await trustPassportService.getPassport(invitedByUserId);
  } catch {
    passport = null;
  }

  const trustLevel = passport?.trust_level ?? 0;
  if (trustLevel < MIN_TRUST_LEVEL_FOR_INVITE) {
    throw new Error(
      `Para convidar membros via Business Invite, você precisa ter Trust Passport nível ${MIN_TRUST_LEVEL_FOR_INVITE} ou superior. ` +
      `Seu nível atual: ${trustLevel}.`
    );
  }

  // Verificar se email já tem convite pendente para este seller
  const { data: existingInvite } = await sb()
    .from('business_invites')
    .select('id, status')
    .eq('seller_id', sellerId)
    .eq('target_email', email.toLowerCase())
    .eq('status', 'pending')
    .maybeSingle();

  if (existingInvite) {
    throw new Error('Já existe um convite pendente para este email neste negócio.');
  }

  // Verificar se o email pertence a um usuário existente
  const { data: targetUser } = await sb()
    .from('users')
    .select('id, full_name, email')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  // Se usuário já existe, verificar se já é membro da equipe
  if (targetUser) {
    const { data: existingMember } = await sb()
      .from('seller_team_members')
      .select('id, status')
      .eq('seller_id', sellerId)
      .eq('user_id', targetUser.id)
      .maybeSingle();

    if (existingMember && existingMember.status === 'active') {
      throw new Error('Este usuário já é membro ativo desta equipe.');
    }
  }

  const finalPerms = permissions || sellerTeamService.defaultPermissionsFor(role);

  // Criar convite
  const { data: invite, error } = await sb()
    .from('business_invites')
    .insert({
      seller_id:             sellerId,
      invited_by:            invitedByUserId,
      target_email:          email.toLowerCase(),
      target_user_id:        targetUser?.id || null,
      proposed_role:         role,
      proposed_permissions:  finalPerms,
    })
    .select('*')
    .single();

  if (error) throw new Error(`Erro ao criar convite: ${error.message}`);

  // Se usuário existente, criar também o team member pendente (para compatibilidade)
  if (targetUser) {
    try {
      await sellerTeamService.inviteMember(sellerId, invitedByUserId, email.toLowerCase(), role, finalPerms);
    } catch (err) {
      // Se já existe como removed, o inviteMember faz upsert
      if (!err.message.includes('já é membro')) {
        logError('createBusinessInvite', err, { context: 'team_member_create' });
      }
    }
  }

  // Buscar nome da loja e do invitador para o email
  const [{ data: seller }, { data: inviter }] = await Promise.all([
    sb().from('seller_profiles').select('business_name').eq('id', sellerId).single(),
    sb().from('users').select('full_name').eq('id', invitedByUserId).single(),
  ]);

  // Enviar notificação/email
  const notifData = {
    sellerName:  seller?.business_name || 'Negócio',
    inviterName: inviter?.full_name || 'Um usuário',
    role,
    email: email.toLowerCase(),
  };

  if (targetUser) {
    // Usuário existente: notificação in-app + email
    notificationDispatcher.dispatch({
      userId: targetUser.id,
      type: 'business_invite_received',
      importance: 'high',
      data: {
        ...notifData,
        sellerId,
        url: '/mercado/vendedor',
      },
    }).catch(err => logError('createBusinessInvite', err, { context: 'notification' }));
  } else {
    // Novo usuário: enviar email com link de registro + token
    notificationDispatcher.dispatch({
      userId: invitedByUserId,
      recipientEmail: email.toLowerCase(),
      type: 'business_invite_new_user',
      importance: 'high',
      data: {
        ...notifData,
        inviteToken: invite.invite_token,
        registerUrl: `/registrar?business_invite=${invite.invite_token}`,
      },
    }).catch(err => logError('createBusinessInvite', err, { context: 'email_new_user' }));
  }

  log('createBusinessInvite', 'Convite criado', { inviteId: invite.id, hasExistingUser: !!targetUser });
  return invite;
}

/**
 * Aceita business invite via token. Funciona para usuários existentes.
 */
async function acceptBusinessInvite(inviteToken, userId) {
  log('acceptBusinessInvite', 'Aceitando convite', { userId });

  const { data: invite, error: findErr } = await sb()
    .from('business_invites')
    .select('*')
    .eq('invite_token', inviteToken)
    .eq('status', 'pending')
    .maybeSingle();

  if (findErr || !invite) throw new Error('Convite não encontrado ou já utilizado.');

  // Verificar expiração
  if (new Date(invite.expires_at) < new Date()) {
    await sb()
      .from('business_invites')
      .update({ status: 'expired' })
      .eq('id', invite.id);
    throw new Error('Este convite expirou.');
  }

  // Atualizar convite como aceito
  const { error: updateErr } = await sb()
    .from('business_invites')
    .update({
      status: 'accepted',
      target_user_id: userId,
      accepted_at: new Date().toISOString(),
    })
    .eq('id', invite.id);

  if (updateErr) throw new Error(`Erro ao aceitar convite: ${updateErr.message}`);

  // Criar/ativar team member via sellerTeamService
  const { data: existingMember } = await sb()
    .from('seller_team_members')
    .select('id, status')
    .eq('seller_id', invite.seller_id)
    .eq('user_id', userId)
    .maybeSingle();

  let member;
  if (existingMember && existingMember.status === 'pending') {
    member = await sellerTeamService.acceptInvite(invite.seller_id, userId);
  } else if (!existingMember) {
    // Criar e ativar diretamente (para novos usuários via registro)
    const { data: newMember, error: insErr } = await sb()
      .from('seller_team_members')
      .insert({
        seller_id:         invite.seller_id,
        user_id:           userId,
        role:              invite.proposed_role,
        status:            'active',
        active:            true,
        invited_by:        invite.invited_by,
        validation_status: 'validated',
        validated_at:      new Date().toISOString(),
        joined_at:         new Date().toISOString(),
        permissions:       invite.proposed_permissions,
      })
      .select('*')
      .single();

    if (insErr) throw new Error(`Erro ao criar membro: ${insErr.message}`);
    member = newMember;

    // Gamification
    const gamificationService = require('./gamificationService');
    gamificationService.triggerEvent('team_member_joined', userId, { seller_id: invite.seller_id })
      .catch(err => logError('acceptBusinessInvite', err, { context: 'gamification' }));
  }

  // Notificar owner do negócio
  const { data: seller } = await sb()
    .from('seller_profiles')
    .select('user_id, business_name')
    .eq('id', invite.seller_id)
    .single();

  const { data: acceptingUser } = await sb()
    .from('users')
    .select('full_name')
    .eq('id', userId)
    .single();

  if (seller) {
    notificationDispatcher.dispatch({
      userId: seller.user_id,
      type: 'business_invite_accepted',
      data: {
        memberName: acceptingUser?.full_name || 'Novo membro',
        sellerName: seller.business_name,
        role: invite.proposed_role,
      },
    }).catch(err => logError('acceptBusinessInvite', err, { context: 'notification' }));
  }

  log('acceptBusinessInvite', 'Convite aceito', { inviteId: invite.id, userId });
  return member;
}

/**
 * Processa convites pendentes após registro de novo usuário.
 * Chamado pelo authController.register() quando user se registra via business_invite token.
 * Auto-aceita convites pendentes vinculados ao email.
 */
async function processRegistrationInvites(email, userId) {
  log('processRegistrationInvites', 'Processando convites pós-registro', { email, userId });

  const { data: pendingInvites } = await sb()
    .from('business_invites')
    .select('*')
    .eq('target_email', email.toLowerCase())
    .eq('status', 'pending');

  if (!pendingInvites || pendingInvites.length === 0) {
    log('processRegistrationInvites', 'Nenhum convite pendente', { email });
    return [];
  }

  const results = [];
  for (const invite of pendingInvites) {
    // Verificar expiração
    if (new Date(invite.expires_at) < new Date()) {
      await sb()
        .from('business_invites')
        .update({ status: 'expired' })
        .eq('id', invite.id);
      continue;
    }

    try {
      // Atualizar convite
      await sb()
        .from('business_invites')
        .update({
          status: 'accepted',
          target_user_id: userId,
          accepted_at: new Date().toISOString(),
        })
        .eq('id', invite.id);

      // Criar team member ativo diretamente
      const { data: member, error: insErr } = await sb()
        .from('seller_team_members')
        .insert({
          seller_id:         invite.seller_id,
          user_id:           userId,
          role:              invite.proposed_role,
          status:            'active',
          active:            true,
          invited_by:        invite.invited_by,
          validation_status: 'validated',
          validated_at:      new Date().toISOString(),
          joined_at:         new Date().toISOString(),
          permissions:       invite.proposed_permissions,
        })
        .select('*')
        .single();

      if (insErr) {
        logError('processRegistrationInvites', insErr, { inviteId: invite.id });
        continue;
      }

      // Gamification
      const gamificationService = require('./gamificationService');
      gamificationService.triggerEvent('team_member_joined', userId, { seller_id: invite.seller_id })
        .catch(err => logError('processRegistrationInvites', err, { context: 'gamification' }));

      results.push(member);
    } catch (err) {
      logError('processRegistrationInvites', err, { inviteId: invite.id });
    }
  }

  log('processRegistrationInvites', `Processados ${results.length} convites`, { email, userId });
  return results;
}

/**
 * Lista convites pendentes de um seller.
 */
async function listBusinessInvites(sellerId) {
  log('listBusinessInvites', 'Listando convites', { sellerId });

  const { data, error } = await sb()
    .from('business_invites')
    .select('*')
    .eq('seller_id', sellerId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Erro ao listar convites: ${error.message}`);
  return data || [];
}

/**
 * Cancela um convite pendente.
 */
async function cancelBusinessInvite(inviteId, callerUserId) {
  log('cancelBusinessInvite', 'Cancelando convite', { inviteId, callerUserId });

  const { data: invite, error: findErr } = await sb()
    .from('business_invites')
    .select('id, status, seller_id')
    .eq('id', inviteId)
    .eq('status', 'pending')
    .maybeSingle();

  if (findErr || !invite) throw new Error('Convite não encontrado ou já utilizado.');

  const { error } = await sb()
    .from('business_invites')
    .update({ status: 'cancelled' })
    .eq('id', inviteId);

  if (error) throw new Error(`Erro ao cancelar convite: ${error.message}`);

  log('cancelBusinessInvite', 'Convite cancelado', { inviteId });
  return { id: inviteId, status: 'cancelled' };
}

/**
 * Busca convite por token (usado na landing page de registro).
 */
async function getInviteByToken(token) {
  const { data, error } = await sb()
    .from('business_invites')
    .select(`
      id, seller_id, target_email, proposed_role, status, expires_at, created_at,
      seller_profiles (business_name, category),
      users!business_invites_invited_by_fkey (full_name)
    `)
    .eq('invite_token', token)
    .eq('status', 'pending')
    .maybeSingle();

  if (error || !data) return null;

  // Check expiration
  if (new Date(data.expires_at) < new Date()) return null;

  return {
    id:            data.id,
    seller_id:     data.seller_id,
    business_name: data.seller_profiles?.business_name,
    category:      data.seller_profiles?.category,
    inviter_name:  data.users?.full_name,
    proposed_role: data.proposed_role,
    target_email:  data.target_email,
    expires_at:    data.expires_at,
  };
}

module.exports = {
  createBusinessInvite,
  acceptBusinessInvite,
  processRegistrationInvites,
  listBusinessInvites,
  cancelBusinessInvite,
  getInviteByToken,
};
