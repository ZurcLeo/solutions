// routes/auth.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const verifyToken = require('../middlewares/auth');

// Lista de origens permitidas
const allowedOrigins = [
  'https://eloscloud.com',
  'http://localhost:3000',
  'https://www.facebook.com',
  'https://accounts.google.com'
];

// Middleware to add CORS headers for all requests
router.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Rotas de autenticação
 */

/**
* @swagger
 * /auth/facebook-login:
 *   post:
 *     summary: Login com Facebook
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               accessToken:
 *                 type: string
 *                 description: Token de acesso do Facebook
 *     responses:
 *       200:
 *         description: Sucesso no login
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   description: Mensagem de sucesso
 */
router.post('/facebook-login', authController.facebookLogin);

/**
  * @swagger
 * /auth/register:
 *   post:
 *     summary: Registrar com email
 *     tags: [Auth]
 *     description: |
 *       Registra um usuário usando email e senha.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 description: Email do usuário
 *               password:
 *                 type: string
 *                 description: Senha do usuário
 *     responses:
 *       201:
 *         description: Usuário registrado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   description: Mensagem de sucesso
 *                 token:
 *                   type: string
 *                   description: Token JWT
 */
router.post('/register', authController.registerWithEmail);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login com email
 *     tags: [Auth]
 *     description: |
 *       Autentica um usuário usando email e senha.
 *       A lógica de negócio inclui:
 *       1. Busca do registro do usuário pelo email.
 *       2. Criação de um token personalizado para o usuário.
 *       3. Verificação se o email do usuário foi verificado.
 *       4. Garantia de que o perfil do usuário exista no sistema.
 *       Em caso de sucesso, um token de autenticação e uma mensagem de sucesso são retornados na resposta.
 *       Em caso de erro, uma mensagem de erro é retornada na resposta.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 description: Email do usuário.
 *               password:
 *                 type: string
 *                 description: Senha do usuário.
 *     responses:
 *       200:
 *         description: Login bem-sucedido
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   description: Mensagem de sucesso.
 *                 token:
 *                   type: string
 *                   description: Token JWT.
 *       401:
 *         description: Email não verificado.
 *       500:
 *         description: Erro no servidor.
 */
router.post('/login', authController.signInWithEmail);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout do usuário
 *     tags: [Auth]
 *     description: |
 *       Realiza o logout do usuário e adiciona o token à lista negra.
 *       A lógica de negócio inclui:
 *       1. Verificação da presença e formato do token de autorização no cabeçalho.
 *       2. Extração do token de autorização.
 *       3. Adição do token à lista negra para que não possa mais ser utilizado.
 *       Em caso de sucesso, uma mensagem de sucesso é retornada na resposta.
 *       Em caso de erro, uma mensagem de erro é retornada na resposta.
 *     responses:
 *       200:
 *         description: Logout bem-sucedido
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   description: Mensagem de sucesso.
 *       401:
 *         description: Não autorizado, token inválido ou ausente.
 *       500:
 *         description: Erro no servidor.
 */
router.post('/logout', verifyToken, authController.logout);

/**
  * @swagger
 * /auth/login-with-provider:
 *   post:
 *     summary: Login com provedor externo
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               idToken:
 *                 type: string
 *                 description: Token de identificação do provedor
 *               provider:
 *                 type: string
 *                 description: Nome do provedor (google, facebook, microsoft)
 *     responses:
 *       200:
 *         description: Sucesso no login
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   description: Mensagem de sucesso
 *                 token:
 *                   type: string
 *                   description: Token JWT
 */
router.post('/login-with-provider', authController.signInWithProvider);

/**
 * @swagger
 * /auth/register-with-provider:
 *   post:
 *     summary: Registrar com provedor externo
 *     tags: [Auth]
 *     description: |
 *       Registra um usuário usando um provedor externo (Google, Microsoft) e um código de convite.
 *       Este endpoint valida o código de convite, autentica o usuário com o provedor externo, garante
 *       que o perfil do usuário exista no sistema e invalida o código de convite após o uso.
 *       A lógica de negócio inclui:
 *       1. Validação do código de convite.
 *       2. Autenticação com o provedor externo.
 *       3. Criação do perfil do usuário, se não existir.
 *       4. Invalidação do código de convite.
 *       5. Retorno de um token JWT.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               provider:
 *                 type: string
 *                 description: Nome do provedor (google, microsoft).
 *               inviteCode:
 *                 type: string
 *                 description: Código de convite.
 *     responses:
 *       201:
 *         description: Usuário registrado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   description: Mensagem de sucesso.
 *                 token:
 *                   type: string
 *                   description: Token JWT.
 *       400:
 *         description: Provedor inválido ou código de convite inválido.
 *       500:
 *         description: Erro no servidor.
 */
router.post('/register-with-provider', authController.registerWithProvider);

/**
 * @swagger
 * /auth/resend-verification-email:
 *   post:
 *     summary: Reenviar email de verificação
 *     tags: [Auth]
 *     description: |
 *       Reenvia o email de verificação para o usuário autenticado.
 *       A lógica de negócio inclui:
 *       1. Verificação se há um usuário autenticado.
 *       2. Reenvio do email de verificação.
 *       Em caso de sucesso, uma mensagem de sucesso é retornada na resposta.
 *       Em caso de erro, uma mensagem de erro é registrada e retornada na resposta.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 description: Email do usuário para reenvio da verificação.
 *     responses:
 *       200:
 *         description: Email de verificação reenviado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   description: Mensagem de sucesso.
 *       500:
 *         description: Erro ao reenviar email de verificação.
 */
router.post('/resend-verification-email', authController.resendVerificationEmail);

/**
 * @swagger
 * /auth/token:
 *   get:
 *     summary: Obter token de autenticação
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Token de autenticação válido
 *       401:
 *         description: Não autorizado
 */
router.get('/token', verifyToken, authController.getToken);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Obter usuário atual
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Informações do usuário atual
 *       401:
 *         description: Não autorizado
 */
router.get('/me', verifyToken, authController.getCurrentUser);

module.exports = router;