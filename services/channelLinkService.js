/**
 * @fileoverview Channel Link Service — vinculação WhatsApp ↔ ElosCloud
 *
 * 1:1 estrito: um phone ↔ uma conta. Vínculo novo revoga anteriores dos dois lados.
 * Usa RPC confirm_channel_link para transação atômica (Fix #3).
 */

'use strict';

const crypto = require('crypto');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const TAG = 'ChannelLinkService';
const DEFAULT_CHANNEL = 'whatsapp';
const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 min

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

// ── Phone utils ─────────────────────────────────────────────────────────────

function normalizePhoneE164(phone) {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  if (!/^\+\d{10,15}$/.test(cleaned)) {
    const err = new Error('invalid_phone_e164');
    err.statusCode = 400;
    throw err;
  }
  return cleaned;
}

function maskPhone(phone) {
  // +5522999223696 → +55 (22) 9****-3696
  const m = phone.match(/^\+(\d{2})(\d{2})(\d)(\d*)(\d{4})$/);
  if (!m) return phone.replace(/\d(?=\d{4})/g, '*');
  return `+${m[1]} (${m[2]}) ${m[3]}${'*'.repeat(m[4].length)}-${m[5]}`;
}

// ── 1. lookupByPhone ────────────────────────────────────────────────────────

async function lookupByPhone(channel, phone) {
  const normalized = normalizePhoneE164(phone);

  const { data, error } = await sb()
    .from('user_channel_links')
    .select('user_id, verified_at')
    .eq('channel', channel)
    .eq('phone', normalized)
    .eq('status', 'verified')
    .maybeSingle();

  if (error) {
    logger.error(`[${TAG}] lookupByPhone error`, { error: error.message });
    throw error;
  }

  if (!data) {
    return { status: 'none' };
  }

  // Buscar display name
  const { data: user } = await sb()
    .from('users')
    .select('full_name')
    .eq('id', data.user_id)
    .maybeSingle();

  return {
    status: 'verified',
    userId: data.user_id,
    displayName: user?.full_name?.split(' ')[0] || null,
    linkedAt: data.verified_at,
  };
}

// ── 2. initLink ─────────────────────────────────────────────────────────────

async function initLink(phone, conversationId) {
  const normalized = normalizePhoneE164(phone);

  // Revogar pendings anteriores desse phone
  await sb()
    .from('user_channel_links')
    .update({ status: 'revoked', revoked_reason: 'replaced_by_new_link', updated_at: new Date().toISOString() })
    .eq('channel', DEFAULT_CHANNEL)
    .eq('phone', normalized)
    .eq('status', 'pending');

  // Gerar token
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  // user_id nullable: pending links não têm user (definido no confirm via RPC)
  const { data, error } = await sb()
    .from('user_channel_links')
    .insert({
      channel: DEFAULT_CHANNEL,
      phone: normalized,
      status: 'pending',
      link_token_hash: tokenHash,
      token_expires_at: expiresAt,
      conversation_id: conversationId,
    })
    .select('id')
    .single();

  if (error) {
    logger.error(`[${TAG}] initLink insert error`, { error: error.message, phone: normalized });
    throw error;
  }

  const baseUrl = process.env.FRONTEND_URL || 'https://eloscloud.com';
  const linkUrl = `${baseUrl}/vincular?t=${token}`;

  logger.info(`[${TAG}] Link criado`, { linkId: data.id, phone: normalized });

  return { linkUrl, expiresAt };
}

// ── 3. previewLink ──────────────────────────────────────────────────────────

async function previewLink(tokenHash, userId) {
  const { data, error } = await sb()
    .from('user_channel_links')
    .select('id, phone, token_expires_at')
    .eq('link_token_hash', tokenHash)
    .eq('status', 'pending')
    .gt('token_expires_at', new Date().toISOString())
    .maybeSingle();

  if (error) {
    logger.error(`[${TAG}] previewLink error`, { error: error.message });
    throw error;
  }

  if (!data) {
    return null; // token inválido ou expirado
  }

  const result = {
    phoneMasked: maskPhone(data.phone),
    expiresAt: data.token_expires_at,
  };

  // Se userId fornecido (sessão ativa), verificar links existentes
  if (userId) {
    const { data: existing } = await sb()
      .from('user_channel_links')
      .select('id')
      .eq('channel', DEFAULT_CHANNEL)
      .eq('status', 'verified')
      .or(`user_id.eq.${userId},phone.eq.${data.phone}`)
      .limit(1);

    result.hasExistingLink = (existing && existing.length > 0);
  }

  return result;
}

