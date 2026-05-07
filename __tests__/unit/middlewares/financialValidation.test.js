jest.mock('../../../models/Wallet', () => ({
  findByUserId: jest.fn(),
}));

const Wallet = require('../../../models/Wallet');
const validateFinancialOperation = require('../../../middlewares/financialValidation');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('validateFinancialOperation', () => {
  let next;

  beforeEach(() => {
    next = jest.fn();
    jest.clearAllMocks();
  });

  describe('validação de amount', () => {
    it('deve retornar 400 quando amount está ausente', async () => {
      const req = { body: { type: 'credit', userId: 'u1' } };
      const res = mockRes();

      await validateFinancialOperation(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid amount' });
      expect(next).not.toHaveBeenCalled();
    });

    it('deve retornar 400 quando amount é zero', async () => {
      const req = { body: { amount: 0, type: 'credit', userId: 'u1' } };
      const res = mockRes();

      await validateFinancialOperation(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid amount' });
      expect(next).not.toHaveBeenCalled();
    });

    it('deve retornar 400 quando amount é negativo', async () => {
      const req = { body: { amount: -50, type: 'credit', userId: 'u1' } };
      const res = mockRes();

      await validateFinancialOperation(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid amount' });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('operação de crédito (type !== debit)', () => {
    it('deve chamar next() quando amount válido e type é credit', async () => {
      const req = { body: { amount: 100, type: 'credit', userId: 'u1' } };
      const res = mockRes();

      await validateFinancialOperation(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(Wallet.findByUserId).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('deve chamar next() quando type está ausente e amount é válido', async () => {
      const req = { body: { amount: 50, userId: 'u1' } };
      const res = mockRes();

      await validateFinancialOperation(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('operação de débito (type === debit)', () => {
    it('deve chamar next() quando saldo é suficiente', async () => {
      Wallet.findByUserId.mockResolvedValue({ balance: 500 });
      const req = { body: { amount: 100, type: 'debit', userId: 'u1' } };
      const res = mockRes();

      await validateFinancialOperation(req, res, next);

      expect(Wallet.findByUserId).toHaveBeenCalledWith('u1');
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('deve retornar 400 quando saldo é insuficiente', async () => {
      Wallet.findByUserId.mockResolvedValue({ balance: 50 });
      const req = { body: { amount: 100, type: 'debit', userId: 'u1' } };
      const res = mockRes();

      await validateFinancialOperation(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Insufficient funds' });
      expect(next).not.toHaveBeenCalled();
    });

    it('deve retornar 400 quando wallet não existe', async () => {
      Wallet.findByUserId.mockResolvedValue(null);
      const req = { body: { amount: 100, type: 'debit', userId: 'u1' } };
      const res = mockRes();

      await validateFinancialOperation(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Insufficient funds' });
      expect(next).not.toHaveBeenCalled();
    });

    it('deve retornar 500 quando Wallet.findByUserId lança exceção', async () => {
      Wallet.findByUserId.mockRejectedValue(new Error('Firestore unavailable'));
      const req = { body: { amount: 100, type: 'debit', userId: 'u1' } };
      const res = mockRes();

      await validateFinancialOperation(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Firestore unavailable' });
      expect(next).not.toHaveBeenCalled();
    });
  });
});
