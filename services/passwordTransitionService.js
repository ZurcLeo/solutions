/**
 * @fileoverview Password Transition Service — Migra users com senha para passwordless (AUTH-PL-006)
 *
 * Envia email de transição para users que ainda não foram notificados, com magic link
 * para acesso imediato. Controlado por env vars:
 *  - AUTH_PASSWORD_CUTOFF_DATE: ISO date — após essa data, login com senha retorna 410
 *  - AUTH_PASSWORD_TRANSITION_BATCH_SIZE: tamanho do batch (default 50)
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { getAuth } = require('../firebaseAdmin');
const { logger } = require('../logger');
const emailService = require('./emailService');
const magicLinkService = require('./magicLinkService');

const CTRL = 'passwordTransitionService';
const BATCH_SIZE = parseInt(process.env.AUTH_PASSWORD_TRANSITION_BATCH_SIZE || '50', 10);

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

/**
 * Data cutoff configurada (env AUTH_PASSWORD_CUTOFF_DATE).
 * @returns {Date|null}
 */
function getCutoffDate() {
  const raw = process.env.AUTH_PASSWORD_CUTOFF_DATE;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Verifica se o login por senha está desabilitado (após cutoff).
 * @returns {boolean}
 */
function isPasswordLoginDisabled() {
  const cutoff = getCutoffDate();
  if (!cutoff) return false; // sem cutoff = dual-mode indefinido
  return new Date() >= cutoff;
}

/**
 * Verifica se login por senha está deprecated (cutoff definido, mas ainda não atingido).
 * @returns {{ deprecated: boolean, cutoffDate: string|null }}
 */
function getPasswordDeprecationStatus() {
  const cutoff = getCutoffDate();
  if (!cutoff) return { deprecated: false, cutoffDate: null };
  const now = new Date();
  return {
    deprecated: now < cutoff,
    disabled: now >= cutoff,
    cutoffDate: cutoff.toISOString(),
  };
}

/**
 * Formata data para exibição pt-BR (ex: "27 de agosto de 2026").
 * @param {Date} date
 * @returns {string}
 */
function formatDatePtBR(date) {
  const months = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];
  return `${date.getDate()} de ${months[date.getMonth()]} de ${date.getFullYear()}`;
}

/**
 * Envia emails de transição em batch para users que ainda não foram notificados.
 *
 * @param {Object} [options]
 * @param {number} [options.batchSize] - Tamanho do batch (default BATCH_SIZE)
 * @param {boolean} [options.dryRun]   - Se true, apenas conta sem enviar
 * @returns {{ processed: number, sent: number, errors: number, remaining: number }}
 */
async function sendTransitionBatch(options = {}) {
  const fn = `${CTRL}.sendTransitionBatch`;
  const batchSize = options.batchSize || BATCH_SIZE;
  const dryRun = options.dryRun || false;
  const cutoff = getCutoffDate();
  const cutoffLabel = cutoff ? formatDatePtBR(cutoff) : null;

  logger.info(`[${fn}] Iniciando batch`, { batchSize, dryRun });

  // 1. Buscar users não notificados
  const { data: users, error: fetchErr } = await sb()
    .from('users')
    .select('id, email, nome')
    .is('password_transition_notified_at', null)
    .not('email', 'is', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(batchSize);

  if (fetchErr) {
    logger.error(`[${fn}] Erro ao buscar users`, { error: fetchErr.message });
    throw new Error(`Falha ao buscar users: ${fetchErr.message}`);
  }

  if (!users || users.length === 0) {
    logger.info(`[${fn}] Nenhum user pendente`);
    return { processed: 0, sent: 0, errors: 0, remaining: 0 };
  }

  // Contar total restante
  const { count: remaining } = await sb()
    .from('users')
    .select('id', { count: 'exact', head: true })
    .is('password_transition_notified_at', null)
    .not('email', 'is', null)
    .is('deleted_at', null);

  if (dryRun) {
    logger.info(`[${fn}] Dry run — ${users.length} users no batch, ${remaining} total restante`);
    return { processed: users.length, sent: 0, errors: 0, remaining: remaining || 0 };
  }

  let sent = 0;
  let errors = 0;

  for (const user of users) {
    try {
      // Gerar magic link para acesso imediato
      const linkResult = await magicLinkService.sendMagicLink(user.email, {
        skipEmail: true, // não envia o email padrão — vamos enviar o de transição
      });

      // Se o magic link service retorna o token/URL, usamos
      // Se não (skipEmail não suportado), construímos a URL manualmente
      let magicLinkUrl = linkResult?.magicLinkUrl;
      if (!magicLinkUrl) {
        // Fallback: gerar um magic link diretamente
        const result = await _generateTransitionMagicLink(user.id, user.email);
        magicLinkUrl = result.url;
      }

      // Enviar email de transição
      const emailResult = await emailService.sendPasswordTransition({
        to: user.email,
        userName: user.nome || user.email.split('@')[0],
        magicLinkUrl,
        cutoffDate: cutoffLabel,
      });

      if (emailResult.success) {
        // Marcar como notificado
        await sb()
          .from('users')
          .update({ password_transition_notified_at: new Date().toISOString() })
          .eq('id', user.id);
        sent++;
      } else {
        errors++;
        logger.warn(`[${fn}] Falha ao enviar para ${user.email}`, { error: emailResult.error });
      }
    } catch (err) {
      errors++;
      logger.error(`[${fn}] Erro ao processar user ${user.id}`, { error: err.message });
    }

    // Throttle: 200ms entre emails para não estourar rate limit Resend
    await new Promise(r => setTimeout(r, 200));
  }

  logger.info(`[${fn}] Batch concluído`, {
    processed: users.length, sent, errors,
    remaining: (remaining || 0) - sent,
  });

  return {
    processed: users.length,
    sent,
    errors,
    remaining: Math.max(0, (remaining || 0) - sent),
  };
}

/**
 * Gera magic link diretamente para o email de transição (sem enviar o email padrão).
 * @private
 */
async function _generateTransitionMagicLink(userId, email) {
  const crypto = require('crypto');
  const FRONTEND_URL = process.env.FRONTEND_URL || 'https://eloscloud.com';

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60000); // 24h para email de transição

  await sb()
    .from('user_magic_links')
    .insert({
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
    });

  return {
    url: `${FRONTEND_URL}/auth/magic-link?token=${encodeURIComponent(token)}`,
  };
}

/**
 * Retorna estatísticas da transição.
 * @returns {{ total: number, notified: number, pending: number, cutoffDate: string|null }}
 */
async function getTransitionStats() {
  const { count: total } = await sb()
    .from('users')
    .select('id', { count: 'exact', head: true })
    .not('email', 'is', null)
    .is('deleted_at', null);

  const { count: notified } = await sb()
    .from('users')
    .select('id', { count: 'exact', head: true })
    .not('email', 'is', null)
    .is('deleted_at', null)
    .not('password_transition_notified_at', 'is', null);

  const cutoff = getCutoffDate();

  return {
    total: total || 0,
    notified: notified || 0,
    pending: (total || 0) - (notified || 0),
    cutoffDate: cutoff ? cutoff.toISOString() : null,
    cutoffLabel: cutoff ? formatDatePtBR(cutoff) : null,
    isPasswordDisabled: isPasswordLoginDisabled(),
  };
}

module.exports = {
  sendTransitionBatch,
  getTransitionStats,
  getCutoffDate,
  isPasswordLoginDisabled,
  getPasswordDeprecationStatus,
  formatDatePtBR,
};
