/**
 * @file trustPassportService.test.js
 * @description Testes unitários do Trust Passport (score unificado cross-vertical).
 *
 * Cobre 8 cenários:
 *  TP-001 — recordEvent: insere evento positivo no Supabase
 *  TP-002 — recordEvent: rejeita domínio inválido
 *  TP-003 — recordEvent: rejeita sinal inconsistente (is_negative=false, impact<0)
 *  TP-004 — recordEvent: dispara recálculo para high-impact events
 *  TP-005 — calculatePassport: score básico com 1 domínio ativo
 *  TP-006 — calculatePassport: nível limitado por min_domains
 *  TP-007 — createEndorsement: bloqueia auto-endosso
 *  TP-008 — createEndorsement: bloqueia nível < 3
 */

const trustPassportService = require('../../../services/trustPassportService');

// ─── Mocks globais ──────────────────────────────────────────────────────────

jest.mock('../../../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ─── Supabase mock ───────────────────────────────────────────────────────────

let mockSingle;
let mockDirect;
let mockRpc;
let builder;
let mockSupabase;

jest.mock('../../../config/supabase', () => ({
  getSupabaseClient: jest.fn(() => mockSupabase),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resetMocks() {
  mockSingle = jest.fn();
  mockDirect = jest.fn();
  mockRpc = jest.fn().mockResolvedValue({ data: null, error: null });

  builder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    single: mockSingle,
    then: (resolve, reject) =>
      Promise.resolve(mockDirect()).then(resolve, reject),
  };

  mockSupabase = {
    from: jest.fn().mockReturnValue(builder),
    rpc: mockRpc,
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const USER_ID = 'user-001';
const ENDORSER_ID = 'user-endorser';
const ENDORSED_ID = 'user-endorsed';

/** 5 trust levels seed */
const LEVELS_SEED = [
  { level: 1, name: 'Novato', min_score: 0, min_domains: 0 },
  { level: 2, name: 'Conhecido', min_score: 15, min_domains: 1 },
  { level: 3, name: 'Vizinho de Confiança', min_score: 35, min_domains: 2 },
  { level: 4, name: 'Pilar da Comunidade', min_score: 60, min_domains: 3 },
  { level: 5, name: 'Guardião', min_score: 85, min_domains: 4 },
];

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('trustPassportService', () => {
  beforeEach(() => {
    resetMocks();
    jest.clearAllMocks();
  });

  // ────────────────────────────────────────────────────────────────────────
  // TP-001: recordEvent insere evento positivo
  // ────────────────────────────────────────────────────────────────────────

  describe('recordEvent', () => {
    it('[TP-001] deve inserir evento positivo no Supabase', async () => {
      // insert retorna success
      mockDirect.mockResolvedValueOnce({ data: null, error: null });

      await trustPassportService.recordEvent(
        USER_ID, 'marketplace', 'review_received', 2.0, false, { order_id: 'o1' }
      );

      expect(mockSupabase.from).toHaveBeenCalledWith('trust_events');
      expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({
        user_id: USER_ID,
        domain: 'marketplace',
        event_type: 'review_received',
        impact: 2.0,
        is_negative: false,
      }));
    });

    // ────────────────────────────────────────────────────────────────────
    // TP-002: domínio inválido
    // ────────────────────────────────────────────────────────────────────

    it('[TP-002] deve rejeitar domínio inválido', async () => {
      await expect(
        trustPassportService.recordEvent(USER_ID, 'invalid_domain', 'test', 1.0)
      ).rejects.toThrow('Domínio inválido');
    });

    // ────────────────────────────────────────────────────────────────────
    // TP-003: sinal inconsistente
    // ────────────────────────────────────────────────────────────────────

    it('[TP-003] deve rejeitar impact positivo com is_negative=true', async () => {
      await expect(
        trustPassportService.recordEvent(USER_ID, 'moderation', 'test', 2.0, true)
      ).rejects.toThrow('Sinal do impact não bate');
    });

    it('[TP-003b] deve rejeitar impact negativo com is_negative=false', async () => {
      await expect(
        trustPassportService.recordEvent(USER_ID, 'moderation', 'test', -2.0, false)
      ).rejects.toThrow('Sinal do impact não bate');
    });

    // ────────────────────────────────────────────────────────────────────
    // TP-004: high-impact events disparam recálculo
    // ────────────────────────────────────────────────────────────────────

    it('[TP-004] deve disparar recálculo para identity_verified (|impact|>=5)', async () => {
      // insert success
      mockDirect.mockResolvedValueOnce({ data: null, error: null });

      // calculatePassport fará 4 queries: events, user, endorsements, levels
      // + 1 upsert. Mockamos para não falhar.
      // events
      mockDirect.mockResolvedValueOnce({ data: [], error: null });
      // user (single)
      mockSingle.mockResolvedValueOnce({
        data: { id: USER_ID, created_at: new Date().toISOString() },
        error: null,
      });
      // endorsements
      mockDirect.mockResolvedValueOnce({ data: [], error: null });
      // levels
      mockDirect.mockResolvedValueOnce({ data: LEVELS_SEED, error: null });
      // upsert
      mockDirect.mockResolvedValueOnce({ data: null, error: null });

      await trustPassportService.recordEvent(
        USER_ID, 'account', 'identity_verified', 5.0, false
      );

      // Wait for fire-and-forget recalc
      await new Promise(r => setTimeout(r, 50));

      // calculatePassport should have been called (upsert to trust_passports)
      const upsertCalls = builder.upsert.mock.calls;
      expect(upsertCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // TP-005: calculatePassport score básico
  // ────────────────────────────────────────────────────────────────────────

  describe('calculatePassport', () => {
    it('[TP-005] deve calcular score com 1 domínio ativo', async () => {
      const now = new Date().toISOString();
      const events = [
        { domain: 'marketplace', event_type: 'review_received', impact: 3, is_negative: false, created_at: now },
        { domain: 'marketplace', event_type: 'order_completed', impact: 2, is_negative: false, created_at: now },
      ];

      // events query
      mockDirect.mockResolvedValueOnce({ data: events, error: null });
      // user query (single)
      mockSingle.mockResolvedValueOnce({
        data: { id: USER_ID, created_at: new Date(Date.now() - 60 * 86400000).toISOString() },
        error: null,
      });
      // endorsements
      mockDirect.mockResolvedValueOnce({ data: [], error: null });
      // levels
      mockDirect.mockResolvedValueOnce({ data: LEVELS_SEED, error: null });
      // upsert
      mockDirect.mockResolvedValueOnce({ data: null, error: null });

      const result = await trustPassportService.calculatePassport(USER_ID);

      expect(result.trust_score).toBeGreaterThan(0);
      expect(result.trust_level).toBeGreaterThanOrEqual(1);
      expect(result.domain_scores.marketplace).toBeGreaterThan(0);
      expect(result.active_domains).toContain('marketplace');
      expect(result.active_domains).toContain('account');
      expect(result.validators).toEqual(expect.any(Array));
    });

    // ────────────────────────────────────────────────────────────────────
    // TP-006: nível limitado por min_domains
    // ────────────────────────────────────────────────────────────────────

    it('[TP-006] deve limitar nível quando domínios ativos insuficientes', async () => {
      const now = new Date().toISOString();
      // High score in 1 domain only (>35 points would qualify for level 3 by score)
      const events = Array.from({ length: 15 }, (_, i) => ({
        domain: 'marketplace',
        event_type: `event_${i}`,
        impact: 3,
        is_negative: false,
        created_at: now,
      }));

      // events
      mockDirect.mockResolvedValueOnce({ data: events, error: null });
      // user (single) — 1 year old account
      mockSingle.mockResolvedValueOnce({
        data: { id: USER_ID, created_at: new Date(Date.now() - 365 * 86400000).toISOString() },
        error: null,
      });
      // endorsements
      mockDirect.mockResolvedValueOnce({ data: [], error: null });
      // levels
      mockDirect.mockResolvedValueOnce({ data: LEVELS_SEED, error: null });
      // upsert
      mockDirect.mockResolvedValueOnce({ data: null, error: null });

      const result = await trustPassportService.calculatePassport(USER_ID);

      // Score should be high but level capped at 2 (only 2 domains: marketplace + account auto)
      // marketplace=13 (capped) + account=~10 = ~23 → level 2 by score + 2 domains
      // Level 3 requires min_domains=2, which is met (marketplace + account)
      // But level 4 requires 3 domains which is NOT met
      expect(result.trust_level).toBeLessThanOrEqual(3);
      expect(result.trust_level).toBeGreaterThanOrEqual(2);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // TP-007: auto-endosso bloqueado
  // ────────────────────────────────────────────────────────────────────────

  describe('createEndorsement', () => {
    it('[TP-007] deve bloquear auto-endosso', async () => {
      await expect(
        trustPassportService.createEndorsement(USER_ID, USER_ID)
      ).rejects.toThrow('Não é possível endorsar a si mesmo');
    });

    // ────────────────────────────────────────────────────────────────────
    // TP-008: nível insuficiente para endorsar
    // ────────────────────────────────────────────────────────────────────

    it('[TP-008] deve bloquear endosso de nível < 3', async () => {
      // getPassport → single() retorna passport com level 2
      mockSingle.mockResolvedValueOnce({
        data: {
          user_id: ENDORSER_ID,
          trust_level: 2,
          last_calculated: new Date().toISOString(),
        },
        error: null,
      });

      await expect(
        trustPassportService.createEndorsement(ENDORSER_ID, ENDORSED_ID)
      ).rejects.toThrow('Nível mínimo para endorsar é 3');
    });
  });
});
