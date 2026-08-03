/**
 * @fileoverview Middleware de gating de módulos da plataforma.
 *
 * Verifica se o módulo está ativo globalmente (platform_modules.status)
 * E se o usuário não desativou o módulo (user_module_preferences.enabled).
 *
 * Deve ser aplicado APÓS verifyToken (precisa de req.user.uid).
 *
 * @module middlewares/requireModule
 */

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

// Cache em memória: Map<"userId:moduleId", { active: boolean, expiresAt: number }>
const cache = new Map();
const TTL_MS = 5 * 60 * 1000; // 5 minutos
let checkCount = 0;

/**
 * Limpa entradas expiradas do cache a cada 1000 checks.
 */
function maybePruneCache() {
  checkCount++;
  if (checkCount < 1000) return;
  checkCount = 0;
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

/**
 * Verifica se um módulo está ativo para um usuário.
 * Módulo ativo = status IN ('ativo','beta') E user_enabled !== false.
 */
async function isModuleActiveForUser(userId, moduleId) {
  const cacheKey = `${userId}:${moduleId}`;
  const now = Date.now();

  maybePruneCache();

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.active;
  }

  const supabase = getSupabaseClient();

  // Busca status global do módulo
  const { data: mod, error: modErr } = await supabase
    .from('platform_modules')
    .select('status')
    .eq('id', moduleId)
    .single();

  if (modErr || !mod) {
    // Módulo não encontrado → não bloqueia (fail-open para não quebrar rotas)
    logger.warn(`[requireModule] Module '${moduleId}' not found in platform_modules`);
    return true;
  }

  // Módulo globalmente inativo
  if (!['ativo', 'beta'].includes(mod.status)) {
    cache.set(cacheKey, { active: false, expiresAt: now + TTL_MS });
    return false;
  }

  // Busca preferência do usuário
  const { data: pref } = await supabase
    .from('user_module_preferences')
    .select('enabled')
    .eq('user_id', userId)
    .eq('module_id', moduleId)
    .maybeSingle();

  // Se não tem preferência ou enabled !== false → ativo
  const active = pref?.enabled !== false;
  cache.set(cacheKey, { active, expiresAt: now + TTL_MS });
  return active;
}

/**
 * Factory de middleware: retorna middleware que verifica se moduleId está ativo.
 *
 * @param {string} moduleId - ID do módulo na tabela platform_modules
 * @returns {Function} Express middleware
 */
function requireModule(moduleId) {
  return async function requireModuleMw(req, res, next) {
    const userId = req.user?.uid;

    // Sem user autenticado → deixa o verifyToken tratar
    if (!userId) return next();

    try {
      const active = await isModuleActiveForUser(userId, moduleId);

      if (!active) {
        logger.info(`[requireModule] Module '${moduleId}' disabled for user ${userId}`);
        return res.status(403).json({
          error: 'MODULE_DISABLED',
          moduleId,
          message: `O modulo '${moduleId}' esta desativado.`,
        });
      }

      next();
    } catch (err) {
      // Falha na verificação não deve bloquear o request (fail-open)
      logger.error(`[requireModule] Error checking module '${moduleId}':`, err.message);
      next();
    }
  };
}

module.exports = requireModule;
