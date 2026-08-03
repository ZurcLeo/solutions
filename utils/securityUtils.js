const { logger } = require('../logger');
const { getSupabaseClient } = require('../config/supabase');

// TTL padrao: 24h para auto-blacklist, sem expiracao para manual
const AUTO_BLACKLIST_TTL_SECONDS = 24 * 60 * 60;

// ── In-memory cache (avoids DB hit on every request) ─────────────────────────
// Map<string, { expiresAt: number | null, cachedAt: number }>
const blacklistCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
let cacheFullyLoaded = false;

/**
 * Carrega toda a blacklist do Supabase para o cache in-memory.
 * Chamada no startup do servidor e periodicamente para refresh.
 */
async function loadBlacklistCache() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('ip_blacklist')
      .select('ip_address, expires_at')
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Erro ao carregar blacklist do Supabase', { error: error.message });
      return;
    }

    const now = Date.now();
    const nowISO = new Date(now).toISOString();

    blacklistCache.clear();
    for (const row of (data || [])) {
      // Pular entradas expiradas
      if (row.expires_at && row.expires_at <= nowISO) continue;

      blacklistCache.set(row.ip_address, {
        expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
        cachedAt: now,
      });
    }

    cacheFullyLoaded = true;
    logger.info(`Blacklist cache loaded: ${blacklistCache.size} active entries`);
  } catch (err) {
    logger.error('Falha ao carregar blacklist cache', { error: err.message });
  }
}

/**
 * Adiciona um IP/token/JA3/user a blacklist persistente (Supabase).
 * Upsert: se ja existe, atualiza reason e expires_at.
 *
 * @param {string} id - IP, JA3 hash ou user ID
 * @param {string} type - 'ip' | 'ja3' | 'user' | 'token'
 * @param {string} reason - motivo do bloqueio
 * @param {number|null} ttlSeconds - TTL em segundos (null = permanente)
 * @returns {Promise<boolean>} true se inseriu/atualizou
 */
async function addToLocalBlacklist(id, type = 'token', reason = 'manual', ttlSeconds = null) {
  try {
    const supabase = getSupabaseClient();

    const expiresAt = ttlSeconds != null
      ? new Date(Date.now() + ttlSeconds * 1000).toISOString()
      : null;

    const { error } = await supabase
      .from('ip_blacklist')
      .upsert(
        {
          ip_address: id,
          type,
          reason,
          blocked_by: 'system',
          expires_at: expiresAt,
        },
        { onConflict: 'ip_address' }
      );

    if (error) {
      logger.error('Erro ao adicionar a blacklist Supabase', { error: error.message, id });
      return false;
    }

    // Atualizar cache imediatamente
    blacklistCache.set(id, {
      expiresAt: expiresAt ? new Date(expiresAt).getTime() : null,
      cachedAt: Date.now(),
    });

    logger.warn(`Item adicionado a blacklist: ${id}`, { type, reason, ttlSeconds });
    return true;
  } catch (err) {
    logger.error('Erro ao adicionar a blacklist', { error: err.message, id });
    return false;
  }
}

/**
 * Verifica se um IP/token/JA3/user esta na blacklist.
 * Consulta SINCRONA via cache in-memory (sem DB hit por request).
 * O cache e recarregado a cada 5min e atualizado nas mutacoes.
 *
 * @param {string} id - IP, JA3 hash ou user ID
 * @returns {boolean}
 */
function isLocallyBlacklisted(id) {
  const entry = blacklistCache.get(id);
  if (!entry) return false;

  const now = Date.now();

  // Verificar se a entrada expirou
  if (entry.expiresAt && entry.expiresAt <= now) {
    blacklistCache.delete(id);
    // Cleanup async no DB (fire-and-forget)
    _cleanupExpiredEntry(id);
    return false;
  }

  // Verificar se o cache entry esta muito stale (>5min) — revalidar async
  if (now - entry.cachedAt > CACHE_TTL_MS) {
    // Marca como revalidando para evitar multiplas queries
    entry.cachedAt = now;
    _revalidateEntry(id);
  }

  return true;
}

