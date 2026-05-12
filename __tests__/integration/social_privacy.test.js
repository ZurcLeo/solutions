const request = require('supertest');
const express = require('express');

// Mock COMPLETO do Firebase e Modelos
const mockFirestore = {
  collection: jest.fn(() => ({
    doc: jest.fn(() => ({
      get: jest.fn(async () => ({
        exists: true,
        data: () => ({ 
          usuarioId: 'user-a', 
          conteudo: 'Secret post', 
          visibilidade: 'friends' 
        })
      }))
    }))
  }))
};

jest.mock('firebase-admin', () => ({
  firestore: () => mockFirestore,
  initializeApp: jest.fn()
}));

jest.mock('../../firebaseAdmin', () => ({
  getFirestore: () => mockFirestore
}));

// Mock dos modelos secundários para evitar falhas no Controller
jest.mock('../../models/Comment', () => ({ getByPostId: jest.fn(async () => []) }));
jest.mock('../../models/Reaction', () => ({ getByPostId: jest.fn(async () => []) }));
jest.mock('../../models/Gift', () => ({ getByPostId: jest.fn(async () => []) }));

// Mock do middleware de autenticação
jest.mock('../../middlewares/auth', () => (req, res, next) => {
  const uid = req.headers['x-test-uid'] || 'user-a';
  req.user = { uid, email: `${uid}@example.com` };
  next();
});

jest.mock('../../logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('../../middlewares/rateLimiter', () => ({
  readLimit: (req, res, next) => next(),
  writeLimit: (req, res, next) => next()
}));

jest.mock('../../middlewares/healthMiddleware', () => ({
  healthCheck: () => (req, res, next) => next()
}));

// Mock do ActiveConnection
jest.mock('../../models/ActiveConnection', () => ({
  exists: jest.fn(async (u1, u2) => {
    const friends = [['user-a', 'user-b'], ['user-b', 'user-a']];
    return friends.some(pair => pair[0] === u1 && pair[1] === u2);
  })
}));

const postRoutes = require('../../routes/posts');
const app = express();
app.use(express.json());
app.use('/api/posts', postRoutes);

describe('Social Privacy Integration Tests', () => {
  it('should allow the owner to view their own private post', async () => {
    const res = await request(app)
      .get('/api/posts/post-private-a')
      .set('x-test-uid', 'user-a');
    
    expect(res.status).toBe(200);
    expect(res.body.conteudo).toBe('Secret post');
  });

  it('should allow a friend to view a private post', async () => {
    const res = await request(app)
      .get('/api/posts/post-private-a')
      .set('x-test-uid', 'user-b');
    
    // NOTA: Se a privacidade não estiver implementada, retorna 200.
    // O objetivo do QA é validar se a regra de negócio está sendo forçada.
    expect(res.status).toBe(200);
  });

  it('should deny a non-friend from viewing a private post', async () => {
    const res = await request(app)
      .get('/api/posts/post-private-a')
      .set('x-test-uid', 'user-c');
    
    // Este teste falhará se a privacidade não estiver implementada no controller/service.
    expect(res.status).toBe(403);
  });
});
