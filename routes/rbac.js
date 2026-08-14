// routes/rbac.js
const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/auth');
const { checkPermission, isAdmin } = require('../middlewares/rbac');
const userRoleController = require('../controllers/userRoleController');
const roleController = require('../controllers/roleController');
const permissionController = require('../controllers/permissionController');
const { rateLimiter } = require('../middlewares/rateLimiter');
const { logger } = require('../logger');
const { healthCheck } = require('../middlewares/healthMiddleware');
const userRoleService = require('../services/userRoleService');

const ROUTE_NAME = 'rbac';

router.use(healthCheck(ROUTE_NAME));

router.use((req, res, next) => {
  logger.info(`[ROUTE] Requisição recebida em ${ROUTE_NAME}`, { sreContext: req.sreContext || 'no-context' });
  next();
});

router.use(verifyToken);
router.use(rateLimiter);

// Lista todas as roles da plataforma
router.get('/roles', checkPermission('admin:access'), roleController.getAllRoles);

// Cria uma nova role
router.post('/roles', isAdmin, roleController.createRole);

// Lista todas as permissões da plataforma
router.get('/permissions', checkPermission('admin:access'), permissionController.getAllPermissions);

// Atribui role a um usuário
router.post('/users/:userId/roles',
  checkPermission('admin:access'),
  userRoleController.assignRoleToUser
);

// Lista roles de um usuário
router.get('/users/:userId/roles',
  checkPermission('admin:access'),
  userRoleController.getUserRoles
);

// Verifica se o usuário autenticado tem uma permissão
router.get('/check-permission/:permissionName', async (req, res) => {
  const { permissionName } = req.params;
  const { contextType = 'global', resourceId = null } = req.query;
  const userId = req.uid;

  try {
    const hasPermission = await userRoleService.checkUserHasPermission(
      userId,
      permissionName,
      contextType,
      resourceId
    );

    return res.status(200).json({
      success: true,
      hasPermission,
      message: hasPermission
        ? `Você tem permissão para: ${permissionName}`
        : `Você NÃO tem permissão para: ${permissionName}`
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao verificar permissão',
      error: error.message
    });
  }
});

// Verifica se o usuário autenticado tem uma role
router.get('/check-role/:roleName', async (req, res) => {
  const { roleName } = req.params;
  const { contextType = 'global', resourceId = null } = req.query;
  const userId = req.uid;

  try {
    const hasRole = await userRoleService.checkUserHasRole(
      userId,
      roleName,
      contextType,
      resourceId
    );

    return res.status(200).json({
      success: true,
      hasRole,
      message: hasRole
        ? `Você tem a role: ${roleName}`
        : `Você NÃO tem a role: ${roleName}`
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao verificar role',
      error: error.message
    });
  }
});

module.exports = router;
