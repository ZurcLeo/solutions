/**
 * Smoke test: valida que Jest + supertest estão configurados corretamente.
 *
 * Testa o comportamento do health endpoint sem importar o index.js
 * (que depende de SSL, Firebase, etc.).
 */
const express = require('express');
const request = require('supertest');

const buildHealthApp = () => {
  const app = express();
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
    });
  });
  return app;
};

describe('smoke: health endpoint', () => {
  const app = buildHealthApp();

  it('deve retornar status 200', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });

  it('deve retornar status: healthy no body', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body.status).toBe('healthy');
  });

  it('deve incluir timestamp e version no body', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('version', '1.0.0');
  });

  it('deve retornar Content-Type application/json', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});
