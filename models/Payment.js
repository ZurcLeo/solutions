const { logger } = require('../logger');
const crypto = require('crypto');

/**
 * Retorna hash HMAC-SHA256 do CPF/CNPJ limpo (somente dígitos).
 * Garante que o documento nunca é persistido em plaintext [SEC-003].
 * O hash é determinístico: permite auditar duplicatas sem expor o valor.
 */
function hashCpf(raw) {
  if (!raw) return null;
  const clean = String(raw).replace(/\D/g, '');
  const salt = process.env.CPF_HASH_SALT || process.env.MASTER_ENCRYPTION_KEY;
  if (!salt) {
    logger.error('CPF_HASH_SALT não configurado — documento fiscal não será armazenado', {
      model: 'Payment', method: 'hashCpf'
    });
    return null;
  }
  return crypto.createHmac('sha256', salt).update(clean).digest('hex');
}

// models/Payment.js
class Payment {
    constructor(data) {
        this.id = data.id;
        this.userId = data.userId;
        this.mercadoPagoPaymentId = data.mercadoPagoPaymentId;
        this.amount = data.amount;
        this.currency = data.currency || 'BRL';
        this.status = data.status;
        this.statusDetail = data.statusDetail;
        this.paymentMethodId = data.paymentMethodId;
        this.paymentTypeId = data.paymentTypeId;
        this.deviceId = data.deviceId; // CRITICAL FIELD for fraud prevention
        // tokenId nunca é persistido: token de cartão é de uso único [SEC-004]
        this.installments = data.installments || 1;
        this.description = data.description;
        this.payerEmail = data.payerEmail;
        this.payerIdentificationType = data.payerIdentificationType;
        this.payerIdentificationNumber = hashCpf(data.payerIdentificationNumber); // HMAC-SHA256 [SEC-003]
        this.metadata = data.metadata || {};
        this.type = data.type; // 'card_payment', 'pix_payment', 'refund', 'withdrawal'
        this.createdAt = data.createdAt || new Date();
        this.updatedAt = data.updatedAt || new Date();
    }

    static async processPayment(paymentData) {
        // Legacy — não mais utilizado diretamente
        throw new Error('Payment.processPayment() está deprecado. Use asaasService diretamente.');
    }

    // Criar pagamento no banco de dados
    static async create(paymentData) {
        try {
            // Aqui você implementaria a criação no seu banco de dados
            // Por enquanto, vou apenas retornar os dados formatados
            const payment = new Payment(paymentData);
            
            logger.info('Payment record created', {
                model: 'Payment',
                method: 'create',
                paymentId: payment.id,
                userId: payment.userId,
                amount: payment.amount,
                status: payment.status
            });

            return payment;
        } catch (error) {
            logger.error('Error creating payment record', {
                model: 'Payment',
                method: 'create',
                error: error.message,
                userId: paymentData?.userId,
                amount: paymentData?.amount
            });
            throw error;
        }
    }

    // Atualizar status do pagamento
    static async updateStatus(paymentId, statusData) {
        try {
            // Implementar atualização no banco de dados
            logger.info('Payment status updated', {
                model: 'Payment',
                method: 'updateStatus',
                paymentId,
                newStatus: statusData.status,
                statusDetail: statusData.statusDetail
            });

            return statusData;
        } catch (error) {
            logger.error('Error updating payment status', {
                model: 'Payment',
                method: 'updateStatus',
                error: error.message,
                paymentId,
                statusData
            });
            throw error;
        }
    }

    // Buscar pagamento por ID do MercadoPago
    static async findByMercadoPagoId(mercadoPagoPaymentId) {
        try {
            // Implementar busca no banco de dados
            logger.info('Searching payment by MercadoPago ID', {
                model: 'Payment',
                method: 'findByMercadoPagoId',
                mercadoPagoPaymentId
            });

            // Por enquanto retorna null - implementar busca real
            return null;
        } catch (error) {
            logger.error('Error finding payment by MercadoPago ID', {
                model: 'Payment',
                method: 'findByMercadoPagoId',
                error: error.message,
                mercadoPagoPaymentId
            });
            throw error;
        }
    }

    // Buscar pagamentos por usuário
    static async findByUserId(userId, options = {}) {
        try {
            logger.info('Searching payments by user ID', {
                model: 'Payment',
                method: 'findByUserId',
                userId,
                options
            });

            // Implementar busca no banco de dados
            return [];
        } catch (error) {
            logger.error('Error finding payments by user ID', {
                model: 'Payment',
                method: 'findByUserId',
                error: error.message,
                userId
            });
            throw error;
        }
    }

    // Método alternativo para compatibilidade
    static async getByUserId(userId, limit = 10) {
        try {
            return await this.findByUserId(userId, { limit });
        } catch (error) {
            logger.warn('Failed to get payments by user ID', { userId, error: error.message });
            return [];
        }
    }

    // Validar dados do pagamento
    static validate(paymentData) {
        const errors = [];

        if (!paymentData.amount || paymentData.amount <= 0) {
            errors.push('Amount must be greater than 0');
        }

        if (!paymentData.userId) {
            errors.push('User ID is required');
        }

        if (!paymentData.payerEmail) {
            errors.push('Payer email is required');
        }

        if (paymentData.type === 'card_payment' && !paymentData.deviceId) {
            errors.push('Device ID is required for card payments');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

module.exports = Payment;