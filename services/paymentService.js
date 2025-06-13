const { MercadoPagoConfig, Payment } = require('mercadopago');
const { logger } = require('../logger');
const { v4: uuidv4 } = require('uuid');

class PaymentService {
  constructor() {
    if (!process.env.MERCADOPAGO_ACCESS_TOKEN) {
      throw new Error('MERCADOPAGO_ACCESS_TOKEN is not defined');
  }
  
  this.client = new MercadoPagoConfig({ 
      accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN 
  });
  this.payment = new Payment(this.client);
}

  async createPixPayment(amount, description, payer, additionalData = {}) {
    try {
      logger.info('Creating PIX payment', {
        service: 'PaymentService',
        method: 'createPixPayment',
        payer,
        amount,
        description,
        notificationUrl: additionalData.notificationUrl,
        externalReference: additionalData.externalReference
      });

      const paymentData = {
        transaction_amount: amount,
        description,
        payment_method_id: 'pix',
        payer: {
          email: payer.email,
          first_name: payer.first_name || payer.firstName || '',
          last_name: payer.last_name || payer.lastName || '',
          identification: {
            type: payer.identificationType || 'CPF',
            number: payer.identificationNumber,
          },
          // Campos extras para melhorar score
          ...(payer.phone && {
            phone: {
              area_code: payer.phone.substring(0, 2),
              number: payer.phone.substring(2)
            }
          }),
          ...(payer.address && { address: payer.address })
        },
        // Incluir items apenas se fornecidos (PIX aceita sem items)
        ...(additionalData.items && additionalData.items.length > 0 && { 
          items: additionalData.items.map(item => ({
            id: item.id || 'item-default',
            title: item.title || description,
            description: item.description || description,
            category_id: item.category_id || 'others',
            quantity: item.quantity || 1,
            unit_price: item.unit_price || amount
          }))
        }),
        date_of_expiration: this._get24HourExpiration(),
        ...(additionalData.notificationUrl && { notification_url: additionalData.notificationUrl }),
        external_reference: additionalData.externalReference,
        statement_descriptor: 'ELOSCLOUD VALIDACAO',
        // Campos adicionais para anti-fraude
        ...(additionalData.binaryMode !== undefined && { binary_mode: additionalData.binaryMode }),
        ...(additionalData.capture !== undefined && { capture: additionalData.capture }),
        ...(additionalData.sponsorId && { sponsor_id: additionalData.sponsorId })
      };

      const payment = await this.payment.create({
        body: paymentData,
        requestOptions: {
          idempotencyKey: uuidv4()
        }
      });

      // O resto do código permanece similar, apenas ajustando a estrutura de resposta
      const transactionData = payment.point_of_interaction.transaction_data;

      return {
        id: payment.id,
        qr_code: transactionData.qr_code,
        qr_code_base64: transactionData.qr_code_base64,
        ticket_url: transactionData.ticket_url,
        status: payment.status,
        expires_at: payment.date_of_expiration,
      };
    } catch (error) {
      logger.error('Error creating PIX payment', {
        service: 'PaymentService',
        method: 'createPixPayment',
        error: error.message,
      });
      throw error;
    }
  }

  async checkPaymentStatus(paymentId) {
    try {
      logger.info('Checking payment status', {
        service: 'PaymentService',
        method: 'checkPaymentStatus',
        paymentId,
      });

      const payment = await this.payment.get({ id: paymentId });

      return {
        id: payment.id,
        status: payment.status,
        status_detail: payment.status_detail,
        transaction_amount: payment.transaction_amount,
        date_created: payment.date_created,
        date_approved: payment.date_approved,
        payer: {
          email: payment.payer?.email,
          identification: payment.payer?.identification,
          first_name: payment.payer?.first_name,
          last_name: payment.payer?.last_name
        },
        payment_method: {
          id: payment.payment_method_id,
          type: payment.payment_type_id
        },
        transaction_details: payment.transaction_details
      };
    } catch (error) {
      logger.error('Error checking payment status', {
        service: 'PaymentService',
        method: 'checkPaymentStatus',
        error: error.message,
        paymentId,
      });
      throw error;
    }
  }

