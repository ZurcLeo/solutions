/**
 * @fileoverview Testes unitários para inviteService — fluxo completo de convites.
 *
 * Cobertura:
 *   canSendInvite       — regras de negócio para autorizar envio
 *   generateAndSendInvite — criação via Supabase (Invite.create) + NotificationDispatcher
 *   checkInvite         — validação pública (existência, status, expiração, email)
 *   validateInvite      — confirmação de identidade sem checar friendName (fix aplicado)
 *   invalidateInvite    — marcação de uso, ancestralidade, ElosCoins e notificações
 *
 * Bugs documentados:
 * [BUG-001] POST /api/invite/generate → 400 quando senderName ou senderEmail é null.
 *   Causa: sendInviteSchema usa Joi.string().optional() que rejeita null.
 *   Fix: || undefined no InviteService frontend.
 */

const inviteService = require('../../../services/inviteService');
const Invite        = require('../../../models/Invite');
const User          = require('../../../models/User');
const NotificationDispatcher = require('../../../services/NotificationDispatcher');

// ── Mocks estáticos ──────────────────────────────────────────────────────────
jest.mock('../../../models/Invite');
jest.mock('../../../models/User');

jest.mock('../../../services/NotificationDispatcher', () => ({
  dispatch: jest.fn().mockResolvedValue({ success: true, jobId: 'job_123' })
}));

jest.mock('../../../services/emailService', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true })
}));

jest.mock('../../../services/notificationService', () => ({
  createNotification: jest.fn().mockResolvedValue(true)
}));

jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,mockqrcode'),
  toBuffer:  jest.fn().mockResolvedValue(Buffer.from('mockbuffer'))
}));

jest.mock('../../../firebaseAdmin', () => {
  const createMockDoc = (path) => ({
    path,
    collection: jest.fn((name) => createMockCollection(`${path}/${name}`)),
    get:    jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
    update: jest.fn().mockResolvedValue(true),
    set:    jest.fn().mockResolvedValue(true)
  });

  const createMockCollection = (path) => ({
    path,
    doc:   jest.fn(() => createMockDoc(`${path}/doc`)),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get:   jest.fn().mockResolvedValue({ empty: true, docs: [] })
  });

  const mockTransaction = { get: jest.fn(), set: jest.fn(), update: jest.fn() };
  const mockAuth = {
    getUserByEmail: jest.fn().mockRejectedValue({ code: 'auth/user-not-found' })
  };
  const mockDb = {
    collection:     jest.fn((name) => createMockCollection(name)),
    runTransaction: jest.fn(cb => cb(mockTransaction))
  };
  const mockBucket = {
    name: 'mock-bucket',
    file: jest.fn(() => ({
      save:   jest.fn().mockResolvedValue(true),
      exists: jest.fn().mockResolvedValue([true]),
      delete: jest.fn().mockResolvedValue(true)
    }))
  };

  return {
    getFirestore: jest.fn(() => mockDb),
    getAuth:      jest.fn(() => mockAuth),
    getStorage:   jest.fn(() => mockBucket),
    mockDb, mockTransaction, mockAuth, mockBucket
  };
});

