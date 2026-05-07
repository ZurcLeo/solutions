jest.mock('../../../models/Dispute');
jest.mock('../../../models/Caixinhas');
jest.mock('../../../logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const Dispute = require('../../../models/Dispute');
const Caixinha = require('../../../models/Caixinhas');
const disputeService = require('../../../services/disputeService');

const PAST = new Date(Date.now() - 10000).toISOString();
const FUTURE = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

const makeCaixinha = (overrides = {}) => ({
  id: 'cx-1',
  adminId: 'admin-1',
  members: ['admin-1', 'user-2', 'user-3', 'user-4'],
  governanceModel: {
    type: 'GROUP_DISPUTE',
    quorumType: 'PERCENTAGE',
    quorumValue: 51,
    adminHasTiebreaker: true,
  },
  ...overrides,
});

const makeDispute = (overrides = {}) => ({
  id: 'd-1',
  caixinhaId: 'cx-1',
  status: 'OPEN',
  expiresAt: FUTURE,
  votes: [],
  type: 'RULE_CHANGE',
  proposedBy: 'user-2',
  proposedChanges: {},
  ...overrides,
});

describe('disputeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── processDisputeResult ──────────────────────────────────────────────────
  describe('processDisputeResult', () => {
    describe('INVARIANTE: disputa não reabre se já resolvida', () => {
      it('deve retornar disputa sem modificações quando status não é OPEN', async () => {
        const resolved = makeDispute({ status: 'APPROVED' });
        Dispute.getById.mockResolvedValue(resolved);
        Caixinha.getById.mockResolvedValue(makeCaixinha());

        const result = await disputeService.processDisputeResult('cx-1', 'd-1');

        expect(result).toBe(resolved);
        expect(Dispute.update).not.toHaveBeenCalled();
      });
    });

    describe('INVARIANTE: disputa expirada vira EXPIRED (não REJECTED)', () => {
      it('deve atualizar status para EXPIRED quando expiresAt passou', async () => {
        const expired = makeDispute({ expiresAt: PAST });
        const updatedExpired = { ...expired, status: 'EXPIRED' };
        Dispute.getById.mockResolvedValue(expired);
        Caixinha.getById.mockResolvedValue(makeCaixinha());
        Dispute.update.mockResolvedValue(updatedExpired);

        const result = await disputeService.processDisputeResult('cx-1', 'd-1');

        expect(Dispute.update).toHaveBeenCalledWith(
          'cx-1', 'd-1',
          expect.objectContaining({ status: 'EXPIRED' })
        );
        expect(result.status).toBe('EXPIRED');
      });
    });

    describe('INVARIANTE: disputa permanece OPEN sem quórum', () => {
      it('deve manter disputa OPEN quando quórum percentual não é atingido', async () => {
        // 4 membros, 51% necessário = 2.04 → precisam de 3 votos
        // 2 votos = 50% < 51% → sem quórum
        const dispute = makeDispute({ votes: [
          { userId: 'user-2', vote: true },
          { userId: 'user-3', vote: false },
        ]});
        Dispute.getById.mockResolvedValue(dispute);
        Caixinha.getById.mockResolvedValue(makeCaixinha()); // 4 members

        const result = await disputeService.processDisputeResult('cx-1', 'd-1');

        expect(Dispute.update).not.toHaveBeenCalled();
        expect(result).toBe(dispute);
      });

      it('deve processar disputa quando quórum COUNT é atingido', async () => {
        const dispute = makeDispute({ votes: [
          { userId: 'admin-1', vote: true },
          { userId: 'user-2', vote: true },
          { userId: 'user-3', vote: false },
        ]});
        const caixinha = makeCaixinha({
          governanceModel: {
            type: 'GROUP_DISPUTE',
            quorumType: 'COUNT',
            quorumValue: 3,
            adminHasTiebreaker: false,
          },
        });
        Dispute.getById.mockResolvedValue(dispute);
        Caixinha.getById.mockResolvedValue(caixinha);
        Dispute.update.mockResolvedValue({ ...dispute, status: 'APPROVED' });
        Caixinha.update.mockResolvedValue({});

        const result = await disputeService.processDisputeResult('cx-1', 'd-1');

        expect(Dispute.update).toHaveBeenCalledWith(
          'cx-1', 'd-1',
          expect.objectContaining({ status: 'APPROVED' })
        );
      });
    });

    describe('aprovação e rejeição por maioria', () => {
      it('deve aprovar disputa quando maioria dos votos é favorável', async () => {
        const dispute = makeDispute({ votes: [
          { userId: 'admin-1', vote: true },
          { userId: 'user-2', vote: true },
          { userId: 'user-3', vote: false },
        ]});
        Dispute.getById.mockResolvedValue(dispute);
        Caixinha.getById.mockResolvedValue(makeCaixinha()); // 4 members, 75% ≥ 51%
        Dispute.update.mockResolvedValue({ ...dispute, status: 'APPROVED' });
        Caixinha.update.mockResolvedValue({});

        const result = await disputeService.processDisputeResult('cx-1', 'd-1');

        expect(Dispute.update).toHaveBeenCalledWith(
          'cx-1', 'd-1',
          expect.objectContaining({ status: 'APPROVED' })
        );
      });

      it('deve rejeitar disputa quando maioria dos votos é contrária', async () => {
        const dispute = makeDispute({ votes: [
          { userId: 'admin-1', vote: false },
          { userId: 'user-2', vote: false },
          { userId: 'user-3', vote: true },
        ]});
        Dispute.getById.mockResolvedValue(dispute);
        Caixinha.getById.mockResolvedValue(makeCaixinha());
        Dispute.update.mockResolvedValue({ ...dispute, status: 'REJECTED' });

        const result = await disputeService.processDisputeResult('cx-1', 'd-1');

        expect(Dispute.update).toHaveBeenCalledWith(
          'cx-1', 'd-1',
          expect.objectContaining({ status: 'REJECTED' })
        );
      });
    });

    describe('INVARIANTE: desempate pelo admin', () => {
      it('deve usar voto do admin para desempate quando adminHasTiebreaker é true', async () => {
        // 4 votos: 2 a favor, 2 contra → empate → admin vota TRUE → APPROVED
        const dispute = makeDispute({ votes: [
          { userId: 'admin-1', vote: true },
          { userId: 'user-2', vote: true },
          { userId: 'user-3', vote: false },
          { userId: 'user-4', vote: false },
        ]});
        Dispute.getById.mockResolvedValue(dispute);
        Caixinha.getById.mockResolvedValue(makeCaixinha()); // adminId: 'admin-1'
        Dispute.update.mockResolvedValue({ ...dispute, status: 'APPROVED' });
        Caixinha.update.mockResolvedValue({});

        await disputeService.processDisputeResult('cx-1', 'd-1');

        expect(Dispute.update).toHaveBeenCalledWith(
          'cx-1', 'd-1',
          expect.objectContaining({ status: 'APPROVED' })
        );
      });

      it('deve rejeitar no empate quando admin vota contra', async () => {
        const dispute = makeDispute({ votes: [
          { userId: 'admin-1', vote: false },
          { userId: 'user-2', vote: true },
          { userId: 'user-3', vote: true },
          { userId: 'user-4', vote: false },
        ]});
        Dispute.getById.mockResolvedValue(dispute);
        Caixinha.getById.mockResolvedValue(makeCaixinha());
        Dispute.update.mockResolvedValue({ ...dispute, status: 'REJECTED' });

        await disputeService.processDisputeResult('cx-1', 'd-1');

        expect(Dispute.update).toHaveBeenCalledWith(
          'cx-1', 'd-1',
          expect.objectContaining({ status: 'REJECTED' })
        );
      });
    });
  });

  // ─── checkDisputeRequirement ───────────────────────────────────────────────
  describe('checkDisputeRequirement', () => {
    it('deve retornar requiresDispute: false quando admin é único membro', async () => {
      Caixinha.getById.mockResolvedValue({
        ...makeCaixinha(),
        members: ['admin-1'],
      });

      const result = await disputeService.checkDisputeRequirement('cx-1', 'RULE_CHANGE', 'admin-1');

      expect(result.requiresDispute).toBe(false);
      expect(result.reason).toBe('ADMIN_ONLY_MEMBER');
    });

    it('deve retornar requiresDispute: false para modelo ADMIN_CONTROL quando solicitante é admin', async () => {
      Caixinha.getById.mockResolvedValue({
        ...makeCaixinha(),
        governanceModel: { type: 'ADMIN_CONTROL' },
      });

      const result = await disputeService.checkDisputeRequirement('cx-1', 'RULE_CHANGE', 'admin-1');

      expect(result.requiresDispute).toBe(false);
      expect(result.reason).toBe('ADMIN_CONTROL');
    });

    it('deve retornar requiresDispute: false para INITIAL_CONFIG pelo admin', async () => {
      Caixinha.getById.mockResolvedValue(makeCaixinha());

      const result = await disputeService.checkDisputeRequirement('cx-1', 'INITIAL_CONFIG', 'admin-1');

      expect(result.requiresDispute).toBe(false);
      expect(result.reason).toBe('INITIAL_CONFIG');
    });

    it('deve retornar requiresDispute: true para caso padrão (membro não-admin)', async () => {
      Caixinha.getById.mockResolvedValue(makeCaixinha());

      const result = await disputeService.checkDisputeRequirement('cx-1', 'RULE_CHANGE', 'user-2');

      expect(result.requiresDispute).toBe(true);
      expect(result.reason).toBe('DEFAULT_POLICY');
    });
  });

  // ─── voteOnDispute ─────────────────────────────────────────────────────────
  describe('voteOnDispute', () => {
    it('deve lançar erro quando votante não é membro da caixinha', async () => {
      Caixinha.getById.mockResolvedValue(makeCaixinha());

      await expect(
        disputeService.voteOnDispute('cx-1', 'd-1', { userId: 'outsider-99', vote: true })
      ).rejects.toThrow('Usuário não é membro desta caixinha');

      expect(Dispute.addVote).not.toHaveBeenCalled();
    });

    it('deve registrar voto e processar resultado para membro válido', async () => {
      const caixinha = makeCaixinha();
      const dispute = makeDispute({ votes: [
        { userId: 'admin-1', vote: true },
        { userId: 'user-2', vote: true },
        { userId: 'user-3', vote: true },
      ]});
      Caixinha.getById.mockResolvedValue(caixinha);
      Dispute.addVote.mockResolvedValue();
      Dispute.getById.mockResolvedValue(dispute);
      Dispute.update.mockResolvedValue({ ...dispute, status: 'APPROVED' });
      Caixinha.update.mockResolvedValue({});

      const result = await disputeService.voteOnDispute(
        'cx-1', 'd-1',
        { userId: 'user-2', vote: true }
      );

      expect(Dispute.addVote).toHaveBeenCalledWith('cx-1', 'd-1', { userId: 'user-2', vote: true });
    });
  });

  // ─── cancelDispute ─────────────────────────────────────────────────────────
  describe('cancelDispute', () => {
    it('deve lançar erro quando usuário não é admin nem proponente', async () => {
      const dispute = makeDispute({ proposedBy: 'user-2' });
      Dispute.getById.mockResolvedValue(dispute);
      Caixinha.getById.mockResolvedValue(makeCaixinha()); // adminId: 'admin-1'

      await expect(
        disputeService.cancelDispute('cx-1', 'd-1', 'user-3', 'motivo')
      ).rejects.toThrow('Usuário não tem permissão para cancelar esta disputa');
    });

    it('deve cancelar disputa quando solicitante é admin', async () => {
      const dispute = makeDispute({ proposedBy: 'user-2' });
      const cancelled = { ...dispute, status: 'CANCELLED' };
      Dispute.getById.mockResolvedValue(dispute);
      Caixinha.getById.mockResolvedValue(makeCaixinha());
      Dispute.update.mockResolvedValue(cancelled);

      const result = await disputeService.cancelDispute('cx-1', 'd-1', 'admin-1', 'motivo');

      expect(Dispute.update).toHaveBeenCalledWith(
        'cx-1', 'd-1',
        expect.objectContaining({ status: 'CANCELLED', cancelledBy: 'admin-1' })
      );
      expect(result.status).toBe('CANCELLED');
    });

    it('deve cancelar disputa quando solicitante é o proponente', async () => {
      const dispute = makeDispute({ proposedBy: 'user-2' });
      Dispute.getById.mockResolvedValue(dispute);
      Caixinha.getById.mockResolvedValue(makeCaixinha());
      Dispute.update.mockResolvedValue({ ...dispute, status: 'CANCELLED' });

      await disputeService.cancelDispute('cx-1', 'd-1', 'user-2', 'desisti');

      expect(Dispute.update).toHaveBeenCalledWith(
        'cx-1', 'd-1',
        expect.objectContaining({ status: 'CANCELLED', cancelledBy: 'user-2' })
      );
    });
  });

  // ─── createDispute ─────────────────────────────────────────────────────────
  describe('createDispute', () => {
    it('deve criar disputa injetando caixinhaId no objeto', async () => {
      const data = { title: 'Vote', type: 'RULE_CHANGE', proposedBy: 'user-2' };
      const created = { id: 'd-new', caixinhaId: 'cx-1', ...data };
      Dispute.create.mockResolvedValue(created);

      const result = await disputeService.createDispute('cx-1', data);

      expect(Dispute.create).toHaveBeenCalledWith(
        expect.objectContaining({ ...data, caixinhaId: 'cx-1' })
      );
      expect(result).toEqual(created);
    });
  });

  // ─── createRuleChangeDispute ───────────────────────────────────────────────
  describe('createRuleChangeDispute', () => {
    it('deve lançar erro quando regras propostas são idênticas às atuais', async () => {
      const rules = { maxLoan: 1000, interestRate: 5 };

      await expect(
        disputeService.createRuleChangeDispute('cx-1', 'user-2', rules, rules)
      ).rejects.toThrow('Nenhuma alteração detectada');
    });

    it('deve criar disputa RULE_CHANGE com diff correto', async () => {
      const current = { maxLoan: 1000, interestRate: 5 };
      const proposed = { maxLoan: 2000, interestRate: 5 }; // só maxLoan mudou
      const created = { id: 'd-new', type: 'RULE_CHANGE', caixinhaId: 'cx-1' };
      Dispute.create.mockResolvedValue(created);

      const result = await disputeService.createRuleChangeDispute(
        'cx-1', 'user-2', current, proposed
      );

      expect(Dispute.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'RULE_CHANGE',
          caixinhaId: 'cx-1',
          proposedBy: 'user-2',
          proposedChanges: {
            maxLoan: { from: 1000, to: 2000 },
          },
        })
      );
    });
  });

  // ─── getDisputeVoteInfo ────────────────────────────────────────────────────
  describe('getDisputeVoteInfo', () => {
    it('deve lançar erro quando disputa não existe', async () => {
      Dispute.getById.mockResolvedValue(null);

      await expect(
        disputeService.getDisputeVoteInfo('cx-1', 'd-999', 'user-1')
      ).rejects.toThrow('Disputa não encontrada');
    });

    it('deve retornar voteInfo com estatísticas corretas', async () => {
      const dispute = makeDispute({
        votes: [
          { userId: 'admin-1', vote: true, comment: '', timestamp: new Date().toISOString() },
          { userId: 'user-2', vote: false, comment: '', timestamp: new Date().toISOString() },
        ],
      });
      Dispute.getById.mockResolvedValue(dispute);
      Caixinha.getById.mockResolvedValue(makeCaixinha()); // 4 members

      const info = await disputeService.getDisputeVoteInfo('cx-1', 'd-1', 'user-3');

      expect(info.hasUserVoted).toBe(false);
      expect(info.userVote).toBeNull();
      expect(info.canVote).toBe(true);
      expect(info.statistics.totalVotes).toBe(2);
      expect(info.statistics.positiveVotes).toBe(1);
      expect(info.statistics.negativeVotes).toBe(1);
      expect(info.statistics.totalMembers).toBe(4);
      expect(info.statistics.quorumPercentage).toBe(50);
    });

    it('deve indicar que usuário já votou e não pode votar novamente', async () => {
      const dispute = makeDispute({
        votes: [
          { userId: 'user-2', vote: true, comment: 'ok', timestamp: new Date().toISOString() },
        ],
      });
      Dispute.getById.mockResolvedValue(dispute);
      Caixinha.getById.mockResolvedValue(makeCaixinha());

      const info = await disputeService.getDisputeVoteInfo('cx-1', 'd-1', 'user-2');

      expect(info.hasUserVoted).toBe(true);
      expect(info.userVote).toMatchObject({ vote: true });
      expect(info.canVote).toBe(false);
    });

    it('deve marcar disputa como expirada e inativa', async () => {
      const dispute = makeDispute({ expiresAt: PAST });
      Dispute.getById.mockResolvedValue(dispute);
      Caixinha.getById.mockResolvedValue(makeCaixinha());

      const info = await disputeService.getDisputeVoteInfo('cx-1', 'd-1', 'user-2');

      expect(info.isExpired).toBe(true);
      expect(info.isActive).toBe(false);
      expect(info.canVote).toBe(false);
    });
  });
});
