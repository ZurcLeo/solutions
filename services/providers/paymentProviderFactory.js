/**
 * paymentProviderFactory — Resolve o provedor de pagamento ativo via env var.
 *
 * Variável de ambiente: PAYMENT_PROVIDER (default: 'asaas')
 *
 * Para trocar de provedor:
 *   1. Implemente IPaymentProvider em um novo arquivo (ex: CelcoinProvider.js)
 *   2. Registre no map abaixo
 *   3. Ajuste PAYMENT_PROVIDER no Fly.io (fly secrets set PAYMENT_PROVIDER=celcoin)
 *
 * Nenhuma alteração em controllers ou services é necessária.
 */
const { logger } = require('../../logger');

const PROVIDERS = {
  asaas: () => require('./AsaasProvider'),
  // celcoin: () => require('./CelcoinProvider'),  // futuro
};

let _cachedProvider = null;

function getProvider() {
  if (_cachedProvider) return _cachedProvider;

  const providerName = (process.env.PAYMENT_PROVIDER || 'asaas').toLowerCase();
  const factory = PROVIDERS[providerName];

  if (!factory) {
    logger.error('PAYMENT_PROVIDER inválido — usando Asaas como fallback seguro', {
      service: 'paymentProviderFactory',
      requested: providerName,
      available: Object.keys(PROVIDERS)
    });
    _cachedProvider = require('./AsaasProvider');
  } else {
    _cachedProvider = factory();
    logger.info('Provedor de pagamento ativo', {
      service: 'paymentProviderFactory',
      provider: providerName
    });
  }

  return _cachedProvider;
}

module.exports = { getProvider };