jest.mock('../../../logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));

const { mockDb, mockTransaction, mockAuth } = require('../../../firebaseAdmin');
const emailService        = require('../../../services/emailService');
const notificationService = require('../../../services/notificationService');

// ── Helpers ──────────────────────────────────────────────────────────────────
const makeUser = (overrides = {}) => ({
  uid:          'user-001',
  nome:         'Remetente Teste',
  email:        'remetente@eloscloud.com',
  fotoDoPerfil: 'https://example.com/foto.jpg',
  ...overrides
});

const makeInvite = (overrides = {}) => ({
  inviteId:    'invite-abc',
  email:       'amigo@example.com',
  friendName:  'Amigo Teste',
  senderId:    'user-001',
  senderName:  'Remetente Teste',
  status:      'pending',
  createdAt:   { toDate: () => new Date() },   // Firestore Timestamp shape
  lastSentAt:  null,
  resendCount: 0,
  ...overrides
});

// createdAt 10 dias atrás — garante que o convite está expirado
const makeExpiredInvite = (overrides = {}) =>
  makeInvite({
    createdAt: { toDate: () => new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
    ...overrides
  });

// ─────────────────────────────────────────────────────────────────────────────

describe('inviteService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // jwt.sign precisa de secret — garante que não lança em testes
    process.env.JWT_SECRET = 'test-secret-key';
    NotificationDispatcher.dispatch.mockResolvedValue({ success: true, jobId: 'job_123' });
    mockAuth.getUserByEmail.mockRejectedValue({ code: 'auth/user-not-found' });
    // Defaults úteis para a maioria dos testes
    Invite.updateByInviteId.mockResolvedValue(true);
    Invite.create.mockResolvedValue(true);
  });

  // ===========================================================================
  describe('canSendInvite', () => {
    it('deve rejeitar quando usuário não existe', async () => {
      User.getById.mockResolvedValue(null);

      await expect(inviteService.canSendInvite('user-nao-existe', 'amigo@example.com'))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    it('deve rejeitar quando limite de convites pendentes é atingido', async () => {
      User.getById.mockResolvedValue(makeUser());
      Invite.getPendingBySender.mockResolvedValue(Array(10).fill(makeInvite()));
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
      const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h atrás
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

  // ===========================================================================
  describe('generateAndSendInvite', () => {
    it('deve salvar convite via Invite.create e disparar NotificationDispatcher', async () => {
      User.getById.mockResolvedValue(makeUser());
      Invite.getPendingBySender.mockResolvedValue([]);
      Invite.findByEmail.mockResolvedValue(null);

      await inviteService.generateAndSendInvite('user-001', 'amigo@example.com', 'Amigo Teste');
      // dispatch ocorre em setImmediate (fire-and-forget) — aguardar o próximo tick
      await new Promise(setImmediate);

      expect(Invite.create).toHaveBeenCalledTimes(1);
      expect(NotificationDispatcher.dispatch).toHaveBeenCalledTimes(1);
    });

    it('deve retornar inviteId, email, friendName e expiresAt', async () => {
      User.getById.mockResolvedValue(makeUser());
      Invite.getPendingBySender.mockResolvedValue([]);
      Invite.findByEmail.mockResolvedValue(null);

      const result = await inviteService.generateAndSendInvite(
        'user-001', 'amigo@example.com', 'Amigo Teste'
      );

      expect(result).toMatchObject({
        inviteId:   expect.any(String),
        email:      'amigo@example.com',
        friendName: 'Amigo Teste',
        expiresAt:  expect.any(String)
      });
    });

    it('deve normalizar email para lowercase antes de salvar no Supabase', async () => {
      User.getById.mockResolvedValue(makeUser());
      Invite.getPendingBySender.mockResolvedValue([]);
      Invite.findByEmail.mockResolvedValue(null);

      await inviteService.generateAndSendInvite('user-001', 'AMIGO@EXAMPLE.COM', 'Amigo Teste');

      const savedPayload = Invite.create.mock.calls[0][0];
      expect(savedPayload.email).toBe('amigo@example.com');
    });

    it('deve lançar HttpError 400 e NÃO chamar Dispatcher quando canSendInvite bloqueia', async () => {
      User.getById.mockResolvedValue(makeUser());
      Invite.getPendingBySender.mockResolvedValue(Array(10).fill(makeInvite()));
      Invite.findByEmail.mockResolvedValue(null);

      await expect(
        inviteService.generateAndSendInvite('user-001', 'amigo@example.com', 'Amigo Teste')
      ).rejects.toMatchObject({ statusCode: 400 });

      expect(Invite.create).not.toHaveBeenCalled();
      expect(NotificationDispatcher.dispatch).not.toHaveBeenCalled();
    });

    it('deve salvar expiresAt como 5 dias após criação', async () => {
      User.getById.mockResolvedValue(makeUser());
      Invite.getPendingBySender.mockResolvedValue([]);
      Invite.findByEmail.mockResolvedValue(null);

      const before = Date.now();
      await inviteService.generateAndSendInvite('user-001', 'amigo@example.com', 'Amigo Teste');
      const after = Date.now();

      const savedPayload = Invite.create.mock.calls[0][0];
      const expiresMs = new Date(savedPayload.expiresAt).getTime();
      const expectedMin = before + 4.9 * 24 * 60 * 60 * 1000;
      const expectedMax = after  + 5.1 * 24 * 60 * 60 * 1000;

      expect(expiresMs).toBeGreaterThan(expectedMin);
      expect(expiresMs).toBeLessThan(expectedMax);
    });
  });

  // ===========================================================================
  describe('checkInvite', () => {
    it('deve retornar valid:false quando convite não existe', async () => {
      Invite.getById.mockResolvedValue({ invite: null });

      const result = await inviteService.checkInvite('invite-nao-existe');

      expect(result.valid).toBe(false);
      expect(result.message).toMatch(/não encontrado/i);
    });

    it('deve retornar valid:false quando convite já foi usado', async () => {
      Invite.getById.mockResolvedValue({ invite: makeInvite({ status: 'used' }) });

      const result = await inviteService.checkInvite('invite-abc');

      expect(result.valid).toBe(false);
      expect(result.message).toMatch(/utilizado|cancelado/i);
    });

    it('deve retornar valid:false quando convite está cancelado', async () => {
      Invite.getById.mockResolvedValue({ invite: makeInvite({ status: 'canceled' }) });

      const result = await inviteService.checkInvite('invite-abc');

      expect(result.valid).toBe(false);
    });

    it('deve retornar valid:false quando convite está expirado (> 5 dias)', async () => {
      Invite.getById.mockResolvedValue({ invite: makeExpiredInvite() });

      const result = await inviteService.checkInvite('invite-abc');

      expect(result.valid).toBe(false);
      expect(result.message).toMatch(/expirado/i);
    });

    it('deve retornar valid:false quando email não corresponde ao convite', async () => {
      Invite.getById.mockResolvedValue({ invite: makeInvite() }); // email: amigo@example.com

      const result = await inviteService.checkInvite('invite-abc', 'outro@example.com');

      expect(result.valid).toBe(false);
      expect(result.message).toMatch(/email/i);
    });

    it('deve retornar valid:true com dados do convite quando tudo está correto', async () => {
      Invite.getById.mockResolvedValue({ invite: makeInvite() });

      const result = await inviteService.checkInvite('invite-abc', 'amigo@example.com');

      expect(result.valid).toBe(true);
      expect(result.invite).toMatchObject({
        email:      'amigo@example.com',
        senderName: 'Remetente Teste',
        friendName: 'Amigo Teste',
        status:     'pending'
      });
    });

    it('deve retornar valid:true sem checar email quando email não é fornecido', async () => {
      Invite.getById.mockResolvedValue({ invite: makeInvite() });

      const result = await inviteService.checkInvite('invite-abc');

      expect(result.valid).toBe(true);
    });
  });

  // ===========================================================================
  describe('validateInvite', () => {
    const setupValidInvite = () => {
      Invite.getById.mockResolvedValue({ invite: makeInvite() });
      User.getById.mockResolvedValue(makeUser());
    };

    it('deve lançar 400 quando convite não existe', async () => {
      Invite.getById.mockResolvedValue({ invite: null });

      await expect(
        inviteService.validateInvite('invite-abc', 'amigo@example.com', 'Qualquer Nome')
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('deve lançar 400 quando convite está expirado', async () => {
      Invite.getById.mockResolvedValue({ invite: makeExpiredInvite() });

      await expect(
        inviteService.validateInvite('invite-abc', 'amigo@example.com', 'Qualquer Nome')
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('deve lançar 400 quando email não corresponde ao convite', async () => {
      Invite.getById.mockResolvedValue({ invite: makeInvite() });

      await expect(
        inviteService.validateInvite('invite-abc', 'errado@example.com', 'Qualquer Nome')
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('deve aceitar qualquer nome — friendName não é mais verificado', async () => {
      // Garante que o fix foi aplicado: 'Outro Nome' != 'Amigo Teste' mas deve passar
      setupValidInvite();

      const result = await inviteService.validateInvite(
        'invite-abc', 'amigo@example.com', 'Outro Nome Completamente Diferente'
      );

      expect(result).toMatchObject({
        inviteId:          'invite-abc',
        registrationToken: expect.any(String),
        inviter:           expect.objectContaining({ id: 'user-001' })
      });
    });

    it('deve marcar convite como validated no Supabase', async () => {
      setupValidInvite();

      await inviteService.validateInvite('invite-abc', 'amigo@example.com', 'Meu Nome Real');

      expect(Invite.updateByInviteId).toHaveBeenCalledWith(
        'invite-abc',
        expect.objectContaining({ status: 'validated' })
      );
    });

    it('deve retornar dados do remetente (inviter) com id, nome, email e foto', async () => {
      setupValidInvite();

      const result = await inviteService.validateInvite(
        'invite-abc', 'amigo@example.com', 'Meu Nome'
      );

      expect(result.inviter).toMatchObject({
        id:    'user-001',
        nome:  'Remetente Teste',
        email: 'remetente@eloscloud.com'
      });
    });

    it('deve gerar registrationToken como JWT válido', async () => {
      setupValidInvite();
      const jwt = require('jsonwebtoken');

      const result = await inviteService.validateInvite(
        'invite-abc', 'amigo@example.com', 'Meu Nome'
      );

      expect(() => jwt.verify(result.registrationToken, 'test-secret-key')).not.toThrow();
    });
  });

  // ===========================================================================
  describe('invalidateInvite', () => {
    const setupValidPendingInvite = () => {
      Invite.getById.mockResolvedValue({ invite: makeInvite() });
    };

    it('deve lançar 404 quando convite não existe', async () => {
      Invite.getById.mockResolvedValue({ invite: null });

      await expect(
        inviteService.invalidateInvite('invite-abc', 'new-user-001')
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('deve lançar 400 quando convite já foi utilizado', async () => {
      Invite.getById.mockResolvedValue({ invite: makeInvite({ status: 'used' }) });

      await expect(
        inviteService.invalidateInvite('invite-abc', 'new-user-001')
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('deve marcar convite como used no Supabase com usedBy e usedAt', async () => {
      setupValidPendingInvite();

      await inviteService.invalidateInvite('invite-abc', 'new-user-001');

      expect(Invite.updateByInviteId).toHaveBeenCalledWith(
        'invite-abc',
        expect.objectContaining({ status: 'used', usedBy: 'new-user-001' })
      );
    });

    it('deve criar relacionamento de ancestralidade no Firestore para o novo usuário', async () => {
      setupValidPendingInvite();

      await inviteService.invalidateInvite('invite-abc', 'new-user-001');

      expect(mockDb.runTransaction).toHaveBeenCalledTimes(1);
      // transaction.set deve ser chamado ao menos 3x: ancestralidade, descendentes, compras
      expect(mockTransaction.set.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('deve conceder 5000 ElosCoins de boas-vindas ao novo usuário', async () => {
      setupValidPendingInvite();

      await inviteService.invalidateInvite('invite-abc', 'new-user-001');

      const comprasCall = mockTransaction.set.mock.calls.find(
        ([, data]) => data?.meioPagamento === 'oferta-boas-vindas'
      );
      expect(comprasCall).toBeDefined();
      expect(comprasCall[1].quantidade).toBe(5000);
    });

    it('deve enviar email de boas-vindas ao novo usuário', async () => {
      setupValidPendingInvite();

      await inviteService.invalidateInvite('invite-abc', 'new-user-001');

      expect(emailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to:           'amigo@example.com',
          templateType: 'welcome'
        })
      );
    });

    it('deve notificar o remetente do convite via NotificationDispatcher', async () => {
      setupValidPendingInvite();

      await inviteService.invalidateInvite('invite-abc', 'new-user-001');
      // dispatch ocorre em setImmediate (fire-and-forget)
      await new Promise(setImmediate);

      expect(NotificationDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-001',
          type: 'convite_aceito'
        })
      );
    });

    it('deve retornar { success: true } em caso de sucesso', async () => {
      setupValidPendingInvite();

      const result = await inviteService.invalidateInvite('invite-abc', 'new-user-001');

      expect(result).toMatchObject({ success: true });
    });
  });
});
