const request = require('supertest');
const express = require('express');

// Mock dos middlewares antes de importar as rotas
jest.mock('../../middlewares/auth', () => (req, res, next) => {
  req.user = { uid: 'test-user-id', email: 'test@example.com' };
  next();
});

jest.mock('../../middlewares/rbac', () => ({
  isAdmin: (req, res, next) => {
    if (req.headers['x-test-role'] === 'admin') return next();
    return res.status(403).json({ error: 'Access denied: Admin only' });
  },
  checkPermission: (perm) => (req, res, next) => {
    if (req.headers['x-test-role'] === 'admin') return next();
    return res.status(403).json({ error: `Access denied: Missing permission ${perm}` });
  },
  checkRole: (role) => (req, res, next) => {
    if (req.headers['x-test-role'] === role || req.headers['x-test-role'] === 'admin') return next();
    return res.status(403).json({ error: `Access denied: Missing role ${role}` });
  }
}));

// Mock do logger para não sujar a saída do teste
jest.mock('../../logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

// Mock do rateLimiter
jest.mock('../../middlewares/rateLimiter', () => ({
  rateLimiter: (req, res, next) => next()
}));

const rbacRoutes = require('../../routes/rbac');

const app = express();
app.use(express.json());
app.use('/api/rbac', rbacRoutes);

describe('Security & RBAC Integration Tests', () => {
  describe('GET /api/rbac/roles', () => {
    it('should deny access to a regular user', async () => {
      const response = await request(app)
        .get('/api/rbac/roles')
        .set('x-test-role', 'user');
      
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Access denied');
    });

    it('should allow access to an admin user', async () => {
      // Mock do controller return
      // Como não estamos testando a lógica do banco aqui, mas a segurança (RBAC middleware)
      // O importante é que ele passe pelo middleware e chegue no controller.
      const response = await request(app)
        .get('/api/rbac/roles')
        .set('x-test-role', 'admin');
      
      // 200 ou 500 (se o controller falhar por falta de DB), mas não 403.
      expect(response.status).not.toBe(403);
    });
  });

  describe('POST /api/rbac/initialize', () => {
    it('should strictly require isAdmin for system initialization', async () => {
      const response = await request(app)
        .post('/api/rbac/initialize')
        .set('x-test-role', 'user');
      
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Access denied: Admin only');
    });
  });
});
