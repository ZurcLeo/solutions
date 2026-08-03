const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

/**
 * Middleware que verifica se o usuário possui o plano exigido ativo.
 * Plano 'seller' com billing_mode 'commission' NÃO requer assinatura paga
 * (qualquer user com seller_profile pode vender com 3% de comissão).
 *
 * @param {string} requiredPlan - 'seller' | 'professional' | 'supporter'
 */
const requirePlan = (requiredPlan) => async (req, res, next) => {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('user_subscriptions')
      .select('id, plan, status, billing_mode, subscribed_at')
      .eq('user_id', req.user.uid)
      .eq('plan', requiredPlan)
      .eq('status', 'active')
      .single();

    if (error || !data) {
      return res.status(403).json({
        code: 'PLAN_REQUIRED',
        required: requiredPlan,
        current: 'free',
        message: `Esta funcionalidade requer o plano ${requiredPlan}`
      });
    }

    req.subscription = data;
    next();
  } catch (err) {
    logger.error('requirePlan: erro inesperado', { error: err.message });
    next(err);
  }
};

module.exports = { requirePlan };
