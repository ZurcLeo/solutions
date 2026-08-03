/**
 * @fileoverview Magic Link Service — Login por link enviado por email (15min)
 * Ticket: AUTH-PL-002
 *
 * Gera token aleatório (base64url 32 bytes), armazena hash SHA-256 no banco,
 * envia link clicável por email via emailService.sendMagicLink, valida com lookup.
 */

'use strict';

const crypto = require('crypto');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');
const emailService = require('./emailService');

const CTRL = 'magicLinkService';

const TOKEN_TTL_MINUTES = 15;

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

/**
 * Gera token aleatório base64url (44 chars, URL-safe).
 * @returns {string}
 */
function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Hash do token com SHA-256.
 * @param {string} token
 * @returns {string} hex hash
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Gera e envia magic link por email.
 *
 * @param {string} email - Email do usuário
 * @param {Object} [options]
 * @param {string} [options.ip] - IP do request (para auditoria)
 * @param {string} [options.userAgent] - User-Agent (para auditoria)
 * @returns {{ success: boolean, expiresAt?: string, error?: string }}
 */
async function sendMagicLink(email, options = {}) {
  const fn = `${CTRL}.sendMagicLink`;

  const normalizedEmail = email.toLowerCase().trim();

  // 1. Verificar lockout
  const lockout = await checkLockout(normalizedEmail);
  if (lockout.is_locked) {
    logger.warn(`[${fn}] Email locked out`, { email: normalizedEmail, until: lockout.locked_until });
    return { success: false, error: 'account_locked', locked_until: lockout.locked_until };
  }

  // 2. Resolver usuário por email
  const { data: user } = await sb()
    .from('users')
    .select('id, email, nome')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (!user) {
    // Não revelar se email existe — simular sucesso
    logger.info(`[${fn}] Email not found, returning fake success`, { email: normalizedEmail });
    return { success: true, expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60000).toISOString() };
  }

  // 3. Invalidar links anteriores pendentes
  await sb()
    .from('user_magic_links')
    .update({ used_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('used_at', null);

  // 4. Gerar e armazenar novo token
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60000);

  const { error: insertErr } = await sb()
    .from('user_magic_links')
    .insert({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
      ip_address: options.ip || null,
      user_agent: options.userAgent || null,
    });

  if (insertErr) {
    logger.error(`[${fn}] Failed to insert magic link`, { error: insertErr.message });
    return { success: false, error: 'internal_error' };
  }

  // 5. Construir URL do magic link
  const baseUrl = process.env.FRONTEND_URL || 'https://app.eloscloud.com';
  const magicLinkUrl = `${baseUrl}/auth/magic-link?token=${encodeURIComponent(token)}`;

  // 6. Enviar por email
  const emailResult = await emailService.sendMagicLink({
    to: user.email,
    userName: user.nome || 'usuário',
    magicLinkUrl,
    expiresInMinutes: TOKEN_TTL_MINUTES,
  });

  if (!emailResult.success) {
    logger.error(`[${fn}] Failed to send email`, { error: emailResult.error });
    return { success: false, error: emailResult.error };
  }

  logger.info(`[${fn}] Magic link sent`, { userId: user.id });
  return { success: true, expiresAt: expiresAt.toISOString() };
}

/**
 * Verifica magic link token e retorna userId se válido.
 *
 * @param {string} token - Token do magic link
 * @returns {{ success: boolean, userId?: string, email?: string, error?: string }}
 */
async function verifyMagicLink(token) {
  const fn = `${CTRL}.verifyMagicLink`;

  const tokenHash = hashToken(token);

  // 1. Buscar link ativo por hash (não usado, não expirado)
  const { data: link } = await sb()
    .from('user_magic_links')
    .select('id, user_id, expires_at')
    .eq('token_hash', tokenHash)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (!link) {
    logger.warn(`[${fn}] Invalid or expired magic link`);
    return { success: false, error: 'invalid_or_expired_link' };
  }

  // 2. Resolver email do usuário (para lockout check)
  const { data: user } = await sb()
    .from('users')
    .select('id, email')
    .eq('id', link.user_id)
    .maybeSingle();

  if (!user) {
    return { success: false, error: 'user_not_found' };
  }

  // 3. Verificar lockout
  const lockout = await checkLockout(user.email);
  if (lockout.is_locked) {
    return { success: false, error: 'account_locked', locked_until: lockout.locked_until };
  }

  // 4. Marcar como usado
  await sb()
    .from('user_magic_links')
    .update({ used_at: new Date().toISOString() })
    .eq('id', link.id);

  // 5. Registrar sucesso
  await recordAttempt(user.email, 'magic_link', true);

  logger.info(`[${fn}] Magic link verified`, { userId: user.id });
  return { success: true, userId: user.id, email: user.email };
}

// ---------------------------------------------------------------------------
// Helpers: lockout + attempt logging (shared with accessCodeService)
// ---------------------------------------------------------------------------

async function checkLockout(email) {
  try {
    const { data } = await sb().rpc('check_login_lockout', { p_email: email });
    if (data && data.length > 0) return data[0];
    return { is_locked: false, failed_count: 0 };
  } catch {
    return { is_locked: false, failed_count: 0 };
  }
}

async function recordAttempt(email, method, success, req = null) {
  try {
    await sb()
      .from('auth_login_attempts')
      .insert({
        email: email.toLowerCase().trim(),
        method,
        success,
        ip_address: req?.ip || null,
        user_agent: req?.headers?.['user-agent'] || null,
      });
  } catch (err) {
    logger.warn('Failed to record login attempt', { error: err.message });
  }
}

module.exports = {
  sendMagicLink,
  verifyMagicLink,
  checkLockout,
  recordAttempt,
};
