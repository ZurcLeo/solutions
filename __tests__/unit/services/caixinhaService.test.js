jest.mock('../../../models/Caixinhas');
jest.mock('../../../logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const Caixinha = require('../../../models/Caixinhas');
const caixinhaService = require('../../../services/caixinhaService');

describe('caixinhaService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── getAllCaixinhas ────────────────────────────────────────────────────────
  describe('getAllCaixinhas', () => {
    it('deve lançar erro quando userId não é fornecido', async () => {
      await expect(caixinhaService.getAllCaixinhas(null))
        .rejects.toThrow('ID do usuário não fornecido');
    });

    it('deve retornar lista de caixinhas para userId válido', async () => {
      const caixinhas = [{ id: 'cx1' }, { id: 'cx2' }];
      Caixinha.getAll.mockResolvedValue(caixinhas);

      const result = await caixinhaService.getAllCaixinhas('user-1');

      expect(Caixinha.getAll).toHaveBeenCalledWith('user-1');
      expect(result).toEqual(caixinhas);
    });

    it('deve propagar erro quando Caixinha.getAll falha', async () => {
      Caixinha.getAll.mockRejectedValue(new Error('DB error'));

      await expect(caixinhaService.getAllCaixinhas('user-1'))
        .rejects.toThrow('DB error');
    });
  });

  // ─── createCaixinha ────────────────────────────────────────────────────────
  describe('createCaixinha', () => {
    it('deve criar e retornar a caixinha', async () => {
      const data = { name: 'Férias', adminId: 'admin-1' };
      const created = { id: 'cx-new', ...data };
      Caixinha.create.mockResolvedValue(created);

      const result = await caixinhaService.createCaixinha(data);

      expect(Caixinha.create).toHaveBeenCalledWith(data);
      expect(result).toEqual(created);
    });

    it('deve propagar erro quando Caixinha.create falha', async () => {
      Caixinha.create.mockRejectedValue(new Error('create failed'));

      await expect(caixinhaService.createCaixinha({}))
        .rejects.toThrow('create failed');
    });
  });

  // ─── getCaixinhaById ───────────────────────────────────────────────────────
  describe('getCaixinhaById', () => {
    it('deve retornar a caixinha pelo id', async () => {
      const caixinha = { id: 'cx-1', name: 'Test' };
      Caixinha.getById.mockResolvedValue(caixinha);

      const result = await caixinhaService.getCaixinhaById('cx-1');

      expect(Caixinha.getById).toHaveBeenCalledWith('cx-1');
      expect(result).toEqual(caixinha);
    });

    it('deve propagar erro quando caixinha não existe', async () => {
      Caixinha.getById.mockRejectedValue(new Error('not found'));

      await expect(caixinhaService.getCaixinhaById('cx-999'))
        .rejects.toThrow('not found');
    });
  });

  // ─── updateCaixinha ────────────────────────────────────────────────────────
  describe('updateCaixinha', () => {
    it('deve atualizar e retornar a caixinha', async () => {
      const updated = { id: 'cx-1', name: 'Novo Nome' };
      Caixinha.update.mockResolvedValue(updated);

      const result = await caixinhaService.updateCaixinha('cx-1', { name: 'Novo Nome' });

      expect(Caixinha.update).toHaveBeenCalledWith('cx-1', { name: 'Novo Nome' });
      expect(result).toEqual(updated);
    });
  });

  // ─── deleteCaixinha ────────────────────────────────────────────────────────
  describe('deleteCaixinha', () => {
    it('deve chamar Caixinha.delete com o id correto', async () => {
      Caixinha.delete.mockResolvedValue();

      await caixinhaService.deleteCaixinha('cx-1');

      expect(Caixinha.delete).toHaveBeenCalledWith('cx-1');
    });

    it('deve propagar erro quando deleção falha', async () => {
      Caixinha.delete.mockRejectedValue(new Error('delete failed'));

      await expect(caixinhaService.deleteCaixinha('cx-1'))
        .rejects.toThrow('delete failed');
    });
  });

  // ─── addMembro ─────────────────────────────────────────────────────────────
  describe('addMembro', () => {
    it('deve lançar erro quando usuário já é membro', async () => {
      Caixinha.getById.mockResolvedValue({
        id: 'cx-1',
        members: ['user-1', 'user-2'],
      });

      await expect(caixinhaService.addMembro('cx-1', 'user-1'))
        .rejects.toThrow('Usuário já é membro desta caixinha');
    });

    it('deve adicionar membro e retornar caixinha atualizada', async () => {
      const caixinha = { id: 'cx-1', members: ['admin-1'] };
      const updated = { id: 'cx-1', members: ['admin-1', 'user-new'] };
      Caixinha.getById.mockResolvedValue(caixinha);
      Caixinha.update.mockResolvedValue(updated);

      const result = await caixinhaService.addMembro('cx-1', 'user-new');

      expect(Caixinha.update).toHaveBeenCalledWith(
        'cx-1',
        expect.objectContaining({ membros: expect.arrayContaining(['admin-1', 'user-new']) })
      );
      expect(result).toEqual(updated);
    });
  });

  // ─── updateSaldo ───────────────────────────────────────────────────────────
  describe('updateSaldo', () => {
    describe('INVARIANTE: saldoTotal nunca vai negativo', () => {
      it('deve lançar erro quando debito excede saldoTotal', async () => {
        Caixinha.getById.mockResolvedValue({ id: 'cx-1', saldoTotal: 300 });

        await expect(caixinhaService.updateSaldo('cx-1', 500, 'debito'))
          .rejects.toThrow('Saldo insuficiente');

        expect(Caixinha.update).not.toHaveBeenCalled();
      });

      it('deve lançar erro quando debito é igual ao saldo (resultado seria zero — borda)', async () => {
        // saldo 0 não é "negativo", então este caso deve passar
        // testar que saldo exatamente igual ao valor é permitido
        const updated = { id: 'cx-1', saldoTotal: 0 };
        Caixinha.getById.mockResolvedValue({ id: 'cx-1', saldoTotal: 100 });
        Caixinha.update.mockResolvedValue(updated);

        const result = await caixinhaService.updateSaldo('cx-1', 100, 'debito');

        expect(Caixinha.update).toHaveBeenCalledWith('cx-1', { saldoTotal: 0 });
        expect(result).toEqual(updated);
      });
    });

    it('deve debitar saldo corretamente quando suficiente', async () => {
      const updated = { id: 'cx-1', saldoTotal: 900 };
      Caixinha.getById.mockResolvedValue({ id: 'cx-1', saldoTotal: 1000 });
      Caixinha.update.mockResolvedValue(updated);

      const result = await caixinhaService.updateSaldo('cx-1', 100, 'debito');

      expect(Caixinha.update).toHaveBeenCalledWith('cx-1', { saldoTotal: 900 });
      expect(result).toEqual(updated);
    });

    it('deve creditar saldo corretamente', async () => {
      const updated = { id: 'cx-1', saldoTotal: 1100 };
      Caixinha.getById.mockResolvedValue({ id: 'cx-1', saldoTotal: 1000 });
      Caixinha.update.mockResolvedValue(updated);

      const result = await caixinhaService.updateSaldo('cx-1', 100, 'credito');

      expect(Caixinha.update).toHaveBeenCalledWith('cx-1', { saldoTotal: 1100 });
      expect(result).toEqual(updated);
    });

    it('deve propagar erro quando Caixinha.getById falha', async () => {
      Caixinha.getById.mockRejectedValue(new Error('cx not found'));

      await expect(caixinhaService.updateSaldo('cx-999', 100, 'credito'))
        .rejects.toThrow('cx not found');
    });
  });
});
