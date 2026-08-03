'use strict';

/**
 * @fileoverview raffleFlow.test.js — JOGOS-OPS-002
 *
 * Testes de integração do fluxo completo da rifa:
 *   initializeTickets → buyTicket → confirmPayment →
 *   cancelExpiredReservations → drawRaffle
 *
 * Mocks isolam completamente Supabase e Asaas.
 * Padrão: jest.mock no topo + implementações por cenário em beforeEach/it.
 */

// ─── Mocks de módulos externos ───────────────────────────────────────────────
// Todos os mocks devem ser declarados ANTES de qualquer require do serviço.

jest.mock('../../../logger', () => ({
  logger: {
    info:  jest.fn(),
    error: jest.fn(),
    warn:  jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock do asaasService (classe instanciada no require)
jest.mock('../../../services/asaasService', () => ({
  createCustomer:   jest.fn(),
  createPixCharge:  jest.fn(),
}));

// Mock do sorteioService (funções exportadas)
jest.mock('../../../services/sorteioService', () => ({
  obterNumeroAleatorioRandomOrg: jest.fn(),
  obterNumeroAleatorioNIST:      jest.fn(),
  obterResultadoLoteria:         jest.fn(),
}));

// Mock do gamificationService — fire-and-forget, nunca deve travar os testes
jest.mock('../../../services/gamificationService', () => ({
  triggerEvent: jest.fn().mockResolvedValue(undefined),
}));

// Mock do gamesService (closeGame chamado pelo drawRaffle)
jest.mock('../../../services/gamesService', () => ({
  closeGame:       jest.fn().mockResolvedValue({ id: 'game-1', status: 'closed' }),
  _requireOwner:   jest.fn(),
  _requireAccess:  jest.fn(),
}));

// Mock do NotificationDispatcher (setImmediate dentro do drawRaffle)
jest.mock('../../../services/NotificationDispatcher', () => ({
  dispatch: jest.fn().mockResolvedValue(undefined),
}));

// ─── Mock do Supabase ────────────────────────────────────────────────────────
//
// raffleGamesService usa dois clientes distintos:
//   sb()        → getSupabaseClient()  (operações gerais, usa RLS)
//   sbService() → createClient()       (bypass de RLS para pagamentos)
//
// Estratégia: cada cliente expõe jest.fn() diretamente para que os testes
// possam usar mockResolvedValueOnce/mockReturnValueOnce por cenário.
// Os métodos intermediários (from, select, eq, …) retornam o mesmo objeto
// cliente para suportar a API chainável do Supabase.

function makeSupabaseMock() {
  // Fila de resultados para chamadas awaited diretamente (sem .single()/.maybeSingle())
  // Usamos uma fila para que múltiplas chamadas em sequência possam ter retornos distintos.
  const directResultQueue = [];

  const client = {
    // Auxiliar de teste: enfileira o próximo resultado para uma chamada awaited direta
    _queueDirectResult(result) {
      directResultQueue.push(result);
    },
  };

  const chainMethods = ['from', 'select', 'insert', 'update', 'upsert', 'delete',
                        'eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in', 'order', 'limit'];

  chainMethods.forEach(method => {
    client[method] = jest.fn(() => client);
  });

  // Métodos terminais — Promises mockáveis via mockResolvedValueOnce por cenário
  client.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
  client.single      = jest.fn().mockResolvedValue({ data: null, error: null });
  client.rpc         = jest.fn().mockResolvedValue({ data: null, error: null });

  // Torna o client "thenable" para suportar `await client.from(...).select(...)`
  // sem chamada de .single()/.maybeSingle().
  // Consome o próximo item da fila ou devolve { data: null, error: null }.
  client.then = (resolve, reject) => {
    const result = directResultQueue.length > 0
      ? directResultQueue.shift()
      : { data: null, error: null };
    return Promise.resolve(result).then(resolve, reject);
  };

  return client;
}

// Clientes separados para poder configurar comportamentos distintos
let mockSbAnon;    // retornado por getSupabaseClient()
let mockSbService; // retornado por createClient()

jest.mock('../../../config/supabase', () => ({
  getSupabaseClient: jest.fn(() => mockSbAnon),
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSbService),
}));

// ─── Importações do serviço alvo ─────────────────────────────────────────────
// Importar DEPOIS dos mocks

const raffleGamesService = require('../../../services/raffleGamesService');
const asaasService       = require('../../../services/asaasService');
const sorteioService     = require('../../../services/sorteioService');
const { getSupabaseClient } = require('../../../config/supabase');
const { createClient }      = require('@supabase/supabase-js');

// ─── Helpers de teste ─────────────────────────────────────────────────────────

/**
 * Retorna um objeto de resultado Supabase bem-sucedido.
 * @param {*} data
 */
function ok(data) {
  return { data, error: null };
}

/**
 * Retorna um objeto de resultado Supabase com erro.
 * @param {string} message
 */
function fail(message) {
  return { data: null, error: { message } };
}

/**
 * Reinicializa os mocks chainable antes de cada teste.
 * Garante isolamento completo entre cenários.
 */
function resetSupabaseMocks() {
  mockSbAnon    = makeSupabaseMock();
  mockSbService = makeSupabaseMock();
  getSupabaseClient.mockReturnValue(mockSbAnon);
  createClient.mockReturnValue(mockSbService);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const GAME_ID   = 'game-raffle-001';
const OWNER_ID  = 'user-owner-001';
const BUYER_ID  = 'user-buyer-001';
const PAY_ID    = 'pay_asaas_test_001';
const TICKET_N  = 1;

const baseGame = {
  id:            GAME_ID,
  owner_id:      OWNER_ID,
  game_type:     'RAFFLE',
  title:         'Rifa de Teste',
  status:        'open',
  ticket_count:  10,
  ticket_price:  5.00,
  prize_description: 'Prêmio Teste',
  registration_deadline: null,
  draw_at: null,
};

// ─── Suite de testes ──────────────────────────────────────────────────────────

describe('Rifa — Fluxo Completo (JOGOS-OPS-002)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSupabaseMocks();

    // Variáveis de ambiente mínimas para sbService() não lançar erro
    process.env.SUPABASE_URL              = 'https://fake.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';

    // Usa fake timers para que setImmediate (fire-and-forget de gamification/
    // notifications dentro do serviço) nunca execute fora do contexto do teste,
    // evitando o aviso "import after Jest environment torn down".
    jest.useFakeTimers();
  });

  afterEach(() => {
    // Descarta qualquer setImmediate/setTimeout pendente e restaura timers reais.
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  // ─── Cenário 1: Criação de jogo do tipo RAFFLE ────────────────────────────

  describe('Cenário 1 — initializeTickets: gera 10 bilhetes disponíveis', () => {
    it('deve criar 10 bilhetes com payment_status "available"', async () => {
      // Stub 1: _requireRaffleOwner → from('games').select().eq().maybeSingle()
      mockSbAnon.maybeSingle.mockResolvedValueOnce(ok(baseGame));

      // Stub 2: contagem de bilhetes existentes → { count: 0, error: null }
      // O serviço faz: await supabase.from('raffle_tickets').select('id', {count:'exact', head:true}).eq(...)
      // Essa chamada é awaited diretamente (sem .single()), então enfileiramos na fila direta.
      mockSbAnon._queueDirectResult({ count: 0, error: null });

      // Stub 3: insert em lote (10 bilhetes) — o serviço usa `supabase` (sb()), não sbService()
      // await supabase.from('raffle_tickets').insert(batch) — awaited diretamente
      mockSbAnon._queueDirectResult({ data: null, error: null });

      const result = await raffleGamesService.initializeTickets(GAME_ID, OWNER_ID);

      // Verificações do retorno
      expect(result.created).toBe(10);
      expect(result.alreadyInitialized).toBe(false);
      expect(result.totalTickets).toBe(10);

      // O insert deve ter sido chamado com 10 bilhetes, todos com payment_status 'available'
      const insertCall = mockSbAnon.insert.mock.calls[0][0];
      expect(Array.isArray(insertCall)).toBe(true);
      expect(insertCall).toHaveLength(10);
      insertCall.forEach((ticket, idx) => {
        expect(ticket.game_id).toBe(GAME_ID);
        expect(ticket.ticket_number).toBe(idx + 1);
        expect(ticket.payment_status).toBe('available');
      });
    });

    it('deve ser idempotente: se bilhetes já existem, retorna alreadyInitialized=true', async () => {
      // Stub 1: _requireRaffleOwner
      mockSbAnon.maybeSingle.mockResolvedValueOnce(ok(baseGame));

      // Stub 2: contagem de bilhetes já existentes → count = 10
      mockSbAnon._queueDirectResult({ count: 10, error: null });

      const result = await raffleGamesService.initializeTickets(GAME_ID, OWNER_ID);

      expect(result.alreadyInitialized).toBe(true);
      expect(result.created).toBe(0);
      // Nenhum insert deve ter acontecido
      expect(mockSbAnon.insert).not.toHaveBeenCalled();
    });
  });

  // ─── Cenário 2: Reserva de bilhete (buyTicket) ────────────────────────────

  describe('Cenário 2 — buyTicket: reserva bilhete e gera PIX', () => {
    it('deve reservar bilhete e retornar pixCopiaECola, encodedImage e expiresAt', async () => {
      // Stub 1: verificar participação confirmada
      mockSbAnon.maybeSingle
        .mockResolvedValueOnce(ok({ status: 'confirmed' }));

      // Stub 2: buscar jogo (status, game_type, ticket_price, registration_deadline)
      mockSbAnon.maybeSingle
        .mockResolvedValueOnce(ok({
          id:                    GAME_ID,
          game_type:             'RAFFLE',
          title:                 'Rifa de Teste',
          status:                'open',
          ticket_price:          5.00,
          registration_deadline: null,
        }));

      // Stub 3: reserva otimista via sbService (UPDATE WHERE payment_status='available')
      const reservedTicket = {
        id:             'ticket-uuid-001',
        game_id:        GAME_ID,
        ticket_number:  TICKET_N,
        payment_status: 'reserved',
        owner_id:       BUYER_ID,
        reserved_at:    new Date().toISOString(),
        payment_id:     null,
      };
      mockSbService.select.mockResolvedValueOnce(ok([reservedTicket]));

      // Stub 4: buscar dados do comprador (display_name, email)
      mockSbAnon.single
        .mockResolvedValueOnce(ok({ display_name: 'João Comprador', email: 'joao@test.com' }));

      // Stub 5: Asaas createCustomer
      asaasService.createCustomer.mockResolvedValueOnce({ id: 'cust_test_001' });

      // Stub 6: Asaas createPixCharge
      asaasService.createPixCharge.mockResolvedValueOnce({
        id:            PAY_ID,
        pixCopiaECola: 'PIX123COPIACOLA',
        encodedImage:  'BASE64QRIMAGE',
        txid:          PAY_ID,
        status:        'PENDING',
      });

      // Stub 7: salvar payment_id no bilhete (UPDATE + select + single)
      const updatedTicket = { ...reservedTicket, payment_id: PAY_ID };
      mockSbService.single.mockResolvedValueOnce(ok(updatedTicket));

      const result = await raffleGamesService.buyTicket(GAME_ID, BUYER_ID, TICKET_N);

      // Verificações de retorno
      expect(result).toHaveProperty('ticket');
      expect(result).toHaveProperty('pixCopiaECola', 'PIX123COPIACOLA');
      expect(result).toHaveProperty('pixQrCode', 'BASE64QRIMAGE');
      expect(result).toHaveProperty('expiresAt');
      expect(typeof result.expiresAt).toBe('string');

      // expiresAt deve ser um ISO 8601 aproximadamente 30 minutos no futuro
      const expiresAt = new Date(result.expiresAt);
      const now = new Date();
      const diffMinutes = (expiresAt - now) / 60000;
      expect(diffMinutes).toBeGreaterThan(28);
      expect(diffMinutes).toBeLessThan(32);

      // Verificar que o bilhete retornado tem o payment_id correto
      expect(result.ticket.payment_id).toBe(PAY_ID);

      // Verificar que o Asaas foi chamado com os parâmetros corretos
      expect(asaasService.createCustomer).toHaveBeenCalledWith(
        expect.objectContaining({
          name:              'João Comprador',
          email:             'joao@test.com',
          externalReference: BUYER_ID,
        })
      );
      expect(asaasService.createPixCharge).toHaveBeenCalledWith(
        expect.objectContaining({
          value:             5.00,
          externalReference: `raffle_${GAME_ID}_ticket_${TICKET_N}`,
        })
      );
    });

    it('deve lançar erro se participante não for confirmado', async () => {
      // Participante com status 'pending'
      mockSbAnon.maybeSingle
        .mockResolvedValueOnce(ok({ status: 'pending' }));

      await expect(
        raffleGamesService.buyTicket(GAME_ID, BUYER_ID, TICKET_N)
      ).rejects.toThrow('Você não é um participante confirmado desta rifa');
    });

    it('deve lançar erro se o bilhete já estiver reservado (lock otimista falha)', async () => {
      // Participante confirmado
      mockSbAnon.maybeSingle.mockResolvedValueOnce(ok({ status: 'confirmed' }));

      // Jogo aberto
      mockSbAnon.maybeSingle.mockResolvedValueOnce(ok({
        id: GAME_ID, game_type: 'RAFFLE', title: 'Rifa', status: 'open',
        ticket_price: 5.00, registration_deadline: null,
      }));

      // Lock otimista retorna array vazio → bilhete já reservado
      mockSbService.select.mockResolvedValueOnce(ok([]));

      await expect(
        raffleGamesService.buyTicket(GAME_ID, BUYER_ID, TICKET_N)
      ).rejects.toThrow('Bilhete já reservado ou indisponível');
    });
  });

  // ─── Cenário 3: Confirmação de pagamento via webhook ─────────────────────

  describe('Cenário 3 — confirmPayment: confirma pagamento via webhook Asaas', () => {
    it('deve atualizar payment_status para "paid"', async () => {
      const reservedTicket = {
        id:             'ticket-uuid-001',
        game_id:        GAME_ID,
        ticket_number:  TICKET_N,
        payment_status: 'reserved',
        owner_id:       BUYER_ID,
        reserved_at:    new Date().toISOString(),
        payment_id:     PAY_ID,
      };

      // Stub 1: buscar bilhete pelo payment_id (maybeSingle)
      mockSbService.maybeSingle.mockResolvedValueOnce(ok(reservedTicket));

      // Stub 2: UPDATE payment_status='paid' (single)
      const paidTicket = {
        ...reservedTicket,
        payment_status: 'paid',
        purchased_at:   new Date().toISOString(),
      };
      mockSbService.single.mockResolvedValueOnce(ok(paidTicket));

      const result = await raffleGamesService.confirmPayment(PAY_ID);

      // Verificações
      expect(result).not.toBeNull();
      expect(result.payment_status).toBe('paid');
      expect(result.purchased_at).toBeDefined();

      // Verificar que o UPDATE foi chamado com os campos corretos
      expect(mockSbService.update).toHaveBeenCalledWith(
        expect.objectContaining({ payment_status: 'paid' })
      );
    });

    it('deve ser idempotente: se já pago, retorna o bilhete sem novo UPDATE', async () => {
      const alreadyPaidTicket = {
        id:             'ticket-uuid-001',
        payment_status: 'paid',
        owner_id:       BUYER_ID,
        payment_id:     PAY_ID,
      };

      // Bilhete já está paid
      mockSbService.maybeSingle.mockResolvedValueOnce(ok(alreadyPaidTicket));

      const result = await raffleGamesService.confirmPayment(PAY_ID);

      expect(result.payment_status).toBe('paid');
      // Nenhum UPDATE deve ter sido chamado (idempotência)
      expect(mockSbService.update).not.toHaveBeenCalled();
    });

    it('deve retornar null se paymentId não corresponde a nenhum bilhete', async () => {
      mockSbService.maybeSingle.mockResolvedValueOnce(ok(null));

      const result = await raffleGamesService.confirmPayment('pay_inexistente');

      expect(result).toBeNull();
    });
  });

  // ─── Cenário 4: Expiração de reserva ─────────────────────────────────────

  describe('Cenário 4 — cancelExpiredReservations: libera reservas vencidas', () => {
    it('deve liberar bilhetes com reserved_at > 30min e não tocar nos recentes', async () => {
      // O serviço faz um único UPDATE com filtro .lt('reserved_at', limite)
      // via sbService(). Simula que 1 bilhete expirado foi liberado.
      const releasedTickets = [{ id: 'ticket-expirado-001' }];
      mockSbService.select.mockResolvedValueOnce(ok(releasedTickets));

      const result = await raffleGamesService.cancelExpiredReservations();

      expect(result.released).toBe(1);

      // Verificar que o UPDATE foi chamado com payment_status='available'
      expect(mockSbService.update).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_status: 'available',
          owner_id:       null,
          payment_id:     null,
          reserved_at:    null,
        })
      );

      // Verificar que o filtro por payment_status='reserved' foi aplicado
      expect(mockSbService.eq).toHaveBeenCalledWith('payment_status', 'reserved');

      // Verificar que o filtro .lt('reserved_at', ...) foi aplicado
      // (garante que bilhetes recentes não são cancelados)
      expect(mockSbService.lt).toHaveBeenCalledWith(
        'reserved_at',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)  // ISO 8601
      );
    });

    it('deve retornar released=0 se não há reservas expiradas', async () => {
      // Nenhum bilhete expirado
      mockSbService.select.mockResolvedValueOnce(ok([]));

      const result = await raffleGamesService.cancelExpiredReservations();

      expect(result.released).toBe(0);
    });

    it('deve garantir que o limite de expiração é ~30min no passado', async () => {
      mockSbService.select.mockResolvedValueOnce(ok([]));

      await raffleGamesService.cancelExpiredReservations();

      // Captura o argumento do .lt('reserved_at', <VALOR>)
      const ltCall = mockSbService.lt.mock.calls.find(([field]) => field === 'reserved_at');
      expect(ltCall).toBeDefined();

      const cutoffIso = ltCall[1];
      const cutoff    = new Date(cutoffIso);
      const now       = new Date();

      // Cutoff deve estar entre 29 e 31 minutos atrás
      const diffMinutes = (now - cutoff) / 60000;
      expect(diffMinutes).toBeGreaterThan(29);
      expect(diffMinutes).toBeLessThan(31);
    });
  });

  // ─── Cenário 5: Sorteio (drawRaffle) ─────────────────────────────────────

  describe('Cenário 5 — drawRaffle: sorteia vencedor entre bilhetes pagos', () => {
    const USER_A = 'user-buyer-a';
    const USER_B = 'user-buyer-b';
    const USER_C = 'user-buyer-c';

    const paidTickets = [
      { id: 'ticket-1', ticket_number: 1, owner_id: USER_A, payment_status: 'paid' },
      { id: 'ticket-2', ticket_number: 2, owner_id: USER_B, payment_status: 'paid' },
      { id: 'ticket-3', ticket_number: 3, owner_id: USER_C, payment_status: 'paid' },
    ];

    it('deve retornar { ticketSorteado, winner.userId, winner.ticketNumber, resultHash }', async () => {
      // Stub 1: _requireRaffleOwner → from('games').select().eq().maybeSingle()
      mockSbAnon.maybeSingle.mockResolvedValueOnce(ok({ ...baseGame, status: 'open' }));

      // Stub 2: buscar bilhetes pagos →
      //   await sb().from('raffle_tickets').select(...).eq(...).eq(...).order(...)
      // Essa cadeia é awaited diretamente (sem .single())
      mockSbAnon._queueDirectResult(ok(paidTickets));

      // Random.org retorna o ticket_number 2 (USER_B ganha)
      sorteioService.obterNumeroAleatorioRandomOrg.mockResolvedValueOnce(2);

      // Stub 3: inserir resultado em game_results → .insert().select().single()
      const gameResult = {
        id:          'result-uuid-001',
        game_id:     GAME_ID,
        result_hash: 'abc',
        drawn_at:    new Date().toISOString(),
      };
      mockSbAnon.single.mockResolvedValueOnce(ok(gameResult));

      const result = await raffleGamesService.drawRaffle(GAME_ID, OWNER_ID);

      // Verificações estruturais
      expect(result).toHaveProperty('ticketSorteado', 2);
      expect(result).toHaveProperty('winner');
      expect(result.winner.userId).toBe(USER_B);
      expect(result.winner.ticketNumber).toBe(2);
      expect(result).toHaveProperty('resultHash');
      expect(typeof result.resultHash).toBe('string');
      expect(result.resultHash.length).toBeGreaterThanOrEqual(8);
    });

    it('deve gerar um resultHash SHA-256 de 64 caracteres hexadecimais', async () => {
      // Stub 1: _requireRaffleOwner
      mockSbAnon.maybeSingle.mockResolvedValueOnce(ok({ ...baseGame, status: 'open' }));

      // Stub 2: bilhetes pagos (direto)
      mockSbAnon._queueDirectResult(ok(paidTickets));

      sorteioService.obterNumeroAleatorioRandomOrg.mockResolvedValueOnce(1);

      // Stub 3: game_results insert → single
      mockSbAnon.single.mockResolvedValueOnce(ok({
        id: 'result-uuid-002', game_id: GAME_ID, drawn_at: new Date().toISOString(),
      }));

      const result = await raffleGamesService.drawRaffle(GAME_ID, OWNER_ID);

      // SHA-256 produz 64 caracteres hex
      expect(result.resultHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('deve usar NIST Beacon se Random.org falhar', async () => {
      // Stub 1: _requireRaffleOwner
      mockSbAnon.maybeSingle.mockResolvedValueOnce(ok({ ...baseGame, status: 'open' }));

      // Stub 2: bilhetes pagos (direto)
      mockSbAnon._queueDirectResult(ok(paidTickets));

      // Random.org lança erro; NIST retorna valor que mapeia para ticket_number 3
      // Fórmula: minTicket + ((nistRaw - 1) % range) = 1 + ((3 - 1) % 3) = 3
      sorteioService.obterNumeroAleatorioRandomOrg.mockRejectedValueOnce(
        new Error('Random.org indisponível')
      );
      sorteioService.obterNumeroAleatorioNIST.mockResolvedValueOnce(3);

      // Stub 3: game_results insert → single
      mockSbAnon.single.mockResolvedValueOnce(ok({
        id: 'result-uuid-003', game_id: GAME_ID, drawn_at: new Date().toISOString(),
      }));

      const result = await raffleGamesService.drawRaffle(GAME_ID, OWNER_ID);

      expect(result.winner.userId).toBe(USER_C);
      expect(result.algorithm).toContain('nist');
    });
  });

  // ─── Cenário 6: Sorteio sem bilhetes pagos — deve lançar erro ─────────────

  describe('Cenário 6 — drawRaffle sem bilhetes pagos: deve lançar erro', () => {
    it('deve lançar "Nenhum bilhete pago para sortear" quando não há bilhetes pagos', async () => {
      // Jogo aberto com owner correto
      mockSbAnon.maybeSingle.mockResolvedValueOnce(ok({ ...baseGame, status: 'open' }));

      // Nenhum bilhete pago — enfileirado como resultado direto
      mockSbAnon._queueDirectResult(ok([]));

      await expect(
        raffleGamesService.drawRaffle(GAME_ID, OWNER_ID)
      ).rejects.toThrow('Nenhum bilhete pago para sortear');
    });

    it('deve lançar erro se o jogo não estiver aberto', async () => {
      // Jogo com status 'closed'
      mockSbAnon.maybeSingle.mockResolvedValueOnce(
        ok({ ...baseGame, status: 'closed' })
      );

      await expect(
        raffleGamesService.drawRaffle(GAME_ID, OWNER_ID)
      ).rejects.toThrow("Rifa deve estar com status 'open' para sortear");
    });

    it('deve lançar erro se o userId não for o owner da rifa', async () => {
      // Jogo pertence a OWNER_ID, mas a chamada vem de outro usuário
      mockSbAnon.maybeSingle.mockResolvedValueOnce(
        ok({ ...baseGame, owner_id: 'outro-usuario' })
      );

      await expect(
        raffleGamesService.drawRaffle(GAME_ID, OWNER_ID)
      ).rejects.toThrow('Você não tem permissão para gerenciar esta rifa');
    });
  });
});
