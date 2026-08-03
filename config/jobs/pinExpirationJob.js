/**
 * @fileoverview PIN Expiration Job
 * Marca PINs expirados como 'expired' periodicamente.
 * Frequencia: a cada 5 minutos.
 */

'use strict';

const { logger } = require('../../logger');

function startPinExpirationJob() {
  logger.info('[pinExpirationJob] Iniciando job de expiracao de PINs (cada 5min)');

  setInterval(async () => {
    try {
      const iconPinExchangeService = require('../../services/iconPinExchangeService');
      await iconPinExchangeService.expireStaleExchanges();
    } catch (err) {
      logger.error('[pinExpirationJob] Erro na expiracao de PINs', { error: err.message });
    }
  }, 5 * 60 * 1000);
}

module.exports = { startPinExpirationJob };
