const loanService = require('../../../services/loanService');
const Emprestimos = require('../../../models/Emprestimos');
const Caixinha = require('../../../models/Caixinhas');
const disputeService = require('../../../services/disputeService');

// Mocks
jest.mock('../../../models/Emprestimos');
jest.mock('../../../models/Caixinhas');
jest.mock('../../../services/disputeService');
jest.mock('../../../services/gamificationService', () => ({
  triggerEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../services/trustPassportService', () => ({
  recordEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../firebaseAdmin', () => {
  const createMockDoc = (path) => ({
    path,
    collection: jest.fn((name) => createMockCollection(`${path}/${name}`)),
    get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) })
  });

  const createMockCollection = (path) => ({
    path,
    doc: jest.fn((id) => createMockDoc(`${path}/${id}`)),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ empty: true, docs: [] })
  });

  const mockTransaction = {
    get: jest.fn(),
    update: jest.fn(),
    set: jest.fn(),
    delete: jest.fn()
  };

  const mockDb = {
    collection: jest.fn((name) => createMockCollection(name)),
    doc: jest.fn((id) => createMockDoc(id)),
    runTransaction: jest.fn(cb => cb(mockTransaction))
  };

  return {
    getFirestore: jest.fn(() => mockDb),
    mockDb,
    mockTransaction,
    createMockDoc,
    createMockCollection
  };
});

jest.mock('../../../logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

// --- Supabase mock (chainable query builder for approveLoan / makePayment) ---
const mockRpcFn = jest.fn();
function createSupabaseChain(resolveValue) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resolveValue || { data: null, error: null }),
    update: jest.fn().mockReturnThis(),
  };
}
const mockSupabase = {
  from: jest.fn(() => createSupabaseChain()),
  rpc: mockRpcFn,
};
jest.mock('../../../config/supabase', () => ({
  getSupabaseClient: jest.fn(() => mockSupabase)
}));

const { mockDb, mockTransaction, createMockDoc, createMockCollection } = require('../../../firebaseAdmin');

