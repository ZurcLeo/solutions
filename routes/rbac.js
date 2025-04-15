// routes/rbac.js
const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/auth');
const { isAdmin, checkPermission, checkRole } = require('../middlewares/rbac');
const roleController = require('../controllers/roleController');
const permissionController = require('../controllers/permissionController');
const userRoleController = require('../controllers/userRoleController');
const { rateLimiter } = require('../middlewares/rateLimiter');
const validate = require('../middlewares/validate');
const rbacSchemas = require('../schemas/rbacSchema');
const { logger } = require('../logger');
const { healthCheck } = require('../middlewares/healthMiddleware');

// Nome da rota para logging
const ROUTE_NAME = 'rbac';

// Aplicar middleware de health check a todas as rotas de RBAC
router.use(healthCheck(ROUTE_NAME));

// Middleware de log para todas as requisições
router.use((req, res, next) => {
  logger.info(`[ROUTE] Requisição recebida em ${ROUTE_NAME}`, {
    path: req.path,
    method: req.method,
    userId: req.user?.uid,
    params: req.params,
    body: req.body,
    query: req.query,
  });
  next();
});

// Todos os endpoints requerem autenticação
router.use(verifyToken);
router.use(rateLimiter);

// ----- Rotas de Inicialização -----
/**
 * @swagger
 * /rbac/initialize:
 *   post:
 *     summary: Inicializa o sistema de RBAC
 *     description: Cria roles e permissões padrão e configura suas associações
 *     tags:
 *       - RBAC
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Sistema inicializado com sucesso
 *       500:
 *         description: Erro ao inicializar sistema
 */
router.post('/initialize', isAdmin, roleController.initializeSystem);

/**
 * @swagger
 * /rbac/migrate-admin-users:
 *   post:
 *     summary: Migra usuários admin
 *     description: Migra usuários com flag isOwnerOrAdmin para role Admin
 *     tags:
 *       - RBAC
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Migração concluída com sucesso
 *       500:
 *         description: Erro na migração
 */
router.post('/migrate-admin-users', isAdmin, userRoleController.migrateAdminUsers);

// ----- Rotas de Roles -----
/**
 * @swagger
 * /rbac/roles:
 *   get:
 *     summary: Lista todas as roles
 *     tags:
 *       - RBAC
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de roles
 *       500:
 *         description: Erro ao buscar roles
 */
router.get('/roles', checkPermission('admin:access'), roleController.getAllRoles);

/**
 * @swagger
 * /rbac/roles/{id}:
 *   get:
 *     summary: Obtém uma role pelo ID
 *     tags:
 *       - RBAC
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Role encontrada
 *       404:
 *         description: Role não encontrada
 *       500:
 *         description: Erro ao buscar role
 */
router.get('/roles/:id', checkPermission('admin:access'), roleController.getRoleById);

/**
 * @swagger
 * /rbac/roles:
 *   post:
 *     summary: Cria uma nova role
 *     tags:
 *       - RBAC
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RoleInput'
 *     responses:
 *       201:
 *         description: Role criada com sucesso
 *       409:
 *         description: Role já existe
 *       500:
 *         description: Erro ao criar role
 */
router.post('/roles', isAdmin, validate(rbacSchemas.roleCreate), roleController.createRole);

/**
 * @swagger
 * /rbac/roles/{id}:
 *   put:
 *     summary: Atualiza uma role
 *     tags:
 *       - RBAC
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RoleInput'
 *     responses:
 *       200:
 *         description: Role atualizada com sucesso
 *       404:
 *         description: Role não encontrada
 *       409:
 *         description: Nome da role já existe
 *       500:
 *         description: Erro ao atualizar role
 */
router.put('/roles/:id', isAdmin, validate(rbacSchemas.roleUpdate), roleController.updateRole);

/**
 * @swagger
 * /rbac/roles/{id}:
 *   delete:
 *     summary: Remove uma role
 *     tags:
 *       - RBAC
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Role removida com sucesso
 *       404:
 *         description: Role não encontrada
 *       409:
 *         description: Role em uso, não pode ser removida
 *       500:
 *         description: Erro ao remover role
 */
