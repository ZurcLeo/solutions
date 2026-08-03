jest.mock('../../../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../../config/supabase', () => ({
  getSupabaseClient: jest.fn(),
}));

jest.mock('../../../services/validators/ProductValidator');

const { getSupabaseClient } = require('../../../config/supabase');
const ProductValidator = require('../../../services/validators/ProductValidator');
const { validateSellerCapability } = require('../../../middlewares/validateSellerCapability');

const mockReq = (overrides = {}) => ({
  user: { uid: 'user-123' },
  ...overrides,
});

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const mockSupabaseQuery = (data, error = null) => {
  const chain = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data, error }),
  };
  getSupabaseClient.mockReturnValue(chain);
  return chain;
};

describe('validateSellerCapability middleware', () => {
  let next;

  beforeEach(() => {
    next = jest.fn();
    jest.resetAllMocks();
  });

  // ── Auth checks ───────────────────────────────────

  it('retorna 401 quando req.user está ausente', async () => {
    const req = mockReq({ user: undefined });
    const res = mockRes();

    await validateSellerCapability('has_modifiers')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'AUTH_REQUIRED' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  // ── Seller profile checks ────────────────────────

  it('retorna 403 SELLER_PROFILE_REQUIRED quando vendedor não existe', async () => {
    mockSupabaseQuery(null, { code: 'PGRST116' });
    const req = mockReq();
    const res = mockRes();

    await validateSellerCapability('has_modifiers')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SELLER_PROFILE_REQUIRED' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('retorna 500 quando Supabase retorna erro inesperado', async () => {
    mockSupabaseQuery(null, { code: 'OTHER', message: 'connection lost' });
    const req = mockReq();
    const res = mockRes();

    await validateSellerCapability('has_modifiers')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'INTERNAL_ERROR' })
    );
  });

  it('retorna 403 SELLER_NOT_ACTIVE quando status != active', async () => {
    mockSupabaseQuery({
      id: 'seller-1', user_id: 'user-123', category: 'alimentacao',
      categories: ['alimentacao'], status: 'pending',
    });
    const req = mockReq();
    const res = mockRes();

    await validateSellerCapability('has_modifiers')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SELLER_NOT_ACTIVE', status: 'pending' })
    );
  });

  // ── Capability checks (single category) ──────────

  it('permite acesso quando capability está habilitada', async () => {
    mockSupabaseQuery({
      id: 'seller-1', user_id: 'user-123', category: 'alimentacao',
      categories: ['alimentacao'], status: 'active',
    });
    ProductValidator.mergedCapabilitiesFor.mockReturnValue({
      has_modifiers: true, has_menu_categories: true,
    });

    const req = mockReq();
    const res = mockRes();

    await validateSellerCapability('has_modifiers')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.sellerProfile).toBeDefined();
    expect(req.sellerProfile.id).toBe('seller-1');
    expect(req.sellerCapabilities).toEqual(
      expect.objectContaining({ has_modifiers: true })
    );
  });

  it('retorna 403 CAPABILITY_MISSING quando capability não está habilitada', async () => {
    mockSupabaseQuery({
      id: 'seller-1', user_id: 'user-123', category: 'servicos',
      categories: ['servicos'], status: 'active',
    });
    ProductValidator.mergedCapabilitiesFor.mockReturnValue({
      has_modifiers: false, has_scheduling: true,
    });

    const req = mockReq();
    const res = mockRes();

    await validateSellerCapability('has_modifiers')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CAPABILITY_MISSING',
        missing: ['has_modifiers'],
        required: ['has_modifiers'],
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  // ── Multi-capability check ────────────────────────

  it('verifica múltiplas capabilities de uma vez', async () => {
    mockSupabaseQuery({
      id: 'seller-1', user_id: 'user-123', category: 'alimentacao',
      categories: ['alimentacao'], status: 'active',
    });
    ProductValidator.mergedCapabilitiesFor.mockReturnValue({
      has_modifiers: true, has_scheduling: false,
    });

    const req = mockReq();
    const res = mockRes();

    await validateSellerCapability('has_modifiers', 'has_scheduling')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CAPABILITY_MISSING',
        missing: ['has_scheduling'],
      })
    );
  });

  // ── Multi-category (union) ────────────────────────

  it('usa UNIÃO de capabilities para vendedor multi-categoria', async () => {
    mockSupabaseQuery({
      id: 'seller-1', user_id: 'user-123', category: 'produtos',
      categories: ['produtos', 'servicos'], status: 'active',
    });
    // União: produtos(has_weight) + servicos(has_scheduling) → ambos true
    ProductValidator.mergedCapabilitiesFor.mockReturnValue({
      has_weight: true, has_scheduling: true, has_stock: true,
      has_modifiers: false,
    });

    const req = mockReq();
    const res = mockRes();

    await validateSellerCapability('has_scheduling')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(ProductValidator.mergedCapabilitiesFor).toHaveBeenCalledWith(['produtos', 'servicos']);
  });

  // ── Fallback: categories vazio → usa category TEXT ─

  it('faz fallback para category TEXT quando categories está vazio', async () => {
    mockSupabaseQuery({
      id: 'seller-1', user_id: 'user-123', category: 'alimentacao',
      categories: [], status: 'active',
    });
    ProductValidator.mergedCapabilitiesFor.mockReturnValue({
      has_modifiers: true,
    });

    const req = mockReq();
    const res = mockRes();

    await validateSellerCapability('has_modifiers')(req, res, next);

    expect(next).toHaveBeenCalled();
    // Fallback: deve usar ['alimentacao'] (do category TEXT)
    expect(ProductValidator.mergedCapabilitiesFor).toHaveBeenCalledWith(['alimentacao']);
  });

  // ── Cache: reutiliza req.sellerProfile ─────────────

  it('reutiliza req.sellerProfile quando já está populado', async () => {
    const cachedProfile = {
      id: 'seller-1', user_id: 'user-123',
      categories: ['alimentacao'], status: 'active',
    };
    ProductValidator.mergedCapabilitiesFor.mockReturnValue({
      has_modifiers: true,
    });

    const req = mockReq({ sellerProfile: cachedProfile });
    const res = mockRes();

    await validateSellerCapability('has_modifiers')(req, res, next);

    expect(next).toHaveBeenCalled();
    // Supabase NÃO deve ter sido chamado (perfil já estava no req)
    expect(getSupabaseClient).not.toHaveBeenCalled();
  });

  // ── Error handling ─────────────────────────────────

  it('chama next(err) em erro inesperado', async () => {
    getSupabaseClient.mockImplementation(() => {
      throw new Error('supabase crash');
    });

    const req = mockReq();
    const res = mockRes();

    await validateSellerCapability('has_modifiers')(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0][0].message).toBe('supabase crash');
  });
});

