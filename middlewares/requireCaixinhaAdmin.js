/**
 * @fileoverview Middleware que verifica que o usuário autenticado é o admin_id da caixinha.
 * Fail-closed: em caso de erro ou caixinha não encontrada, retorna 403.
 * Deve ser usado após verifyToken e antes de qualquer ação destrutiva (PUT/DELETE) em caixinhas.
 */
const { getSupabaseClient } = require('../config/supabase');
const logger = require('../logger');

const requireCaixinhaAdmin = async (req, res, next) => {
  const userId = req.uid;
  const { caixinhaId } = req.params;

  if (!userId || !caixinhaId) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }

  try {
    const supabase = getSupabaseClient();
    if (!supabase) {
      logger.error('requireCaixinhaAdmin: Supabase indisponível', { caixinhaId, userId });
      return res.status(503).json({ error: 'Serviço temporariamente indisponível.' });
    }

    const { data, error } = await supabase
      .from('caixinhas')
      .select('admin_id')
      .eq('id', caixinhaId)
      .maybeSingle();

    if (error) {
      logger.error('requireCaixinhaAdmin: erro ao consultar caixinha', {
        caixinhaId, userId, error: error.message
      });
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    if (!data) {
      return res.status(404).json({ error: 'Caixinha não encontrada.' });
    }

    if (data.admin_id !== userId) {
      logger.warn('requireCaixinhaAdmin: tentativa de acesso por não-admin', {
        caixinhaId, userId, adminId: data.admin_id
      });
      return res.status(403).json({ error: 'Apenas o administrador da caixinha pode realizar esta ação.' });
    }

    next();
  } catch (err) {
    logger.error('requireCaixinhaAdmin: erro inesperado', { caixinhaId, userId, error: err.message });
    return res.status(403).json({ error: 'Acesso negado.' });
  }
};

module.exports = requireCaixinhaAdmin;
