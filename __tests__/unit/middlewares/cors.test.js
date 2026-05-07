jest.mock('../../../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Captura corsOptions antes de cors() ser chamado com elas
let capturedCorsOptions;
jest.mock('cors', () =>
  jest.fn((options) => {
    capturedCorsOptions = options;
    return jest.fn((req, res, next) => next());
  })
);

// Require após os mocks para capturar corsOptions
const corsMiddleware = require('../../../middlewares/cors');

describe('cors middleware', () => {
  describe('configuração exportada', () => {
    it('deve exportar uma função middleware', () => {
      expect(typeof corsMiddleware).toBe('function');
    });

    it('deve ter credentials: true', () => {
      expect(capturedCorsOptions.credentials).toBe(true);
    });

    it('deve incluir métodos HTTP padrão', () => {
      expect(capturedCorsOptions.methods).toContain('GET');
      expect(capturedCorsOptions.methods).toContain('POST');
      expect(capturedCorsOptions.methods).toContain('PUT');
      expect(capturedCorsOptions.methods).toContain('DELETE');
      expect(capturedCorsOptions.methods).toContain('OPTIONS');
    });
  });

  describe('callback de origin', () => {
    let originCallback;

    beforeEach(() => {
      originCallback = capturedCorsOptions.origin;
    });

    it('deve permitir requisições sem origin (mobile apps, Postman, server-to-server)', (done) => {
      originCallback(null, (err, allowed) => {
        expect(err).toBeNull();
        expect(allowed).toBe(true);
        done();
      });
    });

    it('deve permitir https://eloscloud.com (lista exata — produção)', (done) => {
      originCallback('https://eloscloud.com', (err, allowed) => {
        expect(err).toBeNull();
        expect(allowed).toBe(true);
        done();
      });
    });

    it('deve permitir https://eloscloud.com.br (lista exata — produção)', (done) => {
      originCallback('https://eloscloud.com.br', (err, allowed) => {
        expect(err).toBeNull();
        expect(allowed).toBe(true);
        done();
      });
    });

    it('deve permitir http://localhost:3000 (ambiente de desenvolvimento)', (done) => {
      // Em test env (NODE_ENV=test ≠ production), developmentOrigins são incluídas
      originCallback('http://localhost:3000', (err, allowed) => {
        expect(err).toBeNull();
        expect(allowed).toBe(true);
        done();
      });
    });

    it('deve permitir subdomínio do eloscloud.com via regex', (done) => {
      originCallback('https://sub.eloscloud.com', (err, allowed) => {
        expect(err).toBeNull();
        expect(allowed).toBe(true);
        done();
      });
    });

    it('deve permitir subdomínio do eloscloud.com.br via regex', (done) => {
      originCallback('https://admin.eloscloud.com.br', (err, allowed) => {
        expect(err).toBeNull();
        expect(allowed).toBe(true);
        done();
      });
    });

    it('deve bloquear origin desconhecida retornando Error', (done) => {
      originCallback('https://malicious-site.com', (err) => {
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toContain('malicious-site.com');
        done();
      });
    });

    it('deve bloquear http://eloscloud.com (protocolo incorreto — somente https)', (done) => {
      // http:// não corresponde ao regex ^https://...
      // mas http://eloscloud.com não está na lista exata nem no regex
      originCallback('http://eloscloud.com', (err) => {
        // Pode ser na lista exata (sem regex), mas a lista só inclui https://
        // Verificar que foi bloqueado (não está na lista exata de produção)
        // Como NODE_ENV != production, check development origins too
        // http://eloscloud.com não está nem em produção nem em dev → bloqueado
        expect(err).toBeInstanceOf(Error);
        done();
      });
    });

    it('deve bloquear subdomínio com protocolo http (regex exige https)', (done) => {
      originCallback('http://sub.eloscloud.com', (err) => {
        expect(err).toBeInstanceOf(Error);
        done();
      });
    });
  });

  describe('maxAge', () => {
    it('deve ter maxAge configurado', () => {
      // Em ambiente de teste (não-produção): 3600; em produção: 86400
      expect(capturedCorsOptions.maxAge).toBeGreaterThan(0);
    });
  });
});
