/**
 * @fileoverview Testes das 3 correções de delivery fee
 *
 * Cenários:
 *   1. Fronteira dos 20% — boundary exato em 1.20× e 1.21×
 *   2. Modo degradado — teto absoluto R$3–R$500 quando RPC falha
 *   3. distanceService — Google Maps e fallback Haversine
 */

'use strict';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockRpc = jest.fn();
const mockFrom = jest.fn();
const mockSupabaseClient = {
  rpc: mockRpc,
  from: mockFrom,
};

jest.mock('../../../config/supabase', () => ({
  getSupabaseClient: () => mockSupabaseClient,
}));

jest.mock('../../../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../../services/gamificationService', () => ({
  triggerEvent: jest.fn().mockResolvedValue(undefined),
  spendCoins: jest.fn().mockResolvedValue(undefined),
}));

// Mock deliveryService.findEligibleDeliverers diretamente
const mockFindEligible = jest.fn();
jest.mock('../../../services/deliveryService', () => ({
  findEligibleDeliverers: mockFindEligible,
}));

// ── Require modules AFTER mocks ──────────────────────────────────────────────

// _validateDeliveryFee é privada, então testamos via createOrder
// Mas primeiro, precisamos extraí-la. Vamos testar indiretamente.

// Para testar _validateDeliveryFee isoladamente, vamos re-implementar o módulo
// de forma que possamos acessar a lógica. Alternativa: testar via createOrder.

// Abordagem: chamar createOrder com mocks controlados e verificar os resultados.

