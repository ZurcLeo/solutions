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

    // Rate limit interceptor: warn quando restam poucas chamadas + retry em 429
    this.client.interceptors.response.use(
      (response) => {
        const remaining = response.headers['ratelimit-remaining'];
        if (remaining !== undefined && Number(remaining) < 100) {
          logger.warn('Asaas rate limit baixo', {
            service: 'AsaasService',
            rateLimitRemaining: remaining,
          });
        }
        return response;
      },
      async (error) => {
        if (error.response?.status === 429 && !error.config._retried) {
          error.config._retried = true;
          const retryAfter = Number(error.response.headers['retry-after'] || 2) * 1000;
          logger.warn('Asaas 429 — aguardando retry', {
            service: 'AsaasService',
            retryAfterMs: retryAfter,
          });
          await new Promise(resolve => setTimeout(resolve, retryAfter));
          return this.client.request(error.config);
        }
        return Promise.reject(error);
      }
    );
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
        // Se o customer existe sem CPF e agora temos, atualizar via PUT
        if (cpfCnpj && !existing.cpfCnpj) {
          await this.client.put(`/customers/${existing.id}`, {
            cpfCnpj: cpfCnpj.replace(/\D/g, ''),
          });
          logger.info('Customer atualizado com CPF no Asaas', {
            service: 'AsaasService', method: 'createCustomer', customerId: existing.id,
          });
        } else {
          logger.info('Customer já existe no Asaas', {
            service: 'AsaasService', method: 'createCustomer', customerId: existing.id,
          });
        }
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
  async createPixCharge({ customerId, value, description, externalReference, split, txid }) {
    try {
      logger.info('Criando cobrança PIX no Asaas', {
        service: 'AsaasService',
        method: 'createPixCharge',
        customerId,
        value,
        externalReference,
        hasTxid: !!txid
      });

      // H0-002: validade de 7 dias (antes: amanhã / 30 min)
      const dueDate = this._getDatePlusDays(7);

      const { data: payment } = await this.client.post('/payments', {
        customer: customerId,
        billingType: 'PIX',
        value,
        dueDate,
        description,
        externalReference,       // mantém caixinhaId:userId para reconciliação no webhook
        postalService: false,
        // H0-003: txid customizado embutido no QR Code (a ser validado na sandbox H0-009)
        // Se o Asaas suportar, payment.pixTxid virá no webhook; senão, campo é ignorado
        ...(txid && { txid }),
        ...(split && split.length > 0 && { split })
      });

      // Buscar QR code gerado para o pagamento
      const { data: qrCode } = await this.client.get(
        `/payments/${payment.id}/pixQrCode`
      );

      logger.info('Cobrança PIX criada com sucesso', {
        service: 'AsaasService',
        method: 'createPixCharge',
        paymentId: payment.id,
        pixTxid: payment.pixTxid || null,
        status: payment.status
      });

      return {
        id: payment.id,
        pixCopiaECola: qrCode.payload,
        encodedImage: qrCode.encodedImage,
        txid: payment.pixTxid || payment.id,
        status: payment.status,
        expirationDate: this._getDatePlusDays(7) + 'T23:59:59.000Z',
        invoiceUrl: payment.invoiceUrl || null,
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
   * Busca dados da transação PIX de um pagamento recebido.
   * Retorna informações do pagador: nome, CPF/CNPJ e dados bancários.
   * Necessário para verificar titularidade na validação de conta.
   */
  async getPixTransaction(paymentId) {
    try {
      logger.info('Buscando transação PIX', {
        service: 'AsaasService',
        method: 'getPixTransaction',
        paymentId,
      });

      const { data } = await this.client.get(`/payments/${paymentId}/pixTransaction`);

      return {
        endToEndId:  data.endToEndId  || null,
        payerName:   data.payer?.name     || null,
        payerCpfCnpj: data.payer?.cpfCnpj || null,
        payerIspb:   data.payer?.bankAccount?.ispb  || null,
        payerAgency: data.payer?.bankAccount?.agency || null,
        payerAccount: data.payer?.bankAccount?.accountNumber || null,
      };
    } catch (error) {
      logger.error('Erro ao buscar transação PIX', {
        service: 'AsaasService',
        method: 'getPixTransaction',
        paymentId,
        error: error.response?.data || error.message,
      });
      throw this._normalizeError(error, 'Falha ao buscar dados da transação PIX');
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
   * Cria uma subconta (white-label) no Asaas para uma caixinha.
   * A conta mestre ElosCloud (CNPJ) é responsável pela subconta.
   * Email gerado: caixinha-{caixinhaId}@eloscloud.com (único por caixinha).
   * O apiKey retornado não pode ser recuperado depois — deve ser persistido imediatamente.
   */
  async createSubconta({ caixinhaId, adminName, cpfCnpj, birthDate, phone }) {
    try {
      logger.info('Criando subconta Asaas para caixinha', {
        service: 'AsaasService',
        method: 'createSubconta',
        caixinhaId
      });

      const email = `caixinha-${caixinhaId}@eloscloud.com`;
      const name = `${adminName} — ${caixinhaId.slice(0, 8)}`;

      const payload = {
        name,
        email,
        cpfCnpj: cpfCnpj ? cpfCnpj.replace(/\D/g, '') : undefined,
        ...(birthDate && { birthDate }),
        ...(phone && { mobilePhone: phone.replace(/\D/g, '') }),
        companyType: 'MEI'
      };

      const { data } = await this.client.post('/accounts', payload);

      logger.info('Subconta Asaas criada com sucesso', {
        service: 'AsaasService',
        method: 'createSubconta',
        caixinhaId,
        accountId: data.id,
        walletId: data.walletId
      });

      return {
        accountId: data.id,
        walletId: data.walletId,
        apiKey: data.apiKey
      };
    } catch (error) {
      logger.error('Erro ao criar subconta Asaas', {
        service: 'AsaasService',
        method: 'createSubconta',
        caixinhaId,
        error: error.response?.data || error.message
      });
      throw this._normalizeError(error, 'Falha ao criar subconta no gateway de pagamento');
    }
  }

  /**
   * Realiza transferência PIX usando o apiKey da subconta da caixinha.
   * O dinheiro sai do saldo da subconta (não da conta mestre ElosCloud).
   */
  async createSubcontaTransfer({ subcontaApiKey, pixAddressKey, pixAddressKeyType, value, description }) {
    try {
      logger.info('Criando transferência via subconta', {
        service: 'AsaasService',
        method: 'createSubcontaTransfer',
        value,
        pixAddressKeyType
      });

      const subcontaClient = axios.create({
        baseURL: process.env.ASAAS_API_URL || 'https://sandbox.asaas.com/api/v3',
        headers: {
          'access_token': subcontaApiKey,
          'Content-Type': 'application/json',
          'User-Agent': 'ElosCloud/1.0'
        },
        timeout: 15000
      });

      const { data } = await subcontaClient.post('/transfers', {
        operationType: 'PIX',
        pixAddressKey,
        pixAddressKeyType,
        value,
        description,
        scheduleDate: this._getTodayDate()
      });

      logger.info('Transferência via subconta criada com sucesso', {
        service: 'AsaasService',
        method: 'createSubcontaTransfer',
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
      logger.error('Erro ao criar transferência via subconta', {
        service: 'AsaasService',
        method: 'createSubcontaTransfer',
        error: error.response?.data || error.message
      });
      throw this._normalizeError(error, 'Falha ao processar saque via subconta');
    }
  }

  /**
   * Cancela uma cobrança no Asaas.
   * Usado para invalidar um PIX expirado antes de gerar um novo.
   */
  async cancelPayment(paymentId) {
    try {
      logger.info('Cancelando cobrança no Asaas', {
        service: 'AsaasService',
        method: 'cancelPayment',
        paymentId,
      });

      await this.client.delete(`/payments/${paymentId}`);

      logger.info('Cobrança cancelada com sucesso', {
        service: 'AsaasService',
        method: 'cancelPayment',
        paymentId,
      });
    } catch (error) {
      // Se já foi cancelado ou não existe, não é erro fatal
      const status = error.response?.status;
      if (status === 404 || status === 400) {
        logger.warn('Cobrança já cancelada ou não encontrada', {
          service: 'AsaasService',
          method: 'cancelPayment',
          paymentId,
          status,
        });
        return;
      }
      logger.error('Erro ao cancelar cobrança no Asaas', {
        service: 'AsaasService',
        method: 'cancelPayment',
        paymentId,
        error: error.response?.data || error.message,
      });
      throw this._normalizeError(error, 'Falha ao cancelar cobrança no gateway de pagamento');
    }
  }

  /**
   * Cancela uma assinatura recorrente no Asaas (DELETE /subscriptions/{id}).
   * Idempotente: se já cancelada ou não encontrada, retorna silenciosamente.
   */
  async cancelSubscription(asaasSubscriptionId) {
    try {
      logger.info('Cancelando assinatura recorrente no Asaas', {
        service: 'AsaasService',
        method: 'cancelSubscription',
        asaasSubscriptionId,
      });

      await this.client.delete(`/subscriptions/${asaasSubscriptionId}`);

      logger.info('Assinatura cancelada com sucesso no Asaas', {
        service: 'AsaasService',
        method: 'cancelSubscription',
        asaasSubscriptionId,
      });
    } catch (error) {
      const status = error.response?.status;
      if (status === 404 || status === 400) {
        logger.warn('Assinatura já cancelada ou não encontrada no Asaas', {
          service: 'AsaasService',
          method: 'cancelSubscription',
          asaasSubscriptionId,
          status,
        });
        return;
      }
      logger.error('Erro ao cancelar assinatura no Asaas', {
        service: 'AsaasService',
        method: 'cancelSubscription',
        asaasSubscriptionId,
        error: error.response?.data || error.message,
      });
      throw this._normalizeError(error, 'Falha ao cancelar assinatura no gateway de pagamento');
    }
  }

  /**
   * Valida o token do webhook recebido no header asaas-access-token.
   * O token configurado no painel Asaas deve estar em ASAAS_WEBHOOK_TOKEN.
   */
  validateWebhookToken(req) {
    const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;

    if (!webhookToken) {
      logger.error('ASAAS_WEBHOOK_TOKEN não configurado — rejeitando webhook por segurança', {
        service: 'AsaasService',
        method: 'validateWebhookToken',
        action: 'WEBHOOK_REJECTED_NO_TOKEN'
      });
      return false;
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

  // ─── Cartão de crédito ──────────────────────────────────────────────

  /**
   * Pré-autorização (hold) em cartão de crédito sem captura imediata.
   * O valor fica reservado até captureAuthorizedPayment() ou refundPayment() (void).
   */
  async authorizeCardPayment({ customerId, value, description, externalReference, creditCard, creditCardHolderInfo }) {
    try {
      logger.info('Criando pré-autorização de cartão no Asaas', {
        service: 'AsaasService', method: 'authorizeCardPayment', customerId, value, externalReference,
      });

      if (value < 5) throw new Error('Valor mínimo para cartão no Asaas é R$ 5,00.');

      const payload = {
        customer: customerId,
        billingType: 'CREDIT_CARD',
        value,
        dueDate: new Date().toISOString().slice(0, 10),
        authorizeOnly: true,
        description,
        externalReference,
        ...(creditCard && { creditCard }),
        ...(creditCardHolderInfo && { creditCardHolderInfo }),
      };

      const { data } = await this.client.post('/payments', payload);

      logger.info('Pré-autorização criada com sucesso', {
        service: 'AsaasService', method: 'authorizeCardPayment', paymentId: data.id, status: data.status,
      });

      return { paymentId: data.id, status: data.status };
    } catch (error) {
      logger.error('Erro ao criar pré-autorização de cartão', {
        service: 'AsaasService', method: 'authorizeCardPayment',
        error: error.response?.data || error.message,
      });
      throw this._normalizeError(error, 'Falha ao pré-autorizar pagamento com cartão');
    }
  }

  /**
   * Captura um pagamento previamente autorizado (AUTHORIZED → CONFIRMED).
   */
  async captureAuthorizedPayment(paymentId) {
    try {
      logger.info('Capturando pagamento autorizado', {
        service: 'AsaasService', method: 'captureAuthorizedPayment', paymentId,
      });

      const { data } = await this.client.post(`/payments/${paymentId}/captureAuthorizedPayment`);

      logger.info('Pagamento capturado com sucesso', {
        service: 'AsaasService', method: 'captureAuthorizedPayment', paymentId, status: data.status,
      });

      return { paymentId: data.id, status: data.status, value: data.value };
    } catch (error) {
      logger.error('Erro ao capturar pagamento autorizado', {
        service: 'AsaasService', method: 'captureAuthorizedPayment', paymentId,
        error: error.response?.data || error.message,
      });
      throw this._normalizeError(error, 'Falha ao capturar pagamento');
    }
  }

  /**
   * Reembolsa um pagamento (void se AUTHORIZED, refund se CONFIRMED/RECEIVED).
   * @param {string} paymentId
   * @param {number} [value] — se omitido, reembolso total
   */
  async refundPayment(paymentId, value) {
    try {
      logger.info('Processando reembolso/void', {
        service: 'AsaasService', method: 'refundPayment', paymentId, partialValue: value,
      });

      const payload = value !== undefined ? { value } : {};
      const { data } = await this.client.post(`/payments/${paymentId}/refund`, payload);

      logger.info('Reembolso processado com sucesso', {
        service: 'AsaasService', method: 'refundPayment', paymentId, status: data.status,
      });

      return { paymentId: data.id, status: data.status, value: data.value };
    } catch (error) {
      // Se já foi reembolsado/cancelado, não é erro fatal
      const status = error.response?.status;
      if (status === 400 || status === 404) {
        logger.warn('Pagamento já reembolsado ou não encontrado', {
          service: 'AsaasService', method: 'refundPayment', paymentId, status,
        });
        return { paymentId, status: 'already_refunded', value: 0 };
      }
      logger.error('Erro ao processar reembolso', {
        service: 'AsaasService', method: 'refundPayment', paymentId,
        error: error.response?.data || error.message,
      });
      throw this._normalizeError(error, 'Falha ao processar reembolso');
    }
  }

  /**
   * Cobrança imediata em cartão (sem hold — débito instantâneo).
   * Uso: compra de ElosCoins, cobranças extras.
   */
  async createCardCharge({ customerId, value, description, externalReference, creditCard, creditCardHolderInfo }) {
    try {
      logger.info('Criando cobrança de cartão imediata', {
        service: 'AsaasService', method: 'createCardCharge', customerId, value, externalReference,
      });

      if (value < 5) throw new Error('Valor mínimo para cartão no Asaas é R$ 5,00.');

      const payload = {
        customer: customerId,
        billingType: 'CREDIT_CARD',
        value,
        description,
        externalReference,
        ...(creditCard && { creditCard }),
        ...(creditCardHolderInfo && { creditCardHolderInfo }),
      };

      const { data } = await this.client.post('/payments', payload);

      logger.info('Cobrança de cartão criada com sucesso', {
        service: 'AsaasService', method: 'createCardCharge', paymentId: data.id, status: data.status,
      });

      return { paymentId: data.id, status: data.status, value: data.value, invoiceUrl: data.invoiceUrl || null };
    } catch (error) {
      logger.error('Erro ao criar cobrança de cartão', {
        service: 'AsaasService', method: 'createCardCharge',
        error: error.response?.data || error.message,
      });
      throw this._normalizeError(error, 'Falha ao cobrar cartão');
    }
  }

  /**
   * Cria cobrança de boleto bancário.
   */
  async createBoletoCharge({ customerId, value, dueDate, description, externalReference }) {
    try {
      logger.info('Criando cobrança de boleto', {
        service: 'AsaasService', method: 'createBoletoCharge', customerId, value, externalReference,
      });

      const { data } = await this.client.post('/payments', {
        customer: customerId,
        billingType: 'BOLETO',
        value,
        dueDate: dueDate || this._getDatePlusDays(3),
        description,
        externalReference,
      });

      logger.info('Boleto criado com sucesso', {
        service: 'AsaasService', method: 'createBoletoCharge', paymentId: data.id,
      });

      return {
        paymentId: data.id,
        status: data.status,
        bankSlipUrl: data.bankSlipUrl,
        invoiceUrl: data.invoiceUrl,
        dueDate: data.dueDate,
      };
    } catch (error) {
      logger.error('Erro ao criar boleto', {
        service: 'AsaasService', method: 'createBoletoCharge',
        error: error.response?.data || error.message,
      });
      throw this._normalizeError(error, 'Falha ao gerar boleto');
    }
  }

  /**
   * Cria Payment Link hospedado do Asaas.
   * Usado para cartão de crédito recorrente — redireciona o cliente
   * para a tela de checkout do Asaas onde preenche dados do cartão.
   * Endpoint: POST /paymentLinks
   * Docs: https://docs.asaas.com/reference/criar-um-link-de-pagamentos
   */
  async createCheckoutLink({ name, description, value, externalReference, cycle, successUrl }) {
    try {
      logger.info('Criando payment link Asaas', {
        service: 'AsaasService', method: 'createCheckoutLink', value, cycle, externalReference,
      });

      const isRecurrent = !!cycle;
      const payload = {
        name,
        description,
        billingType: 'CREDIT_CARD',
        chargeType: isRecurrent ? 'RECURRENT' : 'DETACHED',
        value,
        ...(externalReference && { externalReference }),
        ...(isRecurrent && { subscriptionCycle: cycle.toUpperCase() }),
        ...(successUrl && !successUrl.includes('localhost') && {
          callback: { successUrl, autoRedirect: true },
        }),
      };

      const { data } = await this.client.post('/paymentLinks', payload);

      logger.info('Payment link criado com sucesso', {
        service: 'AsaasService', method: 'createCheckoutLink', linkId: data.id, url: data.url,
      });

      return { id: data.id, url: data.url };
    } catch (error) {
      logger.error('Erro ao criar payment link', {
        service: 'AsaasService', method: 'createCheckoutLink',
        error: error.response?.data || error.message,
      });
      throw this._normalizeError(error, 'Falha ao criar link de pagamento');
    }
  }

  // ─── Assinaturas recorrentes (checkout transparente) ───────────────

  /**
   * Cria assinatura recorrente via cartão de crédito (checkout transparente).
   * Endpoint: POST /subscriptions
   * O primeiro pagamento é cobrado imediatamente.
   */
  async createCardSubscription({ customer, value, nextDueDate, cycle, description, externalReference, creditCard, creditCardHolderInfo, remoteIp }) {
    try {
      logger.info('Criando assinatura recorrente com cartão', {
        service: 'AsaasService', method: 'createCardSubscription', customer, value, cycle, externalReference,
      });

      if (value < 5) throw new Error('Valor mínimo para assinatura no Asaas é R$ 5,00.');

      const payload = {
        customer,
        billingType: 'CREDIT_CARD',
        value,
        nextDueDate: nextDueDate || this._getTodayDate(),
        cycle: cycle || 'MONTHLY',
        description,
        externalReference,
        creditCard,
        creditCardHolderInfo,
        ...(remoteIp && { remoteIp }),
      };

      const { data } = await this.client.post('/subscriptions', payload);

      logger.info('Assinatura recorrente criada com sucesso', {
        service: 'AsaasService', method: 'createCardSubscription',
        subscriptionId: data.id, status: data.status, nextDueDate: data.nextDueDate,
      });

      return { subscriptionId: data.id, status: data.status, nextDueDate: data.nextDueDate };
    } catch (error) {
      logger.error('Erro ao criar assinatura recorrente', {
        service: 'AsaasService', method: 'createCardSubscription',
        error: error.response?.data || error.message,
      });
      throw this._normalizeError(error, 'Falha ao criar assinatura recorrente com cartão');
    }
  }

  // ─── Atualizar valor de assinatura recorrente ─────────────────────

  /**
   * Atualiza o valor de uma assinatura recorrente no Asaas.
   * Usado para refletir add-ons (ex: IconChat +R$29,90).
   * PUT /subscriptions/{id}
   */
  async updateSubscriptionValue(asaasSubscriptionId, newValue, description) {
    try {
      logger.info('Atualizando valor da assinatura no Asaas', {
        service: 'AsaasService', method: 'updateSubscriptionValue',
        asaasSubscriptionId, newValue,
      });

      const payload = { value: newValue };
      if (description) payload.description = description;

      const { data } = await this.client.put(`/subscriptions/${asaasSubscriptionId}`, payload);

      logger.info('Valor da assinatura atualizado com sucesso', {
        service: 'AsaasService', method: 'updateSubscriptionValue',
        subscriptionId: data.id, newValue: data.value,
      });

      return { subscriptionId: data.id, value: data.value, status: data.status };
    } catch (error) {
      logger.error('Erro ao atualizar valor da assinatura', {
        service: 'AsaasService', method: 'updateSubscriptionValue',
        asaasSubscriptionId,
        error: error.response?.data || error.message,
      });
      throw this._normalizeError(error, 'Falha ao atualizar valor da assinatura');
    }
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

  _getDatePlusDays(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0]; // YYYY-MM-DD
  }

  _getTomorrowDate() {
    return this._getDatePlusDays(1);
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
