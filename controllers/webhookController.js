const paymentService = require('../services/paymentService');
const asaasService = require('../services/asaasService');
const ledgerService = require('../services/ledgerService');
const BankAccount = require('../models/BankAccount');
const { logger } = require('../logger');
const crypto = require('crypto');

/**
 * Webhook do Mercado Pago para notificações de pagamento
 * Responde rapidamente com 200 e processa em background
 */
exports.mercadoPagoWebhook = async (req, res) => {
  const { type, action, data } = req.body;
  const signature = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'];

  logger.info('Webhook do Mercado Pago recebido', {
    controller: 'WebhookController',
    method: 'mercadoPagoWebhook',
    type,
    action,
    dataId: data?.id,
    requestId,
    action: 'WEBHOOK_RECEIVED'
  });

  // Responder imediatamente com 200 para confirmar recebimento
  res.status(200).json({ status: 'received' });

  // Processar webhook em background (não aguarda resultado)
  setImmediate(async () => {
    try {
      // 1. Verificar assinatura do webhook (se configurada)
      if (process.env.MERCADOPAGO_WEBHOOK_SECRET && signature) {
        const isValidSignature = exports._verifyWebhookSignature(req, signature);
        if (!isValidSignature) {
          logger.warn('Assinatura do webhook inválida', {
            controller: 'WebhookController',
            method: 'mercadoPagoWebhook',
            requestId,
            action: 'INVALID_SIGNATURE'
          });
          return;
        }
      }

      // 2. Processar apenas eventos de pagamento atualizados
      if (type === 'payment' && action === 'payment.updated' && data?.id) {
        await exports._processPaymentNotification(data.id, requestId);
      } else {
        logger.info('Webhook ignorado - não é payment.updated', {
          controller: 'WebhookController',
          method: 'mercadoPagoWebhook',
          type,
          action,
          requestId
        });
      }

    } catch (error) {
      logger.error('Erro no processamento do webhook em background', {
        controller: 'WebhookController',
        method: 'mercadoPagoWebhook',
        type,
        action,
        dataId: data?.id,
        requestId,
        error: error.message,
        stack: error.stack,
        action: 'WEBHOOK_BACKGROUND_ERROR'
      });
    }
  });
};

/**
 * Processa notificação de pagamento com idempotência
 */
exports._processPaymentNotification = async (paymentId, requestId) => {
  try {
    // 0. Verificar idempotência - rejeitar webhooks duplicados
    const webhookHash = crypto.createHash('sha256').update(`${requestId}:${paymentId}`).digest('hex');
    const cacheKey = `webhook:processed:${webhookHash}`;
    
    const alreadyProcessed = await exports._checkIdempotencyCache(cacheKey);
    if (alreadyProcessed) {
      logger.info('Webhook duplicado rejeitado - já foi processado', {
        controller: 'WebhookController',
        method: '_processPaymentNotification',
        paymentId,
        requestId,
        webhookHash,
        action: 'DUPLICATE_WEBHOOK_REJECTED'
      });
      return;
    }

    logger.info('Processando notificação de pagamento', {
      controller: 'WebhookController',
      method: '_processPaymentNotification',
      paymentId,
      requestId,
      action: 'PROCESSING_PAYMENT_NOTIFICATION'
    });

    // 1. Buscar detalhes do pagamento no Mercado Pago
    const paymentData = await paymentService.checkPaymentStatus(paymentId);

    // 2. Verificar se é um micropagamento de validação (R$ 0,01)
    if (paymentData.transaction_amount !== 0.01) {
      logger.info('Pagamento não é um micropagamento de validação', {
        controller: 'WebhookController',
        method: '_processPaymentNotification',
        paymentId,
        amount: paymentData.transaction_amount,
        action: 'NOT_VALIDATION_PAYMENT'
      });
      return;
    }

    // 3. Verificar se o pagamento foi aprovado
    if (paymentData.status !== 'approved') {
      logger.info('Pagamento não aprovado', {
        controller: 'WebhookController',
        method: '_processPaymentNotification',
        paymentId,
        status: paymentData.status,
        action: 'PAYMENT_NOT_APPROVED'
      });
      return;
    }

    // 4. Buscar conta bancária pendente que pode corresponder a este pagamento
    const pendingAccounts = await exports._findPendingAccountsForPayment(paymentData);

    for (const account of pendingAccounts) {
      try {
        // 5. Validar se os dados do pagador correspondem à conta
        const isValidPayer = await exports._validatePayerData(paymentData, account);
        
        if (isValidPayer) {
          // 6. Atualizar conta para validada
          await BankAccount.update(account.adminId, account.id, {
            status: 'validada',
            validatedAt: new Date().toISOString(),
            validationPaymentId: paymentId,
            autoValidated: true
          });

          logger.info('Conta bancária validada automaticamente via webhook', {
            controller: 'WebhookController',
            method: '_processPaymentNotification',
            paymentId,
            accountId: account.id,
            adminId: account.adminId,
            action: 'AUTO_VALIDATION_SUCCESS'
          });

          // Notificar usuário sobre validação da conta
          try {
            const NotificationDispatcher = require('../services/NotificationDispatcher');
            await NotificationDispatcher.dispatch({
              userId: account.adminId,
              type: 'account_validated',
              importance: 'medium',
              data: {
                accountId: account.id,
                message: 'Sua conta bancária foi validada com sucesso e está pronta para receber saques.'
              },
              metadata: { triggeredBy: 'system', correlationId: paymentId }
            });
          } catch (err) {
            logger.warn('Falha ao notificar validação de conta', { error: err.message, userId: account.adminId });
          }

          // Parar no primeiro match válido
          break;
        }
      } catch (validationError) {
        logger.warn('Erro na validação automática da conta', {
          controller: 'WebhookController',
          method: '_processPaymentNotification',
          paymentId,
          accountId: account.id,
          error: validationError.message,
          action: 'AUTO_VALIDATION_ERROR'
        });
      }
    }

  } catch (error) {
    logger.error('Erro no processamento da notificação de pagamento', {
      controller: 'WebhookController',
      method: '_processPaymentNotification',
      paymentId,
      requestId,
      error: error.message,
      stack: error.stack,
      action: 'PAYMENT_NOTIFICATION_ERROR'
    });
    throw error;
  }
};

