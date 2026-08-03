'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');
const ProductValidator = require('../services/validators/ProductValidator');

/**
 * Middleware que valida se o seller_profile do usuário autenticado possui
 * as capabilities exigidas pela rota.
 *
 * Gêmeo server-side da sellerTypeConfig.js do frontend.
 * A config define o que aparece; cada rota da API valida de forma independente
 * se aquela capability está habilitada para aquele seller_profile.
 *
 * Usa a UNIÃO das capabilities quando o vendedor é multi-categoria
 * (seller_profiles.categories[]).
 *
 * Após validação, popula:
 *   - req.sellerProfile  — perfil completo do vendedor
 *   - req.sellerCapabilities — capabilities unificadas (objeto booleano)
 *
 * @param {...string} requiredCapabilities - Nomes de capabilities exigidas
 *   Ex: 'has_modifiers', 'has_menu_categories', 'has_scheduling'
 *
 * @example
 *   router.post('/menu/categories',
 *     verifyToken,
 *     validateSellerCapability('has_menu_categories'),
 *     writeLimit,
 *     ctrl.createMenuCategory
 *   );
 */
const validateSellerCapability = (...requiredCapabilities) => async (req, res, next) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({
        code: 'AUTH_REQUIRED',
        message: 'Autenticação necessária.',
      });
    }

    // 1. Buscar perfil do vendedor (se já estiver em req, reutiliza)
    let seller = req.sellerProfile;

    if (!seller) {
      const supabase = getSupabaseClient();

      // Try direct owner lookup first
      const { data, error } = await supabase
        .from('seller_profiles')
        .select('id, user_id, category, categories, primary_category, status')
        .eq('user_id', userId)
        .single();

      if (data) {
        seller = data;
      } else if (error && error.code === 'PGRST116') {
        // Not a direct owner — try team member fallback
        const { data: member, error: memberErr } = await supabase
          .from('seller_team_members')
          .select('seller_id')
          .eq('user_id', userId)
          .eq('status', 'active')
          .eq('active', true)
          .limit(1)
          .single();

        if (member) {
          const { data: teamSeller, error: teamErr } = await supabase
            .from('seller_profiles')
            .select('id, user_id, category, categories, primary_category, status')
            .eq('id', member.seller_id)
            .single();

          if (teamErr || !teamSeller) {
            return res.status(403).json({
              code: 'SELLER_PROFILE_REQUIRED',
              message: 'Perfil de vendedor não encontrado.',
            });
          }
          seller = teamSeller;
        } else {
          return res.status(403).json({
            code: 'SELLER_PROFILE_REQUIRED',
            message: 'Você precisa criar um perfil de vendedor para acessar este recurso.',
          });
        }
      } else if (error) {
        logger.error('validateSellerCapability: erro ao buscar seller_profile', {
          userId, error: error.message,
        });
        return res.status(500).json({
          code: 'INTERNAL_ERROR',
          message: 'Erro ao verificar perfil do vendedor.',
        });
      }
    }

    // 2. Verificar status do vendedor
    if (seller.status !== 'active') {
      return res.status(403).json({
        code: 'SELLER_NOT_ACTIVE',
        status: seller.status,
        message: 'Perfil de vendedor não está ativo. Status atual: ' + seller.status,
      });
    }

    // 3. Computar capabilities pela UNIÃO de categorias
    //    Se categories[] estiver vazio (legado), fallback para category TEXT
    const categories = (seller.categories && seller.categories.length > 0)
      ? seller.categories
      : [seller.category];

    const capabilities = ProductValidator.mergedCapabilitiesFor(categories);

    // 4. Verificar cada capability exigida
    const missing = requiredCapabilities.filter(cap => !capabilities[cap]);

    if (missing.length > 0) {
      logger.warn('validateSellerCapability: capability não habilitada', {
        userId,
        sellerId: seller.id,
        categories,
        required: requiredCapabilities,
        missing,
      });

      return res.status(403).json({
        code: 'CAPABILITY_MISSING',
        required: requiredCapabilities,
        missing,
        categories,
        message: `Seu perfil de vendedor (${categories.join(', ')}) não possui acesso a: ${missing.join(', ')}.`,
      });
    }

    // 5. Anexar ao request para uso downstream (evita query duplicada)
    req.sellerProfile = seller;
    req.sellerCapabilities = capabilities;

    next();
  } catch (err) {
    logger.error('validateSellerCapability: erro inesperado', { error: err.message });
    next(err);
  }
};

module.exports = { validateSellerCapability };
