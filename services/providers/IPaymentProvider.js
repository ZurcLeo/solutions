/**
 * IPaymentProvider — Interface abstrata para provedores de pagamento.
 *
 * Objetivo: evitar lock-in com um único provedor (Asaas).
 * Para trocar de provedor (ex: Celcoin, BaaS), basta implementar esta interface
 * e ajustar a variável de ambiente PAYMENT_PROVIDER.
 *
 * Provedores implementados:
 *   - 'asaas' (padrão) → AsaasProvider.js
 *
 * Uso:
 *   const provider = require('./paymentProviderFactory').getProvider();
 *   await provider.createPixCharge({ ... });
 */
class IPaymentProvider {
  /**
   * Cria ou reutiliza um customer no provedor.
   * @param {{ name, email, cpfCnpj, phone, externalReference }} params
   * @returns {Promise<{ id: string }>}
   */
  async createCustomer(params) {
    throw new Error('IPaymentProvider.createCustomer() não implementado');
  }

  /**
   * Cria uma cobrança PIX e retorna QR Code.
   * @param {{ customerId, value, description, externalReference, split, txid }} params
   * @returns {Promise<{ id, pixCopiaECola, encodedImage, txid, status, expirationDate }>}
   */
  async createPixCharge(params) {
    throw new Error('IPaymentProvider.createPixCharge() não implementado');
  }

  /**
   * Consulta o status de um pagamento.
   * @param {string} paymentId
   * @returns {Promise<{ id, status, value, paymentDate, externalReference }>}
   */
  async getPaymentStatus(paymentId) {
    throw new Error('IPaymentProvider.getPaymentStatus() não implementado');
  }

  /**
   * Cancela uma cobrança pendente.
   * @param {string} paymentId
   * @returns {Promise<void>}
   */
  async cancelPayment(paymentId) {
    throw new Error('IPaymentProvider.cancelPayment() não implementado');
  }

  /**
   * Realiza transferência PIX (saque) para chave externa.
   * @param {{ pixAddressKey, pixAddressKeyType, value, description }} params
   * @returns {Promise<{ id, status, value, transferDate }>}
   */
  async createTransfer(params) {
    throw new Error('IPaymentProvider.createTransfer() não implementado');
  }

  /**
   * Realiza transferência PIX via subconta de uma caixinha.
   * @param {{ subcontaApiKey, pixAddressKey, pixAddressKeyType, value, description }} params
   * @returns {Promise<{ id, status, value, transferDate }>}
   */
  async createSubcontaTransfer(params) {
    throw new Error('IPaymentProvider.createSubcontaTransfer() não implementado');
  }

  /**
   * Cria subconta (white-label) para uma caixinha.
   * @param {{ caixinhaId, adminName, cpfCnpj, birthDate, phone }} params
   * @returns {Promise<{ accountId, walletId, apiKey }>}
   */
  async createSubconta(params) {
    throw new Error('IPaymentProvider.createSubconta() não implementado');
  }

  /**
   * Valida o token do webhook recebido.
   * @param {import('express').Request} req
   * @returns {boolean}
   */
  validateWebhookToken(req) {
    throw new Error('IPaymentProvider.validateWebhookToken() não implementado');
  }

  /**
   * Busca dados da transação PIX de um pagamento (nome/CPF do pagador).
   * @param {string} paymentId
   * @returns {Promise<{ endToEndId, payerName, payerCpfCnpj, payerIspb, payerAgency, payerAccount }>}
   */
  async getPixTransaction(paymentId) {
    throw new Error('IPaymentProvider.getPixTransaction() não implementado');
  }

  /**
   * Pré-autorização (hold) em cartão de crédito.
   * @param {{ customerId, value, description, externalReference, creditCard?, creditCardHolderInfo? }} params
   * @returns {Promise<{ paymentId: string, status: string }>}
   */
  async authorizeCardPayment(params) {
    throw new Error('IPaymentProvider.authorizeCardPayment() não implementado');
  }

  /**
   * Captura pagamento previamente autorizado.
   * @param {string} paymentId
   * @returns {Promise<{ paymentId: string, status: string, value: number }>}
   */
  async captureAuthorizedPayment(paymentId) {
    throw new Error('IPaymentProvider.captureAuthorizedPayment() não implementado');
  }

  /**
   * Reembolsa (void se autorizado, refund se confirmado).
   * @param {string} paymentId
   * @param {number} [value] — omitir para reembolso total
   * @returns {Promise<{ paymentId: string, status: string, value: number }>}
   */
  async refundPayment(paymentId, value) {
    throw new Error('IPaymentProvider.refundPayment() não implementado');
  }

  /**
   * Cobrança imediata em cartão (sem hold).
   * @param {{ customerId, value, description, externalReference, creditCard?, creditCardHolderInfo? }} params
   * @returns {Promise<{ paymentId: string, status: string, value: number }>}
   */
  async createCardCharge(params) {
    throw new Error('IPaymentProvider.createCardCharge() não implementado');
  }
}

module.exports = IPaymentProvider;
