// O módulo chama logger.info durante a inicialização (for loop de configuração)
// logger DEVE ser mockado ANTES do require do módulo
jest.mock('../../../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Expõe mockConsume via __mockConsume para controle nos testes
jest.mock('rate-limiter-flexible', () => {
  const mockConsume = jest.fn();
  return {
    RateLimiterMemory: jest.fn(() => ({ consume: mockConsume })),
    __mockConsume: mockConsume,
  };
});

const {
  rateLimiter,
  authRateLimiter,
  readLimit,
  writeLimit,
  connectionLimit,
  bankingLimit,
} = require('../../../middlewares/rateLimiter');

const { __mockConsume: mockConsume } = require('rate-limiter-flexible');
const { RateLimiterMemory } = require('rate-limiter-flexible');

const mockReq = (overrides = {}) => ({
  ip: '127.0.0.1',
  path: '/test',
  user: null,
  ...overrides,
});

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('rateLimiter middlewares', () => {
  let next;

  beforeEach(() => {
    next = jest.fn();
    mockConsume.mockReset();
    mockConsume.mockResolvedValue({ remainingPoints: 99 }); // padrão: dentro do limite
  });

  describe('inicialização', () => {
    it('deve criar 6 instâncias de RateLimiterMemory (uma por tipo)', () => {
      expect(RateLimiterMemory).toHaveBeenCalledTimes(6);
    });

    it('deve exportar todos os 6 middlewares', () => {
      expect(typeof rateLimiter).toBe('function');
      expect(typeof authRateLimiter).toBe('function');
      expect(typeof readLimit).toBe('function');
      expect(typeof writeLimit).toBe('function');
      expect(typeof connectionLimit).toBe('function');
      expect(typeof bankingLimit).toBe('function');
    });
  });

  describe('comportamento dentro do limite', () => {
    it('rateLimiter deve chamar next() quando dentro do limite', async () => {
      const req = mockReq();
      const res = mockRes();

      await rateLimiter(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('authRateLimiter deve chamar next() quando dentro do limite', async () => {
      const req = mockReq();
      const res = mockRes();

      await authRateLimiter(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('bankingLimit deve chamar next() quando dentro do limite', async () => {
      const req = mockReq();
      const res = mockRes();

      await bankingLimit(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('comportamento quando limite é excedido', () => {
    it('deve retornar 429 com retryAfter quando limite é excedido', async () => {
      mockConsume.mockRejectedValue({ msBeforeNext: 30000 });
      const req = mockReq();
      const res = mockRes();

      await rateLimiter(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Too many requests'),
          retryAfter: 30,
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('deve converter msBeforeNext em segundos inteiros no retryAfter', async () => {
      mockConsume.mockRejectedValue({ msBeforeNext: 45500 });
      const req = mockReq();
      const res = mockRes();

      await authRateLimiter(req, res, next);

      const jsonArg = res.json.mock.calls[0][0];
      expect(jsonArg.retryAfter).toBe(46); // Math.round(45500/1000) = 46
    });

    it('writeLimit deve retornar 429 quando limite de escrita é excedido', async () => {
      mockConsume.mockRejectedValue({ msBeforeNext: 60000 });
      const req = mockReq();
      const res = mockRes();

      await writeLimit(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('chave de rate limit (key)', () => {
    it('deve usar IP quando req.user é null', async () => {
      const req = mockReq({ ip: '192.168.1.1', user: null });
      const res = mockRes();

      await rateLimiter(req, res, next);

      expect(mockConsume).toHaveBeenCalledWith('192.168.1.1');
    });

    it('deve usar IP-uid quando req.user está presente', async () => {
      const req = mockReq({ ip: '192.168.1.1', user: { uid: 'user-abc' } });
      const res = mockRes();

      await rateLimiter(req, res, next);

      expect(mockConsume).toHaveBeenCalledWith('192.168.1.1-user-abc');
    });
  });
});
