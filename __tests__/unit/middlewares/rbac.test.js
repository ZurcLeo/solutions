jest.mock('../../../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../../services/userRoleService', () => ({
  checkUserHasPermission: jest.fn(),
  checkUserHasRole: jest.fn(),
  getUserRoles: jest.fn(),
}));
jest.mock('../../../models/User', () => ({ getById: jest.fn() }));
jest.mock('../../../models/Role', () => ({ getById: jest.fn() }));

const userRoleService = require('../../../services/userRoleService');
const User = require('../../../models/User');
const Role = require('../../../models/Role');
const { checkPermission, checkRole, isAdmin, injectRoleInfo, checkBankValidation } = require('../../../middlewares/rbac');

const mockReq = (overrides = {}) => ({
  uid: 'user-123',
  user: { uid: 'user-123' },
  params: {},
  path: '/test',
  ...overrides,
});

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('rbac middlewares', () => {
  let next;

  beforeEach(() => {
    next = jest.fn();
    jest.clearAllMocks();
  });

  describe('checkPermission', () => {
    it('deve retornar 401 quando req.uid está ausente', async () => {
      const req = mockReq({ uid: undefined });
      const res = mockRes();
      const middleware = checkPermission('read:resource');

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Autenticação necessária' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('deve retornar 403 quando usuário não tem a permissão', async () => {
      userRoleService.checkUserHasPermission.mockResolvedValue(false);
      const req = mockReq();
      const res = mockRes();
      const middleware = checkPermission('admin:write');

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('deve chamar next() quando usuário tem a permissão', async () => {
      userRoleService.checkUserHasPermission.mockResolvedValue(true);
      const req = mockReq();
      const res = mockRes();
      const middleware = checkPermission('read:resource');

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('deve retornar 500 quando ocorre erro interno', async () => {
      userRoleService.checkUserHasPermission.mockRejectedValue(new Error('DB error'));
      const req = mockReq();
      const res = mockRes();
      const middleware = checkPermission('read:resource');

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(next).not.toHaveBeenCalled();
    });

    it('deve usar contextType e resourceId personalizados', async () => {
      userRoleService.checkUserHasPermission.mockResolvedValue(true);
      const getResourceId = (req) => req.params.caixinhaId;
      const req = mockReq({ params: { caixinhaId: 'cx-123' } });
      const res = mockRes();
      const middleware = checkPermission('caixinha:manage', 'caixinha', getResourceId);

      await middleware(req, res, next);

      expect(userRoleService.checkUserHasPermission).toHaveBeenCalledWith(
        'user-123', 'caixinha:manage', 'caixinha', 'cx-123'
      );
    });
  });

  describe('checkRole', () => {
    it('deve retornar 401 quando req.uid está ausente', async () => {
      const req = mockReq({ uid: undefined });
      const res = mockRes();
      const middleware = checkRole('Admin');

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('deve retornar 403 quando usuário não tem a role', async () => {
      userRoleService.checkUserHasRole.mockResolvedValue(false);
      const req = mockReq();
      const res = mockRes();
      const middleware = checkRole('Admin');

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('deve chamar next() quando usuário tem a role', async () => {
      userRoleService.checkUserHasRole.mockResolvedValue(true);
      const req = mockReq();
      const res = mockRes();
      const middleware = checkRole('Member');

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('deve retornar 500 quando ocorre erro interno', async () => {
      userRoleService.checkUserHasRole.mockRejectedValue(new Error('DB error'));
      const req = mockReq();
      const res = mockRes();
      const middleware = checkRole('Admin');

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('isAdmin', () => {
    it('deve retornar 401 quando req.uid está ausente', async () => {
      const req = mockReq({ uid: undefined });
      const res = mockRes();

      await isAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('deve retornar 403 quando usuário não existe no banco', async () => {
      User.getById.mockResolvedValue(null);
      const req = mockReq();
      const res = mockRes();

      await isAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('deve chamar next() e setar req.user.isAdmin quando tem Admin role', async () => {
      User.getById.mockResolvedValue({ uid: 'user-123', isOwnerOrAdmin: false });
      userRoleService.checkUserHasRole.mockResolvedValue(true);
      const req = mockReq();
      const res = mockRes();

      await isAdmin(req, res, next);

      expect(req.user.isAdmin).toBe(true);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('deve chamar next() quando isOwnerOrAdmin === true (sistema legado)', async () => {
      User.getById.mockResolvedValue({ uid: 'user-123', isOwnerOrAdmin: true });
      userRoleService.checkUserHasRole.mockResolvedValue(false);
      const req = mockReq();
      const res = mockRes();

      await isAdmin(req, res, next);

      expect(req.user.isAdmin).toBe(true);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('deve retornar 403 quando usuário não é admin por nenhum mecanismo', async () => {
      User.getById.mockResolvedValue({ uid: 'user-123', isOwnerOrAdmin: false });
      userRoleService.checkUserHasRole.mockResolvedValue(false);
      const req = mockReq();
      const res = mockRes();

      await isAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('deve retornar 500 quando ocorre erro interno', async () => {
      User.getById.mockRejectedValue(new Error('DB error'));
      const req = mockReq();
      const res = mockRes();

      await isAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('injectRoleInfo', () => {
    it('deve chamar next() sem popular rbac quando uid está ausente', async () => {
      const req = mockReq({ uid: undefined });
      const res = mockRes();

      await injectRoleInfo(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.rbac).toBeUndefined();
    });

    it('deve popular req.rbac.roles e req.rbac.roleInfos quando uid presente', async () => {
      const userRoles = [{ roleId: 'role-1', context: { type: 'global' }, validationStatus: 'validated' }];
      userRoleService.getUserRoles.mockResolvedValue(userRoles);
      Role.getById.mockResolvedValue({ name: 'Member' });

      const req = mockReq();
      const res = mockRes();

      await injectRoleInfo(req, res, next);

      expect(req.rbac.roles).toEqual(userRoles);
      expect(req.rbac.roleInfos).toHaveLength(1);
      expect(req.rbac.roleInfos[0].name).toBe('Member');
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('deve criar req.hasRole() helper funcional', async () => {
      const userRoles = [
        {
          roleId: 'role-1',
          context: { type: 'caixinha', resourceId: 'cx-1' },
          validationStatus: 'validated',
        },
      ];
      userRoleService.getUserRoles.mockResolvedValue(userRoles);
      Role.getById.mockResolvedValue({ name: 'Admin' });

      const req = mockReq();
      const res = mockRes();

      await injectRoleInfo(req, res, next);

      expect(req.hasRole('Admin', 'caixinha', 'cx-1')).toBe(true);
      expect(req.hasRole('Admin', 'caixinha', 'cx-999')).toBe(false);
      expect(req.hasRole('Member', 'caixinha', 'cx-1')).toBe(false);
    });

    it('deve chamar next() mesmo quando ocorre erro (continua sem rbac)', async () => {
      userRoleService.getUserRoles.mockRejectedValue(new Error('DB error'));
      const req = mockReq();
      const res = mockRes();

      await injectRoleInfo(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('checkBankValidation', () => {
    it('deve retornar 401 quando uid está ausente', async () => {
      const req = mockReq({ uid: undefined });
      const res = mockRes();
      const middleware = checkBankValidation();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('deve retornar 400 quando caixinhaId não é fornecido', async () => {
      const req = mockReq({ params: {} });
      const res = mockRes();
      const middleware = checkBankValidation(() => null);

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'ID da caixinha não fornecido' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('deve chamar next() quando usuário tem role validada para a caixinha', async () => {
      userRoleService.getUserRoles.mockResolvedValue([
        { validationStatus: 'validated' },
      ]);
      const req = mockReq({ params: { caixinhaId: 'cx-123' } });
      const res = mockRes();
      const middleware = checkBankValidation();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('deve retornar 403 com requiresValidation quando tem roles mas nenhuma validada', async () => {
      userRoleService.getUserRoles.mockResolvedValue([
        { validationStatus: 'pending' },
      ]);
      const req = mockReq({ params: { caixinhaId: 'cx-123' } });
      const res = mockRes();
      const middleware = checkBankValidation();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Validação bancária pendente',
          requiresValidation: true,
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('deve retornar 403 quando usuário não tem nenhuma role na caixinha', async () => {
      userRoleService.getUserRoles.mockResolvedValue([]);
      const req = mockReq({ params: { caixinhaId: 'cx-123' } });
      const res = mockRes();
      const middleware = checkBankValidation();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Você não tem acesso a esta caixinha' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('deve retornar 500 quando ocorre erro interno', async () => {
      userRoleService.getUserRoles.mockRejectedValue(new Error('DB error'));
      const req = mockReq({ params: { caixinhaId: 'cx-123' } });
      const res = mockRes();
      const middleware = checkBankValidation();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
