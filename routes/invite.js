const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/auth')
const { 
  getSentInvites, 
  cancelInvite, 
  sendInvite, 
  validateInvite, 
  invalidateInvite 
} = require('../controllers/inviteController');

// Lista de origens permitidas
const allowedOrigins = [
  'https://eloscloud.com',
  'http://localhost:3000'];

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
 *   name: Convite
 *   description: Gerenciamento de convites
 */

/**
 * @swagger
 * /invite/validate:
 *   post:
 *     summary: Valida um convite
 *     tags: [Convite]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               inviteToken:
 *                 type: string
 *                 description: Token do convite a ser validado
 *                 example: some_invite_token
 *     responses:
 *       200:
 *         description: Convite validado com sucesso
 *       400:
 *         description: Erro na solicitação
 *       500:
 *         description: Erro no servidor
 */
router.post('/validate', validateInvite);

/**
 * @swagger
 * /invite/invalidate:
 *   post:
 *     summary: Invalida um convite
 *     tags: [Convite]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               inviteToken:
 *                 type: string
 *                 description: Token do convite a ser invalidado
 *                 example: some_invite_token
 *     responses:
 *       200:
 *         description: Convite invalidado com sucesso
 *       400:
 *         description: Erro na solicitação
 *       500:
 *         description: Erro no servidor
 */
router.post('/invalidate', verifyToken, invalidateInvite);
/**
 * @swagger
 * /invite/generate:
 *   post:
 *     summary: Gera um novo convite
 *     tags: [Convite]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 description: Email para o qual o convite será gerado
 *                 example: user@/example.com
 *     responses:
 *       201:
 *         description: Convite gerado com sucesso
 *       400:
 *         description: Erro na solicitação
 *       500:
 *         description: Erro no servidor
 */
router.post('/generate', verifyToken, sendInvite);
/**
 * @swagger
 * /invite/sent:
 *   get:
 *     summary: Retorna todos os convites enviados pelo usuário autenticado
 *     tags: [Convite]
 *     responses:
 *       200:
 *         description: Convites enviados retornados com sucesso
 *       500:
 *         description: Erro no servidor
 */
router.get('/sent', verifyToken, getSentInvites);
/**
 * @swagger
 * /invite/cancel/{id}:
 *   put:
 *     summary: Cancela um convite
 *     tags: [Convite]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do convite
 *     responses:
 *       200:
 *         description: Convite cancelado com sucesso
 *       500:
 *         description: Erro no servidor
 */
router.put('/cancel/:id', verifyToken, cancelInvite);

module.exports = router;
