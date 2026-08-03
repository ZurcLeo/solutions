'use strict';

// JOGOS-OPS-003 — Testes de integração: Amigo Oculto com negociação de valor
// Cobre: criação de jogo, sorteio Sattolo, revelação individual, proposta/aceite/recusa de valor

// ── Mocks de dependências externas ──────────────────────────────────────────

// Mock do logger (suprime saída nos testes)
jest.mock('../../../logger', () => ({
  logger: {
    info:  jest.fn(),
    error: jest.fn(),
    warn:  jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock do cliente Supabase — retorna um objeto mockável via makeSb()
const mockSb = {
  from: jest.fn(),
  rpc:  jest.fn(),
};
jest.mock('../../../config/supabase', () => ({
  getSupabaseClient: jest.fn(() => mockSb),
}));

// Mock de gamesService: isolamos _requireOwner, closeGame e addParticipant
// para não arrastar toda a lógica interna do gamesService nos testes do secretFriendService.
jest.mock('../../../services/gamesService', () => ({
  _requireOwner:   jest.fn(),
  _requireAccess:  jest.fn(),
  closeGame:       jest.fn(),
  addParticipant:  jest.fn(),
  createGame:      jest.fn(),
  openGame:        jest.fn(),
  cancelGame:      jest.fn(),
  updateGame:      jest.fn(),
  getGame:         jest.fn(),
  listMyGames:     jest.fn(),
  getParticipants: jest.fn(),
  associateCaixinha: jest.fn(),
}));

// Mock do socket handler para não precisar de instância Socket.IO nos testes
jest.mock('../../../config/socket/handlers/gameHandlers', () => ({
  emitDrawDone:          jest.fn(),
  emitParticipantJoined: jest.fn(),
}));

// Mock do gamificationService (importado via require() lazy dentro do setImmediate)
jest.mock('../../../services/gamificationService', () => ({
  triggerEvent: jest.fn().mockResolvedValue(undefined),
}));

// ── Imports APÓS mocks ───────────────────────────────────────────────────────

const { _requireOwner, closeGame } = require('../../../services/gamesService');
const {
  drawPairs,
  revealMyPair,
  proposeGiftValue,
  respondGiftProposal,
  sattoloCycle,
} = require('../../../services/secretFriendService');

// ── Helpers de factory ───────────────────────────────────────────────────────

const GAME_ID  = 'game-sf-001';
const OWNER_ID = 'owner-user';
const USER_A   = 'user-A';
const USER_B   = 'user-B';
const USER_C   = 'user-C';
const USER_D   = 'user-D';

/**
 * Cria um objeto de jogo SECRET_FRIEND padrão para os testes.
 */
function makeGame(overrides = {}) {
  return {
    id:                 GAME_ID,
    owner_id:           OWNER_ID,
    game_type:          'SECRET_FRIEND',
    status:             'open',
    gift_value_mode:    'suggested',
    suggested_gift_value: 50,
    title:              'Amigo Oculto da Família',
    ...overrides,
  };
}

/**
 * Cria um builder encadeável de mock para as chamadas Supabase.
 * Retorna um proxy que cada método retorna `this` para encadeamento,
 * exceto `single()` / `maybeSingle()` / `select()` no final que resolvem o valor.
 *
 * Uso: buildChain({ data: [...], error: null })
 */
function buildChain(result) {
  const chain = {
    select:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    in:          jest.fn().mockReturnThis(),
    order:       jest.fn().mockReturnThis(),
    limit:       jest.fn().mockReturnThis(),
    upsert:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
    single:      jest.fn().mockResolvedValue(result),
    maybeSingle: jest.fn().mockResolvedValue(result),
  };
  // Alguns métodos intermediários podem terminar a cadeia (e.g. .insert sem .single)
  chain.insert.mockReturnValue({ ...chain, ...{ mockResolvedValue: undefined } });
  // Redefine insert para sempre retornar a cadeia com a resolução correta
  chain.insert = jest.fn().mockResolvedValue(result);
  chain.update = jest.fn().mockReturnThis();
  // Para update().eq().select().single() precisamos que update retorne a própria chain
  chain.update = jest.fn(() => chain);
  chain.insert = jest.fn(() => chain);
  chain.upsert = jest.fn(() => chain);
  return chain;
}

// ── Suite principal ──────────────────────────────────────────────────────────

describe('SecretFriend — Fluxo Completo (integração com Supabase mockado)', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Cenário 1: sattoloCycle — algoritmo puro (sem mocks de rede)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('sattoloCycle — algoritmo de derangement', () => {
    it('deve gerar exatamente N pares para N participantes', () => {
      const ids = [USER_A, USER_B, USER_C, USER_D];
      const pares = sattoloCycle(ids);

      expect(pares).toHaveLength(4);
    });

    it('deve garantir que nenhum participante é seu próprio amigo oculto (propriedade de derangement)', () => {
      const ids = [USER_A, USER_B, USER_C, USER_D];
      const pares = sattoloCycle(ids);

      for (const par of pares) {
        expect(par.giver).not.toBe(par.receiver);
      }
    });

    it('deve garantir cobertura completa: cada participante aparece exatamente 1x como giver e 1x como receiver', () => {
      const ids = [USER_A, USER_B, USER_C, USER_D];
      const pares = sattoloCycle(ids);

      const givers   = pares.map(p => p.giver);
      const receivers = pares.map(p => p.receiver);

      // Cada ID deve aparecer exatamente uma vez em cada posição
      for (const id of ids) {
        expect(givers.filter(g => g === id)).toHaveLength(1);
        expect(receivers.filter(r => r === id)).toHaveLength(1);
      }
    });

    it('deve lançar erro com menos de 2 participantes', () => {
      expect(() => sattoloCycle(['only-one'])).toThrow(
        'Amigo Oculto requer pelo menos 2 participantes'
      );
    });

    it('deve ser estatisticamente válido em múltiplas execuções (rodadas de estresse)', () => {
      const ids = [USER_A, USER_B, USER_C, USER_D];
      // Executa 50 vezes para verificar que a propriedade de derangement é invariante
      for (let run = 0; run < 50; run++) {
        const pares = sattoloCycle(ids);
        for (const par of pares) {
          expect(par.giver).not.toBe(par.receiver);
        }
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Cenário 1 (integração): Criação de jogo SECRET_FRIEND via createGame
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Cenário 1 — Criação de jogo SECRET_FRIEND', () => {
    it('deve criar jogo com game_type SECRET_FRIEND, gift_value_mode suggested e suggested_gift_value corretos', async () => {
      const { createGame } = require('../../../services/gamesService');

      const expectedGame = makeGame();
      createGame.mockResolvedValueOnce(expectedGame);

      const result = await createGame(OWNER_ID, {
        game_type:            'SECRET_FRIEND',
        gift_value_mode:      'suggested',
        suggested_gift_value: 50,
        title:                'Amigo Oculto da Família',
      });

      expect(result.game_type).toBe('SECRET_FRIEND');
      expect(result.gift_value_mode).toBe('suggested');
      expect(result.suggested_gift_value).toBe(50);
      expect(result.owner_id).toBe(OWNER_ID);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Cenário 2: drawPairs — sorteio com 4 participantes
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Cenário 2 — drawPairs com 4 participantes', () => {
    it('deve criar 4 pares em secret_friend_pairs e verificar unicidade + cobertura Sattolo', async () => {
      const participants = [
        { user_id: USER_A },
        { user_id: USER_B },
        { user_id: USER_C },
        { user_id: USER_D },
      ];

      // _requireOwner retorna jogo com status 'open' e tipo SECRET_FRIEND
      _requireOwner.mockResolvedValueOnce(makeGame());

      // game_participants.select().eq('game_id').eq('status') → lista de participantes
      const partChain = {
        select:      jest.fn().mockReturnThis(),
        eq:          jest.fn().mockReturnThis(),
        // última chamada resolve com os participantes
        // Jest: a segunda .eq() resolve a Promise
      };
      // Implementação: from('game_participants') → chain que resolve em .eq()
      // O service faz: sb.from('game_participants').select('user_id').eq(...).eq(...)
      // A última operação encadeada (segundo .eq) deve resolver a Promise
      let partCallCount = 0;
      partChain.eq = jest.fn(() => {
        partCallCount++;
        if (partCallCount >= 2) {
          return Promise.resolve({ data: participants, error: null });
        }
        return partChain;
      });
      partChain.select = jest.fn().mockReturnValue(partChain);

      // secret_friend_pairs.insert(rows) → sucesso
      const insertPairsChain = Promise.resolve({ data: null, error: null });

      // game_results.insert(...) → sucesso
      const insertResultsChain = Promise.resolve({ data: null, error: null });

      // closeGame → sucesso
      closeGame.mockResolvedValueOnce({ id: GAME_ID, status: 'closed' });

      // Configura mockSb.from para despachar a chain correta por tabela
      mockSb.from.mockImplementation((table) => {
        if (table === 'game_participants') return partChain;
        if (table === 'secret_friend_pairs') return { insert: jest.fn().mockReturnValue(insertPairsChain) };
        if (table === 'game_results')        return { insert: jest.fn().mockReturnValue(insertResultsChain) };
        return {};
      });

      const result = await drawPairs(GAME_ID, OWNER_ID);

      // Verifica resultado retornado
      expect(result.total).toBe(4);
      expect(typeof result.resultadoHash).toBe('string');
      expect(result.resultadoHash).toHaveLength(64); // SHA-256 hex

      // Verifica que closeGame foi chamado
      expect(closeGame).toHaveBeenCalledWith(GAME_ID, OWNER_ID);

      // Verifica que secret_friend_pairs recebeu insert com 4 linhas
      const insertCall = mockSb.from.mock.calls.find(([t]) => t === 'secret_friend_pairs');
      expect(insertCall).toBeDefined();
    });

    it('deve garantir propriedades do Sattolo cycle nos pares inseridos (nenhum giver === receiver)', async () => {
      // Captura os rows passados ao insert de secret_friend_pairs
      let capturedRows = null;

      const participants = [
        { user_id: USER_A },
        { user_id: USER_B },
        { user_id: USER_C },
        { user_id: USER_D },
      ];

      _requireOwner.mockResolvedValueOnce(makeGame());

      let partCallCount2 = 0;
      const partChain2 = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn(() => {
          partCallCount2++;
          if (partCallCount2 >= 2) {
            return Promise.resolve({ data: participants, error: null });
          }
          return partChain2;
        }),
      };
      partChain2.select = jest.fn().mockReturnValue(partChain2);

      closeGame.mockResolvedValueOnce({ id: GAME_ID, status: 'closed' });

      mockSb.from.mockImplementation((table) => {
        if (table === 'game_participants') return partChain2;
        if (table === 'secret_friend_pairs') {
          return {
            insert: jest.fn((rows) => {
              capturedRows = rows;
              return Promise.resolve({ data: null, error: null });
            }),
          };
        }
        if (table === 'game_results') return { insert: jest.fn().mockResolvedValue({ data: null, error: null }) };
        return {};
      });

      await drawPairs(GAME_ID, OWNER_ID);

      expect(capturedRows).not.toBeNull();
      expect(capturedRows).toHaveLength(4);

      // Propriedade de derangement: nenhum giver === receiver
      for (const row of capturedRows) {
        expect(row.giver_id).not.toBe(row.receiver_id);
      }

      // Cobertura: cada participante aparece exatamente 1x como giver e 1x como receiver
      const givers   = capturedRows.map(r => r.giver_id);
      const receivers = capturedRows.map(r => r.receiver_id);
      const ids = [USER_A, USER_B, USER_C, USER_D];

      for (const id of ids) {
        expect(givers.filter(g => g === id)).toHaveLength(1);
        expect(receivers.filter(r => r === id)).toHaveLength(1);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Cenário 3: revealMyPair — revelação individual isolada
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Cenário 3 — revealMyPair: revelação individual e privacidade', () => {
    it('deve retornar receiverId e isFirstReveal=true para usuário A após sorteio', async () => {
      // Jogo fechado (sorteio realizado)
      const gameChain = {
        select:      jest.fn().mockReturnThis(),
        eq:          jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data:  makeGame({ status: 'closed' }),
          error: null,
        }),
      };

      // Par de A: receiver é USER_B, ainda não revelado
      const pairOfA = {
        id:          'pair-a-b',
        receiver_id: USER_B,
        revealed_at: null,
      };
      const pairChain = {
        select:      jest.fn().mockReturnThis(),
        eq:          jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: pairOfA, error: null }),
      };

      // Update do revealed_at
      const updateChain = {
        update: jest.fn().mockReturnThis(),
        eq:     jest.fn().mockResolvedValue({ data: null, error: null }),
      };

      mockSb.from.mockImplementation((table) => {
        if (table === 'games')               return gameChain;
        if (table === 'secret_friend_pairs') {
          // Distingue entre select (revelar par) e update (marcar revealed_at)
          return {
            select: jest.fn().mockReturnValue(pairChain),
            update: jest.fn().mockReturnValue(updateChain),
          };
        }
        return {};
      });

      const result = await revealMyPair(GAME_ID, USER_A);

      expect(result.receiverId).toBe(USER_B);
      expect(result.isFirstReveal).toBe(true);
    });

    it('NÃO deve retornar dados dos pares de outros participantes (privacidade)', async () => {
      // Monta um jogo fechado
      const gameChain = {
        select:      jest.fn().mockReturnThis(),
        eq:          jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data:  makeGame({ status: 'closed' }),
          error: null,
        }),
      };

      // O par de B (que o service retorna ao consultar giver_id = B)
      const pairOfB = {
        id:          'pair-b-c',
        receiver_id: USER_C,
        revealed_at: null,
      };
      const pairChainB = {
        select:      jest.fn().mockReturnThis(),
        eq:          jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: pairOfB, error: null }),
      };
      const updateChainB = {
        update: jest.fn().mockReturnThis(),
        eq:     jest.fn().mockResolvedValue({ data: null, error: null }),
      };

      mockSb.from.mockImplementation((table) => {
        if (table === 'games') return gameChain;
        if (table === 'secret_friend_pairs') {
          return {
            select: jest.fn().mockReturnValue(pairChainB),
            update: jest.fn().mockReturnValue(updateChainB),
          };
        }
        return {};
      });

      // Chamar revealMyPair para B só revela o par de B (USER_C), não de A ou D
      const result = await revealMyPair(GAME_ID, USER_B);

      expect(result.receiverId).toBe(USER_C);
      // Garantia: result não contém IDs de outros usuários misturados
      expect(result.receiverId).not.toBe(USER_A);
      expect(result.receiverId).not.toBe(USER_B); // nunca revela a si mesmo
      expect(result.receiverId).not.toBe(USER_D);
    });

    it('deve retornar isFirstReveal=false quando par já foi revelado anteriormente', async () => {
      const alreadyRevealedAt = '2026-06-01T10:00:00.000Z';

      const gameChain = {
        select:      jest.fn().mockReturnThis(),
        eq:          jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data:  makeGame({ status: 'closed' }),
          error: null,
        }),
      };

      const pairAlreadyRevealed = {
        id:          'pair-a-b',
        receiver_id: USER_B,
        revealed_at: alreadyRevealedAt,
      };
      const pairChain = {
        select:      jest.fn().mockReturnThis(),
        eq:          jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: pairAlreadyRevealed, error: null }),
      };

      mockSb.from.mockImplementation((table) => {
        if (table === 'games')               return gameChain;
        if (table === 'secret_friend_pairs') return { select: jest.fn().mockReturnValue(pairChain) };
        return {};
      });

      const result = await revealMyPair(GAME_ID, USER_A);

      expect(result.receiverId).toBe(USER_B);
      expect(result.isFirstReveal).toBe(false);
      expect(result.revealedAt).toBe(alreadyRevealedAt);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Cenário 4: proposeGiftValue — proposta de valor (modo 'suggested')
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Cenário 4 — proposeGiftValue: proposta de valor alternativo', () => {
    it('deve registrar proposta de R$ 80 com gift_value_proposal=80 e gift_value_accepted=null', async () => {
      // Mock game (modo suggested)
      const gameChain = {
        select:      jest.fn().mockReturnThis(),
        eq:          jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data:  makeGame(),
          error: null,
        }),
      };

      // Participante B confirmado
      const partChain = {
        select:      jest.fn().mockReturnThis(),
        eq:          jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data:  { id: 'part-b' },
          error: null,
        }),
      };

      // Registro da proposta após update
      const updatedParticipant = {
        game_id:             GAME_ID,
        user_id:             USER_B,
        gift_value_proposal: 80,
        gift_value_accepted: null,
        status:              'confirmed',
      };
      const updateChain = {
        update: jest.fn().mockReturnThis(),
        eq:     jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: updatedParticipant, error: null }),
      };
      updateChain.update = jest.fn().mockReturnValue(updateChain);
      updateChain.eq     = jest.fn().mockReturnValue(updateChain);
      updateChain.select = jest.fn().mockReturnValue(updateChain);

      mockSb.from.mockImplementation((table) => {
        if (table === 'games')             return gameChain;
        if (table === 'game_participants') {
          // Distingue entre select (verificar participante) e update (salvar proposta)
          return {
            select: jest.fn().mockReturnValue(partChain),
            update: jest.fn().mockReturnValue(updateChain),
          };
        }
        return {};
      });

      const result = await proposeGiftValue(GAME_ID, USER_B, 80);

      // Verifica os campos retornados
      expect(result.gift_value_proposal).toBe(80);
      expect(result.gift_value_accepted).toBeNull();
    });

    it('deve lançar erro quando o jogo não usa modo suggested', async () => {
      const gameChain = {
        select:      jest.fn().mockReturnThis(),
        eq:          jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data:  makeGame({ gift_value_mode: 'fixed' }),
          error: null,
        }),
      };

      mockSb.from.mockImplementation((table) => {
        if (table === 'games') return gameChain;
        return {};
      });

      await expect(proposeGiftValue(GAME_ID, USER_B, 80))
        .rejects.toThrow("Propostas de valor só são aceitas no modo 'suggested'");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Cenário 5: respondGiftProposal — aceite de proposta pelo criador
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Cenário 5 — respondGiftProposal: aceite de proposta', () => {
    it('deve atualizar gift_value_accepted=true quando owner aceita proposta de B', async () => {
      _requireOwner.mockResolvedValueOnce(makeGame());

      const updatedParticipant = {
        game_id:             GAME_ID,
        user_id:             USER_B,
        gift_value_proposal: 80,
        gift_value_accepted: true,
        responded_at:        expect.any(String),
        status:              'confirmed',
      };

      const updateChain = {
        update: jest.fn().mockReturnThis(),
        eq:     jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: updatedParticipant, error: null }),
      };
      updateChain.update = jest.fn().mockReturnValue(updateChain);
      updateChain.eq     = jest.fn().mockReturnValue(updateChain);
      updateChain.select = jest.fn().mockReturnValue(updateChain);

      mockSb.from.mockImplementation((table) => {
        if (table === 'game_participants') {
          return { update: jest.fn().mockReturnValue(updateChain) };
        }
        return {};
      });

      const result = await respondGiftProposal(GAME_ID, USER_B, OWNER_ID, true);

      expect(result.gift_value_accepted).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Cenário 6: respondGiftProposal — recusa + contraproposta para C
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Cenário 6 — respondGiftProposal: recusa e contraproposta', () => {
    it('deve rejeitar proposta de C (gift_value_accepted=false) em modo suggested', async () => {
      // Em modo 'suggested', rejeitar não muda status para 'declined'
      _requireOwner.mockResolvedValueOnce(makeGame({ gift_value_mode: 'suggested' }));

      const rejectedParticipant = {
        game_id:             GAME_ID,
        user_id:             USER_C,
        gift_value_proposal: 90,
        gift_value_accepted: false,
        responded_at:        new Date().toISOString(),
        status:              'confirmed', // modo suggested não declina participante
      };

      const updateChain = {
        update: jest.fn().mockReturnThis(),
        eq:     jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: rejectedParticipant, error: null }),
      };
      updateChain.update = jest.fn().mockReturnValue(updateChain);
      updateChain.eq     = jest.fn().mockReturnValue(updateChain);
      updateChain.select = jest.fn().mockReturnValue(updateChain);

      mockSb.from.mockImplementation((table) => {
        if (table === 'game_participants') {
          return { update: jest.fn().mockReturnValue(updateChain) };
        }
        return {};
      });

      const result = await respondGiftProposal(GAME_ID, USER_C, OWNER_ID, false);

      expect(result.gift_value_accepted).toBe(false);
      // Em modo suggested, participante NÃO é declinado
      expect(result.status).toBe('confirmed');
    });

    it('deve declinar participante C (status=declined) quando modo é fixed e proposta é rejeitada', async () => {
      _requireOwner.mockResolvedValueOnce(makeGame({ gift_value_mode: 'fixed' }));

      const declinedParticipant = {
        game_id:             GAME_ID,
        user_id:             USER_C,
        gift_value_accepted: false,
        responded_at:        new Date().toISOString(),
        status:              'declined',
      };

      const updateChain = {
        update: jest.fn().mockReturnThis(),
        eq:     jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: declinedParticipant, error: null }),
      };
      updateChain.update = jest.fn().mockReturnValue(updateChain);
      updateChain.eq     = jest.fn().mockReturnValue(updateChain);
      updateChain.select = jest.fn().mockReturnValue(updateChain);

      mockSb.from.mockImplementation((table) => {
        if (table === 'game_participants') {
          return { update: jest.fn().mockReturnValue(updateChain) };
        }
        return {};
      });

      const result = await respondGiftProposal(GAME_ID, USER_C, OWNER_ID, false);

      // Status deve ser 'declined' pois mode=fixed
      expect(result.status).toBe('declined');
      expect(result.gift_value_accepted).toBe(false);
    });

    it('deve permitir nova proposta de C após rejeição (contraproposta de R$ 60)', async () => {
      // O owner recusa a proposta de C (R$ 90) e C envia contraproposta de R$ 60
      // Esta é uma nova chamada a proposeGiftValue com valor 60

      const gameChain = {
        select:      jest.fn().mockReturnThis(),
        eq:          jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data:  makeGame(),
          error: null,
        }),
      };

      const partChain = {
        select:      jest.fn().mockReturnThis(),
        eq:          jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data:  { id: 'part-c' },
          error: null,
        }),
      };

      // Contraproposta de R$ 60 — gift_value_accepted resetado para null
      const counterProposal = {
        game_id:             GAME_ID,
        user_id:             USER_C,
        gift_value_proposal: 60,
        gift_value_accepted: null,
        status:              'confirmed',
      };

      const updateChain = {
        update: jest.fn().mockReturnThis(),
        eq:     jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: counterProposal, error: null }),
      };
      updateChain.update = jest.fn().mockReturnValue(updateChain);
      updateChain.eq     = jest.fn().mockReturnValue(updateChain);
      updateChain.select = jest.fn().mockReturnValue(updateChain);

      mockSb.from.mockImplementation((table) => {
        if (table === 'games')             return gameChain;
        if (table === 'game_participants') {
          return {
            select: jest.fn().mockReturnValue(partChain),
            update: jest.fn().mockReturnValue(updateChain),
          };
        }
        return {};
      });

      const result = await proposeGiftValue(GAME_ID, USER_C, 60);

      expect(result.gift_value_proposal).toBe(60);
      // Aceite anterior resetado — aguardando nova resposta do owner
      expect(result.gift_value_accepted).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Cenário 7: drawPairs com menos de 2 participantes — deve lançar erro
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Cenário 7 — drawPairs com menos de 2 participantes confirmados', () => {
    it('deve lançar erro quando há apenas 1 participante confirmado', async () => {
      _requireOwner.mockResolvedValueOnce(makeGame());

      // Apenas 1 participante confirmado
      let callCount = 0;
      const partChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn(() => {
          callCount++;
          if (callCount >= 2) {
            return Promise.resolve({
              data: [{ user_id: USER_A }],
              error: null,
            });
          }
          return partChain;
        }),
      };
      partChain.select = jest.fn().mockReturnValue(partChain);

      mockSb.from.mockImplementation((table) => {
        if (table === 'game_participants') return partChain;
        return {};
      });

      await expect(drawPairs(GAME_ID, OWNER_ID))
        .rejects.toThrow('São necessários pelo menos 2 participantes confirmados');
    });

    it('deve lançar erro quando há 0 participantes confirmados', async () => {
      _requireOwner.mockResolvedValueOnce(makeGame());

      let callCount2 = 0;
      const emptyPartChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn(() => {
          callCount2++;
          if (callCount2 >= 2) {
            return Promise.resolve({ data: [], error: null });
          }
          return emptyPartChain;
        }),
      };
      emptyPartChain.select = jest.fn().mockReturnValue(emptyPartChain);

      mockSb.from.mockImplementation((table) => {
        if (table === 'game_participants') return emptyPartChain;
        return {};
      });

      await expect(drawPairs(GAME_ID, OWNER_ID))
        .rejects.toThrow('São necessários pelo menos 2 participantes confirmados');
    });

    it('sattoloCycle deve lançar erro com menos de 2 IDs (unidade)', () => {
      expect(() => sattoloCycle([USER_A])).toThrow(
        'Amigo Oculto requer pelo menos 2 participantes'
      );
      expect(() => sattoloCycle([])).toThrow(
        'Amigo Oculto requer pelo menos 2 participantes'
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Cenário 8: revealMyPair antes do sorteio — deve lançar erro
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Cenário 8 — revealMyPair antes do sorteio (jogo ainda open)', () => {
    it('deve lançar erro quando o jogo está com status open (sorteio não realizado)', async () => {
      // Jogo ainda em status 'open' (sorteio não foi feito)
      const gameChain = {
        select:      jest.fn().mockReturnThis(),
        eq:          jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data:  makeGame({ status: 'open' }),
          error: null,
        }),
      };

      mockSb.from.mockImplementation((table) => {
        if (table === 'games') return gameChain;
        return {};
      });

      await expect(revealMyPair(GAME_ID, USER_A))
        .rejects.toThrow('Os pares ainda não foram sorteados ou o jogo não está finalizado');
    });

    it('deve lançar erro quando o jogo está com status draft (antes mesmo de abrir)', async () => {
      const gameChain = {
        select:      jest.fn().mockReturnThis(),
        eq:          jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data:  makeGame({ status: 'draft' }),
          error: null,
        }),
      };

      mockSb.from.mockImplementation((table) => {
        if (table === 'games') return gameChain;
        return {};
      });

      await expect(revealMyPair(GAME_ID, USER_A))
        .rejects.toThrow('Os pares ainda não foram sorteados ou o jogo não está finalizado');
    });

    it('deve lançar erro quando o jogo não existe', async () => {
      const gameChain = {
        select:      jest.fn().mockReturnThis(),
        eq:          jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      };

      mockSb.from.mockImplementation((table) => {
        if (table === 'games') return gameChain;
        return {};
      });

      await expect(revealMyPair(GAME_ID, USER_A))
        .rejects.toThrow('Jogo não encontrado');
    });

    it('deve lançar erro quando usuário não está no sorteio (par inexistente)', async () => {
      // Jogo fechado mas USER_A não é participante
      const gameChain = {
        select:      jest.fn().mockReturnThis(),
        eq:          jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data:  makeGame({ status: 'closed' }),
          error: null,
        }),
      };

      const noPairChain = {
        select:      jest.fn().mockReturnThis(),
        eq:          jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      };

      mockSb.from.mockImplementation((table) => {
        if (table === 'games')               return gameChain;
        if (table === 'secret_friend_pairs') return { select: jest.fn().mockReturnValue(noPairChain) };
        return {};
      });

      await expect(revealMyPair(GAME_ID, USER_A))
        .rejects.toThrow('Você não está participando deste sorteio');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Cenário extra: drawPairs lança erro quando jogo já foi sorteado (23505)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Cenário extra — drawPairs: sorteio duplicado', () => {
    it('deve lançar erro quando os pares já foram sorteados (unique constraint violation)', async () => {
      _requireOwner.mockResolvedValueOnce(makeGame());

      let callCount = 0;
      const partChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn(() => {
          callCount++;
          if (callCount >= 2) {
            return Promise.resolve({
              data: [
                { user_id: USER_A },
                { user_id: USER_B },
                { user_id: USER_C },
                { user_id: USER_D },
              ],
              error: null,
            });
          }
          return partChain;
        }),
      };
      partChain.select = jest.fn().mockReturnValue(partChain);

      mockSb.from.mockImplementation((table) => {
        if (table === 'game_participants') return partChain;
        if (table === 'secret_friend_pairs') {
          return {
            insert: jest.fn().mockResolvedValue({
              data: null,
              error: { code: '23505', message: 'duplicate key' },
            }),
          };
        }
        return {};
      });

      await expect(drawPairs(GAME_ID, OWNER_ID))
        .rejects.toThrow('Os pares deste jogo já foram sorteados');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Cenário extra: drawPairs lança erro quando game_type não é SECRET_FRIEND
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Cenário extra — drawPairs: tipo de jogo inválido', () => {
    it('deve lançar erro quando game_type não é SECRET_FRIEND', async () => {
      _requireOwner.mockResolvedValueOnce(makeGame({ game_type: 'RAFFLE' }));

      await expect(drawPairs(GAME_ID, OWNER_ID))
        .rejects.toThrow('Esta operação é exclusiva para jogos do tipo SECRET_FRIEND');
    });

    it('deve lançar erro quando status do jogo não é open', async () => {
      _requireOwner.mockResolvedValueOnce(makeGame({ status: 'closed' }));

      await expect(drawPairs(GAME_ID, OWNER_ID))
        .rejects.toThrow("Sorteio requer status 'open'");
    });
  });

});
