jest.mock('jsonwebtoken', () => ({ verify: jest.fn() }));
jest.mock('../../../services/blacklistService', () => ({
  isTokenBlacklisted: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../../services/authService', () => ({
  verifyAndGenerateNewToken: jest.fn(),
}));

process.env.JWT_SECRET = 'test-secret';

const jwt = require('jsonwebtoken');
const { isTokenBlacklisted } = require('../../../services/blacklistService');
const { verifyAndGenerateNewToken } = require('../../../services/authService');
const verifyToken = require('../../../middlewares/auth');

const mockReq = (overrides = {}) => ({
  headers: {},
  cookies: {},
  body: {},
  ip: '127.0.0.1',
  path: '/test',
  ...overrides,
});

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res);
  return res;
};

describe('auth middleware (verifyToken)', () => {
  let next;

  beforeEach(() => {
    next = jest.fn();
    jest.clearAllMocks();
    isTokenBlacklisted.mockResolvedValue(false);
  });

  describe('extração de token', () => {
    it('deve retornar 401 quando nenhum token é fornecido', async () => {
      const req = mockReq();
      const res = mockRes();

      await verifyToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Token não fornecido' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('deve extrair token do Authorization header com prefixo Bearer', async () => {
      const decoded = { uid: 'user123', email: 'test@test.com' };
      jwt.verify.mockReturnValue(decoded);
      const req = mockReq({
        headers: { authorization: 'Bearer valid-token' },
      });
      const res = mockRes();

      await verifyToken(req, res, next);

      expect(jwt.verify).toHaveBeenCalledWith('valid-token', expect.anything());
      expect(next).toHaveBeenCalled();
    });

    it('deve extrair token do cookie authorization com prefixo Bearer', async () => {
      const decoded = { uid: 'user123' };
      jwt.verify.mockReturnValue(decoded);
      const req = mockReq({
        cookies: { authorization: 'Bearer cookie-token' },
      });
      const res = mockRes();

      await verifyToken(req, res, next);

      expect(jwt.verify).toHaveBeenCalledWith('cookie-token', expect.anything());
      expect(next).toHaveBeenCalled();
    });

    it('deve extrair token do cookie authorization sem prefixo Bearer', async () => {
      const decoded = { uid: 'user123' };
      jwt.verify.mockReturnValue(decoded);
      const req = mockReq({
        cookies: { authorization: 'raw-token' },
      });
      const res = mockRes();

      await verifyToken(req, res, next);

      expect(jwt.verify).toHaveBeenCalledWith('raw-token', expect.anything());
      expect(next).toHaveBeenCalled();
    });

    it('deve extrair token da string do header cookie (fallback)', async () => {
      const decoded = { uid: 'user123' };
      jwt.verify.mockReturnValue(decoded);
      const req = mockReq({
        headers: { cookie: 'authorization=Bearer header-cookie-token; other=val' },
      });
      const res = mockRes();

      await verifyToken(req, res, next);

      expect(jwt.verify).toHaveBeenCalledWith('header-cookie-token', expect.anything());
      expect(next).toHaveBeenCalled();
    });
  });

  describe('caminho feliz', () => {
    it('deve popular req.user, req.uid e req.auth quando token é válido', async () => {
      const decoded = { uid: 'user123', email: 'test@test.com', role: 'member' };
      jwt.verify.mockReturnValue(decoded);
      const req = mockReq({ headers: { authorization: 'Bearer valid-token' } });
      const res = mockRes();

      await verifyToken(req, res, next);

      expect(req.user).toEqual(decoded);
      expect(req.uid).toBe('user123');
      expect(req.auth).toEqual({ decoded });
      expect(req.isFirstAccess).toBe(false);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('tratamento de erros de JWT', () => {
    it('deve retornar 401 com requiresLogin quando token está na blacklist', async () => {
      isTokenBlacklisted.mockResolvedValue(true);
      const req = mockReq({ headers: { authorization: 'Bearer blacklisted-token' } });
      const res = mockRes();

      await verifyToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Token revogado', requiresLogin: true })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('deve retornar 401 com mensagem "Token inválido" para JsonWebTokenError', async () => {
      const err = new Error('invalid signature');
      err.name = 'JsonWebTokenError';
      jwt.verify.mockImplementation(() => { throw err; });
      const req = mockReq({ headers: { authorization: 'Bearer bad-token' } });
      const res = mockRes();

      await verifyToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Token inválido' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('deve retornar 401 genérico para outros erros sem refreshToken', async () => {
      const err = new Error('jwt expired');
      err.name = 'TokenExpiredError';
      jwt.verify.mockImplementation(() => { throw err; });
      const req = mockReq({
        headers: { authorization: 'Bearer expired-token' },
        cookies: {}, // sem refreshToken
      });
      const res = mockRes();

      await verifyToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Erro de autenticação' })
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('renovação de token (handleRefreshToken)', () => {
    it('deve renovar token e chamar next() quando TokenExpiredError + refreshToken válidos', async () => {
      const expired = new Error('jwt expired');
      expired.name = 'TokenExpiredError';
      const newDecoded = { uid: 'user123', email: 'renewed@test.com' };

      jwt.verify
        .mockImplementationOnce(() => { throw expired; }) // primeiro verify falha
        .mockReturnValueOnce(newDecoded); // segundo verify (após refresh) retorna decoded

      verifyAndGenerateNewToken.mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });

      const req = mockReq({
        headers: { authorization: 'Bearer expired-token' },
        cookies: { refreshToken: 'valid-refresh' },
      });
      const res = mockRes();

      await verifyToken(req, res, next);

      expect(verifyAndGenerateNewToken).toHaveBeenCalledWith('valid-refresh');
      expect(res.cookie).toHaveBeenCalledWith(
        'authorization',
        'Bearer new-access-token',
        expect.any(Object)
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'refreshToken',
        'new-refresh-token',
        expect.any(Object)
      );
      expect(req.user).toEqual(newDecoded);
      expect(req.uid).toBe('user123');
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('deve retornar 401 com requiresLogin quando renovação de token falha', async () => {
      const expired = new Error('jwt expired');
      expired.name = 'TokenExpiredError';
      jwt.verify.mockImplementation(() => { throw expired; });
      verifyAndGenerateNewToken.mockRejectedValue(new Error('refresh inválido'));

      const req = mockReq({
        headers: { authorization: 'Bearer expired-token' },
        cookies: { refreshToken: 'bad-refresh' },
      });
      const res = mockRes();

      await verifyToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Erro ao renovar token', requiresLogin: true })
      );
      expect(next).not.toHaveBeenCalled();
    });
  });
});