router.delete('/roles/:id', isAdmin, roleController.deleteRole);

/**
 * @swagger
 * /rbac/roles/{id}/permissions:
 *   get:
 *     summary: Lista permissões de uma role
 *     tags:
 *       - RBAC
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lista de permissões
 *       404:
 *         description: Role não encontrada
 *       500:
 *         description: Erro ao buscar permissões
 */
router.get('/roles/:id/permissions', checkPermission('admin:access'), roleController.getRolePermissions);

/**
 * @swagger
 * /rbac/roles/{roleId}/permissions/{permissionId}:
 *   post:
 *     summary: Atribui uma permissão a uma role
 *     tags:
 *       - RBAC
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: roleId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: permissionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Permissão atribuída com sucesso
 *       404:
 *         description: Role ou permissão não encontrada
 *       500:
 *         description: Erro ao atribuir permissão
 */
router.post('/roles/:roleId/permissions/:permissionId', isAdmin, roleController.assignPermissionToRole);

/**
 * @swagger
 * /rbac/roles/{roleId}/permissions/{permissionId}:
 *   delete:
 *     summary: Remove uma permissão de uma role
 *     tags:
 *       - RBAC
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: roleId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: permissionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Permissão removida com sucesso
 *       404:
 *         description: Role, permissão ou associação não encontrada
 *       500:
 *         description: Erro ao remover permissão
 */
router.delete('/roles/:roleId/permissions/:permissionId', isAdmin, roleController.removePermissionFromRole);

// ----- Rotas de Permissões -----
/**
 * @swagger
 * /rbac/permissions:
 *   get:
 *     summary: Lista todas as permissões
 *     tags:
 *       - RBAC
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de permissões
 *       500:
 *         description: Erro ao buscar permissões
 */
router.get('/permissions', checkPermission('admin:access'), permissionController.getAllPermissions);

/**
 * @swagger
 * /rbac/permissions/{id}:
 *   get:
 *     summary: Obtém uma permissão pelo ID
 *     tags:
 *       - RBAC
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Permissão encontrada
 *       404:
 *         description: Permissão não encontrada
 *       500:
 *         description: Erro ao buscar permissão
 */
router.get('/permissions/:id', checkPermission('admin:access'), permissionController.getPermissionById);

/**
 * @swagger
 * /rbac/permissions:
 *   post:
 *     summary: Cria uma nova permissão
 *     tags:
 *       - RBAC
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PermissionInput'
 *     responses:
 *       201:
 *         description: Permissão criada com sucesso
 *       409:
 *         description: Permissão já existe
 *       500:
 *         description: Erro ao criar permissão
 */
router.post('/permissions', isAdmin, validate(rbacSchemas.permissionCreate), permissionController.createPermission);

/**
 * @swagger
 * /rbac/permissions/{id}:
 *   put:
 *     summary: Atualiza uma permissão
 *     tags:
 *       - RBAC
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PermissionInput'
 *     responses:
 *       200:
 *         description: Permissão atualizada com sucesso
 *       404:
 *         description: Permissão não encontrada
 *       409:
 *         description: Nome da permissão já existe
 *       500:
 *         description: Erro ao atualizar permissão
 */
router.put('/permissions/:id', isAdmin, validate(rbacSchemas.permissionUpdate), permissionController.updatePermission);

/**
 * @swagger
 * /rbac/permissions/{id}:
 *   delete:
 *     summary: Remove uma permissão
 *     tags:
 *       - RBAC
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Permissão removida com sucesso
 *       404:
 *         description: Permissão não encontrada
 *       409:
 *         description: Permissão em uso, não pode ser removida
 *       500:
 *         description: Erro ao remover permissão
 */
router.delete('/permissions/:id', isAdmin, permissionController.deletePermission);

// ----- Rotas de User Roles -----
/**
 * @swagger
 * /rbac/users/{userId}/roles:
 *   get:
 *     summary: Lista roles de um usuário
 *     tags:
 *       - RBAC
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lista de roles do usuário
 *       404:
 *         description: Usuário não encontrado
 *       500:
 *         description: Erro ao buscar roles
 */
