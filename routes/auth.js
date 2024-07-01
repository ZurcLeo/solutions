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
 *     responses:
 *       200:
 *         description: Sucesso no login
 */
router.post('/facebook-login', authController.facebookLogin);

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Registrar com email
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       201:
 *         description: Usuário registrado com sucesso
 */
router.post('/register', authController.registerWithEmail);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login com email
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Sucesso no login
 */
router.post('/login', authController.signInWithEmail);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout do usuário
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Sucesso no logout
 */
router.post('/logout', authController.logout);

/**
 * @swagger
 * /auth/login-with-provider:
 *   post:
 *     summary: Login com provedor externo
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Sucesso no login
 */
router.post('/login-with-provider', authController.signInWithProvider);

/**
 * @swagger
 * /auth/register-with-provider:
 *   post:
 *     summary: Registrar com provedor externo
 *     tags: [Auth]
 *     responses:
 *       201:
 *         description: Usuário registrado com sucesso
 */
router.post('/register-with-provider', authController.registerWithProvider);

/**
 * @swagger
 * /auth/resend-verification-email:
 *   post:
 *     summary: Reenviar email de verificação
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Email de verificação reenviado
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