const express = require('express');
const router = express.Router();
const postController = require('../controllers/postController');
const verifyToken = require('../middlewares/auth');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { logger } = require('../logger')

const ROUTE_NAME = 'posts'
// Aplicar middleware de health check a todas as rotas de interests
// router.use(healthCheck(ROUTE_NAME));

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

/**
 * @swagger
 * tags:
 *   name: Posts
 *   description: Gerenciamento de postagens
 */

/**
 * @swagger
 * /posts/{id}:
 *   get:
 *     summary: Retorna uma postagem pelo ID
 *     tags: [Posts]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da postagem
 *     responses:
 *       200:
 *         description: Postagem retornada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Post'
 *       400:
 *         description: Erro na solicitação
 *       404:
 *         description: Postagem não encontrada
 *       500:
 *         description: Erro no servidor
 */
router.get('/:id', verifyToken, readLimit, postController.getPostById);

/**
 * @swagger
 * /posts:
 *   post:
 *     summary: Cria uma nova postagem
 *     tags: [Posts]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Post'
 *     responses:
 *       201:
 *         description: Postagem criada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Post'
 *       400:
 *         description: Erro na solicitação
 *       500:
 *         description: Erro no servidor
 */
router.post('/', verifyToken, writeLimit, postController.createPost);

/**
 * @swagger
 * /posts/{id}:
 *   put:
 *     summary: Atualiza uma postagem pelo ID
 *     tags: [Posts]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da postagem
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Post'
 *     responses:
 *       200:
 *         description: Postagem atualizada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Post'
 *       400:
 *         description: Erro na solicitação
 *       404:
 *         description: Postagem não encontrada
 *       500:
 *         description: Erro no servidor
 */
router.put('/:id', verifyToken, writeLimit, postController.updatePost);

/**
 * @swagger
 * /posts/{id}:
 *   delete:
 *     summary: Deleta uma postagem pelo ID
 *     tags: [Posts]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da postagem
 *     responses:
 *       200:
 *         description: Postagem deletada com sucesso
 *       400:
 *         description: Erro na solicitação
 *       404:
 *         description: Postagem não encontrada
 *       500:
 *         description: Erro no servidor
 */
router.delete('/:id', verifyToken, writeLimit, postController.deletePost);

/**
 * @swagger
 * /posts/{postId}/comments:
 *   post:
 *     summary: Adiciona um comentário a uma postagem
 *     tags: [Posts]
 *     parameters:
 *       - in: path
 *         name: postId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da postagem
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content:
 *                 type: string
 *                 description: Conteúdo do comentário
 *                 example: "Este é um comentário"
 *     responses:
 *       200:
 *         description: Comentário adicionado com sucesso
 *       400:
 *         description: Erro na solicitação
 *       404:
 *         description: Postagem não encontrada
 *       500:
 *         description: Erro no servidor
 */
router.post('/:postId/comments', verifyToken, writeLimit, postController.addComment);

/**
 * @swagger
 * /posts/{postId}/reactions:
 *   post:
 *     summary: Adiciona uma reação a uma postagem
 *     tags: [Posts]
 *     parameters:
 *       - in: path
 *         name: postId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da postagem
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 description: Tipo de reação
 *                 example: "like"
 *     responses:
 *       200:
 *         description: Reação adicionada com sucesso
 *       400:
 *         description: Erro na solicitação
 *       404:
 *         description: Postagem não encontrada
 *       500:
 *         description: Erro no servidor
 */
router.post('/:postId/reactions', verifyToken, writeLimit, postController.addReaction);

/**
 * @swagger
 * /posts/{postId}/gifts:
 *   post:
 *     summary: Adiciona um presente a uma postagem
 *     tags: [Posts]
 *     parameters:
 *       - in: path
 *         name: postId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da postagem
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               giftId:
 *                 type: string
 *                 description: ID do presente
 *                 example: "giftId123"
 *     responses:
 *       200:
 *         description: Presente adicionado com sucesso
 *       400:
 *         description: Erro na solicitação
 *       404:
 *         description: Postagem não encontrada
 *       500:
 *         description: Erro no servidor
 */
router.post('/:postId/gifts', verifyToken, writeLimit, postController.addGift);

module.exports = router;