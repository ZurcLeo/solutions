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

  async createPixPayment(amount, description, payer) {
    try {
      logger.info('Creating PIX payment', {
        service: 'PaymentService',
        method: 'createPixPayment',
        payer,
        amount,
        description,
      });

      const paymentData = {
        transaction_amount: amount,
        description,
        payment_method_id: 'pix',
        payer: {
          email: payer.email,
          identification: {
            type: payer.identificationType,
            number: payer.identificationNumber,
          },
        },
        date_of_expiration: this._get24HourExpiration(),
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
        status: payment.status,
        status_detail: payment.status_detail,
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

  _get24HourExpiration() {
    const date = new Date();
    date.setHours(date.getHours() + 24);
    return date.toISOString();
  }
}

module.exports = new PaymentService();