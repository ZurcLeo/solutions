/**
 * @fileoverview Middleware de enforcement de KYC.
 * Bloqueia operações financeiras sensíveis para usuários sem identidade verificada.
 *
 * @module middlewares/requireKYC
 *
 * @example
 * // Criar caixinha exige KYC nível cpf
 * router.post('/',
 *   verifyToken,
 *   requireKYC('cpf'),
 *   caixinhaController.createCaixinha
 * );
 *
 * // Futuramente, nível document para operações de maior valor
 * router.post('/sacar',
 *   verifyToken,
 *   requireKYC('document'),
 *   caixinhaController.sacar
 * );
 */

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

// Hierarquia de níveis KYC (do menor para o maior)
const KYC_LEVELS = ['none', 'cpf', 'document', 'full'];

/**
 * Verifica se o nível atual do usuário satisfaz o nível requerido.
 */
const _meetsLevel = (userLevel, requiredLevel) => {
  const userIdx     = KYC_LEVELS.indexOf(userLevel     || 'none');
  const requiredIdx = KYC_LEVELS.indexOf(requiredLevel || 'cpf');
  return userIdx >= requiredIdx;
};

/**
 * Factory do middleware de KYC.
 *
 * @param {'cpf'|'document'|'full'} [requiredLevel='cpf'] - Nível mínimo exigido
 * @returns {Function} Middleware Express assíncrono
 */
const requireKYC = (requiredLevel = 'cpf') => {
  if (!KYC_LEVELS.includes(requiredLevel)) {
    throw new Error(`requireKYC: nível inválido "${requiredLevel}". Use: ${KYC_LEVELS.slice(1).join(', ')}`);
  }

  return async (req, res, next) => {
    const userId = req.uid;

    if (!userId) {
      return res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        error: 'Autenticação necessária.',
      });
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      logger.error('requireKYC: Supabase indisponível', { middleware: 'requireKYC', userId });
      return res.status(503).json({
        success: false,
        code: 'SERVICE_UNAVAILABLE',
        error: 'Serviço de verificação temporariamente indisponível.',
      });
    }

    try {
      const { data: user, error } = await supabase
        .from('users')
        .select('kyc_status, kyc_level, kyc_verified_at')
        .eq('id', userId)
        .single();

      if (error) {
        logger.error('requireKYC: erro ao consultar usuário', {
          middleware: 'requireKYC',
          userId,
          error: error.message,
        });
        // Fail-open: se não conseguir consultar, bloqueia por segurança
        return res.status(503).json({
          success: false,
          code: 'SERVICE_UNAVAILABLE',
          error: 'Não foi possível verificar sua identidade. Tente novamente.',
        });
      }

      const kycStatus = user?.kyc_status || 'none';
      const kycLevel  = user?.kyc_level  || 'none';

      if (kycStatus !== 'verified' || !_meetsLevel(kycLevel, requiredLevel)) {
        logger.info('requireKYC: acesso negado — KYC insuficiente', {
          middleware: 'requireKYC',
          userId,
          kycStatus,
          kycLevel,
          requiredLevel,
        });

        return res.status(403).json({
          success:        false,
          code:           'KYC_REQUIRED',
          error:          'Verificação de identidade necessária para esta operação.',
          currentStatus:  kycStatus,
          currentLevel:   kycLevel,
          requiredLevel,
          // Instrui o frontend sobre o próximo passo
          nextStep: {
            description: 'Solicite um código OTP e verifique seu CPF.',
            otpGenerate: 'POST /api/security/otp/generate { "type": "kyc" }',
            kycVerify:   'POST /api/kyc/verify-cpf { "cpf", "birthDate", "declaredName" }',
          },
        });
      }

      // KYC satisfeito — adiciona contexto ao request
      req.kycContext = { kycStatus, kycLevel, kycVerifiedAt: user?.kyc_verified_at };

      logger.info('requireKYC: acesso autorizado', {
        middleware: 'requireKYC',
        userId,
        kycLevel,
        requiredLevel,
      });

      next();
    } catch (err) {
      logger.error('requireKYC: exceção não tratada', {
        middleware: 'requireKYC',
        userId,
        error: err.message,
      });
      return res.status(500).json({
        success: false,
        code: 'INTERNAL_ERROR',
        error: 'Erro interno ao verificar identidade.',
      });
    }
  };
};

module.exports = requireKYC;
