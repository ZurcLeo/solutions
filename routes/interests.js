// src/routes/interestsRoutes.js
const express = require('express');
const router = express.Router();
const interestsController = require('../controllers/interestsController');
const verifyToken = require('../middlewares/auth');
const { isAdmin } = require('../middlewares/admin');
const {readLimit, writeLimit} = require('../middlewares/rateLimiter');
const { healthCheck } = require('../middlewares/healthMiddleware');
const { logger } = require('../logger')

const ROUTE_NAME = 'interests'
// Aplicar middleware de health check a todas as rotas de interests
router.use(healthCheck(ROUTE_NAME));

// Middleware de log para todas as requisições
router.use((req, res, next) => {
  logger.info(`[ROUTE] Requisição recebida em ${ROUTE_NAME.toUpperCase()}`, {
    path: req.path,
    method: req.method,
    userId: req.user?.uid,
    params: req.params,
    body: req.body,
    query: req.query,
  });
  next();
});


// Rota para obter categorias e interesses disponíveis (pública, com rate limiting)
router.get('/categories', readLimit, interestsController.getAvailableInterests);

// Rotas para interesses específicos de usuário (autenticadas)
router.get('/:userId', verifyToken, interestsController.getUserInterests);
router.put('/:userId', verifyToken, interestsController.updateUserInterests);

// Rotas administrativas (apenas admin)
router.post('/admin/categories', verifyToken, isAdmin, writeLimit, interestsController.createCategory);
router.put('/admin/categories/:categoryId', verifyToken, isAdmin, writeLimit, interestsController.updateCategory);
router.post('/admin/interests', verifyToken, isAdmin, writeLimit, interestsController.createInterest);
router.put('/admin/interests/:interestId', verifyToken, isAdmin, writeLimit, interestsController.updateInterest);
router.get('/admin/stats', verifyToken, isAdmin, readLimit, interestsController.getInterestStats);

// Rotas de migração (apenas admin)
router.post('/admin/migrate/static', verifyToken, isAdmin, interestsController.migrateStaticInterests);
router.post('/admin/migrate/users', verifyToken, isAdmin, interestsController.migrateUserInterests);

module.exports = router;