// ── 4. confirmLink ──────────────────────────────────────────────────────────

async function confirmLink(userId, tokenHash) {
  const { data, error } = await sb().rpc('confirm_channel_link', {
    p_token_hash: tokenHash,
    p_user_id: userId,
  });

  if (error) {
    if (error.message?.includes('invalid_or_expired_token')) {
      const err = new Error('invalid_or_expired_token');
      err.statusCode = 410;
      throw err;
    }
    logger.error(`[${TAG}] confirmLink RPC error`, { error: error.message, userId });
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    const err = new Error('invalid_or_expired_token');
    err.statusCode = 410;
    throw err;
  }

  logger.info(`[${TAG}] Link confirmado`, {
    linkId: row.out_link_id,
    userId,
    phone: row.out_phone,
    revokedCount: row.out_revoked_count,
  });

  return {
    linkId: row.out_link_id,
    phone: row.out_phone,
    conversationId: row.out_conversation_id,
    revokedCount: row.out_revoked_count,
  };
}

// ── 5. getUserLink ──────────────────────────────────────────────────────────

async function getUserLink(userId, channel = DEFAULT_CHANNEL) {
  const { data, error } = await sb()
    .from('user_channel_links')
    .select('id, channel, phone, verified_at')
    .eq('user_id', userId)
    .eq('channel', channel)
    .eq('status', 'verified')
    .maybeSingle();

  if (error) {
    logger.error(`[${TAG}] getUserLink error`, { error: error.message, userId });
    throw error;
  }

  if (!data) return null;

  return {
    id: data.id,
    channel: data.channel,
    phoneMasked: maskPhone(data.phone),
    linkedAt: data.verified_at,
  };
}

// ── 6. revokeByUser ─────────────────────────────────────────────────────────

async function revokeByUser(userId, channel = DEFAULT_CHANNEL) {
  const { data, error } = await sb()
    .from('user_channel_links')
    .update({
      status: 'revoked',
      revoked_reason: 'user_request',
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('channel', channel)
    .eq('status', 'verified')
    .select('id')
    .maybeSingle();

  if (error) {
    logger.error(`[${TAG}] revokeByUser error`, { error: error.message, userId });
    throw error;
  }

  if (!data) {
    const err = new Error('no_active_link');
    err.statusCode = 404;
    throw err;
  }

  logger.info(`[${TAG}] Link revogado pelo usuário`, { linkId: data.id, userId });
  return { revoked: true };
}

// ── 7. revokeByPhone (IconChat — D3) ────────────────────────────────────────

async function revokeByPhone(phone, conversationId, channel = DEFAULT_CHANNEL) {
  const normalized = normalizePhoneE164(phone);

  const { data, error } = await sb()
    .from('user_channel_links')
    .update({
      status: 'revoked',
      revoked_reason: 'icon_request',
      updated_at: new Date().toISOString(),
    })
    .eq('channel', channel)
    .eq('phone', normalized)
    .eq('status', 'verified')
    .select('id, user_id, conversation_id')
    .maybeSingle();

  if (error) {
    logger.error(`[${TAG}] revokeByPhone error`, { error: error.message, phone: normalized });
    throw error;
  }

  if (!data) {
    const err = new Error('no_active_link');
    err.statusCode = 404;
    throw err;
  }

  logger.info(`[${TAG}] Link revogado via IconChat`, {
    linkId: data.id,
    userId: data.user_id,
    phone: normalized,
    conversationId,
  });

  return {
    revoked: true,
    userId: data.user_id,
    conversationId: data.conversation_id,
  };
}

module.exports = {
  normalizePhoneE164,
  maskPhone,
  lookupByPhone,
  initLink,
  previewLink,
  confirmLink,
  getUserLink,
  revokeByUser,
  revokeByPhone,
};