/**
 * Busca contas bancárias pendentes que podem corresponder ao pagamento
 */
exports._findPendingAccountsForPayment = async (paymentData) => {
  try {
    // Esta é uma busca simplificada - em produção, você pode implementar
    // uma estratégia mais sofisticada de matching
    
    // Por enquanto, buscaremos todas as contas pendentes criadas nas últimas 24h
    const yesterday = new Date();
    yesterday.setHours(yesterday.getHours() - 24);

    // TODO: Implementar busca otimizada no modelo BankAccount
    // Por enquanto, retornamos array vazio
    return [];
    
  } catch (error) {
    logger.error('Erro ao buscar contas pendentes para o pagamento', {
      controller: 'WebhookController',
      method: '_findPendingAccountsForPayment',
      error: error.message
    });
    return [];
  }
};

/**
 * Verifica assinatura do webhook do Mercado Pago
 * Documentação: https://www.mercadopago.com.br/developers/pt/docs/integration-patterns/webhooks-v2/signature-validation
 */
exports._verifyWebhookSignature = (req, signature) => {
  try {
    const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    if (!secret) {
      logger.warn('MERCADOPAGO_WEBHOOK_SECRET não configurado - pulando verificação', {
        controller: 'WebhookController',
        method: '_verifyWebhookSignature'
      });
      return true; // Se não há secret configurado, não verifica
    }

    if (!signature) {
      logger.warn('Assinatura não fornecida no header x-signature', {
        controller: 'WebhookController',
        method: '_verifyWebhookSignature'
      });
      return false;
    }

    // Mercado Pago envia múltiplas assinaturas separadas por vírgula
    // Formato: v1=hash1,ts=timestamp,v1=hash2
    const signatureParts = signature.split(',');
    const signatureMap = {};
    
    signatureParts.forEach(part => {
      const [key, value] = part.split('=');
      if (key && value) {
        signatureMap[key] = value;
      }
    });

    const receivedHash = signatureMap.v1;
    const timestamp = signatureMap.ts;

    if (!receivedHash || !timestamp) {
      logger.warn('Assinatura mal formatada', {
        controller: 'WebhookController',
        method: '_verifyWebhookSignature',
        signature
      });
      return false;
    }

    // Verificar se o timestamp não é muito antigo (5 minutos)
    const currentTime = Math.floor(Date.now() / 1000);
    const timestampDiff = currentTime - parseInt(timestamp);
    
    if (timestampDiff > 300) { // 5 minutos
      logger.warn('Webhook muito antigo', {
        controller: 'WebhookController',
        method: '_verifyWebhookSignature',
        timestampDiff
      });
      return false;
    }

    // Criar hash esperado
    const dataToSign = `id=${req.body.data?.id}&request-id=${req.headers['x-request-id']}&ts=${timestamp}`;
    const expectedHash = crypto
      .createHmac('sha256', secret)
      .update(dataToSign)
      .digest('hex');

    const isValid = receivedHash === expectedHash;
    
    if (!isValid) {
      logger.warn('Hash de assinatura não confere', {
        controller: 'WebhookController',
        method: '_verifyWebhookSignature',
        receivedHash,
        expectedHash,
        dataToSign
      });
    }

    return isValid;

  } catch (error) {
    logger.error('Erro na verificação de assinatura do webhook', {
      controller: 'WebhookController',
      method: '_verifyWebhookSignature',
      error: error.message,
      stack: error.stack
    });
    return false;
  }
};

