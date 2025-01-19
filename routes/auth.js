const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const verifyToken = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const userSchema = require('../schemas/userSchema');
const { logger } = require('../logger');
const { rateLimiter, authRateLimiter } = require('../middlewares/rateLimiter');

// Middleware CORS
router.use((req, res, next) => {
  const allowedOrigins = [
    'https://eloscloud.com',
    'http://localhost:3000'
  ];
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Middleware Logger
router.use((req, res, next) => {
  logger.info('Requisição recebida', {
    service: 'api',
    function: req.originalUrl,
    method: req.method,
    url: req.originalUrl,
    headers: req.headers,
    body: req.body
  });
  next();
});

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Registro com email e senha.
 *     description: Cria uma nova conta de usuário usando email e senha.
 *     tags:
 *       - Autenticação
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       200:
 *         description: Conta criada com sucesso.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       500:
 *         description: Erro ao criar conta.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.route('/register')
  .post(authRateLimiter, authController.registerWithEmail);

  /**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login com email e senha.
 *     description: Realiza login de um usuário usando email e senha.
 *     tags:
 *       - Autenticação
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login bem-sucedido.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       500:
 *         description: Erro ao realizar login.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.route('/login')
  .post(authRateLimiter, authController.signInWithEmail);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Realiza logout do usuário.
 *     description: Encerra a sessão do usuário e coloca o token na blacklist.
 *     tags:
 *       - Autenticação
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout bem-sucedido.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   description: Mensagem de sucesso.
 *                   example: "Logout successful and token blacklisted"
 *       500:
 *         description: Erro ao realizar logout.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.route('/logout')
  .post(rateLimiter, verifyToken, validate(userSchema), authController.logout);

  /**
 * @swagger
 * /auth/facebook-login:
 *   post:
 *     summary: Login com Facebook.
 *     description: Realiza login usando um token de acesso do Facebook.
 *     tags:
 *       - Autenticação
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               accessToken:
 *                 type: string
 *                 description: Token de acesso do Facebook.
 *                 example: "facebook_access_token"
 *     responses:
 *       200:
 *         description: Login bem-sucedido.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userId:
 *                   type: string
 *                   description: ID do usuário autenticado.
 *                   example: "user123"
 *                 email:
 *                   type: string
 *                   description: Email do usuário.
 *                   example: "user@example.com"
 *       500:
 *         description: Erro ao autenticar com Facebook.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.route('/facebook-login')
  .post(authRateLimiter, authController.facebookLogin);

/**
 * @swagger
 * /auth/login-with-provider:
 *   post:
 *     summary: Login com provedor externo.
 *     description: Realiza login usando o token de um provedor externo (Google, Facebook, Microsoft).
 *     tags:
 *       - Autenticação
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               idToken:
 *                 type: string
 *                 description: Token do provedor externo.
 *                 example: "provider_token_example"
 *               provider:
 *                 type: string
 *                 description: Nome do provedor externo (google, facebook, microsoft).
 *                 example: "google"
 *     responses:
 *       200:
 *         description: Login bem-sucedido.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Provedor inválido ou não suportado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Erro ao realizar login com provedor.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.route('/login-with-provider')
  .post(rateLimiter, authController.signInWithProvider);

  /**
 * @swagger
 * /auth/register-with-provider:
 *   post:
 *     summary: Registro com provedor externo.
 *     description: Registra um usuário utilizando o token de um provedor externo (Google, Facebook, Microsoft).
 *     tags:
 *       - Autenticação
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               provider:
 *                 type: string
 *                 description: Nome do provedor externo (google, facebook, microsoft).
 *                 example: "google"
 *               inviteId:
 *                 type: string
 *                 description: ID do convite (opcional).
 *                 example: "invite123"
 *               email:
 *                 type: string
 *                 description: Email do usuário.
 *                 example: "user@example.com"
 *               nome:
 *                 type: string
 *                 description: Nome do usuário.
 *                 example: "John Doe"
 *     responses:
 *       200:
 *         description: Registro com provedor bem-sucedido.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       500:
 *         description: Erro ao registrar com provedor.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.route('/register-with-provider')
  .post(authRateLimiter, authController.registerWithProvider);

  /**
 * @swagger
 * /auth/refresh-token:
 *   post:
 *     summary: Renova tokens de autenticação.
 *     description: Verifica o refresh token e gera novos tokens de acesso e refresh.
 *     tags:
 *       - Autenticação
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: Token de refresh do usuário.
 *                 example: "refresh_token_example"
 *     responses:
 *       200:
 *         description: Tokens renovados com sucesso.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                   description: Novo token de acesso.
 *                   example: "eyJhbGciOiJIUzI1..."
 *                 refreshToken:
 *                   type: string
 *                   description: Novo token de refresh.
 *                   example: "eyJhbGciOiJIUzI1..."
 *       400:
 *         description: Refresh token inválido.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Erro ao renovar tokens.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.route('/refresh-token')
  .post(rateLimiter, verifyToken, authController.refreshToken);

  /**
 * @swagger
 * /auth/token:
 *   get:
 *     summary: Gera novos tokens de acesso e refresh.
 *     description: Endpoint para gerar tokens JWT de acesso e refresh para um usuário autenticado.
 *     tags:
 *       - Autenticação
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Tokens gerados com sucesso.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                   description: Token JWT de acesso.
 *                   example: "eyJhbGciOiJIUzI1..."
 *                 refreshToken:
 *                   type: string
 *                   description: Token JWT de refresh.
 *                   example: "eyJhbGciOiJIUzI1..."
 *       500:
 *         description: Erro ao gerar tokens.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.route('/token')
  .get(rateLimiter, verifyToken, authController.getToken);

  /**
 * @swagger
 * /auth/resend-verification-email:
 *   post:
 *     summary: Reenvia email de verificação.
 *     description: Reenvia o email de verificação para o endereço de email associado ao usuário.
 *     tags:
 *       - Autenticação
 *     responses:
 *       200:
 *         description: Email de verificação reenviado com sucesso.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   description: Mensagem de sucesso.
 *                   example: "Email de verificação reenviado."
 *       500:
 *         description: Erro ao reenviar email de verificação.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.route('/resend-verification-email')
  .post(rateLimiter, authController.resendVerificationEmail);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Obter dados do usuário atual.
 *     description: Recupera as informações do usuário autenticado usando o token JWT.
 *     tags:
 *       - Autenticação
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dados do usuário recuperados com sucesso.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401:
 *         description: Não autorizado. Token ausente ou inválido.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Erro ao recuperar dados do usuário.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.route('/me')
  .get(rateLimiter, verifyToken, authController.getCurrentUser);

module.exports = router;