// ── ProductValidator.mergedCapabilitiesFor (unit) ──────

describe('ProductValidator.mergedCapabilitiesFor', () => {
  beforeEach(() => {
    // Restore real implementation for these tests
    ProductValidator.mergedCapabilitiesFor.mockRestore?.();
    ProductValidator.capabilitiesFor.mockRestore?.();
  });

  // These tests use the REAL implementation, not mocks
  const RealValidator = jest.requireActual('../../../services/validators/ProductValidator');

  it('retorna capabilities de uma categoria única', () => {
    const caps = RealValidator.mergedCapabilitiesFor(['alimentacao']);
    expect(caps.has_modifiers).toBe(true);
    expect(caps.has_menu_categories).toBe(true);
    expect(caps.has_scheduling).toBe(false);
  });

  it('retorna UNIÃO para múltiplas categorias', () => {
    const caps = RealValidator.mergedCapabilitiesFor(['produtos', 'servicos']);
    // produtos tem has_weight:true, servicos tem has_scheduling:true
    expect(caps.has_weight).toBe(true);
    expect(caps.has_scheduling).toBe(true);
    // nenhuma das duas tem has_modifiers
    expect(caps.has_modifiers).toBe(false);
  });

  it('retorna fallback "outros" para array vazio', () => {
    const caps = RealValidator.mergedCapabilitiesFor([]);
    expect(caps).toEqual(RealValidator.capabilitiesFor('outros'));
  });

  it('Loja de Informática [produtos, servicos] tem stock + scheduling', () => {
    const caps = RealValidator.mergedCapabilitiesFor(['produtos', 'servicos']);
    expect(caps.has_stock).toBe(true);
    expect(caps.has_scheduling).toBe(true);
    expect(caps.has_weight).toBe(true);
    expect(caps.has_portfolio).toBe(true);
  });

  it('alimentacao + servicos desbloqueia modifiers + scheduling', () => {
    const caps = RealValidator.mergedCapabilitiesFor(['alimentacao', 'servicos']);
    expect(caps.has_modifiers).toBe(true);
    expect(caps.has_menu_categories).toBe(true);
    expect(caps.has_scheduling).toBe(true);
    expect(caps.has_portfolio).toBe(true);
  });
});
