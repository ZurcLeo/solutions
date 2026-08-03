/**
 * @file KYCSocialService.test.js
 * @description Testes unitários do KYC Social Comunitário (Círculo de Confiança).
 *
 * Cobre 6 invariantes críticos de segurança identificados em docs/business/KYC_SOCIAL.md:
 *  INV-001 — Auto-validação bloqueada (SELF_VALIDATION)
 *  INV-002 — Nível do validador insuficiente (VALIDATOR_LEVEL_REQUIRED)
 *  INV-003 — Padrinho não pode validar afilhado (GODFATHER_CONFLICT)
 *  INV-004 — Dupla validação bloqueada (ALREADY_VALIDATED)
 *  INV-005 — Quórum não atingido: approvalReached = false
 *  INV-006 — Quórum atingido: kyc_social_verified = true + RPC + gamificação
 *
 * Mock strategy: o cliente Supabase usa um builder encadeável que também é
 * "thenable" (tem `.then`). Dois níveis de retorno:
 *  - mockSingle: para queries que terminam em .single() → {data, error}
 *  - mockDirect: para queries awaited diretamente (insert, count, updates) → {data, error, count}
 */

const KYCSocialService = require('../../../services/KYCSocialService');
const gamificationService = require('../../../services/gamificationService');

// ─── Mocks globais ──────────────────────────────────────────────────────────

