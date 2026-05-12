const BaseFlow = require('./BaseFlow');

/**
 * Simula o ciclo de vida de um empréstimo (Loan).
 * 
 * Ciclo testado:
 *   criar caixinha (emprestimos: true) → injetar saldo → solicitar empréstimo (2º usuário) →
 *   aprovar empréstimo (admin) → realizar pagamento → verificar quitação parcial.
 */
class LoanFlow extends BaseFlow {
  constructor(runId, backendUrl) {
    super('loan', 'api', runId, backendUrl);
  }

  async run(testUser, secondUser) {
    const authAdmin = { Authorization: `Bearer ${testUser.accessToken}` };
    const authUser  = secondUser?.accessToken 
      ? { Authorization: `Bearer ${secondUser.accessToken}` } 
      : authAdmin; // Fallback para o próprio admin se não houver segundo usuário

    let caixinhaId = null;
    let loanId = null;

    // 1. Criar caixinha com empréstimos habilitados
    await this.step('create_loan_enabled_caixinha', async ({ axios }) => {
      const res = await axios.post('/api/caixinha/', {
        name: `QA Loan Caixinha ${this.runId}`,
        description: 'Caixinha para teste de empréstimos',
        adminId: testUser.uid,
        contribuicaoMensal: 200,
        duracaoMeses: 12,
        distribuicaoTipo: 'MENSAL',
        permiteEmprestimos: true,
        diaVencimento: 15
      }, { headers: authAdmin });

      caixinhaId = res.data?.id || res.data?.caixinhaId;
      return { caixinhaId };
    });

    if (!caixinhaId) return this.result();

    // 2. Injetar saldo na caixinha para permitir o empréstimo
    await this.step('seed_caixinha_funds', async ({ axios }) => {
      return await axios.post('/api/qa/seed-balance', {
        caixinhaId,
        userId: testUser.uid,
        amount: 1000,
        description: 'Carga para lastro de empréstimo'
      }, {
        headers: { 'x-qa-internal': 'true' }
      });
    });

    // 3. Solicitar empréstimo (Second User)
    await this.step('request_loan', async ({ axios }) => {
      const res = await axios.post(`/api/caixinha/${caixinhaId}/emprestimos`, {
        userId: secondUser?.uid || testUser.uid,
        valor: 500,
        parcelas: 5,
        motivo: 'Teste de fluxo QA',
        taxaJuros: 2
      }, { headers: authUser });

      loanId = res.data?.id || res.data?.loanId;
      return { loanId, status: res.data?.status };
    });

    if (!loanId) return this.result();

    // 4. Aprovar empréstimo (Admin)
    await this.step('approve_loan', async ({ axios }) => {
      const res = await axios.post(`/api/caixinha/${caixinhaId}/emprestimos/${loanId}/aprovar`, {
        adminId: testUser.uid
      }, { headers: authAdmin });

      return { success: res.data?.success || res.status === 200 };
    });

    // 5. Realizar pagamento de parcela
    await this.step('make_loan_payment', async ({ axios }) => {
      const res = await axios.post(`/api/caixinha/${caixinhaId}/emprestimos/${loanId}/pagamento`, {
        valor: 110, // 500/5 + 2% juros aproximado
        metodo: 'pix',
        observacao: 'Pagamento QA'
      }, { headers: authUser });

      return { 
        success: res.data?.success || res.status === 200,
        novoSaldoDevedor: res.data?.saldoDevedor 
      };
    });

    // 6. Verificar status final do empréstimo
    await this.step('verify_loan_final_status', async ({ axios }) => {
      const res = await axios.get(`/api/caixinha/${caixinhaId}/emprestimos/${loanId}`, { 
        headers: authUser 
      });

      return {
        status: res.data?.status,
        valorPago: res.data?.valorPago,
        totalParcelas: res.data?.parcelas?.length
      };
    });

    return this.result();
  }
}

module.exports = LoanFlow;
