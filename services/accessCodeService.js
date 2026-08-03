/**
 * @fileoverview Access Code Service — Códigos de acesso temporários (8-char, 24h)
 * Ticket: AUTH-PL-002
 *
 * Gera códigos alfanuméricos 8-char (formato XXXX-XXXX), armazena hash SHA-256,
 * envia por email via emailService.sendOTP, valida com lookup + timing-safe compare.
 *
 * Sem bcrypt (não é dep do projeto). Usa SHA-256 + HMAC consistente com o codebase.
 */

'use strict';

const crypto = require('crypto');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');
const emailService = require('./emailService');

const CTRL = 'accessCodeService';

// Charset sem caracteres confusos (sem O/0, I/1, L)
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_TTL_HOURS = 24;

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

/**
 * Gera código alfanumérico aleatório de 8 chars.
 * @returns {string} Ex: "A7K2M9P4"
 */
function generateCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CHARSET[bytes[i] % CHARSET.length];
  }
  return code;
}

/**
 * Formata código com dash: "A7K2M9P4" → "A7K2-M9P4"
 */
function formatCode(code) {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Hash do código com SHA-256 + salt por userId (previne rainbow tables cross-user).
 */
function hashCode(code, userId) {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'access-code-secret')
    .update(`${code.toUpperCase()}:${userId}`)
    .digest('hex');
}

/**
 * Gera e envia código de acesso por email.
 *
 * @param {string} email - Email do usuário
 * @returns {{ success: boolean, expiresAt?: string, error?: string }}
 */
async function sendAccessCode(email) {
  const fn = `${CTRL}.sendAccessCode`;

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
    .select('id, email, full_name')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (!user) {
    // Não revelar se email existe — simular sucesso
    logger.info(`[${fn}] Email not found, returning fake success`, { email: normalizedEmail });
    return { success: true, expiresAt: new Date(Date.now() + CODE_TTL_HOURS * 3600000).toISOString() };
  }

  // 3. Invalidar códigos anteriores pendentes
  await sb()
    .from('user_access_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('used_at', null);

  // 4. Gerar e armazenar novo código
  const code = generateCode();
  const codeHash = hashCode(code, user.id);
  const expiresAt = new Date(Date.now() + CODE_TTL_HOURS * 3600000);

  const { error: insertErr } = await sb()
    .from('user_access_codes')
    .insert({
      user_id: user.id,
      code_hash: codeHash,
      expires_at: expiresAt.toISOString(),
    });

  if (insertErr) {
    logger.error(`[${fn}] Failed to insert access code`, { error: insertErr.message });
    return { success: false, error: 'internal_error' };
  }

  // 5. Enviar por email
  const formatted = formatCode(code);
  const emailResult = await emailService.sendOTP({
    to: user.email,
    userName: user.full_name || 'usuário',
    code: formatted,
    type: 'login',
    expiresIn: CODE_TTL_HOURS * 3600,
  });

  if (!emailResult.success) {
    logger.error(`[${fn}] Failed to send email`, { error: emailResult.error });
    return { success: false, error: emailResult.error };
  }

  logger.info(`[${fn}] Access code sent`, { userId: user.id });
  return { success: true, expiresAt: expiresAt.toISOString() };
}

/**
 * Verifica código de acesso e retorna userId se válido.
 *
 * @param {string} email
 * @param {string} code - Código informado (com ou sem dash)
 * @returns {{ success: boolean, userId?: string, error?: string }}
 */
async function verifyAccessCode(email, code) {
  const fn = `${CTRL}.verifyAccessCode`;

  const normalizedEmail = email.toLowerCase().trim();
  const normalizedCode = code.replace(/-/g, '').toUpperCase();

  // 1. Verificar lockout
  const lockout = await checkLockout(normalizedEmail);
  if (lockout.is_locked) {
    return { success: false, error: 'account_locked', locked_until: lockout.locked_until };
  }

  // 2. Resolver usuário
  const { data: user } = await sb()
    .from('users')
    .select('id, email')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (!user) {
    await recordAttempt(normalizedEmail, 'access_code', false);
    return { success: false, error: 'invalid_code' };
  }

  // 3. Buscar código ativo (não usado, não expirado)
  const { data: activeCode } = await sb()
    .from('user_access_codes')
    .select('id, code_hash, expires_at')
    .eq('user_id', user.id)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!activeCode) {
    await recordAttempt(normalizedEmail, 'access_code', false);
    return { success: false, error: 'invalid_code' };
  }

  // 4. Verificar hash (timing-safe)
  const candidateHash = hashCode(normalizedCode, user.id);
  const isValid = crypto.timingSafeEqual(
    Buffer.from(activeCode.code_hash, 'hex'),
    Buffer.from(candidateHash, 'hex'),
  );

  if (!isValid) {
    await recordAttempt(normalizedEmail, 'access_code', false);
    return { success: false, error: 'invalid_code' };
  }

  // 5. Marcar como usado
  await sb()
    .from('user_access_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('id', activeCode.id);

  // 6. Registrar sucesso
  await recordAttempt(normalizedEmail, 'access_code', true);

  logger.info(`[${fn}] Access code verified`, { userId: user.id });
  return { success: true, userId: user.id };
}

// ---------------------------------------------------------------------------
// Helpers: lockout + attempt logging
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
  sendAccessCode,
  verifyAccessCode,
  recordAttempt,
  checkLockout,
};
