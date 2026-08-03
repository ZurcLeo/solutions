const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

/**
 * Middleware que verifica se o usuário atingiu o nível mínimo de gamificação.
 * Usado para gates de funcionalidades como a Loja Social (Nível 3+).
 *
 * @param {number} minLevel - Nível mínimo exigido
 */
const requireLevel = (minLevel) => async (req, res, next) => {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('user_gamification')
      .select('current_level')
      .eq('user_id', req.user.uid)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.warn('requireLevel: erro ao buscar gamificação', { userId: req.user.uid, error: error.message });
    }

    const currentLevel = data?.current_level ?? 0;

    if (currentLevel < minLevel) {
      return res.status(403).json({
        code: 'LEVEL_REQUIRED',
        required: minLevel,
        current: currentLevel,
        message: `Complete missões para desbloquear esta funcionalidade. Nível necessário: ${minLevel}`
      });
    }

    req.userLevel = currentLevel;
    next();
  } catch (err) {
    logger.error('requireLevel: erro inesperado', { error: err.message });
    next(err);
  }
};

module.exports = { requireLevel };
