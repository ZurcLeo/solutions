/**
 * @fileoverview Middleware que bloqueia requests de usuários suspensos.
 *
 * Deve ser aplicado APÓS verifyToken nas rotas protegidas.
 * Permite que admins e rotas de auth/support passem sem verificação.
 *
 * @module middlewares/requireActiveUser
 */

const { checkSuspension } = require('../services/suspensionService');
const { logger } = require('../logger');

// Rotas que não devem ser bloqueadas por suspensão
// (o usuário precisa poder fazer logout, ver status da suspensão e abrir ticket de suporte)
const EXEMPT_PATHS = [
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/auth/me',
  '/api/notifications/vapid-key',
  '/api/admin/',           // Admin pode tudo
  '/api/support/',         // Usuário suspenso pode abrir ticket
  '/api/user/suspension',  // Pode consultar própria suspensão
];

/**
 * Middleware que verifica se o usuário está suspenso.
 * Se sim, retorna 403 com detalhes da suspensão.
 */
async function requireActiveUser(req, res, next) {
  // Sem user autenticado → próximo middleware cuida
  if (!req.user?.uid) return next();

  // Rotas isentas
  const path = req.originalUrl || req.path;
  if (EXEMPT_PATHS.some(exempt => path.startsWith(exempt))) {
    return next();
  }

  try {
    const { suspended, suspension } = await checkSuspension(req.user.uid);

    if (suspended) {
      logger.warn(`[requireActiveUser] Blocked suspended user ${req.user.uid} from ${req.method} ${path}`);

      return res.status(403).json({
        error: 'account_suspended',
        message: 'Sua conta está suspensa.',
        suspension: {
          reason: suspension.reason,
          category: suspension.category,
          expiresAt: suspension.expires_at,
          createdAt: suspension.created_at,
          permanent: !suspension.expires_at,
        },
      });
    }
  } catch (err) {
    // Falha na verificação não deve bloquear o request
    logger.error('[requireActiveUser] Error checking suspension:', err.message);
  }

  next();
}

module.exports = requireActiveUser;
