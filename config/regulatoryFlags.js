'use strict';

/**
 * @fileoverview Feature flags regulatorios — compliance gates.
 *
 * Controla modulos com risco regulatorio que devem permanecer
 * desativados para operacoes financeiras reais ate parecer juridico.
 *
 * Para reativar: defina a env var correspondente como "true" no Fly.io.
 *   fly secrets set CAIXINHA_FINANCIAL_ENABLED=true
 *   fly secrets set GAMES_BOLAO_ENABLED=true
 *   fly secrets set RIFAS_ENABLED=true
 *
 * @module config/regulatoryFlags
 */

const { logger } = require('../logger');

function envBool(key) {
  return (process.env[key] || '').toLowerCase() === 'true';
}

const regulatoryFlags = {
  CAIXINHA_FINANCIAL_ENABLED: envBool('CAIXINHA_FINANCIAL_ENABLED'),
  GAMES_BOLAO_ENABLED: envBool('GAMES_BOLAO_ENABLED'),
  RIFAS_ENABLED: envBool('RIFAS_ENABLED'),
};

logger.info('[regulatoryFlags] Estado das feature flags regulatorias:', {
  CAIXINHA_FINANCIAL_ENABLED: regulatoryFlags.CAIXINHA_FINANCIAL_ENABLED,
  GAMES_BOLAO_ENABLED:       regulatoryFlags.GAMES_BOLAO_ENABLED,
  RIFAS_ENABLED:             regulatoryFlags.RIFAS_ENABLED,
});

module.exports = regulatoryFlags;