jest.mock('../../../services/gamificationService', () => ({
  triggerEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ─── Supabase mock ───────────────────────────────────────────────────────────
//
// O builder é compartilhado entre todas as chamadas .from().
// Métodos encadeáveis (.select, .insert, .update, .eq) retornam `builder` via mockReturnThis().
// .single() consome da fila mockSingle (para queries de linha única).
// Queries direct-await consomem da fila mockDirect via o getter `.then`.

let mockSingle;
let mockDirect;
let mockRpc;
let builder;
let mockSupabase;

jest.mock('../../../config/supabase', () => ({
  getSupabaseClient: jest.fn(() => mockSupabase),
}));

// ─── Helpers de setup ────────────────────────────────────────────────────────

function resetMocks() {
  mockSingle = jest.fn();
  mockDirect = jest.fn();
  mockRpc    = jest.fn().mockResolvedValue({ data: null, error: null });

  builder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    // .single() — retorna a próxima resposta da fila
    single: mockSingle,
    // torna o builder "thenable" para direct-await sem .single()
    then: (resolve, reject) =>
      Promise.resolve(mockDirect())
        .then(resolve, reject),
  };

  mockSupabase = {
    from: jest.fn().mockReturnValue(builder),
    rpc:  mockRpc,
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const REQUEST_ID   = 'req-uuid-001';
const REQUESTER_ID = 'user-requester';
const VALIDATOR_ID = 'user-validator';

/** Solicitação pendente padrão */
const pendingRequest = { id: REQUEST_ID, user_id: REQUESTER_ID, status: 'pending' };

/** Trust Passport de validador com trust_level 4 (mínimo exigido — Pilar da Comunidade) */
const validatorPassport = { trust_level: 4 };

// ─── Suite principal ─────────────────────────────────────────────────────────

describe('KYCSocialService.validateIdentity', () => {
  beforeEach(() => {
    resetMocks();
    jest.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // INV-001: Auto-validação bloqueada
  // ──────────────────────────────────────────────────────────────────────────

  it('[INV-001] deve lançar SELF_VALIDATION quando validador = solicitante', async () => {
    // A 1ª chamada .single() retorna a request
    mockSingle.mockResolvedValueOnce({ data: pendingRequest, error: null });

    await expect(
      KYCSocialService.validateIdentity(REQUEST_ID, REQUESTER_ID)
    ).rejects.toMatchObject({ code: 'SELF_VALIDATION' });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // INV-002: Trust Level do validador insuficiente (< 4)
  // ──────────────────────────────────────────────────────────────────────────

  it('[INV-002] deve lançar VALIDATOR_LEVEL_REQUIRED quando trust_level < 4', async () => {
    // single 1: request ok
    mockSingle.mockResolvedValueOnce({ data: pendingRequest, error: null });
    // single 2: trust passport com nível 3 (insuficiente — precisa 4+)
    mockSingle.mockResolvedValueOnce({ data: { trust_level: 3 }, error: null });

    await expect(
      KYCSocialService.validateIdentity(REQUEST_ID, VALIDATOR_ID)
    ).rejects.toMatchObject({ code: 'VALIDATOR_LEVEL_REQUIRED' });
  });

  it('[INV-002] deve lançar VALIDATOR_LEVEL_REQUIRED quando trust passport não encontrado', async () => {
    mockSingle.mockResolvedValueOnce({ data: pendingRequest, error: null });
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });

    await expect(
      KYCSocialService.validateIdentity(REQUEST_ID, VALIDATOR_ID)
    ).rejects.toMatchObject({ code: 'VALIDATOR_LEVEL_REQUIRED' });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // INV-003: Padrinho não pode validar o próprio afilhado
  // ──────────────────────────────────────────────────────────────────────────

  it('[INV-003] deve lançar GODFATHER_CONFLICT quando validador é padrinho do solicitante', async () => {
    // single 1: request ok
    mockSingle.mockResolvedValueOnce({ data: pendingRequest, error: null });
    // single 2: trust passport nível 4
    mockSingle.mockResolvedValueOnce({ data: validatorPassport, error: null });
    // single 3: vínculo de padrinho encontrado — VALIDADOR é o padrinho
    mockSingle.mockResolvedValueOnce({ data: { id: 'bond-001' }, error: null });

    await expect(
      KYCSocialService.validateIdentity(REQUEST_ID, VALIDATOR_ID)
    ).rejects.toMatchObject({ code: 'GODFATHER_CONFLICT' });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // INV-004: Dupla validação bloqueada (constraint UNIQUE → código pg 23505)
  // ──────────────────────────────────────────────────────────────────────────

  it('[INV-004] deve lançar ALREADY_VALIDATED quando validador já votou (code 23505)', async () => {
    // single 1: request ok
    mockSingle.mockResolvedValueOnce({ data: pendingRequest, error: null });
    // single 2: trust passport nível 4
    mockSingle.mockResolvedValueOnce({ data: validatorPassport, error: null });
    // single 3: sem vínculo de padrinho
    mockSingle.mockResolvedValueOnce({ data: null, error: null });

    // direct 1: insert dispara violação de UNIQUE
    mockDirect.mockReturnValueOnce({ data: null, error: { code: '23505', message: 'duplicate key' } });

    await expect(
      KYCSocialService.validateIdentity(REQUEST_ID, VALIDATOR_ID)
    ).rejects.toMatchObject({ code: 'ALREADY_VALIDATED' });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // INV-005: Quórum não atingido (< 3 validações)
  // ──────────────────────────────────────────────────────────────────────────

  it('[INV-005] não deve aprovar quando count < 3 (2 validações)', async () => {
    // single 1: request ok
    mockSingle.mockResolvedValueOnce({ data: pendingRequest, error: null });
    // single 2: trust level 4
    mockSingle.mockResolvedValueOnce({ data: validatorPassport, error: null });
    // single 3: sem vínculo
    mockSingle.mockResolvedValueOnce({ data: null, error: null });

    // direct 1: insert ok
    mockDirect.mockReturnValueOnce({ data: {}, error: null });
    // direct 2: count = 2 (ainda não atingiu quórum)
    mockDirect.mockReturnValueOnce({ count: 2, error: null });

    const result = await KYCSocialService.validateIdentity(REQUEST_ID, VALIDATOR_ID);

    expect(result).toMatchObject({ validated: true, approvalReached: false });
    // Nenhuma atualização de status deve ter ocorrido — from() chamado apenas
    // para: request, gamification, godfather_bonds, insert, count = 5 vezes
    // Verificamos que NÃO chamou update com status='approved'
    const updateCalls = builder.update.mock.calls;
    const approvedCall = updateCalls.find(
      ([payload]) => payload && payload.status === 'approved'
    );
    expect(approvedCall).toBeUndefined();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // INV-006: Quórum atingido (3ª validação) — aprovação automática completa
  // ──────────────────────────────────────────────────────────────────────────

  it('[INV-006] deve aprovar automaticamente ao atingir 3ª validação', async () => {
    // single 1: request pendente
    mockSingle.mockResolvedValueOnce({ data: pendingRequest, error: null });
    // single 2: trust level 4
    mockSingle.mockResolvedValueOnce({ data: validatorPassport, error: null });
    // single 3: sem vínculo de padrinho
    mockSingle.mockResolvedValueOnce({ data: null, error: null });

    // direct 1: insert ok
    mockDirect.mockReturnValueOnce({ data: {}, error: null });
    // direct 2: count = 3 → quórum atingido!
    mockDirect.mockReturnValueOnce({ count: 3, error: null });
    // direct 3: update kyc_social_requests.status = 'approved' ok
    mockDirect.mockReturnValueOnce({ data: {}, error: null });
    // direct 4: update users.kyc_social_verified = true ok
    mockDirect.mockReturnValueOnce({ data: {}, error: null });

    const result = await KYCSocialService.validateIdentity(REQUEST_ID, VALIDATOR_ID);

    // Resultado: aprovado
    expect(result).toMatchObject({ validated: true, approvalReached: true });

    // kyc_social_requests.status deve ter sido atualizado para 'approved'
    const updateCalls = builder.update.mock.calls;
    const approvedCall = updateCalls.find(
      ([payload]) => payload && payload.status === 'approved'
    );
    expect(approvedCall).toBeDefined();
    expect(approvedCall[0]).toMatchObject({ status: 'approved' });

    // users.kyc_social_verified deve ter sido setado para true
    const verifiedCall = updateCalls.find(
      ([payload]) => payload && payload.kyc_social_verified === true
    );
    expect(verifiedCall).toBeDefined();

    // RPC calculate_social_score deve ter sido chamada com o user_id do solicitante
    expect(mockRpc).toHaveBeenCalledWith('calculate_social_score', {
      p_user_id: REQUESTER_ID,
    });

    // Gamificação: event 'community_kyc_verified' disparado para o validador
    expect(gamificationService.triggerEvent).toHaveBeenCalledWith(
      'community_kyc_verified',
      VALIDATOR_ID
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // INV-006 complementar: falhas silenciosas não propagam
  // ──────────────────────────────────────────────────────────────────────────

  it('[INV-006] falha no RPC ou gamificação não deve abortar o fluxo', async () => {
    mockSingle.mockResolvedValueOnce({ data: pendingRequest, error: null });
    mockSingle.mockResolvedValueOnce({ data: validatorPassport, error: null });
    mockSingle.mockResolvedValueOnce({ data: null, error: null });

    mockDirect.mockReturnValueOnce({ data: {}, error: null });         // insert
    mockDirect.mockReturnValueOnce({ count: 3, error: null });         // count
    mockDirect.mockReturnValueOnce({ data: {}, error: null });         // update request
    mockDirect.mockReturnValueOnce({ data: {}, error: null });         // update users

    // RPC e gamificação falham
    mockRpc.mockRejectedValueOnce(new Error('pg: connection refused'));
    gamificationService.triggerEvent.mockRejectedValueOnce(new Error('gamification down'));

    // O fluxo NÃO deve lançar — falhas são silenciosas (apenas logged como warn)
    await expect(
      KYCSocialService.validateIdentity(REQUEST_ID, VALIDATOR_ID)
    ).resolves.toMatchObject({ validated: true, approvalReached: true });
  });
});

// ─── Suite: requestVerification ─────────────────────────────────────────────

describe('KYCSocialService.requestVerification', () => {
  beforeEach(() => {
    resetMocks();
    jest.clearAllMocks();
  });

  it('deve lançar TRUST_LEVEL_REQUIRED quando trust_level < 2', async () => {
    mockSingle.mockResolvedValueOnce({ data: { trust_level: 1 }, error: null });

    await expect(
      KYCSocialService.requestVerification(REQUESTER_ID)
    ).rejects.toMatchObject({ code: 'TRUST_LEVEL_REQUIRED' });
  });

  it('deve lançar ALREADY_PENDING quando já existe solicitação pendente', async () => {
    // single 1: trust passport nível 2 ok
    mockSingle.mockResolvedValueOnce({ data: { trust_level: 2 }, error: null });
    // single 2: solicitação existente com status 'pending'
    mockSingle.mockResolvedValueOnce({ data: { id: 'req-001', status: 'pending' }, error: null });

    await expect(
      KYCSocialService.requestVerification(REQUESTER_ID)
    ).rejects.toMatchObject({ code: 'ALREADY_PENDING' });
  });

  it('deve criar nova solicitação quando não existe registro anterior', async () => {
    // single 1: gamificação nível 3
    mockSingle.mockResolvedValueOnce({ data: { current_level: 3 }, error: null });
    // single 2: nenhuma solicitação existente
    mockSingle.mockResolvedValueOnce({ data: null, error: null });
    // single 3: insert retorna a nova solicitação
    mockSingle.mockResolvedValueOnce({ data: { id: 'req-new', status: 'pending', user_id: REQUESTER_ID }, error: null });

    const result = await KYCSocialService.requestVerification(REQUESTER_ID);

    expect(result).toMatchObject({ id: 'req-new', status: 'pending' });
  });

  it('deve re-ativar solicitação expirada sem criar novo registro', async () => {
    // single 1: gamificação nível 4
    mockSingle.mockResolvedValueOnce({ data: { current_level: 4 }, error: null });
    // single 2: solicitação expirada existente
    mockSingle.mockResolvedValueOnce({ data: { id: 'req-old', status: 'expired' }, error: null });
    // single 3: update retorna a solicitação reativada
    mockSingle.mockResolvedValueOnce({ data: { id: 'req-old', status: 'pending', user_id: REQUESTER_ID }, error: null });

    const result = await KYCSocialService.requestVerification(REQUESTER_ID);

    expect(result).toMatchObject({ id: 'req-old', status: 'pending' });
    // Deve ter chamado .update() (não insert) na linha existente
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' })
    );
  });
});

// ─── Suite: getRequestForValidation (Interface Cega — LGPD) ─────────────────

describe('KYCSocialService.getRequestForValidation — Interface Cega', () => {
  beforeEach(() => {
    resetMocks();
    jest.clearAllMocks();
  });

  it('deve retornar apenas nome, foto e bairro — sem CPF, RG ou document_photo_url', async () => {
    // single 1: request
    mockSingle.mockResolvedValueOnce({
      data: { id: REQUEST_ID, user_id: REQUESTER_ID, status: 'pending', created_at: '2026-01-01' },
      error: null,
    });
    // single 2: dados do usuário — inclui campos sensíveis que NÃO devem ser retornados
    mockSingle.mockResolvedValueOnce({
      data: {
        full_name: 'Maria das Graças',
        avatar_url: 'https://example.com/photo.jpg',
        neighborhood: 'Vila Esperança',
      },
      error: null,
    });
    // direct 1: count de validações
    mockDirect.mockReturnValueOnce({ count: 1, error: null });
    // single 3: already_validated = false
    mockSingle.mockResolvedValueOnce({ data: null, error: null });

    const result = await KYCSocialService.getRequestForValidation(REQUEST_ID, VALIDATOR_ID);

    // Campos permitidos
    expect(result.requester.name).toBe('Maria das Graças');
    expect(result.requester.profile_photo).toBe('https://example.com/photo.jpg');
    expect(result.requester.neighborhood).toBe('Vila Esperança');

    // Campos proibidos NUNCA devem aparecer na resposta (Interface Cega — LGPD)
    expect(result.requester).not.toHaveProperty('cpf');
    expect(result.requester).not.toHaveProperty('rg');
    expect(result.requester).not.toHaveProperty('document_photo_url');
    expect(result).not.toHaveProperty('document_photo_url');

    // Contagem
    expect(result.validations_received).toBe(1);
    expect(result.validations_required).toBe(3);
    expect(result.already_validated).toBe(false);
  });

  it('deve lançar NOT_PENDING para solicitação já aprovada', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: REQUEST_ID, user_id: REQUESTER_ID, status: 'approved', created_at: '2026-01-01' },
      error: null,
    });

    await expect(
      KYCSocialService.getRequestForValidation(REQUEST_ID, VALIDATOR_ID)
    ).rejects.toMatchObject({ code: 'NOT_PENDING' });
  });
});
