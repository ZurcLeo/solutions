const verifyToken = require('../../../middlewares/auth');
const jwt = require('jsonwebtoken');

// Mock de serviços
jest.mock('../../../services/blacklistService', () => ({
  isTokenBlacklisted: jest.fn().mockResolvedValue(false)
}));

jest.mock('../../../services/authService', () => ({
  verifyAndGenerateNewToken: jest.fn()
}));

describe('Auth Middleware - Modo Degradado (Firebase Auth Offline)', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      headers: {},
      cookies: {}
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      cookie: jest.fn()
    };
    next = jest.fn();
    process.env.JWT_SECRET = 'test_secret';
    jest.clearAllMocks();
  });

  it('deve retornar 401 com mensagem amigável quando o token expirou e a renovação falha', async () => {
    const expiredToken = jwt.sign({ uid: 'user123' }, process.env.JWT_SECRET, { expiresIn: '-1s' });
    req.headers['authorization'] = `Bearer ${expiredToken}`;
    req.cookies.refreshToken = 'some_refresh_token';

    const { verifyAndGenerateNewToken } = require('../../../services/authService');
    verifyAndGenerateNewToken.mockRejectedValue(new Error('Firebase Authentication is currently unavailable'));

    await verifyToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Erro ao renovar token',
      requiresLogin: true
    }));
  });

  it('deve retornar 401 quando o token é inválido (JsonWebTokenError)', async () => {
    req.headers['authorization'] = 'Bearer invalid_token';

    await verifyToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Token inválido'
    }));
  });
});