describe('Correção 2: Validação server-side do delivery_fee', () => {
  let marketplaceService;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock seller_profiles query (retorno padrão)
    mockFrom.mockImplementation((table) => {
      if (table === 'seller_profiles') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: makeSeller(),
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'marketplace_products') {
        return {
          select: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({
              data: [makeProduct()],
              error: null,
            }),
          }),
        };
      }
      if (table === 'marketplace_orders') {
        return {
          insert: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { id: 'order-001', total_brl: 25.00, status: 'pending' },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'users') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({
                data: { full_name: 'Comprador', photo_url: null, username: 'buyer' },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'eloscoins_redemptions') {
        return { insert: jest.fn().mockResolvedValue({ error: null }) };
      }
      // Fallback genérico
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: {}, error: null }),
          }),
        }),
      };
    });

    // Limpa cache de require para pegar mocks frescos
    jest.isolateModules(() => {
      marketplaceService = require('../../../services/marketplaceService');
    });
  });

  // ── Factories ──────────────────────────────────────────────────────────────

  function makeSeller(overrides = {}) {
    return {
      id: 'seller-001',
      user_id: 'user-seller-001',
      status: 'active',
      address_lat: -23.5505,
      address_lng: -46.6333,
      address_city: 'São Paulo',
      address_state: 'SP',
      accepts_eloscoins: false,
      max_coins_per_order: 0,
      coins_discount_rate: 0.01,
      commission_rate: 0.02,
      freight_mode: 'buyer_pays',
      freight_split_ratio: 1.0,
      ...overrides,
    };
  }

  function makeProduct(overrides = {}) {
    return {
      id: 'prod-001',
      name: 'Produto Teste',
      price_brl: 20.00,
      max_coins_discount: 0,
      active: true,
      seller_id: 'seller-001',
      ...overrides,
    };
  }

  function makeOrderData(overrides = {}) {
    return {
      seller_id: 'seller-001',
      items: [{ product_id: 'prod-001', qty: 1 }],
      payment_method: 'pix',
      fulfillment_type: 'local_delivery',
      delivery_address: 'Rua A, 100, Centro, São Paulo, SP',
      delivery_fee: 10.00,
      delivery_lat: -23.5600,
      delivery_lng: -46.6400,
      ...overrides,
    };
  }

  function makeCandidates(fees) {
    return fees.map((fee, i) => ({
      service_id: `svc-${i}`,
      estimated_fee: fee,
      total_km: fee / 2,
      match_score: i,
    }));
  }

  // ── Teste 1: Fronteira dos 20% ─────────────────────────────────────────────

  describe('Fronteira dos 20% (boundary test)', () => {
    it('deve ACEITAR fee em exatamente 1.20× o fee máximo (boundary inclusivo)', async () => {
      // Candidatos retornam fees de 8.00 e 10.00
      // maxFee = 10.00, upperBound = 10.00 × 1.20 = 12.00
      mockFindEligible.mockResolvedValue(makeCandidates([8.00, 10.00]));

      const data = makeOrderData({ delivery_fee: 12.00 }); // exatamente 1.20×

      // Não deve lançar erro
      const result = await marketplaceService.createOrder('buyer-001', data);
      expect(result).toBeDefined();
      expect(result.id).toBe('order-001');
    });

    it('deve REJEITAR fee em 1.21× o fee máximo com DELIVERY_FEE_MISMATCH', async () => {
      // maxFee = 10.00, upperBound = 12.00
      // 10.00 × 1.21 = 12.10 → acima do upper bound
      mockFindEligible.mockResolvedValue(makeCandidates([8.00, 10.00]));

      const data = makeOrderData({ delivery_fee: 12.10 });

      await expect(marketplaceService.createOrder('buyer-001', data))
        .rejects
        .toMatchObject({
          code: 'DELIVERY_FEE_MISMATCH',
        });
    });

    it('deve REJEITAR fee em 0.79× o fee mínimo (abaixo do lower bound)', async () => {
      // minFee = 8.00, lowerBound = 8.00 × 0.80 = 6.40
      // 8.00 × 0.79 = 6.32 → abaixo do lower bound
      mockFindEligible.mockResolvedValue(makeCandidates([8.00, 10.00]));

      const data = makeOrderData({ delivery_fee: 6.32 });

      await expect(marketplaceService.createOrder('buyer-001', data))
        .rejects
        .toMatchObject({
          code: 'DELIVERY_FEE_MISMATCH',
        });
    });

    it('deve ACEITAR fee em exatamente 0.80× o fee mínimo (boundary inclusivo)', async () => {
      // minFee = 8.00, lowerBound = 6.40
      mockFindEligible.mockResolvedValue(makeCandidates([8.00, 10.00]));

      const data = makeOrderData({ delivery_fee: 6.40 });

      const result = await marketplaceService.createOrder('buyer-001', data);
      expect(result).toBeDefined();
    });

    it('deve REJEITAR fee absurdamente baixo (R$0.01)', async () => {
      mockFindEligible.mockResolvedValue(makeCandidates([8.00, 10.00]));

      const data = makeOrderData({ delivery_fee: 0.01 });

      await expect(marketplaceService.createOrder('buyer-001', data))
        .rejects
        .toMatchObject({
          code: 'DELIVERY_FEE_MISMATCH',
        });
    });

    it('deve incluir serverFee na rejeição para o frontend atualizar', async () => {
      mockFindEligible.mockResolvedValue(makeCandidates([8.00, 10.00]));

      const data = makeOrderData({ delivery_fee: 0.01 });

      try {
        await marketplaceService.createOrder('buyer-001', data);
        fail('Deveria ter lançado erro');
      } catch (err) {
        expect(err.code).toBe('DELIVERY_FEE_MISMATCH');
        expect(err.serverFee).toBe(8.00); // minFee
        expect(err.minFee).toBe(8.00);
        expect(err.maxFee).toBe(10.00);
      }
    });
  });

  // ── Teste 2: Sem entregadores disponíveis ──────────────────────────────────

  describe('Sem entregadores disponíveis', () => {
    it('deve REJEITAR com NO_DELIVERERS quando não há candidatos', async () => {
      mockFindEligible.mockResolvedValue([]);

      const data = makeOrderData({ delivery_fee: 10.00 });

      await expect(marketplaceService.createOrder('buyer-001', data))
        .rejects
        .toMatchObject({
          code: 'NO_DELIVERERS',
        });
    });

    it('deve REJEITAR com NO_DELIVERERS quando candidatos é null', async () => {
      mockFindEligible.mockResolvedValue(null);

      const data = makeOrderData({ delivery_fee: 10.00 });

      await expect(marketplaceService.createOrder('buyer-001', data))
        .rejects
        .toMatchObject({
          code: 'NO_DELIVERERS',
        });
    });
  });

  // ── Teste 3: Modo degradado (RPC falha) ────────────────────────────────────

  describe('Modo degradado (RPC/matching falha)', () => {
    beforeEach(() => {
      mockFindEligible.mockRejectedValue(new Error('RPC timeout'));
    });

    it('deve REJEITAR fee R$0.01 pelo teto absoluto (< R$3.00)', async () => {
      const data = makeOrderData({ delivery_fee: 0.01 });

      await expect(marketplaceService.createOrder('buyer-001', data))
        .rejects
        .toMatchObject({
          code: 'DELIVERY_FEE_MISMATCH',
        });
    });

    it('deve REJEITAR fee R$2.99 pelo teto absoluto (< R$3.00)', async () => {
      const data = makeOrderData({ delivery_fee: 2.99 });

      await expect(marketplaceService.createOrder('buyer-001', data))
        .rejects
        .toMatchObject({
          code: 'DELIVERY_FEE_MISMATCH',
        });
    });

    it('deve ACEITAR fee R$3.00 (exatamente no piso do degradado)', async () => {
      const data = makeOrderData({ delivery_fee: 3.00 });

      const result = await marketplaceService.createOrder('buyer-001', data);
      expect(result).toBeDefined();
    });

    it('deve ACEITAR fee R$10.00 no modo degradado', async () => {
      const data = makeOrderData({ delivery_fee: 10.00 });

      const result = await marketplaceService.createOrder('buyer-001', data);
      expect(result).toBeDefined();
    });

    it('deve ACEITAR fee R$500.00 (exatamente no teto do degradado)', async () => {
      const data = makeOrderData({ delivery_fee: 500.00 });

      const result = await marketplaceService.createOrder('buyer-001', data);
      expect(result).toBeDefined();
    });

    it('deve REJEITAR fee R$500.01 pelo teto absoluto (> R$500.00)', async () => {
      const data = makeOrderData({ delivery_fee: 500.01 });

      await expect(marketplaceService.createOrder('buyer-001', data))
        .rejects
        .toMatchObject({
          code: 'DELIVERY_FEE_MISMATCH',
        });
    });
  });

  // ── Teste 4: fulfillment_type não-delivery ─────────────────────────────────

  describe('fulfillment_type não é local_delivery', () => {
    it('deve forçar delivery_fee = 0 para pickup', async () => {
      mockFindEligible.mockResolvedValue(makeCandidates([8.00]));

      const data = makeOrderData({
        fulfillment_type: 'pickup',
        delivery_fee: 15.00, // tentativa de cobrar frete sem entrega
      });

      const result = await marketplaceService.createOrder('buyer-001', data);
      expect(result).toBeDefined();
      // findEligibleDeliverers NÃO deve ter sido chamado
      expect(mockFindEligible).not.toHaveBeenCalled();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Correção 1: distanceService — Google Maps + fallback
// ══════════════════════════════════════════════════════════════════════════════

describe('Correção 1: distanceService', () => {
  let distanceService;
  let originalFetch;
  let originalEnv;

  beforeEach(() => {
    jest.clearAllMocks();
    originalFetch = global.fetch;
    originalEnv = process.env.GOOGLE_MAPS_API_KEY;

    // Limpa cache interno (módulo preserva estado)
    jest.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.GOOGLE_MAPS_API_KEY = originalEnv;
  });

  describe('getRoadDistance', () => {
    it('deve retornar distância do Google Maps quando API responde OK', async () => {
      process.env.GOOGLE_MAPS_API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue({
        json: () => Promise.resolve({
          status: 'OK',
          rows: [{
            elements: [{
              status: 'OK',
              distance: { value: 7500 },  // 7.5 km
              duration: { value: 900 },   // 15 min
            }],
          }],
        }),
      });

      distanceService = require('../../../services/distanceService');

      const result = await distanceService.getRoadDistance(-23.55, -46.63, -23.56, -46.64);

      expect(result.distanceKm).toBe(7.5);
      expect(result.durationMinutes).toBe(15);
      expect(result.source).toBe('google_maps');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('deve fazer fallback para Haversine quando API key ausente', async () => {
      process.env.GOOGLE_MAPS_API_KEY = '';
      global.fetch = jest.fn();

      distanceService = require('../../../services/distanceService');

      const result = await distanceService.getRoadDistance(-23.55, -46.63, -23.56, -46.64);

      expect(result.source).toBe('haversine');
      expect(result.distanceKm).toBeGreaterThan(0);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('deve fazer fallback para Haversine quando API retorna erro', async () => {
      process.env.GOOGLE_MAPS_API_KEY = 'test-key';
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      distanceService = require('../../../services/distanceService');

      const result = await distanceService.getRoadDistance(-23.55, -46.63, -23.56, -46.64);

      expect(result.source).toBe('haversine');
      expect(result.distanceKm).toBeGreaterThan(0);
    });

    it('deve retornar null para coordenadas ausentes', async () => {
      distanceService = require('../../../services/distanceService');

      const result = await distanceService.getRoadDistance(null, null, -23.56, -46.64);

      expect(result.distanceKm).toBeNull();
      expect(result.source).toBe('none');
    });

    it('deve usar cache na segunda chamada com mesmas coordenadas', async () => {
      process.env.GOOGLE_MAPS_API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue({
        json: () => Promise.resolve({
          status: 'OK',
          rows: [{ elements: [{ status: 'OK', distance: { value: 5000 }, duration: { value: 600 } }] }],
        }),
      });

      distanceService = require('../../../services/distanceService');

      await distanceService.getRoadDistance(-23.55, -46.63, -23.56, -46.64);
      await distanceService.getRoadDistance(-23.55, -46.63, -23.56, -46.64);

      // Só 1 fetch — segunda chamada veio do cache
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('cache deve agrupar origens próximas (2 decimais = ~1.1km)', async () => {
      process.env.GOOGLE_MAPS_API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue({
        json: () => Promise.resolve({
          status: 'OK',
          rows: [{ elements: [{ status: 'OK', distance: { value: 5000 }, duration: { value: 600 } }] }],
        }),
      });

      distanceService = require('../../../services/distanceService');

      // Origem 1: -23.5500
      await distanceService.getRoadDistance(-23.5500, -46.6300, -23.5600, -46.6400);
      // Origem 2: -23.5509 (9m de diferença — mesmo arredondamento 2 decimais)
      await distanceService.getRoadDistance(-23.5509, -46.6300, -23.5600, -46.6400);

      // Ambas devem usar a mesma chave de cache → só 1 fetch
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('haversineKm', () => {
    it('deve calcular distância correta entre SP centro e Pinheiros (~5km)', () => {
      distanceService = require('../../../services/distanceService');

      const dist = distanceService.haversineKm(-23.5505, -46.6333, -23.5630, -46.6850);
      // SP Centro → Pinheiros ≈ 5-6 km em linha reta
      expect(dist).toBeGreaterThan(4);
      expect(dist).toBeLessThan(7);
    });
  });
});