describe('loanService', () => {
  const caixinhaId = 'caixinha-123';
  const loanId = 'loan-456';
  const adminId = 'admin-789';
  const userId = 'user-101';

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset default behaviors
    mockDb.collection.mockImplementation((name) => createMockCollection(name));
    mockTransaction.get.mockReset();
    mockTransaction.update.mockReset();
  });

  describe('approveLoan', () => {
    it('deve rejeitar se saldoTotal ficaria negativo', async () => {
      // Loan requesting 1000 but caixinha only has 500
      const loanChain = createSupabaseChain({
        data: { id: loanId, status: 'pendente', valor_solicitado: 1000, valor_total: 1000, user_id: userId },
        error: null
      });
      const caixinhaChain = createSupabaseChain({
        data: { admin_id: adminId, saldo_total: 500 },
        error: null
      });

      let fromCallCount = 0;
      mockSupabase.from.mockImplementation(() => {
        fromCallCount++;
        if (fromCallCount === 1) return loanChain;
        return caixinhaChain;
      });

      await expect(loanService.approveLoan(caixinhaId, loanId, adminId))
        .rejects.toThrow('Saldo insuficiente na caixinha');
    });

    it('deve debitar saldo e registrar empréstimo de forma atômica', async () => {
      // Loan requesting 100, caixinha has 1000
      const loanChain = createSupabaseChain({
        data: { id: loanId, status: 'pendente', valor_solicitado: 100, valor_total: 100, user_id: userId },
        error: null
      });
      const caixinhaChain = createSupabaseChain({
        data: { admin_id: adminId, saldo_total: 1000 },
        error: null
      });
      const updateChain = createSupabaseChain({ data: null, error: null });

      let fromCallCount = 0;
      mockSupabase.from.mockImplementation(() => {
        fromCallCount++;
        if (fromCallCount === 1) return loanChain;    // emprestimos select
        if (fromCallCount === 2) return caixinhaChain; // caixinhas select
        return updateChain;                            // emprestimos update
      });

      // RPC update_caixinha_saldo — success
      mockRpcFn.mockResolvedValue({ data: null, error: null });

      const result = await loanService.approveLoan(caixinhaId, loanId, adminId);
      expect(result.success).toBe(true);
      // Verify RPC was called to debit 100 from the caixinha balance
      expect(mockRpcFn).toHaveBeenCalledWith('update_caixinha_saldo', {
        p_caixinha_id: caixinhaId,
        p_delta: -100,
        p_min_saldo: 100
      });
    });
  });

  describe('requestLoan', () => {
    it('deve rejeitar se membro não está active', async () => {
      const loanData = { userId: userId, valor: 100, motivo: 'Teste' };
      const mockSnapshot = {
        empty: false,
        docs: [{ data: () => ({ status: 'inativo', active: false }) }]
      };

      mockDb.collection.mockImplementation((name) => {
        const col = createMockCollection(name);
        if (name === 'caixinhas') {
          col.doc = jest.fn((id) => {
            const doc = createMockDoc(`caixinhas/${id}`);
            doc.collection = jest.fn((sub) => {
              const subCol = createMockCollection(`caixinhas/${id}/${sub}`);
              if (sub === 'membros') subCol.get = jest.fn().mockResolvedValue(mockSnapshot);
              return subCol;
            });
            return doc;
          });
        }
        return col;
      });

      disputeService.checkDisputeRequirement.mockResolvedValue({ requiresDispute: false });
      await expect(loanService.requestLoan(caixinhaId, loanData)).rejects.toThrow('Membro inativo não pode solicitar empréstimo');
    });

    it('deve permitir solicitação se membro está active', async () => {
      const loanData = { userId: userId, valor: 100, motivo: 'Teste' };
      const mockSnapshot = {
        empty: false,
        docs: [{ data: () => ({ status: 'ativo', active: true }) }]
      };

      mockDb.collection.mockImplementation((name) => {
        const col = createMockCollection(name);
        if (name === 'caixinhas') {
          col.doc = jest.fn((id) => {
            const doc = createMockDoc(`caixinhas/${id}`);
            doc.collection = jest.fn((sub) => {
              const subCol = createMockCollection(`caixinhas/${id}/${sub}`);
              if (sub === 'membros') subCol.get = jest.fn().mockResolvedValue(mockSnapshot);
              return subCol;
            });
            return doc;
          });
        }
        return col;
      });

      disputeService.checkDisputeRequirement.mockResolvedValue({ requiresDispute: false });
      Emprestimos.create.mockResolvedValue({ id: 'new-loan-id', ...loanData });
      const result = await loanService.requestLoan(caixinhaId, loanData);
      expect(result.success).toBe(true);
    });
  });

  describe('makePayment', () => {
    it('deve registrar pagamento e atualizar saldo da caixinha de forma atômica', async () => {
      // RPC registrar_pagamento_emprestimo returns parcial status (200 of 1000)
      mockRpcFn.mockResolvedValue({
        data: {
          novo_status: 'parcial',
          valor_pago_total: 200,
          pagamento_id: 'pag-1',
          transacao_id: 'txn-1'
        },
        error: null
      });

      const result = await loanService.makePayment(caixinhaId, loanId, { valor: 200 });
      expect(result.success).toBe(true);
      expect(result.data.valor_pago).toBe(200);
      expect(mockRpcFn).toHaveBeenCalledWith('registrar_pagamento_emprestimo', expect.objectContaining({
        p_emprestimo_id: loanId,
        p_caixinha_id: caixinhaId,
        p_valor: 200
      }));
    });

    it('deve marcar empréstimo como quitado quando valor total é atingido', async () => {
      // RPC returns quitado status (final payment reaches total)
      mockRpcFn.mockResolvedValue({
        data: {
          novo_status: 'quitado',
          valor_pago_total: 1000,
          pagamento_id: 'pag-2',
          transacao_id: 'txn-2'
        },
        error: null
      });

      const result = await loanService.makePayment(caixinhaId, loanId, { valor: 200 });
      expect(result.data.status).toBe('quitado');
    });
  });

  describe('rejectLoan', () => {
    it('deve rejeitar empréstimo se for admin', async () => {
      Caixinha.getById.mockResolvedValue({ adminId, members: [adminId, userId] });
      Emprestimos.getById.mockResolvedValue({ id: loanId, status: 'pendente' });
      Emprestimos.rejeitar.mockResolvedValue({ id: loanId, status: 'rejeitado' });

      const result = await loanService.rejectLoan(caixinhaId, loanId, adminId, 'Motivo');
      expect(result.success).toBe(true);
      expect(Emprestimos.rejeitar).toHaveBeenCalledWith(caixinhaId, loanId, adminId, 'Motivo');
    });
  });
});
