/**
 * @fileoverview waitlistService — Lista de espera com contact matching
 *
 * Privacy-by-design: nunca persiste telefone em texto claro.
 * Matching bidirecional via HMAC-SHA256 com WAITLIST_SALT.
 *
 * Momento 1: A entra na waitlist → verifica matches com membros ativos
 * Momento 2: B entra na plataforma → verifica matches com waitlist
 */

'use strict';

const crypto = require('crypto');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');
const { generateAndSendInvite } = require('./inviteService');
const NotificationDispatcher = require('./NotificationDispatcher');

const SERVICE = 'waitlistService';
const MAX_CONTACTS_PER_REQUEST = 1000;

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

/**
 * Normaliza telefone para formato padrão: só dígitos, com código do país.
 * Aceita qualquer formato: (21) 99999-1234, +55 21 99999 1234, etc.
 */
function normalizePhone(phone) {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (!digits.startsWith('55')) {
    digits = `55${digits}`;
  }
  return digits;
}

/**
 * Computa HMAC-SHA256 de um telefone normalizado com WAITLIST_SALT.
 */
function computePhoneHmac(phone) {
  const salt = process.env.WAITLIST_SALT;
  if (!salt) throw new Error('WAITLIST_SALT não configurado');
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return crypto.createHmac('sha256', salt).update(normalized).digest('hex');
}

/**
 * Computa HMAC para um array de telefones.
 */
function computePhoneHmacBatch(phones) {
  const salt = process.env.WAITLIST_SALT;
  if (!salt) throw new Error('WAITLIST_SALT não configurado');
  return phones
    .map(p => normalizePhone(p))
    .filter(Boolean)
    .map(n => crypto.createHmac('sha256', salt).update(n).digest('hex'));
}

// ──────────────────────────────────────────────────────
// Cadastro na lista de espera
// ──────────────────────────────────────────────────────

/**
 * Cadastra usuário na lista de espera.
 * @param {Object} data - { nome, email, phone?, referral_source? }
 * @returns {Object} registro da waitlist
 */
async function addToWaitlist(data) {
  const fn = 'addToWaitlist';
  const { nome, email, phone, referral_source } = data;

  try {
    const phoneHash = phone ? computePhoneHmac(phone) : null;

    const { data: record, error } = await sb()
      .from('waitlist')
      .insert({
        nome,
        email: email.toLowerCase().trim(),
        phone_hash: phoneHash,
        referral_source: referral_source || null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new Error('Este email já está na lista de espera');
      }
      logError(fn, error, { email });
      throw error;
    }

    log(fn, 'Usuário adicionado à lista de espera', {
      waitlistId: record.id, email, referral_source,
    });

    return record;

  } catch (err) {
    logError(fn, err, { email });
    throw err;
  }
}

// ──────────────────────────────────────────────────────
// Contact matching (Momento 1)
// ──────────────────────────────────────────────────────

/**
 * Recebe telefones da agenda de A, computa HMAC e verifica matches.
 * @param {string} waitlistId - ID do registro na waitlist
 * @param {string[]} phones - Array de telefones (texto claro, normalização interna)
 * @returns {Object} { matchCount }
 */
async function checkContacts(waitlistId, phones) {
  const fn = 'checkContacts';

  if (!phones || phones.length === 0) {
    return { matchCount: 0 };
  }

  if (phones.length > MAX_CONTACTS_PER_REQUEST) {
    throw new Error(`Máximo de ${MAX_CONTACTS_PER_REQUEST} contatos por vez`);
  }

  try {
    // Computa HMACs no servidor — nunca persiste telefone em texto claro
    const hashes = computePhoneHmacBatch(phones);

    if (hashes.length === 0) {
      return { matchCount: 0 };
    }

    // Chama RPC que salva hashes e verifica matches em uma operação
    const { data: matchCount, error } = await sb()
      .rpc('check_waitlist_contacts', {
        p_waitlist_id: waitlistId,
        p_hashes: hashes,
      });

    if (error) {
      logError(fn, error, { waitlistId, hashCount: hashes.length });
      throw error;
    }

    log(fn, 'Contact matching concluído', {
      waitlistId, contactsChecked: hashes.length, matchCount,
    });

    // Dispara notificações para cada B encontrado (fire-and-forget)
    if (matchCount > 0) {
      setImmediate(async () => {
        try {
          const { data: notifications } = await sb()
            .from('waitlist_match_notifications')
            .select('notified_user_id, waitlist_nome')
            .eq('waitlist_id', waitlistId)
            .eq('status', 'pending');

          for (const n of (notifications || [])) {
            NotificationDispatcher.dispatch({
              userId: n.notified_user_id,
              type: 'waitlist_match',
              importance: 'normal',
              data: {
                waitlistNome: n.waitlist_nome,
                url: '/configuracoes/convites',
              },
            });
          }
        } catch (dispatchErr) {
          logError(fn, dispatchErr, { waitlistId, step: 'dispatchNotifications' });
        }
      });
    }

    return { matchCount: matchCount || 0 };

  } catch (err) {
    logError(fn, err, { waitlistId });
    throw err;
  }
}

