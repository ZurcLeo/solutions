/**
 * @fileoverview Testes unitários para inviteService
 *
 * Bugs documentados:
 * [BUG-001] POST /api/invite/generate → 400 quando senderName ou senderEmail é null.
 *   Causa: sendInviteSchema usa Joi.string().optional() que rejeita null (aceita apenas undefined).
 *   O frontend envia senderName: null quando currentUser.displayName é null.
 *   Fix: filtrar null no InviteService OU adicionar .allow(null) no schema.
 */

const inviteService = require('../../../services/inviteService');
const Invite = require('../../../models/Invite');
const User = require('../../../models/User');
const NotificationDispatcher = require('../../../services/NotificationDispatcher');

jest.mock('../../../models/Invite');
jest.mock('../../../models/User');
jest.mock('../../../services/NotificationDispatcher', () => ({
  dispatch: jest.fn().mockResolvedValue({ success: true, jobId: 'job_123' })
}));
jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,mockqrcode'),
  toBuffer: jest.fn().mockResolvedValue(Buffer.from('mockbuffer'))
}));

jest.mock('../../../firebaseAdmin', () => {
  const createMockDoc = (path) => ({
    path,
    collection: jest.fn((name) => createMockCollection(`${path}/${name}`)),
    get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
    update: jest.fn().mockResolvedValue(true),  // necessário para inviteRef.update()
    set: jest.fn().mockResolvedValue(true)
  });

  const createMockCollection = (path) => ({
    path,
    doc: jest.fn(() => createMockDoc(`${path}/doc`)),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ empty: true, docs: [] })
  });

  const mockTransaction = {
    get: jest.fn(),
    set: jest.fn(),
    update: jest.fn()
  };

  const mockAuth = {
    getUserByEmail: jest.fn().mockRejectedValue({ code: 'auth/user-not-found' })
  };

  const mockDb = {
    collection: jest.fn((name) => createMockCollection(name)),
    runTransaction: jest.fn(cb => cb(mockTransaction))
  };

  const mockBucket = {
    name: 'mock-bucket',
    file: jest.fn(() => ({
      save: jest.fn().mockResolvedValue(true),
      exists: jest.fn().mockResolvedValue([true]),
      delete: jest.fn().mockResolvedValue(true)
    }))
  };

  const mockStorage = () => mockBucket;

  return {
    getFirestore: jest.fn(() => mockDb),
    getAuth: jest.fn(() => mockAuth),
    getStorage: jest.fn(() => mockStorage()),
    mockDb,
    mockTransaction,
    mockAuth,
    mockBucket
  };
});

