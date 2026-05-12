const ledgerService = require('../../../services/ledgerService');
const { getFirestore } = require('../../../firebaseAdmin');

// Mock do Firebase Admin
jest.mock('../../../firebaseAdmin', () => {
  const mockBatch = {
    set: jest.fn(),
    update: jest.fn(),
    commit: jest.fn()
  };

  const mockQuery = {
    where: jest.fn(() => mockQuery),
    limit: jest.fn(() => mockQuery),
    get: jest.fn(),
    doc: jest.fn(() => mockDoc)
  };

  const mockDoc = {
    get: jest.fn(),
    collection: jest.fn(() => mockQuery)
  };

  const mockDb = {
    collection: jest.fn(() => ({
      doc: jest.fn(() => mockDoc),
      where: jest.fn(() => mockQuery)
    })),
    batch: jest.fn(() => mockBatch)
  };

  return {
    getFirestore: jest.fn(() => mockDb),
    _mockDb: mockDb,
    _mockBatch: mockBatch,
    _mockDoc: mockDoc,
    _mockQuery: mockQuery
  };
});

jest.mock('../../../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('ledgerService', () => {
  const { _mockDb, _mockBatch, _mockDoc, _mockQuery } = require('../../../firebaseAdmin');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('creditMember', () => {
    const payload = {
      caixinhaId: 'caixinha_123',
      userId: 'user_456',
      amount: 100,
      paymentId: 'pay_789',
      description: 'Teste'
    };

    it('deve executar todas as operações no mesmo batch em caso de sucesso', async () => {
      // 1. Idempotência: não existe transação anterior
      _mockQuery.get.mockResolvedValue({ empty: true });
      
      // 2. Ledger do membro existe
      _mockDoc.get.mockResolvedValue({ exists: true, data: () => ({ saldoVirtual: 50 }) });
      
      // 3. Caixinha existe
      _mockDoc.get.mockResolvedValueOnce({ exists: true, data: () => ({ saldoVirtual: 50 }) }) // para o ledger
               .mockResolvedValueOnce({ exists: true, data: () => ({ saldoTotal: 1000 }) }); // para a caixinha

      _mockBatch.commit.mockResolvedValue();

      await ledgerService.creditMember(payload);

      // Verifica se set (transação), update (ledger) e update (caixinha) foram chamados
      expect(_mockBatch.set).toHaveBeenCalledTimes(1);
      expect(_mockBatch.update).toHaveBeenCalledTimes(2);
      expect(_mockBatch.commit).toHaveBeenCalledTimes(1);
    });

    it('deve garantir atomicidade: se o commit falhar, nada é persistido', async () => {
      _mockQuery.get.mockResolvedValue({ empty: true });
      _mockDoc.get.mockResolvedValue({ exists: true, data: () => ({ saldoTotal: 1000 }) });
      
      // Simula falha catastrófica no commit do batch
      _mockBatch.commit.mockRejectedValue(new Error('Firestore Write Collision'));

      await expect(ledgerService.creditMember(payload))
        .rejects.toThrow('Firestore Write Collision');

      // O batch foi montado, mas o erro do commit impede a persistência real
      expect(_mockBatch.commit).toHaveBeenCalled();
    });

    it('deve abortar se a caixinha não estiver encontrada', async () => {
      _mockQuery.get.mockResolvedValue({ empty: true });
      _mockDoc.get.mockResolvedValue({ exists: false });

      await expect(ledgerService.creditMember(payload))
        .rejects.toThrow('Caixinha caixinha_123 não encontrada');

      expect(_mockBatch.commit).not.toHaveBeenCalled();
    });

    it('deve respeitar idempotência e não processar pagamento duplicado', async () => {
      // Simula que o pagamento já existe
      _mockQuery.get.mockResolvedValue({ empty: false });

      const result = await ledgerService.creditMember(payload);

      expect(result.alreadyProcessed).toBe(true);
      expect(_mockBatch.commit).not.toHaveBeenCalled();
    });
  });
});
