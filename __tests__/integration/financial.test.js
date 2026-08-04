const { getFirestore } = require('../../firebaseAdmin');

// Definir mocks globais para que possam ser acessados dentro e fora do jest.mock
const mockTransaction = {
  get: jest.fn(),
  update: jest.fn(),
  set: jest.fn(),
  delete: jest.fn()
};

const mockDb = {
  collection: jest.fn(() => ({
    doc: jest.fn(() => ({
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({})),
        where: jest.fn(() => ({
          limit: jest.fn(() => ({
            get: jest.fn()
          }))
        }))
      }))
    }))
  })),
  runTransaction: jest.fn(cb => cb(mockTransaction))
};

jest.mock('../../firebaseAdmin', () => ({
  getFirestore: jest.fn(() => mockDb)
}));

// --- Supabase mock (chainable query builder) ---
const mockRpcFn = jest.fn();
const mockSupabaseChain = {
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn(),
  update: jest.fn().mockReturnThis(),
};
const mockSupabase = {
  from: jest.fn(() => ({ ...mockSupabaseChain })),
  rpc: mockRpcFn,
};

// Each from() call needs its own fresh chain so .eq()/.single() resolve independently
function createChain(resolveValue) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resolveValue || { data: null, error: null }),
    update: jest.fn().mockReturnThis(),
  };
  return chain;
}

jest.mock('../../config/supabase', () => ({
  getSupabaseClient: jest.fn(() => mockSupabase)
}));

// Mock do logger
jest.mock('../../logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

// Importar o serviço APÓS os mocks estarem configurados
const loanService = require('../../services/loanService');

describe('Financial Logic - Loan Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reinicializar o comportamento do runTransaction para garantir que usa o mockTransaction correto
    mockDb.runTransaction.mockImplementation(cb => cb(mockTransaction));
  });

  describe('approveLoan', () => {
    it('should deduct requested amount from caixinha total balance', async () => {
      const caixinhaId = 'c123';
      const loanId = 'l456';
      const adminId = 'admin789';

      // Chain 1: emprestimos query — loan data
      const loanChain = createChain({
        data: { id: loanId, status: 'pendente', valor_solicitado: 500, valor_total: 500, user_id: 'borrower1' },
        error: null
      });
      // Chain 2: caixinhas query — caixinha data
      const caixinhaChain = createChain({
        data: { admin_id: adminId, saldo_total: 1000 },
        error: null
      });
      // Chain 3: emprestimos update
      const updateChain = createChain({ data: null, error: null });

      let fromCallCount = 0;
      mockSupabase.from.mockImplementation((table) => {
        fromCallCount++;
        if (fromCallCount === 1) return loanChain;    // emprestimos select
        if (fromCallCount === 2) return caixinhaChain; // caixinhas select
        return updateChain;                            // emprestimos update
      });

      // RPC update_caixinha_saldo — success
      mockRpcFn.mockResolvedValue({ data: null, error: null });

      const result = await loanService.approveLoan(caixinhaId, loanId, adminId);

      expect(result.success).toBe(true);
      // Verify the RPC was called to deduct 500 from the balance
      expect(mockRpcFn).toHaveBeenCalledWith('update_caixinha_saldo', {
        p_caixinha_id: caixinhaId,
        p_delta: -500,
        p_min_saldo: 500
      });
    });

    it('should fail if caixinha has insufficient balance', async () => {
      const caixinhaId = 'c123';
      const loanId = 'l456';

      // Loan requesting 2000
      const loanChain = createChain({
        data: { id: loanId, status: 'pendente', valor_solicitado: 2000, valor_total: 2000, user_id: 'borrower1' },
        error: null
      });
      // Caixinha only has 1000
      const caixinhaChain = createChain({
        data: { admin_id: 'admin789', saldo_total: 1000 },
        error: null
      });

      let fromCallCount = 0;
      mockSupabase.from.mockImplementation(() => {
        fromCallCount++;
        if (fromCallCount === 1) return loanChain;
        return caixinhaChain;
      });

      await expect(loanService.approveLoan(caixinhaId, loanId, 'admin789'))
        .rejects.toThrow('Saldo insuficiente na caixinha');
    });
  });

  describe('makePayment', () => {
    it('should update loan status to "quitado" when full amount is paid', async () => {
      const caixinhaId = 'c123';
      const loanId = 'l456';

      // RPC returns quitado status when full amount is paid
      mockRpcFn.mockResolvedValue({
        data: {
          novo_status: 'quitado',
          valor_pago_total: 500,
          pagamento_id: 'pag-1',
          transacao_id: 'txn-1'
        },
        error: null
      });

      const result = await loanService.makePayment(caixinhaId, loanId, { valor: 500 });

      expect(result.data.status).toBe('quitado');
      expect(result.data.valor_pago).toBe(500);
      expect(mockRpcFn).toHaveBeenCalledWith('registrar_pagamento_emprestimo', expect.objectContaining({
        p_emprestimo_id: loanId,
        p_caixinha_id: caixinhaId,
        p_valor: 500
      }));
    });

    it('should update loan status to "parcial" when partial amount is paid', async () => {
      const caixinhaId = 'c123';
      const loanId = 'l456';

      // RPC returns parcial status when partial amount is paid
      mockRpcFn.mockResolvedValue({
        data: {
          novo_status: 'parcial',
          valor_pago_total: 200,
          pagamento_id: 'pag-2',
          transacao_id: 'txn-2'
        },
        error: null
      });

      const result = await loanService.makePayment(caixinhaId, loanId, { valor: 200 });

      expect(result.data.status).toBe('parcial');
      expect(result.data.valor_pago).toBe(200);
      expect(mockRpcFn).toHaveBeenCalledWith('registrar_pagamento_emprestimo', expect.objectContaining({
        p_emprestimo_id: loanId,
        p_caixinha_id: caixinhaId,
        p_valor: 200
      }));
    });
  });
});