// ──────────────────────────────────────────────────────
// Matching reverso (Momento 2) — chamado pelo auth/invite flow
// ──────────────────────────────────────────────────────

/**
 * Registra o hash de telefone de um novo membro e verifica matches na waitlist.
 * Chamado durante o cadastro de telefone/KYC.
 * @param {string} userId - UID do novo membro
 * @param {string} phone - Telefone em texto claro
 * @returns {Object} { registered, matchCount }
 */
async function registerPhoneHash(userId, phone) {
  const fn = 'registerPhoneHash';

  try {
    const hash = computePhoneHmac(phone);
    if (!hash) throw new Error('Telefone inválido');

    // Upsert na tabela phone_hashes
    const { error: upsertErr } = await sb()
      .from('phone_hashes')
      .upsert({
        user_id: userId,
        hash,
        public_matching: true,
      }, { onConflict: 'user_id' });

    if (upsertErr) {
      logError(fn, upsertErr, { userId });
      throw upsertErr;
    }

    // Matching reverso: verifica se alguém na waitlist tem esse hash na agenda
    const { data: matchCount, error: rpcErr } = await sb()
      .rpc('check_waitlist_on_new_member', {
        p_user_id: userId,
        p_phone_hash: hash,
      });

    if (rpcErr) {
      logError(fn, rpcErr, { userId });
      // Não lança erro — o registro do hash já foi feito
      log(fn, 'Matching reverso falhou mas hash registrado', { userId });
      return { registered: true, matchCount: 0 };
    }

    if (matchCount > 0) {
      log(fn, 'Matches encontrados na waitlist para novo membro', {
        userId, matchCount,
      });

      // Notifica B (novo membro) sobre pessoas esperando por ele
      setImmediate(() => {
        NotificationDispatcher.dispatch({
          userId,
          type: 'waitlist_match',
          importance: 'normal',
          data: {
            matchCount,
            url: '/configuracoes/convites',
          },
        });
      });
    }

    return { registered: true, matchCount: matchCount || 0 };

  } catch (err) {
    logError(fn, err, { userId });
    throw err;
  }
}

// ──────────────────────────────────────────────────────
// Notificações de matching (para B)
// ──────────────────────────────────────────────────────

/**
 * Lista notificações pendentes de matching para um membro.
 * @param {string} userId - UID do membro
 * @returns {Array} notificações pendentes
 */
async function getMatchNotifications(userId) {
  const fn = 'getMatchNotifications';

  try {
    const { data: notifications, error } = await sb()
      .from('waitlist_match_notifications')
      .select('id, waitlist_nome, status, created_at, expires_at')
      .eq('notified_user_id', userId)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      logError(fn, error, { userId });
      throw error;
    }

    return notifications || [];

  } catch (err) {
    logError(fn, err, { userId });
    throw err;
  }
}

/**
 * B aceita convidar A — dispara o fluxo de convite.
 * @param {string} userId - UID de B (quem convida)
 * @param {string} notificationId - ID da notificação
 * @returns {Object} { waitlistId, waitlistEmail }
 */
