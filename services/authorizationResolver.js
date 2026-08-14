// services/authorizationResolver.js
// Fonte única de verdade para lógica de bypass admin e resolução de acesso.
// Usado por todos os middlewares RBAC — nenhum middleware reimplementa essa lógica.

const userRoleService = require('./userRoleService');

/**
 * Nomes canônicos de roles de administrador global.
 * Qualquer checagem de "é admin?" deve usar esta constante.
 */
const ADMIN_ROLE_NAMES = ['admin', 'Admin', 'adm-master'];

/**
 * Verifica se o token JWT da request contém uma role de admin validada.
 * Verificação síncrona — zero I/O.
 * Checa tanto `roleName` quanto `roleId` para cobrir variações de payload do JWT.
 * @param {Object} req
 * @returns {boolean}
 */
function isAdminByToken(req) {
  if (!req.user?.roles || !Array.isArray(req.user.roles)) return false;
  return req.user.roles.some(
    r => (ADMIN_ROLE_NAMES.includes(r.roleName) || ADMIN_ROLE_NAMES.includes(r.roleId)) &&
         r.validationStatus === 'validated'
  );
}

/**
 * Verifica se o usuário tem alguma role de admin no banco.
 * Usa o cache do userRoleService (Wave 2) — I/O apenas no primeiro miss.
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function isAdminByDB(userId) {
  for (const roleName of ADMIN_ROLE_NAMES) {
    if (await userRoleService.checkUserHasRole(userId, roleName)) return true;
  }
  return false;
}

/**
 * Resolução completa de admin: token primeiro (sync), banco se necessário (async+cache).
 * @param {string} userId
 * @param {Object} req
 * @returns {Promise<boolean>}
 */
async function resolveAdmin(userId, req) {
  if (isAdminByToken(req)) return true;
  return isAdminByDB(userId);
}

/**
 * Resolução de permissão específica com admin bypass.
 * Ordem: admin por token (sync) → RPC check_user_has_permission (async+cache)
 * Admin bypass antecipa: RPC também cobre admin em SQL, mas token é zero I/O.
 * @param {string} userId
 * @param {string} permissionName
 * @param {string} contextType
 * @param {string|null} resourceId
 * @param {Object} req
 * @returns {Promise<boolean>}
 */
async function resolvePermission(userId, permissionName, contextType, resourceId, req) {
  if (isAdminByToken(req)) return true;
  return userRoleService.checkUserHasPermission(userId, permissionName, contextType, resourceId);
}

/**
 * Resolução de role específica com admin bypass.
 * Ordem: role no token (com contexto) → admin por token → RPC check_user_has_role (async+cache)
 * @param {string} userId
 * @param {string} roleName
 * @param {string} contextType
 * @param {string|null} resourceId
 * @param {Object} req
 * @returns {Promise<boolean>}
 */
async function resolveRole(userId, roleName, contextType, resourceId, req) {
  if (req.user?.roles && Array.isArray(req.user.roles)) {
    // Verificar role específica no token (respeitando contexto)
    const hasRoleInToken = req.user.roles.some(r =>
      (r.roleName === roleName || r.roleId === roleName) &&
      r.validationStatus === 'validated' &&
      (contextType === 'global' ||
        (r.context?.type === contextType && r.context?.resourceId === resourceId))
    );
    if (hasRoleInToken) return true;

    // Admin bypass por token
    if (isAdminByToken(req)) return true;
  }

  // Fallback ao banco (com cache)
  return userRoleService.checkUserHasRole(userId, roleName, contextType, resourceId);
}

module.exports = {
  ADMIN_ROLE_NAMES,
  isAdminByToken,
  isAdminByDB,
  resolveAdmin,
  resolvePermission,
  resolveRole,
};
