const request = require('supertest');
const express = require('express');

// Mock do Supabase — addToLocalBlacklist agora persiste via Supabase + cache in-memory
jest.mock('../../config/supabase', () => ({
  getSupabaseClient: () => ({
    from: jest.fn().mockReturnValue({
      upsert: jest.fn().mockResolvedValue({ error: null }),
      select: jest.fn().mockReturnValue({
        order: jest.fn().mockResolvedValue({ data: [], error: null }),
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockResolvedValue({ data: null }),
          lte: jest.fn().mockResolvedValue({ error: null }),
        }),
      }),
      delete: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          lte: jest.fn().mockResolvedValue({ error: null }),
          select: jest.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    }),
  }),
}));

// Mock do logger para não sujar a saída do teste
jest.mock('../../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  },
  morganMiddleware: (req, res, next) => next()
}));

const { authRateLimiter } = require('../../middlewares/rateLimiter');
const checkBlacklist = require('../../middlewares/checkBlacklist');
const { isLocallyBlacklisted, addToLocalBlacklist } = require('../../utils/securityUtils');

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use(checkBlacklist); // Aplicar o middleware de blacklist

// Rota simulando autenticação com rate limit restritivo
app.post('/api/auth/login', authRateLimiter, (req, res) => {
  res.status(200).json({ success: true });
});

describe('Security Stress & Auto-Blacklisting', () => {
  it('should blacklist IP after repeated rate limit violations on sensitive routes', async () => {
    const testIp = '192.168.1.100';

    // authRateLimiter: points=5, auto-blacklist quando consumedPoints > points * 4 (>20).
    // Precisamos de 21 requests para o consumedPoints ultrapassar 20.
    for (let i = 0; i < 21; i++) {
      await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', testIp);
    }

    // Aguardar o fire-and-forget do addToLocalBlacklist resolver
    await new Promise(r => setTimeout(r, 50));

    // O IP deve estar no cache in-memory (Supabase mockado aceita o upsert)
    expect(isLocallyBlacklisted(testIp)).toBe(true);

    // Qualquer requisição subsequente desse IP deve retornar 403 via checkBlacklist middleware
    const blockedRes = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', testIp);

    expect(blockedRes.status).toBe(403);
    expect(blockedRes.body.error).toContain('IP blacklisted');
  });

  it('should block requests with a blacklisted JA3 Fingerprint', async () => {
    const suspiciousJA3 = 'bad_bot_fingerprint_xyz';

    // addToLocalBlacklist faz upsert no Supabase (mockado) + atualiza cache in-memory
    await addToLocalBlacklist(suspiciousJA3, 'ja3', 'Known bot fingerprint');

    // Requisição com esse fingerprint deve ser bloqueada pelo middleware checkBlacklist
    const blockedRes = await request(app)
      .post('/api/auth/login')
      .set('x-ja3-hash', suspiciousJA3);

    expect(blockedRes.status).toBe(403);
    expect(blockedRes.body.error).toContain('Fingerprint blacklisted');
  });
});
