//routes/user.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authController = require('../controllers/authController');
const verifyToken = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const userSchema = require('../schemas/userSchema');
const { upload, errorHandler } = require('../middlewares/upload.cjs');
const { logger } = require('../logger');


// Lista de origens permitidas
const allowedOrigins = ['https://eloscloud.com', 'http://localhost:3000'];

const cleanRequestBody = (req, res, next) => {
  if (req.body.providerData) {
    delete req.body.providerData;
  }
  next();
};

const convertDataCriacao = (req, res, next) => {
  if (req.body.dataCriacao && typeof req.body.dataCriacao === 'string') {
    req.body.dataCriacao = new Date(req.body.dataCriacao);
  }
  next();
};

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

// Middleware para logar todas as requisições
router.use((req, res, next) => {
  logger.info('Requisição recebida', {
    service: 'api',
    function: req.originalUrl,
    method: req.method,
    url: req.originalUrl,
    params: req.params,
    headers: req.headers,
    body: req.body
  });
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
router.get('/', verifyToken, validate(userSchema), userController.getUsers);

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
 *         description: Usuário retornado com sucesso
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
router.get('/:userId', verifyToken, validate(userSchema), userController.getUserById);

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
router.post('/add-user', verifyToken, cleanRequestBody, validate(userSchema), userController.addUser);

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
router.put('/update-user/:userId', verifyToken, convertDataCriacao, cleanRequestBody, validate(userSchema), userController.updateUser);

/**
 * @swagger
 * /users/upload-profile-picture/{userId}:
 *   put:
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
router.put('/upload-profile-picture/:userId', 
  verifyToken, 
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
router.delete('/delete-user/:id', verifyToken, validate(userSchema), userController.deleteUser);

/**
 * @swagger
 * /users/me:
 *   get:
 *     summary: Retorna o perfil do usuário autenticado
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Perfil do usuário retornado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401:
 *         description: Não autorizado
 *       500:
 *         description: Erro no servidor
 */
router.get('/me', verifyToken, validate(userSchema), authController.getCurrentUser);

module.exports = router;