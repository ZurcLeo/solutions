const BaseFlow = require('./BaseFlow');

/**
 * Simula o ciclo de vida de um empréstimo (Loan).
 * 
 * Ciclo testado:
 *   criar caixinha (emprestimos: true) → injetar saldo → solicitar empréstimo (2º usuário) →
 *   aprovar empréstimo (admin) → realizar pagamento → verificar quitação parcial.
 */
class LoanFlow extends BaseFlow {
  constructor(runId, backendUrl, qaToken, onProgress = null) {
    super('loan', 'api', runId, backendUrl, qaToken, onProgress);
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
        dataCriacao: new Date().toISOString(),
        permiteEmprestimos: true,
        diaVencimento: 15
      }, { headers: authAdmin });

      caixinhaId = res.data?.id || res.data?.caixinhaId || res.data?.data?.id;
      return { caixinhaId };
    });

    if (!caixinhaId) return this.result();

    // 2. Injetar saldo na caixinha para permitir o empréstimo
    await this.step('seed_caixinha_funds', async ({ axios }) => {
      const res = await axios.post('/api/qa/seed-balance', {
        caixinhaId,
        userId: testUser.uid,
        amount: 1000,
        description: 'Carga para lastro de empréstimo'
      });
      return { success: res.data?.success, status: res.status };
    });

    // 3. Adicionar secondUser como membro da caixinha (necessário para solicitar empréstimo)
    if (secondUser) {
      await this.step('add_member_for_loan', async ({ axios }) => {
        // Convidar secondUser
        const inviteRes = await axios.post(`/api/caixinha/membros/${caixinhaId}/convite`, {
          caixinhaId,
          targetId: secondUser.uid,
          targetName: secondUser.displayName,
          senderId: testUser.uid,
          senderName: testUser.displayName
        }, { headers: authAdmin });

        // Tenta extrair o ID lidando com typos e diferentes formatos
        const inviteId = inviteRes.data?.inviteId || 
                         inviteRes.data?.caxinhaInviteId || 
                         inviteRes.data?.data?.id || 
                         inviteRes.data?.id;

        if (!inviteId) {
          throw new Error('Falha ao obter ID do convite (verificar typo caxinhaInviteId na API)');
        }

        // secondUser aceita o convite
        await axios.post(`/api/caixinha/membros/convite/${inviteId}/aceitar`,
          { userId: secondUser.uid },
          { headers: authUser }
        );
        return { memberAdded: true, inviteId };
      });
    }

    // 4. Solicitar empréstimo (Second User)
    await this.step('request_loan', async ({ axios }) => {
      const res = await axios.post(`/api/caixinha/${caixinhaId}/emprestimos`, {
        userId: secondUser?.uid || testUser.uid,
        valor: 500,
        parcelas: 5,
        motivo: 'Teste de fluxo QA',
        taxaJuros: 2
      }, { headers: authUser });

      // O backend retorna { success: true, data: { id: '...', ... } }
      loanId = res.data?.data?.id || res.data?.id || res.data?.loanId;
      return { loanId, status: res.data?.data?.status || res.data?.status };
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