  async createCardPayment(paymentData) {
    try {
      logger.info('Creating card payment', {
        service: 'PaymentService',
        method: 'createCardPayment',
        amount: paymentData.amount,
        paymentMethodId: paymentData.payment_method_id,
        installments: paymentData.installments
      });

      const payment = await this.payment.create({
        body: {
          token: paymentData.token,
          transaction_amount: paymentData.amount,
          description: paymentData.description,
          installments: paymentData.installments || 1,
          payment_method_id: paymentData.payment_method_id,
          issuer_id: paymentData.issuer_id,
          payer: {
            email: paymentData.payer.email,
            first_name: paymentData.payer.first_name || '',
            last_name: paymentData.payer.last_name || '',
            identification: {
              type: paymentData.payer.identification.type,
              number: paymentData.payer.identification.number
            },
            // Campos extras para melhorar score
            ...(paymentData.payer.phone && {
              phone: {
                area_code: paymentData.payer.phone.substring(0, 2),
                number: paymentData.payer.phone.substring(2)
              }
            }),
            ...(paymentData.payer.address && { address: paymentData.payer.address })
          },
          // SEMPRE incluir items para melhorar score (CRÍTICO para 73+ pontos)
          items: paymentData.items || [{
            id: 'card-payment-001',
            title: paymentData.description || 'Pagamento ElosCloud',
            description: paymentData.description || 'Pagamento via cartão de crédito',
            category_id: 'services',
            quantity: 1,
            unit_price: paymentData.amount
          }],
          additional_info: {
            device_id: paymentData.device_id,
            // Informações extras para anti-fraude
            ip_address: paymentData.ip_address,
            user_agent: paymentData.user_agent
          },
          ...(paymentData.notification_url && { notification_url: paymentData.notification_url }),
          external_reference: paymentData.external_reference,
          metadata: {
            sdk_version: 'v2',
            integration_type: 'eloscloud_backend',
            ...paymentData.metadata
          },
          // Campos para melhorar score de aprovação
          binary_mode: false,
          capture: true,
          statement_descriptor: 'ELOSCLOUD',
          // 3D Secure para cartões internacionais
          three_d_secure_mode: 'optional',
          // Dados extras para validação
          ...(paymentData.sponsor_id && { sponsor_id: paymentData.sponsor_id }),
          ...(paymentData.application_fee && { application_fee: paymentData.application_fee })
        },
        requestOptions: {
          idempotencyKey: uuidv4()
        }
      });

      logger.info('Card payment created successfully', {
        service: 'PaymentService',
        method: 'createCardPayment',
        paymentId: payment.id,
        status: payment.status
      });

      return {
        id: payment.id,
        status: payment.status,
        status_detail: payment.status_detail,
        payment_method_id: payment.payment_method_id,
        payment_type_id: payment.payment_type_id,
        amount: payment.transaction_amount,
        currency_id: payment.currency_id,
        transaction_amount: payment.transaction_amount,
        installments: payment.installments,
        date_created: payment.date_created,
        date_approved: payment.date_approved,
        payer: {
          id: payment.payer?.id,
          email: payment.payer?.email,
          identification: payment.payer?.identification
        },
        card: payment.card ? {
          first_six_digits: payment.card.first_six_digits,
          last_four_digits: payment.card.last_four_digits,
          cardholder: payment.card.cardholder
        } : null
      };

    } catch (error) {
      logger.error('Error creating card payment', {
        service: 'PaymentService',
        method: 'createCardPayment',
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  validateDeviceId(deviceId) {
    if (!deviceId) {
      logger.warn('Device ID validation failed: empty or null', {
        service: 'PaymentService',
        method: 'validateDeviceId',
        deviceId
      });
      return false;
    }
    
    // SDK V2 generates device IDs with specific patterns
    const validPatterns = ['MP_', 'DEVICE_', 'mp-', 'device-'];
    const isValid = validPatterns.some(pattern => deviceId.startsWith(pattern)) && deviceId.length > 10;
    
    if (!isValid) {
      logger.warn('Device ID validation failed: invalid format', {
        service: 'PaymentService',
        method: 'validateDeviceId',
        deviceId,
        length: deviceId.length
      });
    }
    
    return isValid;
  }

  validateCardToken(token) {
    if (!token) {
      logger.warn('Token validation failed: empty or null', {
        service: 'PaymentService',
        method: 'validateCardToken'
      });
      return false;
    }
    
    // MercadoPago tokens are alphanumeric and typically longer than 20 chars
    const isValid = token.length > 20 && /^[a-zA-Z0-9_-]+$/.test(token);
    
    if (!isValid) {
      logger.warn('Token validation failed: invalid format', {
        service: 'PaymentService',
        method: 'validateCardToken',
        tokenLength: token.length,
        tokenPattern: /^[a-zA-Z0-9_-]+$/.test(token)
      });
    }
    
    return isValid;
  }

  validatePaymentData(paymentData) {
    const errors = [];
    
    // Validações obrigatórias para pontuação alta
    if (!paymentData.token) errors.push('Token is required');
    if (!paymentData.device_id) errors.push('Device ID is required (SDK V2)');
    if (!paymentData.amount || paymentData.amount <= 0) errors.push('Amount must be greater than 0');
    if (!paymentData.payer?.email) errors.push('Payer email is required');
    if (!paymentData.payer?.first_name) errors.push('Payer first name is required');
    if (!paymentData.payer?.last_name) errors.push('Payer last name is required');
    if (!paymentData.payer?.identification?.type) errors.push('Payer identification type is required');
    if (!paymentData.payer?.identification?.number) errors.push('Payer identification number is required');
    
    // Validações para melhorar score
    if (!paymentData.description) errors.push('Description is recommended for better approval rates');
    if (!paymentData.external_reference) errors.push('External reference is recommended');
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings: errors.filter(e => e.includes('recommended'))
    };
  }

  _get24HourExpiration() {
    const date = new Date();
    date.setHours(date.getHours() + 24);
    return date.toISOString();
  }
}

module.exports = new PaymentService();