/**
 * Remove um item da blacklist persistente.
 *
 * @param {string} id - IP, JA3 hash ou user ID
 * @returns {Promise<boolean>} true se removeu
 */
async function removeFromLocalBlacklist(id) {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('ip_blacklist')
      .delete()
      .eq('ip_address', id)
      .select('id');

    if (error) {
      logger.error('Erro ao remover da blacklist Supabase', { error: error.message, id });
      return false;
    }

    if (!data || data.length === 0) return false;

    // Remover do cache imediatamente
    blacklistCache.delete(id);

    logger.info(`Item removido da blacklist: ${id}`);
    return true;
  } catch (err) {
    logger.error('Erro ao remover da blacklist', { error: err.message, id });
    return false;
  }
}

/**
 * Lista todos os itens ativos da blacklist (filtra expirados).
 *
 * @returns {Promise<Array>} Lista de entradas da blacklist
 */
async function listLocalBlacklist() {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('ip_blacklist')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Erro ao listar blacklist Supabase', { error: error.message });
      return [];
    }

    const now = new Date().toISOString();

    // Filtrar expirados e formatar para compatibilidade com o formato antigo
    return (data || [])
      .filter(row => !row.expires_at || row.expires_at > now)
      .map(row => ({
        id: row.ip_address,
        type: row.type,
        reason: row.reason,
        blockedBy: row.blocked_by,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        dbId: row.id,
      }));
  } catch (err) {
    logger.error('Erro ao listar blacklist', { error: err.message });
    return [];
  }
}

// ── Helpers internos ─────────────────────────────────────────────────────────

/**
 * Remove entrada expirada do DB (fire-and-forget).
 */
function _cleanupExpiredEntry(id) {
  (async () => {
    try {
      const supabase = getSupabaseClient();
      await supabase
        .from('ip_blacklist')
        .delete()
        .eq('ip_address', id)
        .lte('expires_at', new Date().toISOString());
    } catch (_) { /* best-effort cleanup */ }
  })();
}

/**
 * Revalida uma entrada do cache contra o DB (fire-and-forget).
 * Se nao existir mais no DB, remove do cache.
 */
function _revalidateEntry(id) {
  (async () => {
    try {
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from('ip_blacklist')
        .select('ip_address, expires_at')
        .eq('ip_address', id)
        .maybeSingle();

      if (!data) {
        blacklistCache.delete(id);
        return;
      }

      const now = new Date().toISOString();
      if (data.expires_at && data.expires_at <= now) {
        blacklistCache.delete(id);
        return;
      }

      // Atualizar cache com dados frescos
      blacklistCache.set(id, {
        expiresAt: data.expires_at ? new Date(data.expires_at).getTime() : null,
        cachedAt: Date.now(),
      });
    } catch (_) { /* best-effort revalidation */ }
  })();
}

// ── Periodic cache refresh (every 5 min) ─────────────────────────────────────
let _refreshInterval = null;

function startCacheRefresh() {
  if (_refreshInterval) return;
  _refreshInterval = setInterval(() => {
    loadBlacklistCache().catch(() => {});
  }, CACHE_TTL_MS);
  // Nao bloquear shutdown
  if (_refreshInterval.unref) _refreshInterval.unref();
}

function stopCacheRefresh() {
  if (_refreshInterval) {
    clearInterval(_refreshInterval);
    _refreshInterval = null;
  }
}

module.exports = {
  addToLocalBlacklist,
  isLocallyBlacklisted,
  removeFromLocalBlacklist,
  listLocalBlacklist,
  loadBlacklistCache,
  startCacheRefresh,
  stopCacheRefresh,
  AUTO_BLACKLIST_TTL_SECONDS,
};
