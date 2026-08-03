const BaseFlow = require('./BaseFlow');

/**
 * Flow de Integração Financeira (FinancialFlow).
 * Testa o ciclo completo: Depósito PIX -> Validação de Saldo -> Compra de Rifa -> Débito de Saldo.
 */
class FinancialFlow extends BaseFlow {
  constructor(runId, backendUrl, qaToken, onProgress = null) {
    super('financial', 'api', runId, backendUrl, qaToken, onProgress);
  }

  async run(testUser) {
    let caixinhaId = null;
    let rifaId = null;

    // 1. Simular Depósito PIX via rota de QA
    await this.step('simulate_pix_deposit', async ({ axios }) => {
      const caixinhaRes = await axios.post('/api/caixinha/', {
        name: `QA Financeira ${this.runId}`,
        description: 'Caixinha financeira para teste de ledger',
        adminId: testUser.uid,
        contribuicaoMensal: 0,
        duracaoMeses: 12,
        distribuicaoTipo: 'FINANCEIRA',
        dataCriacao: new Date().toISOString()
      }, {
        headers: { Authorization: `Bearer ${testUser.accessToken}` }
      });
      
      caixinhaId = caixinhaRes.data?.id || caixinhaRes.data?.data?.id;

      if (!caixinhaId) {
        throw new Error('Falha ao criar caixinha financeira para teste');
      }

      // Chama endpoint de QA para injetar saldo
      const res = await axios.post(`/api/qa/seed-balance`, {
        caixinhaId,
        userId: testUser.uid,
        amount: 500,
        description: 'Carga inicial QA'
      });

      return { success: res.data?.success, status: res.status };
    });

    // 2. Verificar se o ledger foi atualizado
    await this.step('verify_ledger_balance', async ({ axios }) => {
      const res = await axios.get(`/api/caixinha/${caixinhaId}/me`, {
        headers: { Authorization: `Bearer ${testUser.accessToken}` }
      });
      
      const balance = res.data.data.saldoVirtual;
      if (balance !== 500) {
        throw new Error(`Saldo incorreto. Esperado 500, recebido ${balance}`);
      }
    });

    // 3. Criar uma Rifa e Comprar um Bilhete
    await this.step('create_and_buy_raffle', async ({ axios }) => {
      // Criar rifa
      const dataInicio = new Date();
      const dataFim = new Date(dataInicio);
      dataFim.setDate(dataFim.getDate() + 30);

      const rifaRes = await axios.post(`/api/rifas/${caixinhaId}`, {
        nome: 'Rifa de Teste QA',
        descricao: 'Rifa gerada automaticamente pelo Orchestrator para teste financeiro',
        valorBilhete: 50,
        quantidadeBilhetes: 100,
        premio: 'R$ 5.000,00',
        dataInicio: dataInicio.toISOString(),
        dataFim: dataFim.toISOString()
      }, {
        headers: { Authorization: `Bearer ${testUser.accessToken}` }
      });
      rifaId = rifaRes.data.data.id;

      // Comprar bilhete (deve debitar 50 do saldo virtual)
      return await axios.post(`/api/rifas/${caixinhaId}/bilhetes/${rifaId}`, {
        numeroBilhete: 7
      }, {
        headers: { Authorization: `Bearer ${testUser.accessToken}` }
      });
    });

    // 4. Validar se o saldo foi debitado corretamente
    await this.step('verify_debit_balance', async ({ axios }) => {
      const res = await axios.get(`/api/caixinha/${caixinhaId}/me`, {
        headers: { Authorization: `Bearer ${testUser.accessToken}` }
      });
      
      const balance = res.data.data.saldoVirtual;
      if (balance !== 450) { // 500 - 50
        throw new Error(`Saldo após débito incorreto. Esperado 450, recebido ${balance}`);
      }
    });

    return this.result();
  }
}

module.exports = FinancialFlow;
