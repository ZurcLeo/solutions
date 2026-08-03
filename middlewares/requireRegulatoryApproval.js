'use strict';

/**
 * @fileoverview Middleware de compliance — bloqueia modulos com risco regulatorio.
 *
 * Retorna 403 com mensagem padrao quando a feature flag esta desligada.
 * Uso nas rotas:
 *   const { requireCaixinhaFinancial, requireGames, requireRifas } = require('../middlewares/requireRegulatoryApproval');
 *   router.post('/contribuicao', verifyToken, requireCaixinhaFinancial, ctrl.addContribuicao);
 *
 * @module middlewares/requireRegulatoryApproval
 */

const regulatoryFlags = require('../config/regulatoryFlags');
const { logger } = require('../logger');

const BLOCKED_RESPONSE = {
  success: false,
  error: 'module_under_legal_review',
  message: 'Modulo financeiro em homologacao juridica. Funcionalidade disponivel em breve.',
  details: {
    reason: 'regulatory_compliance',
    action: 'Aguarde liberacao juridica ou entre em contato com o suporte.',
  },
};

function createGate(flagKey, moduleName) {
  return function regulatoryGate(req, res, next) {
    if (regulatoryFlags[flagKey]) {
      return next();
    }

    logger.warn(`[regulatoryGate] Bloqueado: ${moduleName}`, {
      middleware: 'requireRegulatoryApproval',
      flag: flagKey,
      module: moduleName,
      method: req.method,
      path: req.originalUrl,
      userId: req.user?.uid || 'anonymous',
    });

    return res.status(403).json(BLOCKED_RESPONSE);
  };
}

module.exports = {
  requireCaixinhaFinancial: createGate('CAIXINHA_FINANCIAL_ENABLED', 'caixinha_financial'),
  requireGames:            createGate('GAMES_BOLAO_ENABLED', 'games_bolao'),
  requireRifas:            createGate('RIFAS_ENABLED', 'rifas'),
};
