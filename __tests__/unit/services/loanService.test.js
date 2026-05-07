const loanService = require('../../../services/loanService');
const Emprestimos = require('../../../models/Emprestimos');
const Caixinha = require('../../../models/Caixinhas');
const disputeService = require('../../../services/disputeService');

// Mocks
jest.mock('../../../models/Emprestimos');
jest.mock('../../../models/Caixinhas');
jest.mock('../../../services/disputeService');

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
      const loanData = { valorSolicitado: 1000, status: 'pendente', memberId: userId };
      const caixinhaData = { adminId: adminId, saldoTotal: 500, members: [adminId, userId] };

      mockTransaction.get.mockImplementation((ref) => {
        if (ref.path && ref.path.includes('emprestimos')) return Promise.resolve({ exists: true, data: () => loanData });
        return Promise.resolve({ exists: true, data: () => caixinhaData });
      });

      await expect(loanService.approveLoan(caixinhaId, loanId, adminId))
        .rejects.toThrow('Saldo insuficiente na caixinha');
    });

    it('deve debitar saldo e registrar empréstimo de forma atômica', async () => {
      const loanData = { valorSolicitado: 100, status: 'pendente', memberId: userId };
      const caixinhaData = { adminId: adminId, saldoTotal: 1000, members: [adminId, userId] };

      mockTransaction.get.mockImplementation((ref) => {
        if (ref.path && ref.path.includes('emprestimos')) return Promise.resolve({ exists: true, data: () => loanData });
        return Promise.resolve({ exists: true, data: () => caixinhaData });
      });

      const result = await loanService.approveLoan(caixinhaId, loanId, adminId);
      expect(result.success).toBe(true);
      expect(mockTransaction.update).toHaveBeenCalledTimes(2);
      expect(mockTransaction.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ saldoTotal: 900 }));
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
      const loanData = { id: loanId, valorTotal: 1000, status: 'aprovado', parcelas: [] };
      const caixinhaData = { saldoTotal: 5000 };

      mockTransaction.get.mockImplementation((ref) => {
        if (ref.path && ref.path.includes('emprestimos')) return Promise.resolve({ exists: true, data: () => loanData });
        return Promise.resolve({ exists: true, data: () => caixinhaData });
      });

      const result = await loanService.makePayment(caixinhaId, loanId, { valor: 200 });
      expect(result.success).toBe(true);
      expect(mockTransaction.update).toHaveBeenCalledTimes(2);
      expect(mockTransaction.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ saldoTotal: 5200 }));
    });

    it('deve marcar empréstimo como quitado quando valor total é atingido', async () => {
      const loanData = { id: loanId, valorTotal: 1000, status: 'parcial', parcelas: [{ valor: 800 }] };
      const caixinhaData = { saldoTotal: 5800 };

      mockTransaction.get.mockImplementation((ref) => {
        if (ref.path && ref.path.includes('emprestimos')) return Promise.resolve({ exists: true, data: () => loanData });
        return Promise.resolve({ exists: true, data: () => caixinhaData });
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