jest.mock('../../../logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));

const { mockDb, mockTransaction, mockAuth } = require('../../../firebaseAdmin');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeUser = (overrides = {}) => ({
  uid: 'user-001',
  nome: 'Remetente Teste',
  email: 'remetente@eloscloud.com',
  fotoDoPerfil: 'https://example.com/foto.jpg',
  ...overrides
});

const makeInvite = (overrides = {}) => ({
  inviteId: 'invite-abc',
  email: 'amigo@example.com',
  friendName: 'Amigo Teste',
  senderId: 'user-001',
  senderName: 'Remetente Teste',
  status: 'pending',
  createdAt: { toDate: () => new Date() },
  lastSentAt: null,
  resendCount: 0,
  ...overrides
});

// ---------------------------------------------------------------------------

describe('inviteService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    NotificationDispatcher.dispatch.mockResolvedValue({ success: true, jobId: 'job_123' });
    mockAuth.getUserByEmail.mockRejectedValue({ code: 'auth/user-not-found' });
  });

  // =========================================================================
  describe('canSendInvite', () => {
    it('deve rejeitar quando usuário não existe', async () => {
      User.getById.mockResolvedValue(null);

      await expect(inviteService.canSendInvite('user-nao-existe', 'amigo@example.com'))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    it('deve rejeitar quando limite de convites pendentes é atingido', async () => {
      User.getById.mockResolvedValue(makeUser());
      const pendingList = Array(10).fill(makeInvite());
      Invite.getPendingBySender.mockResolvedValue(pendingList);
      Invite.findByEmail.mockResolvedValue(null);

      const result = await inviteService.canSendInvite('user-001', 'amigo@example.com');

      expect(result.canSend).toBe(false);
      expect(result.message).toMatch(/limite/i);
    });

    it('deve permitir envio quando não há convite anterior para o email', async () => {
      User.getById.mockResolvedValue(makeUser());
      Invite.getPendingBySender.mockResolvedValue([]);
      Invite.findByEmail.mockResolvedValue(null);

      const result = await inviteService.canSendInvite('user-001', 'novo@example.com');

      expect(result.canSend).toBe(true);
      expect(result.user).toBeDefined();
    });

    it('deve rejeitar quando email já foi registrado por outro convite (status used)', async () => {
      User.getById.mockResolvedValue(makeUser());
      Invite.getPendingBySender.mockResolvedValue([]);
      Invite.findByEmail.mockResolvedValue(makeInvite({ status: 'used' }));

      const result = await inviteService.canSendInvite('user-001', 'amigo@example.com');

      expect(result.canSend).toBe(false);
      expect(result.message).toMatch(/registrado/i);
    });

    it('deve rejeitar quando convite pendente pertence a outro remetente', async () => {
      User.getById.mockResolvedValue(makeUser());
      Invite.getPendingBySender.mockResolvedValue([]);
      Invite.findByEmail.mockResolvedValue(makeInvite({ senderId: 'outro-usuario' }));

      const result = await inviteService.canSendInvite('user-001', 'amigo@example.com');

      expect(result.canSend).toBe(false);
      expect(result.message).toMatch(/outro usuário/i);
    });

    it('deve rejeitar reenvio dentro do cooldown de 1 hora', async () => {
      User.getById.mockResolvedValue(makeUser());
      Invite.getPendingBySender.mockResolvedValue([]);
      const recentDate = new Date(Date.now() - 30 * 60 * 1000); // 30 min atrás
      Invite.findByEmail.mockResolvedValue(
        makeInvite({ lastSentAt: { toDate: () => recentDate } })
      );

      const result = await inviteService.canSendInvite('user-001', 'amigo@example.com');

      expect(result.canSend).toBe(false);
      expect(result.message).toMatch(/aguarde/i);
    });

    it('deve permitir reenvio quando cooldown já passou', async () => {
      User.getById.mockResolvedValue(makeUser());
      Invite.getPendingBySender.mockResolvedValue([]);
      const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 horas atrás
      Invite.findByEmail.mockResolvedValue(
        makeInvite({ lastSentAt: { toDate: () => oldDate } })
      );

      const result = await inviteService.canSendInvite('user-001', 'amigo@example.com');

      expect(result.canSend).toBe(true);
      expect(result.existingInvite).toBeDefined();
    });

    it('deve permitir novo envio quando convite anterior foi cancelado', async () => {
      User.getById.mockResolvedValue(makeUser());
      Invite.getPendingBySender.mockResolvedValue([]);
      Invite.findByEmail.mockResolvedValue(makeInvite({ status: 'canceled' }));

      const result = await inviteService.canSendInvite('user-001', 'amigo@example.com');

      expect(result.canSend).toBe(true);
    });
  });

  // =========================================================================
  describe('generateAndSendInvite', () => {
    it('deve criar convite, enviar email e notificar remetente no mesmo batch via Dispatcher', async () => {
      User.getById.mockResolvedValue(makeUser());
      Invite.getPendingBySender.mockResolvedValue([]);
      Invite.findByEmail.mockResolvedValue(null);

      await inviteService.generateAndSendInvite('user-001', 'amigo@example.com', 'Amigo Teste');

      expect(mockDb.runTransaction).toHaveBeenCalledTimes(1);
      expect(mockTransaction.set).toHaveBeenCalledTimes(1); // apenas o convite
      expect(NotificationDispatcher.dispatch).toHaveBeenCalledTimes(1);
    });

    it('deve retornar inviteId, email, friendName e expiresAt', async () => {
      User.getById.mockResolvedValue(makeUser());
      Invite.getPendingBySender.mockResolvedValue([]);
      Invite.findByEmail.mockResolvedValue(null);

      const result = await inviteService.generateAndSendInvite(
        'user-001',
        'amigo@example.com',
        'Amigo Teste'
      );

      expect(result).toMatchObject({
        inviteId: expect.any(String),
        email: 'amigo@example.com',
        friendName: 'Amigo Teste',
        expiresAt: expect.any(String)
      });
    });

    it('deve normalizar email para lowercase antes de salvar', async () => {
      User.getById.mockResolvedValue(makeUser());
      Invite.getPendingBySender.mockResolvedValue([]);
      Invite.findByEmail.mockResolvedValue(null);

      await inviteService.generateAndSendInvite('user-001', 'AMIGO@EXAMPLE.COM', 'Amigo Teste');

      const savedData = mockTransaction.set.mock.calls[0][1];
      expect(savedData.email).toBe('amigo@example.com');
    });

    it('deve lançar HttpError 400 quando canSendInvite retorna canSend:false', async () => {
      User.getById.mockResolvedValue(makeUser());
      Invite.getPendingBySender.mockResolvedValue(Array(10).fill(makeInvite()));
      Invite.findByEmail.mockResolvedValue(null);

      await expect(
        inviteService.generateAndSendInvite('user-001', 'amigo@example.com', 'Amigo Teste')
      ).rejects.toMatchObject({ statusCode: 400 });

      expect(NotificationDispatcher.dispatch).not.toHaveBeenCalled();
    });
  });
});
