//routes/users.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authController = require('../controllers/authController');
const verifyToken = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const userSchema = require('../schemas/userSchema');
const { upload, errorHandler } = require('../middlewares/upload.cjs');
const { rateLimiter, bankingLimit } = require('../middlewares/rateLimiter');
const { logger } = require('../logger');
const { healthCheck } = require('../middlewares/healthMiddleware');

const ROUTE_NAME = 'user'
// Aplicar middleware de health check a todas as rotas de interests
router.use(healthCheck(ROUTE_NAME));

// Middleware de log para todas as requisições
router.use((req, res, next) => {
  logger.info(`[ROUTE] Requisição recebida em ${ROUTE_NAME}`, { sreContext: req.sreContext || 'no-context' });
  next();
});

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: Gerenciamento de usuários
 */

/**
 * @swagger
 * /users:
 *   get:
 *     summary: Retorna todos os usuários
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: Lista de usuários retornada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/User'
 *       500:
 *         description: Erro no servidor
 */
router.get('/', verifyToken, rateLimiter, userController.getUsers);

/**
 * @swagger
 * /users/search:
 *   get:
 *     summary: Busca usuários pelo nome ou email
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         required: true
 *         description: Termo de busca
 *       - in: query
 *         name: excludeUserId
 *         schema:
 *           type: string
 *         required: false
 *         description: ID do usuário a ser excluído dos resultados
 *     responses:
 *       200:
 *         description: Lista de usuários que correspondem à busca
 *       500:
 *         description: Erro no servidor
 */
router.get('/search', verifyToken, rateLimiter, userController.searchUsers);

/**
 * @swagger
 * /users/{id}:
 *   get:
 *     summary: Retorna um usuário pelo ID
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID do usuário
 *     responses:
 *       200:
 *         description: Successful search. Returns an array of users.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                     description: User ID
 *                   name:
 *                     type: string
 *                     description: User name
 *                   email:
 *                     type: string
 *                     description: User email
 *       400:
 *         description: Bad request. Invalid query parameters.
 *       401:
 *         description: Unauthorized. Missing or invalid token.
 *       500:
 *         description: Internal server error.
 */
// ─── @username — públicos (devem preceder /:userId para evitar conflito) ──────
router.get('/check-username/:username', userController.checkUsername);
router.get('/generate-fallback', userController.generateFallbackUsername);

// ─── PREFS-005: Transparência & Exportação de Dados (LGPD Art. 18) ──────────
router.get('/data-export',        verifyToken, rateLimiter, userController.getDataExport);
router.get('/preference-history', verifyToken, rateLimiter, userController.getPreferenceHistory);

// ─── Preferências de notificação (devem preceder /:userId) ───────────────────
router.get('/preferences', verifyToken, rateLimiter, userController.getNotificationPreferences);
router.put('/preferences', verifyToken, rateLimiter, userController.updateNotificationPreferences);

// ─── Métodos de pagamento globais do usuário (devem preceder /:userId) ────────
const userPaymentMethodController = require('../controllers/userPaymentMethodController');

router.get('/payment-methods',               verifyToken, bankingLimit, userPaymentMethodController.list);
router.post('/payment-methods',              verifyToken, bankingLimit, userPaymentMethodController.register);
router.post('/payment-methods/:id/validate', verifyToken, bankingLimit, userPaymentMethodController.validate);
router.delete('/payment-methods/:id',        verifyToken, bankingLimit, userPaymentMethodController.remove);

router.get('/:userId', verifyToken, rateLimiter, validate(userSchema), userController.getUserById);

/**
 * @swagger
 * /users/add-user:
 *   post:
 *     summary: Adiciona um novo usuário
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/User'
 *     responses:
 *       201:
 *         description: Usuário criado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Erro na solicitação
 *       500:
 *         description: Erro no servidor
 */
router.post('/add-user', verifyToken, rateLimiter, validate(userSchema), userController.addUser);

/**
 * @swagger
 * /users/update-user/{id}:
 *   put:
 *     summary: Atualiza um usuário pelo ID
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID do usuário
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/User'
 *     responses:
 *       200:
 *         description: Usuário atualizado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Erro na solicitação
 *       404:
 *         description: Usuário não encontrado
 *       500:
 *         description: Erro no servidor
 */
router.put('/update-user/:userId', verifyToken, rateLimiter, validate(userSchema), userController.updateUser);

/**
 * @swagger
 * /users/upload-profile-picture/{userId}:
 *   post:
 *     summary: Faz upload da foto de perfil do usuário
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: userId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID do usuário
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               profilePicture:
 *                 type: string
 *                 format: binary
 *                 description: Imagem da foto de perfil do usuário
 *     responses:
 *       200:
 *         description: Imagem carregada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 publicUrl:
 *                   type: string
 *                   description: URL pública da imagem carregada
 *       400:
 *         description: Erro na solicitação
 *       500:
 *         description: Erro no servidor
 */

router.post('/upload-profile-picture/:userId',
  verifyToken,
  rateLimiter,
  upload.single('profilePicture'), 
  errorHandler, 
  userController.uploadProfilePicture);

/**
 * @swagger
 * /users/delete-user/{id}:
 *   delete:
 *     summary: Deleta um usuário pelo ID
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID do usuário
 *     responses:
 *       200:
 *         description: Usuário deletado com sucesso
 *       400:
 *         description: Erro na solicitação
 *       404:
 *         description: Usuário não encontrado
 *       500:
 *         description: Erro no servidor
 */
router.delete('/delete-user/:id', verifyToken, rateLimiter, userController.deleteUser);

// Sugestão via IA (público) e alteração de username (requer auth)
router.post('/suggest-username', userController.suggestUsername);
router.patch('/username', verifyToken, rateLimiter, userController.updateUsername);

// ─── Email de Recuperação ─────────────────────────────────────────────────────
router.put('/recovery-email',          verifyToken, rateLimiter, userController.setRecoveryEmail);
router.post('/recovery-email/verify',  verifyToken, rateLimiter, userController.verifyRecoveryEmail);
router.post('/recovery-email/resend',  verifyToken, rateLimiter, userController.resendRecoveryEmailOTP);
router.delete('/recovery-email',       verifyToken, rateLimiter, userController.removeRecoveryEmail);

// ─── Lista de desejos pessoal (BARTER-006) ────────────────────────────────────
router.get('/me/wishlist',   verifyToken, userController.getMyWishlist);
router.patch('/me/wishlist', verifyToken, userController.updateMyWishlist);

// ─── Status de suspensão própria ──────────────────────────────────────────────
const suspensionController = require('../controllers/suspensionController');
router.get('/suspension', verifyToken, suspensionController.getOwnSuspension);

// ─── Denúncia de perfil de usuário ────────────────────────────────────────────
const reportController = require('../controllers/reportController');
const { writeLimit } = require('../middlewares/rateLimiter');
router.post('/:userId/report', verifyToken, writeLimit, reportController.reportUser);

module.exports = router;