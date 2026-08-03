/**
 * handleService.js — Servico centralizado de handles (usernames) para users e sellers.
 * Namespace unificado: um handle nao pode existir em users.username NEM em seller_profiles.username.
 *
 * HANDLE-001 (H1) — Extraido de userController.js para reutilizacao cross-entity.
 */

const { getSupabaseClient } = require('../config/supabase');
const { getFirestore } = require('../firebaseAdmin');
const { logger } = require('../logger');

// ─── Constantes ──────────────────────────────────────────────────────────────

/** [HANDLE-003] Regex com hifen: letras/numeros/hifen, nao comeca/termina com hifen, 3-30 chars */
const HANDLE_REGEX = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

/** [HANDLE-002] Handles reservados — nenhum usuario/seller pode usar */
const RESERVED_HANDLES = new Set([
  'admin', 'api', 'suporte', 'eloscloud', 'elos', 'oficial',
  'ajuda', 'contato', 'root', 'support', 'help', 'sistema',
  'moderador', 'moderacao', 'staff', 'equipe', 'team',
  'marketplace', 'mercado', 'negocio', 'negocios', 'loja',
  'config', 'configuracoes', 'settings', 'dashboard',
  'login', 'register', 'cadastro', 'auth', 'logout',
  'agora', 'feed', 'social', 'chat', 'mensagens',
  'pagamento', 'payment', 'checkout', 'pedido', 'pedidos',
  'caixinha', 'caixinhas', 'rifa', 'rifas',
  'vincular', 'convite', 'invite',
  'termos', 'privacidade', 'sobre', 'blog',
  'www', 'mail', 'ftp', 'test', 'dev', 'staging',
]);

const RATE_LIMIT_DAYS = 30;
const QUARANTINE_DAYS = 90;

// ─── validateHandle ─────────────────────────────────────────────────────────

/**
 * Valida formato de um handle contra a regex vigente.
 * @param {string} handle
 * @returns {{ valid: boolean, error?: string }}
 */
function validateHandle(handle) {
  if (!handle || typeof handle !== 'string') {
    return { valid: false, error: 'Handle obrigatorio' };
  }

  const h = handle.toLowerCase();

  if (h.length < 3) {
    return { valid: false, error: 'Muito curto (minimo 3 caracteres)' };
  }
  if (h.length > 30) {
    return { valid: false, error: 'Muito longo (maximo 30 caracteres)' };
  }
  if (!HANDLE_REGEX.test(h)) {
    return { valid: false, error: 'Caracteres invalidos (letras minusculas, numeros e hifen; nao pode comecar/terminar com hifen)' };
  }
  if (/--/.test(h)) {
    return { valid: false, error: 'Nao pode conter hifens consecutivos (--)' };
  }

  // [HANDLE-002] Reservados
  if (RESERVED_HANDLES.has(h)) {
    return { valid: false, error: 'Este handle e reservado' };
  }

  return { valid: true };
}

// ─── checkAvailability ──────────────────────────────────────────────────────

/**
 * Verifica disponibilidade de handle no namespace unificado.
 * Consulta: users.username (Supabase) + seller_profiles.username (stub H4) + Firestore fallback.
 *
 * @param {string} handle — handle ja em lowercase
 * @param {object} [opts={}]
 * @param {string} [opts.excludeUserId] — userId a excluir (proprio user checando)
 * @param {string} [opts.excludeSellerId] — sellerId a excluir (proprio seller checando)
 * @returns {Promise<{ available: boolean }>}
 */
async function checkAvailability(handle, opts = {}) {
  const h = handle.toLowerCase();

  // ── 1. Supabase: users.username ───────────────────────────────────────────
  const sb = getSupabaseClient();
  if (sb) {
    let query = sb.from('users').select('id').eq('username', h).limit(1);
    if (opts.excludeUserId) {
      query = query.neq('id', opts.excludeUserId);
    }
    const { data } = await query.maybeSingle();
    if (data) return { available: false };
  }

  // ── 2. Supabase: seller_profiles.username [HANDLE-004] ──────────────────
  if (sb) {
    let sellerQuery = sb.from('seller_profiles').select('id').eq('username', h).limit(1);
    if (opts.excludeSellerId) {
      sellerQuery = sellerQuery.neq('id', opts.excludeSellerId);
    }
    const { data: sellerData } = await sellerQuery.maybeSingle();
    if (sellerData) return { available: false };
  }

  // ── 3. Firestore fallback (dados legados) ─────────────────────────────────
  try {
    const firestore = getFirestore();
    if (firestore) {
      const snap = await firestore.collection('usuario').where('username', '==', h).limit(1).get();
      if (!snap.empty) return { available: false };
    }
  } catch (err) {
    // Firestore indisponivel nao deve bloquear — log e prosseguir
    logger.warn('Firestore fallback indisponivel em checkAvailability', {
      service: 'handleService',
      error: err.message,
    });
  }

  // ── 4. Quarentena: handle em handle_history dentro do prazo [HANDLE-005] ──
  if (sb) {
    const { data: quarantined } = await sb
      .from('handle_history')
      .select('id')
      .eq('handle', h)
      .gt('quarantine_until', new Date().toISOString())
      .limit(1)
      .maybeSingle();
    if (quarantined) return { available: false };
  }

  return { available: true };
}

// ─── generateFallbackHandle ─────────────────────────────────────────────────

