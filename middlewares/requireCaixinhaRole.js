/**
 * @fileoverview Middleware que verifica se o usuário tem ao menos o nível de role exigido.
 * Hierarquia: admin (3) > gerente (2) > membro (1)
 * Fail-closed: em caso de erro, retorna 403.
 * Usado após verifyToken.
 */
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const ROLE_LEVELS = { admin: 3, gerente: 2, membro: 1, removed: 0 };

/**
 * Retorna um middleware que exige no mínimo a role especificada.
 * @param {'admin'|'gerente'|'membro'} minRole
 */
const requireCaixinhaRole = (minRole = 'admin') => async (req, res, next) => {
  const userId = req.uid;
  const caixinhaId = req.params.caixinhaId;

  if (!userId || !caixinhaId) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }

  try {
    const supabase = getSupabaseClient();
    if (!supabase) {
      logger.error('requireCaixinhaRole: Supabase indisponível', { caixinhaId, userId });
      return res.status(503).json({ error: 'Serviço temporariamente indisponível.' });
    }

    const { data, error } = await supabase
      .from('caixinha_members')
      .select('role')
      .eq('caixinha_id', caixinhaId)
      .eq('user_id', userId)
      .eq('status', 'ativo')
      .eq('active', true)
      .maybeSingle();

    if (error) {
      logger.error('requireCaixinhaRole: erro ao consultar membro', { caixinhaId, userId, error: error.message });
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    if (!data) {
      return res.status(403).json({ error: 'Você não é membro ativo desta caixinha.' });
    }

    const userLevel = ROLE_LEVELS[data.role] || 0;
    const requiredLevel = ROLE_LEVELS[minRole] || 0;

    if (userLevel < requiredLevel) {
      logger.warn('requireCaixinhaRole: nível insuficiente', {
        caixinhaId, userId, userRole: data.role, requiredRole: minRole
      });
      return res.status(403).json({
        error: `Esta ação requer o papel de ${minRole} ou superior.`
      });
    }

    // Injeta role no request para uso downstream
    req.caixinhaRole = data.role;
    next();
  } catch (err) {
    logger.error('requireCaixinhaRole: erro inesperado', { caixinhaId, userId, error: err.message });
    return res.status(403).json({ error: 'Acesso negado.' });
  }
};

module.exports = requireCaixinhaRole;
