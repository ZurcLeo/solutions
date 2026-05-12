const BaseFlow = require('./BaseFlow');

/**
 * Flow de Integração Financeira (FinancialFlow).
 * Testa o ciclo completo: Depósito PIX -> Validação de Saldo -> Compra de Rifa -> Débito de Saldo.
 */
class FinancialFlow extends BaseFlow {
  constructor(runId, backendUrl) {
    super('financial', 'api', runId, backendUrl);
  }

  async run(testUser) {
    let caixinhaId = null;
    let rifaId = null;

    // 1. Simular Depósito PIX via rota de QA
    // Nota: Como não encontrei uma rota de 'seed' de saldo, vou assumir que existe 
    // ou que precisaremos criar uma rota controlada para o Orchestrator.
    // Para este exemplo, vou simular o crédito via ledgerService se houver uma rota exposta.
    await this.step('simulate_pix_deposit', async ({ axios }) => {
      // Usaremos o CaixinhaFlow anterior para pegar uma caixinha ou criar uma nova
      // Mas para manter isolado, criamos uma aqui.
      const caixinhaRes = await axios.post('/api/caixinha/', {
        name: `QA Financeira ${this.runId}`,
        goal: 1000,
        type: 'FINANCEIRA'
      }, {
        headers: { Authorization: `Bearer ${testUser.accessToken}` }
      });
      caixinhaId = caixinhaRes.data.data.id;

      // Chama endpoint de QA (que precisaremos garantir que exista no controller)
      // para injetar saldo sem passar pelo gateway real do MercadoPago
      return await axios.post(`/api/qa/seed-balance`, {
        caixinhaId,
        userId: testUser.uid,
        amount: 500,
        description: 'Carga inicial QA'
      }, {
        headers: { 'x-qa-token': process.env.QA_INTERNAL_TOKEN }
      });
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
      const rifaRes = await axios.post(`/api/rifas/${caixinhaId}`, {
        nome: 'Rifa de Teste QA',
        valorBilhete: 50,
        quantidadeBilhetes: 100,
        premio: 'R$ 5.000,00'
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
