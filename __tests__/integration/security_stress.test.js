const request = require('supertest');
const express = require('express');
const { authRateLimiter } = require('../../middlewares/rateLimiter');
const checkBlacklist = require('../../middlewares/checkBlacklist');
const { isLocallyBlacklisted, addToLocalBlacklist } = require('../../utils/securityUtils');
const fs = require('fs');
const path = require('path');

const BLACKLIST_PATH = path.join(__dirname, '../../blacklist.json');

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

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use(checkBlacklist); // Aplicar o middleware de blacklist

// Rota simulando autenticação com rate limit restritivo
app.post('/api/auth/login', authRateLimiter, (req, res) => {
  res.status(200).json({ success: true });
});

describe('Security Stress & Auto-Blacklisting', () => {
  let originalBlacklistContent;

  beforeAll(() => {
    // Backup da blacklist original se existir
    if (fs.existsSync(BLACKLIST_PATH)) {
      originalBlacklistContent = fs.readFileSync(BLACKLIST_PATH, 'utf8');
    }
  });

  afterAll(() => {
    // Restaurar blacklist original
    if (originalBlacklistContent) {
      fs.writeFileSync(BLACKLIST_PATH, originalBlacklistContent);
    } else if (fs.existsSync(BLACKLIST_PATH)) {
      fs.unlinkSync(BLACKLIST_PATH);
    }
  });

  it('should blacklist IP after repeated rate limit violations on sensitive routes', async () => {
    const testIp = '192.168.1.100';
    
    // O authRateLimiter tem limite de 5 pontos. 
    // Nossa lógica no middleware blacklista se consumedPoints > limite * 2 (ou seja, 11 requisições)
    
    for (let i = 0; i < 11; i++) {
      await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', testIp);
    }

    // A 12ª requisição deve ter disparado o blacklisting automático
    // Vamos verificar se o IP está no arquivo blacklist.json
    const blacklist = JSON.parse(fs.readFileSync(BLACKLIST_PATH, 'utf8'));
    const isBlacklisted = blacklist.some(item => item.id === testIp);
    
    expect(isBlacklisted).toBe(true);

    // Agora qualquer requisição desse IP deve retornar 403 via checkBlacklist middleware
    const blockedRes = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', testIp);
    
    expect(blockedRes.status).toBe(403);
    expect(blockedRes.body.error).toContain('IP blacklisted');
  });

  it('should block requests with a blacklisted JA3 Fingerprint', async () => {
    const suspiciousJA3 = 'bad_bot_fingerprint_xyz';
    
    // Simular a adição do fingerprint à blacklist (ex: via SmartSecurityService ou manual)
    addToLocalBlacklist(suspiciousJA3, 'ja3', 'Known bot fingerprint');

    // Requisição com esse fingerprint deve ser bloqueada
    const blockedRes = await request(app)
      .post('/api/auth/login')
      .set('x-ja3-hash', suspiciousJA3);
    
    expect(blockedRes.status).toBe(403);
    expect(blockedRes.body.error).toContain('Fingerprint blacklisted');
  });
});
