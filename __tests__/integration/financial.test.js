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

      // Mock loan data
      mockTransaction.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ status: 'pendente', valor: 500, valorSolicitado: 500 })
      });

      // Mock caixinha data
      mockTransaction.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ adminId: 'admin789', saldoTotal: 1000 })
      });

      const result = await loanService.approveLoan(caixinhaId, loanId, adminId);

      expect(result.success).toBe(true);
      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.anything(), // caixinhaRef
        expect.objectContaining({ saldoTotal: 500 }) // 1000 - 500
      );
    });

    it('should fail if caixinha has insufficient balance', async () => {
      const caixinhaId = 'c123';
      const loanId = 'l456';
      
      mockTransaction.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ status: 'pendente', valor: 2000, valorSolicitado: 2000 })
      });
      mockTransaction.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ adminId: 'admin789', saldoTotal: 1000 })
      });

      await expect(loanService.approveLoan(caixinhaId, loanId, 'admin789'))
        .rejects.toThrow('Saldo insuficiente na caixinha');
    });
  });

  describe('makePayment', () => {
    it('should update loan status to "quitado" when full amount is paid', async () => {
      const caixinhaId = 'c123';
      const loanId = 'l456';

      mockTransaction.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ status: 'aprovado', valor: 500, valorTotal: 500, parcelas: [] })
      });
      mockTransaction.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ saldoTotal: 1000 })
      });

      const result = await loanService.makePayment(caixinhaId, loanId, { valor: 500 });

      expect(result.data.status).toBe('quitado');
      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.anything(), // loanRef
        expect.objectContaining({ status: 'quitado', valorPago: 500 })
      );
    });

    it('should update loan status to "parcial" when partial amount is paid', async () => {
      const caixinhaId = 'c123';
      const loanId = 'l456';

      mockTransaction.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ status: 'aprovado', valor: 500, valorTotal: 500, parcelas: [] })
      });
      mockTransaction.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ saldoTotal: 1000 })
      });

      const result = await loanService.makePayment(caixinhaId, loanId, { valor: 200 });

      expect(result.data.status).toBe('parcial');
      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.anything(), // loanRef
        expect.objectContaining({ status: 'parcial', valorPago: 200 })
      );
    });
  });
});