router.get('/users/:userId/roles', 
  checkPermission('admin:access'), 
  userRoleController.getUserRoles
);

/**
 * @swagger
 * /rbac/users/{userId}/roles:
 *   post:
 *     summary: Atribui uma role a um usuário
 *     tags:
 *       - RBAC
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserRoleInput'
 *     responses:
 *       201:
 *         description: Role atribuída com sucesso
 *       404:
 *         description: Usuário ou role não encontrada
 *       409:
 *         description: Usuário já possui esta role
 *       500:
 *         description: Erro ao atribuir role
 */
router.post('/users/:userId/roles', 
  checkPermission('admin:access'), 
  validate(rbacSchemas.userRoleAssign),
  userRoleController.assignRoleToUser
);

/**
 * @swagger
 * /rbac/users/{userId}/roles/{userRoleId}:
 *   delete:
 *     summary: Remove uma role de um usuário
 *     tags:
 *       - RBAC
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: userRoleId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Role removida com sucesso
 *       404:
 *         description: Usuário ou role não encontrada
 *       500:
 *         description: Erro ao remover role
 */
router.delete('/users/:userId/roles/:userRoleId', 
  checkPermission('admin:access'), 
  userRoleController.removeRoleFromUser
);

/**
 * @swagger
 * /rbac/users/{userId}/roles/{userRoleId}/validate:
 *   post:
 *     summary: Valida uma role de usuário
 *     tags:
 *       - RBAC
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: userRoleId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Role validada com sucesso
 *       404:
 *         description: Usuário ou role não encontrada
 *       500:
 *         description: Erro ao validar role
 */
router.post('/users/:userId/roles/:userRoleId/validate', 
  checkPermission('admin:access'), 
  userRoleController.validateUserRole
);

/**
 * @swagger
 * /rbac/users/{userId}/roles/{userRoleId}/reject:
 *   post:
 *     summary: Rejeita uma role de usuário
 *     tags:
 *       - RBAC
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: userRoleId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *               details:
 *                 type: string
 *     responses:
 *       200:
 *         description: Role rejeitada com sucesso
 *       404:
 *         description: Usuário ou role não encontrada
 *       500:
 *         description: Erro ao rejeitar role
 */
router.post('/users/:userId/roles/:userRoleId/reject', 
  checkPermission('admin:access'), 
  userRoleController.rejectUserRole
);

/**
 * @swagger
 * /rbac/validations/bank/{userId}/init:
 *   post:
 *     summary: Inicia processo de validação bancária
 *     tags:
 *       - RBAC
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userRoleId:
 *                 type: string
 *               bankData:
 *                 type: object
 *     responses:
 *       200:
 *         description: Processo de validação iniciado
 *       404:
 *         description: Usuário não encontrado
 *       500:
 *         description: Erro ao iniciar validação
 */
router.post('/validations/bank/:userId/init', userRoleController.initBankValidation);

/**
 * @swagger
 * /rbac/validations/bank/{userId}/confirm:
 *   post:
 *     summary: Confirma validação bancária
 *     tags:
 *       - RBAC
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               validationCode:
 *                 type: string
 *               userRoleId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Validação confirmada com sucesso
 *       404:
 *         description: Usuário não encontrado
 *       500:
 *         description: Erro ao confirmar validação
 */
router.post('/validations/bank/:userId/confirm', userRoleController.confirmBankValidation);

// Endpoint de teste para verificação de permissões
router.get('/check-permission/:permissionName', (req, res) => {
  const { permissionName } = req.params;
  const { contextType, resourceId } = req.query;
  
  return res.status(200).json({
    success: true,
    hasPermission: true,
    message: `Você tem permissão para: ${permissionName}`
  });
});

// Endpoint de teste para verificação de roles
router.get('/check-role/:roleName', (req, res) => {
  const { roleName } = req.params;
  const { contextType, resourceId } = req.query;
  
  return res.status(200).json({
    success: true,
    hasRole: true,
    message: `Você tem a role: ${roleName}`
  });
});

module.exports = router;