async function acceptMatchInvite(userId, notificationId) {
  const fn = 'acceptMatchInvite';

  try {
    // Chama RPC que atualiza notificação e waitlist
    const { data: waitlistId, error } = await sb()
      .rpc('waitlist_invite_accepted', {
        p_notification_id: notificationId,
        p_inviter_user_id: userId,
      });

    if (error) {
      logError(fn, error, { userId, notificationId });
      throw error;
    }

    // Busca email de A para gerar o convite
    const { data: waitlistEntry, error: fetchErr } = await sb()
      .from('waitlist')
      .select('email, nome')
      .eq('id', waitlistId)
      .single();

    if (fetchErr) {
      logError(fn, fetchErr, { waitlistId });
      throw fetchErr;
    }

    log(fn, 'Match invite aceito — gerando convite', {
      inviterUserId: userId, waitlistId, waitlistEmail: waitlistEntry.email,
    });

    // Dispara o fluxo de convite real (email + QR code)
    let invite = null;
    try {
      invite = await generateAndSendInvite(
        userId,
        waitlistEntry.email,
        waitlistEntry.nome,
      );
      log(fn, 'Convite gerado com sucesso via waitlist match', {
        inviterUserId: userId, waitlistId, inviteId: invite.inviteId,
      });
    } catch (inviteErr) {
      // Não bloqueia — a notificação já foi marcada como 'invited'
      logError(fn, inviteErr, { userId, waitlistId, step: 'generateInvite' });
    }

    return {
      waitlistId,
      waitlistEmail: waitlistEntry.email,
      waitlistNome: waitlistEntry.nome,
      inviteId: invite?.inviteId || null,
    };

  } catch (err) {
    logError(fn, err, { userId, notificationId });
    throw err;
  }
}

/**
 * B rejeita convidar A.
 */
async function dismissMatchNotification(userId, notificationId) {
  const fn = 'dismissMatchNotification';

  try {
    const { error } = await sb()
      .from('waitlist_match_notifications')
      .update({ status: 'dismissed', responded_at: new Date().toISOString() })
      .eq('id', notificationId)
      .eq('notified_user_id', userId);

    if (error) {
      logError(fn, error, { userId, notificationId });
      throw error;
    }

    log(fn, 'Match notification dismissed', { userId, notificationId });
    return { dismissed: true };

  } catch (err) {
    logError(fn, err, { userId, notificationId });
    throw err;
  }
}

// ──────────────────────────────────────────────────────
// Opt-out de matching (privacidade)
// ──────────────────────────────────────────────────────

/**
 * Retorna preferência de matching do membro.
 */
async function getMatchingPreference(userId) {
  const fn = 'getMatchingPreference';

  try {
    const { data, error } = await sb()
      .from('phone_hashes')
      .select('public_matching')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      logError(fn, error, { userId });
      throw error;
    }

    // Se não tem registro, retorna true (padrão)
    return { publicMatching: data?.public_matching ?? true };

  } catch (err) {
    logError(fn, err, { userId });
    throw err;
  }
}

/**
 * Atualiza preferência de matching do membro.
 */
async function updateMatchingPreference(userId, publicMatching) {
  const fn = 'updateMatchingPreference';

  try {
    const { error } = await sb()
      .from('phone_hashes')
      .update({ public_matching: publicMatching })
      .eq('user_id', userId);

    if (error) {
      logError(fn, error, { userId });
      throw error;
    }

    log(fn, `Matching preference updated to ${publicMatching}`, { userId });
    return { publicMatching };

  } catch (err) {
    logError(fn, err, { userId });
    throw err;
  }
}

// ──────────────────────────────────────────────────────
// Status da waitlist (admin)
// ──────────────────────────────────────────────────────

/**
 * Retorna status de um email na waitlist (para verificação).
 */
async function getWaitlistStatus(email) {
  const fn = 'getWaitlistStatus';

  try {
    const { data, error } = await sb()
      .from('waitlist')
      .select('id, nome, status, created_at, notified_at, invited_at')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (error && error.code !== 'PGRST116') {
      logError(fn, error, { email });
      throw error;
    }

    return data || null;

  } catch (err) {
    logError(fn, err, { email });
    throw err;
  }
}

// ──────────────────────────────────────────────────────
// Marca waitlist entry como "joined" quando A finalmente entra
// ──────────────────────────────────────────────────────

/**
 * Chamado quando um usuário que estava na waitlist conclui o registro.
 */
async function markAsJoined(email) {
  const fn = 'markAsJoined';

  try {
    const { error } = await sb()
      .from('waitlist')
      .update({ status: 'joined' })
      .eq('email', email.toLowerCase().trim())
      .in('status', ['waiting', 'notified', 'invited']);

    if (error) {
      logError(fn, error, { email });
      // Não lança erro — é fire-and-forget
    }

    log(fn, 'Waitlist entry marked as joined', { email });

  } catch (err) {
    logError(fn, err, { email });
    // Silencioso — não bloqueia o registro
  }
}

// ──────────────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────────────

module.exports = {
  addToWaitlist,
  checkContacts,
  registerPhoneHash,
  getMatchNotifications,
  acceptMatchInvite,
  dismissMatchNotification,
  getMatchingPreference,
  updateMatchingPreference,
  getWaitlistStatus,
  markAsJoined,
};
