const axios = require('axios');
const { logger } = require('../logger');

class AsaasService {
  constructor() {
    if (!process.env.ASAAS_API_KEY) {
      logger.warn('ASAAS_API_KEY não configurada', { service: 'AsaasService' });
    }

    this.client = axios.create({
      baseURL: process.env.ASAAS_API_URL || 'https://sandbox.asaas.com/api/v3',
      headers: {
        'access_token': process.env.ASAAS_API_KEY,
        'Content-Type': 'application/json',
        'User-Agent': 'ElosCloud/1.0'
      },
      timeout: 15000
    });
  }

  /**
   * Cria ou localiza um customer no Asaas.
   * O Asaas exige um customer vinculado antes de criar uma cobrança.
   * Usa externalReference (userId) para evitar duplicatas.
   */
  async createCustomer({ name, email, cpfCnpj, phone, externalReference }) {
    try {
      logger.info('Criando customer no Asaas', {
        service: 'AsaasService',
        method: 'createCustomer',
        email,
        externalReference
      });

      // Verificar se já existe customer com esse externalReference
      const existing = await this._findCustomerByExternalRef(externalReference);
      if (existing) {
        logger.info('Customer já existe no Asaas', {
          service: 'AsaasService',
          method: 'createCustomer',
          customerId: existing.id
        });
        return { id: existing.id };
      }

      const { data } = await this.client.post('/customers', {
        name,
        email,
        cpfCnpj: cpfCnpj ? cpfCnpj.replace(/\D/g, '') : undefined,
        mobilePhone: phone ? phone.replace(/\D/g, '') : undefined,
        externalReference,
        notificationDisabled: true
      });

      logger.info('Customer criado com sucesso', {
        service: 'AsaasService',
        method: 'createCustomer',
        customerId: data.id
      });

      return { id: data.id };
    } catch (error) {
      logger.error('Erro ao criar customer no Asaas', {
        service: 'AsaasService',
        method: 'createCustomer',
        error: error.response?.data || error.message
      });
      throw this._normalizeError(error, 'Falha ao criar cliente no gateway de pagamento');
    }
  }

  /**
   * Cria cobrança PIX e retorna QR code para exibição ao usuário.
   * Fluxo: POST /payments → GET /payments/{id}/pixQrCode
   */
  async createPixCharge({ customerId, value, description, externalReference }) {
    try {
      logger.info('Criando cobrança PIX no Asaas', {
        service: 'AsaasService',
        method: 'createPixCharge',
        customerId,
        value,
        externalReference
      });

      const dueDate = this._getTomorrowDate();

      const { data: payment } = await this.client.post('/payments', {
        customer: customerId,
        billingType: 'PIX',
        value,
        dueDate,
        description,
        externalReference,
        postalService: false
      });

      // Buscar QR code gerado para o pagamento
      const { data: qrCode } = await this.client.get(
        `/payments/${payment.id}/pixQrCode`
      );

      logger.info('Cobrança PIX criada com sucesso', {
        service: 'AsaasService',
        method: 'createPixCharge',
        paymentId: payment.id,
        status: payment.status
      });

      return {
        id: payment.id,
        pixCopiaECola: qrCode.payload,
        encodedImage: qrCode.encodedImage,
        txid: payment.id,
        status: payment.status,
        expirationDate: qrCode.expirationDate || dueDate
      };
    } catch (error) {
      logger.error('Erro ao criar cobrança PIX no Asaas', {
        service: 'AsaasService',
        method: 'createPixCharge',
        error: error.response?.data || error.message
      });
      throw this._normalizeError(error, 'Falha ao gerar cobrança PIX');
    }
  }

  /**
   * Consulta status de um pagamento.
   */
  async getPaymentStatus(paymentId) {
    try {
      logger.info('Consultando status de pagamento', {
        service: 'AsaasService',
        method: 'getPaymentStatus',
        paymentId
      });

      const { data } = await this.client.get(`/payments/${paymentId}`);

      return {
        id: data.id,
        status: data.status,
        value: data.value,
        paymentDate: data.paymentDate || null,
        externalReference: data.externalReference
      };
    } catch (error) {
      logger.error('Erro ao consultar status de pagamento', {
        service: 'AsaasService',
        method: 'getPaymentStatus',
        paymentId,
        error: error.response?.data || error.message
      });
      throw this._normalizeError(error, 'Falha ao consultar pagamento');
    }
  }

  /**
   * Realiza transferência PIX para chave cadastrada do membro (saque).
   * walletId: conta Asaas de destino ou pixAddressKey para chave externa.
   */
  async createTransfer({ pixAddressKey, pixAddressKeyType, value, description }) {
    try {
      logger.info('Criando transferência de saque', {
        service: 'AsaasService',
        method: 'createTransfer',
        value,
        pixAddressKeyType
      });

      const { data } = await this.client.post('/transfers', {
        operationType: 'PIX',
        pixAddressKey,
        pixAddressKeyType, // CPF, CNPJ, EMAIL, PHONE, EVP
        value,
        description,
        scheduleDate: this._getTodayDate()
      });

      logger.info('Transferência criada com sucesso', {
        service: 'AsaasService',
        method: 'createTransfer',
        transferId: data.id,
        status: data.status
      });

      return {
        id: data.id,
        status: data.status,
        value: data.value,
        transferDate: data.transferDate
      };
    } catch (error) {
      logger.error('Erro ao criar transferência', {
        service: 'AsaasService',
        method: 'createTransfer',
        error: error.response?.data || error.message
      });
      throw this._normalizeError(error, 'Falha ao processar saque');
    }
  }

  /**
   * Valida o token do webhook recebido no header asaas-access-token.
   * O token configurado no painel Asaas deve estar em ASAAS_WEBHOOK_TOKEN.
   */
  validateWebhookToken(req) {
    const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;

    if (!webhookToken) {
      logger.warn('ASAAS_WEBHOOK_TOKEN não configurado — pulando validação', {
        service: 'AsaasService',
        method: 'validateWebhookToken'
      });
      return true;
    }

    const receivedToken = req.headers['asaas-access-token'];

    if (!receivedToken || receivedToken !== webhookToken) {
      logger.warn('Token de webhook Asaas inválido', {
        service: 'AsaasService',
        method: 'validateWebhookToken',
        hasToken: !!receivedToken
      });
      return false;
    }

    return true;
  }

  // ─── Helpers privados ──────────────────────────────────────────────

  async _findCustomerByExternalRef(externalReference) {
    try {
      const { data } = await this.client.get('/customers', {
        params: { externalReference }
      });
      return data.data?.[0] || null;
    } catch {
      return null;
    }
  }

  _getTomorrowDate() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0]; // YYYY-MM-DD
  }

  _getTodayDate() {
    return new Date().toISOString().split('T')[0];
  }

  _normalizeError(error, defaultMessage) {
    const asaasErrors = error.response?.data?.errors;
    if (asaasErrors?.length) {
      const descriptions = asaasErrors.map(e => e.description).join('; ');
      return new Error(`Asaas: ${descriptions}`);
    }
    return new Error(error.response?.data?.message || error.message || defaultMessage);
  }
}

module.exports = new AsaasService();