/**
 * Reutiliza a função de validação do pagador do bankAccountController
 */
exports._validatePayerData = async (paymentData, bankAccount) => {
  const bankAccountController = require('./bankAccountController');
  return bankAccountController._validatePayerData(paymentData, bankAccount);
};

// ─── Asaas Webhook ────────────────────────────────────────────────────────────

/**
 * Webhook do Asaas para notificações de pagamento.
 * Responde 200 imediatamente; processa em background.
 * Rota: POST /api/webhook/asaas
 */
exports.asaasWebhook = async (req, res) => {
  const { event, payment } = req.body;

  logger.info('Webhook Asaas recebido', {
    controller: 'WebhookController',
    method: 'asaasWebhook',
    event,
    paymentId: payment?.id,
    externalReference: payment?.externalReference,
    action: 'ASAAS_WEBHOOK_RECEIVED'
  });

  // Validar token antes de qualquer coisa
  if (!asaasService.validateWebhookToken(req)) {
    return res.status(401).json({ error: 'Token inválido' });
  }

  // Responder 200 imediatamente (Asaas exige resposta rápida)
  res.status(200).json({ status: 'received' });

  // Processar em background
  setImmediate(async () => {
    try {
      await exports._processAsaasEvent(event, payment);
    } catch (error) {
      logger.error('Erro no processamento do webhook Asaas em background', {
        controller: 'WebhookController',
        method: 'asaasWebhook',
        event,
        paymentId: payment?.id,
        error: error.message,
        action: 'ASAAS_WEBHOOK_BACKGROUND_ERROR'
      });
    }
  });
};

/**
 * Processa eventos de pagamento do Asaas.
 * PAYMENT_CONFIRMED e PAYMENT_RECEIVED são os eventos de crédito.
 */
exports._processAsaasEvent = async (event, payment) => {
  const creditEvents = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'];

  if (!creditEvents.includes(event)) {
    logger.info('Evento Asaas ignorado', {
      controller: 'WebhookController',
      method: '_processAsaasEvent',
      event,
      action: 'ASAAS_EVENT_IGNORED'
    });
    return;
  }

  if (!payment?.externalReference) {
    logger.warn('Webhook Asaas sem externalReference — não é contribuição de caixinha', {
      controller: 'WebhookController',
      method: '_processAsaasEvent',
      paymentId: payment?.id,
      event
    });
    return;
  }

  // externalReference = "{caixinhaId}:{userId}"
  const parts = payment.externalReference.split(':');
  if (parts.length !== 2) {
    logger.warn('externalReference mal formatado', {
      controller: 'WebhookController',
      method: '_processAsaasEvent',
      externalReference: payment.externalReference
    });
    return;
  }

  const [caixinhaId, userId] = parts;

  logger.info('Creditando membro via webhook Asaas', {
    controller: 'WebhookController',
    method: '_processAsaasEvent',
    paymentId: payment.id,
    caixinhaId,
    userId,
    amount: payment.value,
    event
  });

  const result = await ledgerService.creditMember({
    caixinhaId,
    userId,
    amount: payment.value,
    paymentId: payment.id,
    description: `PIX confirmado — ${event}`
  });

  if (result.alreadyProcessed) {
    logger.info('Webhook duplicado ignorado pelo ledger', {
      controller: 'WebhookController',
      method: '_processAsaasEvent',
      paymentId: payment.id
    });
    return;
  }

  logger.info('Crédito registrado com sucesso via webhook Asaas', {
    controller: 'WebhookController',
    method: '_processAsaasEvent',
    txId: result.txId,
    paymentId: payment.id,
    caixinhaId,
    userId,
    amount: payment.value,
    action: 'ASAAS_CREDIT_SUCCESS'
  });
};