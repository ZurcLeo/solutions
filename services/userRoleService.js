// services/userRoleService.js
// Atribuição de roles: authController → supabaseSyncService → supabase.rpc('sync_user_role')
// Este serviço lida apenas com verificação de roles/permissões já atribuídas.

const { logger } = require('../logger');
const { createClient } = require('@supabase/supabase-js');

// Inicializar Supabase para leitura opcional
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// ── Cache em memória (Map + TTL) ────────────────────────────────────────────
// Formato de chave: `<tipo>:<userId>:<params...>`
// Tipos possíveis: 'role', 'perm', 'roles' — userId está SEMPRE na posição 2.
// Invalidação por prefixos exatos evita falso-positivo por substring.
// Eviction periódica (5 min) remove entradas expiradas nunca relidas.
const CACHE_TTL_MS = 60 * 1000; // 60 segundos
const _cache = new Map();

// Prefixos de chave por userId — exatos, não substring
const _userPrefixes = (userId) => [
  `role:${userId}:`,
  `perm:${userId}:`,
  `roles:${userId}:`,
];

function _cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    _cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function _cacheSet(key, value) {
  _cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Varredura periódica de entradas expiradas (eviction ativa)
// Previne acúmulo de chaves nunca relidas (ex: combinações userId+caixinhaId visitadas uma vez)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of _cache.entries()) {
    if (now > entry.expiresAt) _cache.delete(key);
  }
}, 5 * 60 * 1000).unref(); // .unref() não impede o processo de encerrar

/**
 * Invalida todas as entradas de cache de um usuário.
 * Usa prefixos exatos (`tipo:userId:`) — sem substring — para evitar
 * falso-positivo se userId aparecer como valor em outra posição da chave.
 * @param {string} userId
 */
function invalidateUserCache(userId) {
  const prefixes = _userPrefixes(userId);
  for (const key of _cache.keys()) {
    if (prefixes.some(p => key.startsWith(p))) _cache.delete(key);
  }
}

/**
 * Serviço para verificação de roles e permissões de usuário.
 * Leitura-apenas — não atribui roles (ver supabaseSyncService).
 */
class UserRoleService {
  /**
   * Verifica se um usuário tem uma role específica
   * @param {string} userId - ID do usuário
   * @param {string} roleName - Nome da role
   * @param {string} contextType - Tipo de contexto (opcional)
   * @param {string} resourceId - ID do recurso no contexto (opcional)
   * @returns {Promise<boolean>} True se o usuário tiver a role
   */
  async checkUserHasRole(userId, roleName, contextType = 'global', resourceId = null) {
    if (!supabase) {
      logger.error('Supabase não configurado — roles não podem ser verificadas', { userId, roleName });
      return false;
    }

    const cacheKey = `role:${userId}:${roleName}:${contextType}:${resourceId}`;
    const cached = _cacheGet(cacheKey);
    if (cached !== undefined) return cached;

    try {
      const { data, error } = await supabase.rpc('check_user_has_role', {
        p_user_id: userId,
        p_role_name: roleName,
        p_context_type: contextType,
        p_resource_id: resourceId
      });
      if (error) throw error;
      _cacheSet(cacheKey, data);
      return data;
    } catch (err) {
      logger.error('Erro ao verificar role no Supabase', {
        service: 'userRoleService',
        function: 'checkUserHasRole',
        userId, roleName, contextType, resourceId,
        error: err.message
      });
      return false;
    }
  }

  /**
   * Verifica se um usuário tem uma permissão específica
   * @param {string} userId - ID do usuário
   * @param {string} permissionName - Nome da permissão
   * @param {string} contextType - Tipo de contexto (opcional)
   * @param {string} resourceId - ID do recurso no contexto (opcional)
   * @returns {Promise<boolean>} True se o usuário tiver a permissão
   */
  async checkUserHasPermission(userId, permissionName, contextType = 'global', resourceId = null) {
    if (!supabase) {
      logger.error('Supabase não configurado — permissões não podem ser verificadas', { userId, permissionName });
      return false;
    }

    const cacheKey = `perm:${userId}:${permissionName}:${contextType}:${resourceId}`;
    const cached = _cacheGet(cacheKey);
    if (cached !== undefined) return cached;

    try {
      const { data, error } = await supabase.rpc('check_user_has_permission', {
        p_user_id: userId,
        p_permission_name: permissionName,
        p_context_type: contextType,
        p_resource_id: resourceId
      });
      if (error) throw error;
      _cacheSet(cacheKey, data);
      return data;
    } catch (err) {
      logger.error('Erro ao verificar permissão no Supabase', {
        service: 'userRoleService',
        function: 'checkUserHasPermission',
        userId, permissionName, contextType, resourceId,
        error: err.message
      });
      return false;
    }
  }

  /**
   * Obtém as roles de um usuário
   * @param {string} userId - ID do usuário
   * @param {string} contextType - Tipo de contexto (opcional)
   * @param {string} resourceId - ID do recurso no contexto (opcional)
   * @returns {Promise<Array<Object>>} Lista de roles (objetos simples)
   */
  async getUserRoles(userId, contextType = null, resourceId = null) {
    if (!supabase) {
      logger.error('Supabase não configurado — roles retornarão vazias', { userId });
      return [];
    }

    const cacheKey = `roles:${userId}:${contextType}:${resourceId}`;
    const cached = _cacheGet(cacheKey);
    if (cached !== undefined) return cached;

    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('*, roles(name)')
        .eq('user_id', userId);

      if (error) throw error;

      const result = (data || []).map(ur => ({
        roleId: ur.role_id,
        roleName: ur.role_id,          // 'admin', 'member' etc. — identificador programático
        displayName: ur.roles?.name,   // 'Administrador', 'Membro' etc. — apenas exibição
        context: ur.metadata?.context || { type: 'global', resourceId: null },
        validationStatus: ur.metadata?.validationStatus || 'validated'
      }));

      _cacheSet(cacheKey, result);
      return result;
    } catch (err) {
      logger.error('Erro ao buscar roles do usuário no Supabase', {
        service: 'userRoleService',
        function: 'getUserRoles',
        userId,
        error: err.message
      });
      return [];
    }
  }
}

const instance = new UserRoleService();

// Exportar invalidateUserCache junto com a instância para permitir
// que pontos de mutação (supabaseSyncService, userRoleController) invalidem ativamente.
instance.invalidateUserCache = invalidateUserCache;

module.exports = instance;
