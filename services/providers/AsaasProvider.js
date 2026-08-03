/**
 * AsaasProvider — Implementação de IPaymentProvider para o gateway Asaas.
 * Delega todas as chamadas para asaasService (singleton).
 * Registrado como 'asaas' no paymentProviderFactory.
 */
const IPaymentProvider = require('./IPaymentProvider');
const asaasService = require('../asaasService');

class AsaasProvider extends IPaymentProvider {
  async createCustomer(params) {
    return asaasService.createCustomer(params);
  }

  async createPixCharge(params) {
    return asaasService.createPixCharge(params);
  }

  async getPaymentStatus(paymentId) {
    return asaasService.getPaymentStatus(paymentId);
  }

  async cancelPayment(paymentId) {
    return asaasService.cancelPayment(paymentId);
  }

  async createTransfer(params) {
    return asaasService.createTransfer(params);
  }

  async createSubcontaTransfer(params) {
    return asaasService.createSubcontaTransfer(params);
  }

  async createSubconta(params) {
    return asaasService.createSubconta(params);
  }

  validateWebhookToken(req) {
    return asaasService.validateWebhookToken(req);
  }

  async getPixTransaction(paymentId) {
    return asaasService.getPixTransaction(paymentId);
  }

  async authorizeCardPayment(params) {
    return asaasService.authorizeCardPayment(params);
  }

  async captureAuthorizedPayment(paymentId) {
    return asaasService.captureAuthorizedPayment(paymentId);
  }

  async refundPayment(paymentId, value) {
    return asaasService.refundPayment(paymentId, value);
  }

  async createCardCharge(params) {
    return asaasService.createCardCharge(params);
  }
}

module.exports = new AsaasProvider();
