const {stripeService} = require('../services/stripeService')

// models/Payment.js
class Payment {
    constructor(data) {
      this.id = data.id;
      this.userId = data.userId;
      this.amount = data.amount;
      this.status = data.status;
      this.type = data.type; // 'payment', 'refund', 'withdrawal'
      this.description = data.description;
      this.createdAt = data.createdAt || new Date();
    }
  
    // Métodos existentes de Stripe continuam funcionando
    static async processPayment(paymentData) {
      // Integração com Stripe existente
      return await stripeService.createPaymentIntent(paymentData);
    }
  }

  module.exports = Payment;