/**
 * Gera handle unico a partir de um nome-base.
 * Sanitiza: lowercase, remove acentos (NFD), remove nao-alfanumericos, trunca 26 chars + 4 digitos.
 *
 * @param {string} baseName — displayName, business_name, etc.
 * @returns {Promise<{ handle: string }>}
 * @throws {Error} se nao conseguir gerar em 5 tentativas
 */
async function generateFallbackHandle(baseName) {
  const sanitized = (baseName || 'elos')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')      // remove nao-alfanumericos
    .substring(0, 26) || 'elos';

  const MAX_ATTEMPTS = 5;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const suffix = Math.floor(1000 + Math.random() * 9000); // 4 digitos
    const candidate = `${sanitized}${suffix}`.substring(0, 30);

    const { available } = await checkAvailability(candidate);
    if (available) return { handle: candidate };
  }

  // Fallback extremo: prefixo elos + timestamp parcial
  const emergency = `elos${Date.now().toString(36).slice(-8)}`.substring(0, 30);
  return { handle: emergency };
}

// ─── checkRateLimit ─────────────────────────────────────────────────────────

/**
 * Verifica se o usuario pode alterar o handle (rate limit: 1x a cada 30 dias).
 *
 * @param {string|Date|null} lastChangedAt — username_last_changed_at
 * @returns {{ allowed: boolean, daysLeft?: number }}
 */
function checkRateLimit(lastChangedAt) {
  if (!lastChangedAt) return { allowed: true }; // primeiro uso

  const changedDate = new Date(lastChangedAt);
  const daysSince = (Date.now() - changedDate.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSince < RATE_LIMIT_DAYS) {
    return { allowed: false, daysLeft: Math.ceil(RATE_LIMIT_DAYS - daysSince) };
  }

  return { allowed: true };
}

// ─── recordHandleRelease [HANDLE-005] ────────────────────────────────────────

/**
 * Records old handle in history table when it changes (fire-and-forget).
 * @param {string} handle — the old handle being released
 * @param {'user'|'seller'} ownerType
 * @param {string} ownerId
 */
async function recordHandleRelease(handle, ownerType, ownerId) {
  const sb = getSupabaseClient();
  if (!sb || !handle) return;
  try {
    await sb.from('handle_history').insert({
      handle: handle.toLowerCase(),
      owner_type: ownerType,
      owner_id: ownerId,
    });
    logger.info('Handle released to history', { service: 'handleService', handle, ownerType, ownerId });
  } catch (err) {
    logger.error('Failed to record handle release', { service: 'handleService', handle, error: err.message });
  }
}

// ─── resolveHandleRedirect [HANDLE-005] ──────────────────────────────────────

/**
 * Checks if a handle exists in history and is within quarantine period.
 * Returns redirect info (current handle of the owner) or null.
 * @param {string} handle
 * @returns {Promise<{ownerType: string, ownerId: string, currentHandle: string, quarantineUntil: string}|null>}
 */
async function resolveHandleRedirect(handle) {
  const sb = getSupabaseClient();
  if (!sb) return null;
  const h = handle.toLowerCase();

  const { data, error } = await sb
    .from('handle_history')
    .select('owner_type, owner_id, quarantine_until')
    .eq('handle', h)
    .gt('quarantine_until', new Date().toISOString())
    .order('released_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  // Look up current handle of the owner
  let currentHandle = null;
  if (data.owner_type === 'user') {
    const { data: user } = await sb.from('users').select('username').eq('id', data.owner_id).maybeSingle();
    currentHandle = user?.username;
  } else if (data.owner_type === 'seller') {
    const { data: seller } = await sb.from('seller_profiles').select('username').eq('id', data.owner_id).maybeSingle();
    currentHandle = seller?.username;
  }

  if (!currentHandle) return null;

  return {
    ownerType: data.owner_type,
    ownerId: data.owner_id,
    currentHandle,
    quarantineUntil: data.quarantine_until,
  };
}

// ─── resolveHandle [HANDLE-005] ──────────────────────────────────────────────

/**
 * Resolves a handle to its owner, with 301 redirect support for old handles.
 * Used by H6 routes (/u/:handle, /s/:handle).
 * @param {string} handle
 * @param {'user'|'seller'} type
 * @returns {Promise<{found: boolean, id?: string, type: string, handle?: string, redirect?: boolean, currentHandle?: string}|null>}
 */
async function resolveHandle(handle, type) {
  const sb = getSupabaseClient();
  if (!sb) return null;
  const h = handle.toLowerCase();

  // Direct lookup first
  if (type === 'user') {
    const { data } = await sb.from('users').select('id, username').eq('username', h).maybeSingle();
    if (data) return { found: true, id: data.id, type: 'user', handle: data.username };
  } else if (type === 'seller') {
    const { data } = await sb.from('seller_profiles').select('id, username').eq('username', h).maybeSingle();
    if (data) return { found: true, id: data.id, type: 'seller', handle: data.username };
  }

  // Check history for 301 redirect
  const redirect = await resolveHandleRedirect(h);
  if (redirect && redirect.ownerType === type) {
    return { found: true, redirect: true, currentHandle: redirect.currentHandle, type: redirect.ownerType };
  }

  return null;
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  HANDLE_REGEX,
  RESERVED_HANDLES,
  RATE_LIMIT_DAYS,
  QUARANTINE_DAYS,
  validateHandle,
  checkAvailability,
  generateFallbackHandle,
  checkRateLimit,
  recordHandleRelease,
  resolveHandleRedirect,
  resolveHandle,
};
