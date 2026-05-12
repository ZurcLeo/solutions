const BaseFlow = require('./BaseFlow');

/**
 * Simula o recebimento de Webhooks e testa Idempotência.
 * 
 * Cenários testados:
 *   1. Recebimento de webhook Asaas (Crédito de membro)
 *   2. Reenvio do mesmo webhook (Idempotência — não deve duplicar saldo)
 *   3. Webhook com token inválido (Segurança)
 *   4. Webhook Mercado Pago (Validação de conta — opcional/futuro)
 */
class WebhookFlow extends BaseFlow {
  constructor(runId, backendUrl) {
    super('webhook', 'api', runId, backendUrl);
  }

  async run(testUser) {
    const auth = { Authorization: `Bearer ${testUser.accessToken}` };
    const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN || '';
    
    let caixinhaId = null;
    let paymentId = `pay_qa_${this.runId}_${Date.now()}`;

    // 1. Setup: Criar uma caixinha para receber o crédito
    await this.step('setup_caixinha_for_webhook', async ({ axios }) => {
      const res = await axios.post('/api/caixinha/', {
        name: `QA Webhook Caixinha ${this.runId}`,
        adminId: testUser.uid,
        contribuicaoMensal: 50,
        duracaoMeses: 6,
        permiteEmprestimos: true
      }, { headers: auth });

      caixinhaId = res.data?.id || res.data?.caixinhaId;
      return { caixinhaId };
    });

    if (!caixinhaId) return this.result();

    // 2. Simular Webhook Asaas (Primeiro Recebimento)
    await this.step('simulate_asaas_webhook_credit', async ({ axios }) => {
      const res = await axios.post('/api/webhook/asaas', {
        event: 'PAYMENT_RECEIVED',
        payment: {
          id: paymentId,
          value: 100.0,
          externalReference: `${caixinhaId}:${testUser.uid}`
        }
      }, {
        headers: { 'asaas-access-token': webhookToken }
      });

      return { statusCode: res.status, status: res.data?.status };
    });

    // 3. Verificar se o saldo foi creditado
    await this.step('verify_initial_credit', async ({ axios }) => {
      const res = await axios.get(`/api/caixinha/${caixinhaId}/me`, { headers: auth });
      const balance = res.data?.data?.saldoVirtual || 0;
      
      if (balance !== 100) {
        throw new Error(`Saldo incorreto após webhook. Esperado 100, recebido ${balance}`);
      }
      return { balance };
    });

    // 4. Simular Webhook Duplicado (Idempotência)
    await this.step('simulate_duplicate_webhook', async ({ axios }) => {
      const res = await axios.post('/api/webhook/asaas', {
        event: 'PAYMENT_RECEIVED',
        payment: {
          id: paymentId,
          value: 100.0,
          externalReference: `${caixinhaId}:${testUser.uid}`
        }
      }, {
        headers: { 'asaas-access-token': webhookToken }
      });

      return { statusCode: res.status, status: res.data?.status };
    });

    // 5. Verificar se o saldo permanece 100 (Não duplicou)
    await this.step('verify_idempotency_protection', async ({ axios }) => {
      const res = await axios.get(`/api/caixinha/${caixinhaId}/me`, { headers: auth });
      const balance = res.data?.data?.saldoVirtual || 0;
      
      if (balance !== 100) {
        throw new Error(`FALHA DE IDEMPOTÊNCIA: Saldo duplicado! Recebido ${balance}, esperado 100`);
      }
      return { balance, protectionActive: true };
    });

    // 6. Testar Webhook com Token Inválido (Segurança)
    if (webhookToken) {
      await this.step('test_invalid_webhook_token', async ({ axios }) => {
        try {
          await axios.post('/api/webhook/asaas', {
            event: 'PAYMENT_RECEIVED',
            payment: { id: 'any', value: 10 }
          }, {
            headers: { 'asaas-access-token': 'wrong_token' }
          });
          throw new Error('Deveria ter retornado 401 para token inválido');
        } catch (err) {
          if (err.response?.status === 401) {
            return { success: true, message: 'Token inválido rejeitado corretamente' };
          }
          throw err;
        }
      });
    }

    return this.result();
  }
}

module.exports = WebhookFlow;
