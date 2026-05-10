/**
 * @fileoverview Testes de contrato do sendInviteSchema + middleware validate
 *
 * Documenta e reproduz BUG-001:
 *   POST /api/invite/generate → 400 quando senderName ou senderEmail é null.
 *
 * Causa raiz:
 *   Joi.string().optional() aceita `undefined` mas REJEITA `null`.
 *   O frontend passa senderName: null quando currentUser.displayName é null,
 *   o que dispara a rejeição do schema antes de chegar ao controller.
 *
 * Fix necessário (escolher um):
 *   Opção A (frontend) — InviteService/index.js:
 *     senderName: invitationData.senderName || currentUser.displayName || undefined
 *     senderEmail: invitationData.senderEmail || currentUser.email || undefined
 *
 *   Opção B (backend) — schemas/inviteSchema.js:
 *     senderName: Joi.string().optional().allow(null, '')
 *     senderEmail: Joi.string().email().optional().allow(null, '')
 */

const Joi = require('joi');
const { sendInviteSchema } = require('../../../schemas/inviteSchema');
const validate = require('../../../middlewares/validate');

jest.mock('../../../logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));

// ---------------------------------------------------------------------------
// Helpers para testar o middleware validate diretamente
// ---------------------------------------------------------------------------
const mockReq = (body) => ({
  method: 'POST',
  path: '/generate',
  params: {},
  query: {},
  body
});

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const runValidate = (body) =>
  new Promise((resolve) => {
    const req = mockReq(body);
    const res = mockRes();
    const next = jest.fn();

    validate(sendInviteSchema)(req, res, () => {
      next();
      resolve({ req, res, next, passed: true });
    });

    // Se next não foi chamado, é porque res.json foi chamado (erro)
    setImmediate(() => {
      if (!next.mock.calls.length) {
        resolve({ req, res, next, passed: false });
      }
    });
  });

// ---------------------------------------------------------------------------
describe('sendInviteSchema — contrato de validação', () => {
  describe('campo email', () => {
    it('deve aceitar email válido', () => {
      const { error } = sendInviteSchema.validate({
        email: 'amigo@eloscloud.com',
        friendName: 'Amigo Teste'
      });
      expect(error).toBeUndefined();
    });

    it('deve rejeitar quando email está ausente', () => {
      const { error } = sendInviteSchema.validate({ friendName: 'Amigo Teste' });
      expect(error).toBeDefined();
      expect(error.details[0].message).toMatch(/email/i);
    });

    it('deve rejeitar email com formato inválido', () => {
      const { error } = sendInviteSchema.validate({
        email: 'nao-e-email',
        friendName: 'Amigo Teste'
      });
      expect(error).toBeDefined();
    });
  });

  describe('campo friendName', () => {
    it('deve aceitar friendName válido', () => {
      const { error } = sendInviteSchema.validate({
        email: 'amigo@eloscloud.com',
        friendName: 'Amigo Teste'
      });
      expect(error).toBeUndefined();
    });

    it('deve rejeitar quando friendName está ausente', () => {
      const { error } = sendInviteSchema.validate({ email: 'amigo@eloscloud.com' });
      expect(error).toBeDefined();
      // Mensagem customizada em PT-BR: 'Nome do amigo é obrigatório.'
      expect(error.details[0].message).toMatch(/nome do amigo/i);
    });

    it('deve rejeitar friendName vazio', () => {
      const { error } = sendInviteSchema.validate({
        email: 'amigo@eloscloud.com',
        friendName: ''
      });
      expect(error).toBeDefined();
    });
  });

  describe('campos opcionais do remetente', () => {
    it('deve aceitar body sem campos opcionais (campos ausentes = undefined)', () => {
      const { error } = sendInviteSchema.validate({
        email: 'amigo@eloscloud.com',
        friendName: 'Amigo Teste'
      });
      expect(error).toBeUndefined();
    });

    it('deve aceitar campos opcionais quando preenchidos corretamente', () => {
      const { error } = sendInviteSchema.validate({
        email: 'amigo@eloscloud.com',
        friendName: 'Amigo Teste',
        userId: 'uid-123',
        senderName: 'Remetente',
        senderEmail: 'remetente@eloscloud.com',
        senderUid: 'uid-456'
      });
      expect(error).toBeUndefined();
    });

    // ----- BUG-001 REPRODUZIDO -----
    it('[BUG-001] deve rejeitar senderName: null — causa o 400 quando displayName não está definido', () => {
      const { error } = sendInviteSchema.validate({
        email: 'amigo@eloscloud.com',
        friendName: 'Amigo Teste',
        senderName: null // ← currentUser.displayName null no Firebase Auth
      });

      // Este teste DEVE PASSAR (confirmando o bug). Quando o bug for corrigido,
      // altere o schema para .allow(null) e este teste deve mudar para expect(error).toBeUndefined()
      expect(error).toBeDefined();
      expect(error.details[0].message).toMatch(/must be a string/i);
    });

    it('[BUG-001] deve rejeitar senderEmail: null — causa o 400 para usuários de auth por telefone', () => {
      const { error } = sendInviteSchema.validate({
        email: 'amigo@eloscloud.com',
        friendName: 'Amigo Teste',
        senderEmail: null // ← currentUser.email null em phone auth
      });

      expect(error).toBeDefined();
      expect(error.details[0].message).toMatch(/must be a string/i);
    });
  });
});

// ---------------------------------------------------------------------------
describe('validate middleware — comportamento com sendInviteSchema', () => {
  it('deve chamar next() com body válido', async () => {
    const { passed, req } = await runValidate({
      email: 'amigo@eloscloud.com',
      friendName: 'Amigo Teste'
    });
    expect(passed).toBe(true);
    expect(req.validatedBody).toMatchObject({
      email: 'amigo@eloscloud.com',
      friendName: 'Amigo Teste'
    });
  });

  it('deve retornar 400 quando friendName está ausente', async () => {
    const { passed, res } = await runValidate({ email: 'amigo@eloscloud.com' });
    expect(passed).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.any(String) })
    );
  });

  it('[BUG-001] deve retornar 400 quando senderName é null', async () => {
    const { passed, res } = await runValidate({
      email: 'amigo@eloscloud.com',
      friendName: 'Amigo Teste',
      senderName: null
    });
    expect(passed).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('deve retornar 400 quando body está vazio', async () => {
    const { passed, res } = await runValidate({});
    expect(passed).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
