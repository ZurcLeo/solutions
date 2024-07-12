const express = require('express');
const router = express.Router();
const caixinhaController = require('../controllers/caixinhaController');
const verifyToken = require('../middlewares/auth');
const { logger } = require('../logger')

// Lista de origens permitidas
const allowedOrigins = ['https://eloscloud.com', 'http://localhost:3000'];

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
    headers: req.headers,
    body: req.body
  });
  next();
});

/**
 * @swagger
 * tags:
 *   name: Caixinha
 *   description: Gestão de caixinhas
 */

/**
 * @swagger
 * /caixinha:
 *   get:
 *     summary: Retorna todas as caixinhas
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de caixinhas
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Caixinha'
 */
router.get('/', verifyToken, caixinhaController.getCaixinhas);

/**
 * @swagger
 * /caixinha/{id}:
 *   get:
 *     summary: Retorna uma caixinha pelo ID
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *     responses:
 *       200:
 *         description: Detalhes da caixinha
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Caixinha'
 */
router.get('/:id', verifyToken, caixinhaController.getCaixinhaById);

/**
 * @swagger
 * /caixinha:
 *   post:
 *     summary: Cria uma nova caixinha
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Caixinha'
 *     responses:
 *       201:
 *         description: Caixinha criada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Caixinha'
 */
router.post('/', verifyToken, caixinhaController.createCaixinha);

/**
 * @swagger
 * /caixinha/{id}:
 *   put:
 *     summary: Atualiza uma caixinha pelo ID
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Caixinha'
 *     responses:
 *       200:
 *         description: Caixinha atualizada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Caixinha'
 */
router.put('/:id', verifyToken, caixinhaController.updateCaixinha);

/**
 * @swagger
 * /caixinha/{id}:
 *   delete:
 *     summary: Deleta uma caixinha pelo ID
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *     responses:
 *       200:
 *         description: Caixinha deletada
 */
router.delete('/:id', verifyToken, caixinhaController.deleteCaixinha);

/**
 * @swagger
 * /caixinha/contribuicao:
 *   post:
 *     summary: Adiciona uma contribuição
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               caixinhaId:
 *                 type: string
 *               amount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Contribuição adicionada
 */
router.post('/contribuicao', verifyToken, caixinhaController.addContribuicao);

/**
 * @swagger
 * /caixinha/{id}/contribuicoes:
 *   get:
 *     summary: Retorna todas as contribuições de uma caixinha específica
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *     responses:
 *       200:
 *         description: Lista de contribuições
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Contribuicao'
 */
router.get('/:id/contribuicoes', verifyToken, caixinhaController.getContribuicoes);

/**
 * @swagger
 * /caixinha/{id}/contribuicoes/{contribuicaoId}:
 *   get:
 *     summary: Retorna detalhes de uma contribuição específica
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *       - in: path
 *         name: contribuicaoId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da contribuição
 *     responses:
 *       200:
 *         description: Detalhes da contribuição
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Contribuicao'
 */
router.get('/:id/contribuicoes/:contribuicaoId', verifyToken, caixinhaController.getContribuicaoById);

/**
 * @swagger
 * /caixinha/{id}/contribuicoes/{contribuicaoId}:
 *   put:
 *     summary: Atualiza uma contribuição específica
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *       - in: path
 *         name: contribuicaoId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da contribuição
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Contribuição atualizada
 */
router.put('/:id/contribuicoes/:contribuicaoId', verifyToken, caixinhaController.updateContribuicao);

/**
 * @swagger
 * /caixinha/{id}/contribuicoes/{contribuicaoId}:
 *   delete:
 *     summary: Deleta uma contribuição específica
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *       - in: path
 *         name: contribuicaoId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da contribuição
 *     responses:
 *       200:
 *         description: Contribuição deletada
 */
router.delete('/:id/contribuicoes/:contribuicaoId', verifyToken, caixinhaController.deleteContribuicao);

/**
 * @swagger
 * /caixinha/emprestimo:
 *   post:
 *     summary: Solicita um empréstimo
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               caixinhaId:
 *                 type: string
 *               amount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Empréstimo solicitado
 */
router.post('/emprestimo', verifyToken, caixinhaController.solicitarEmprestimo);

/**
 * @swagger
 * /caixinha/{id}/emprestimos:
 *   get:
 *     summary: Retorna todos os empréstimos de uma caixinha específica
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *     responses:
 *       200:
 *         description: Lista de empréstimos
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Emprestimo'
 */
router.get('/:id/emprestimos', verifyToken, caixinhaController.getEmprestimos);

/**
 * @swagger
 * /caixinha/{id}/emprestimos/{emprestimoId}:
 *   get:
 *     summary: Retorna detalhes de um empréstimo específico
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *       - in: path
 *         name: emprestimoId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID do empréstimo
 *     responses:
 *       200:
 *         description: Detalhes do empréstimo
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Emprestimo'
 */
router.get('/:id/emprestimos/:emprestimoId', verifyToken, caixinhaController.getEmprestimoById);

/**
 * @swagger
 * /caixinha/{id}/emprestimos/{emprestimoId}:
 *   put:
 *     summary: Atualiza um empréstimo específico
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *       - in: path
 *         name: emprestimoId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID do empréstimo
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Empréstimo atualizado
 */
router.put('/:id/emprestimos/:emprestimoId', verifyToken, caixinhaController.updateEmprestimo);

/**
 * @swagger
 * /caixinha/{id}/emprestimos/{emprestimoId}:
 *   delete:
 *     summary: Deleta um empréstimo específico
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *       - in: path
 *         name: emprestimoId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID do empréstimo
 *     responses:
 *       200:
 *         description: Empréstimo deletado
 */
router.delete('/:id/emprestimos/:emprestimoId', verifyToken, caixinhaController.deleteEmprestimo);

/**
 * @swagger
 * /caixinha/atividade-bonus:
 *   post:
 *     summary: Adiciona uma atividade bônus
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               caixinhaId:
 *                 type: string
 *               description:
 *                 type: string
 *               bonus:
 *                 type: number
 *     responses:
 *       200:
 *         description: Atividade bônus adicionada
 */
router.post('/atividade-bonus', verifyToken, caixinhaController.addAtividadeBonus);

/**
 * @swagger
 * /caixinha/{id}/atividades-bonus:
 *   get:
 *     summary: Retorna todas as atividades bônus de uma caixinha específica
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *     responses:
 *       200:
 *         description: Lista de atividades bônus
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/AtividadeBonus'
 */
router.get('/:id/atividades-bonus', verifyToken, caixinhaController.getAtividadesBonus);

/**
 * @swagger
 * /caixinha/{id}/atividades-bonus/{atividadeId}:
 *   get:
 *     summary: Retorna detalhes de uma atividade bônus específica
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *       - in: path
 *         name: atividadeId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da atividade bônus
 *     responses:
 *       200:
 *         description: Detalhes da atividade bônus
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AtividadeBonus'
 */
router.get('/:id/atividades-bonus/:atividadeId', verifyToken, caixinhaController.getAtividadeBonusById);

/**
 * @swagger
 * /caixinha/{id}/atividades-bonus/{atividadeId}:
 *   put:
 *     summary: Atualiza uma atividade bônus específica
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *       - in: path
 *         name: atividadeId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da atividade bônus
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               description:
 *                 type: string
 *               bonus:
 *                 type: number
 *     responses:
 *       200:
 *         description: Atividade bônus atualizada
 */
router.put('/:id/atividades-bonus/:atividadeId', verifyToken, caixinhaController.updateAtividadeBonus);

/**
 * @swagger
 * /caixinha/{id}/atividades-bonus/{atividadeId}:
 *   delete:
 *     summary: Deleta uma atividade bônus específica
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *       - in: path
 *         name: atividadeId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da atividade bônus
 *     responses:
 *       200:
 *         description: Atividade bônus deletada
 */
router.delete('/:id/atividades-bonus/:atividadeId', verifyToken, caixinhaController.deleteAtividadeBonus);

/**
 * @swagger
 * /caixinha/{id}/relatorio:
 *   get:
 *     summary: Gera um relatório geral da caixinha
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *     responses:
 *       200:
 *         description: Relatório geral da caixinha
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Relatorio'
 */
router.get('/:id/relatorio', verifyToken, caixinhaController.getRelatorio);

/**
 * @swagger
 * /caixinha/{id}/relatorio/contribuicoes:
 *   get:
 *     summary: Gera um relatório detalhado das contribuições de uma caixinha
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *     responses:
 *       200:
 *         description: Relatório detalhado das contribuições
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RelatorioContribuicoes'
 */
router.get('/:id/relatorio/contribuicoes', verifyToken, caixinhaController.getRelatorioContribuicoes);

/**
 * @swagger
 * /caixinha/{id}/relatorio/emprestimos:
 *   get:
 *     summary: Gera um relatório detalhado dos empréstimos de uma caixinha
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *     responses:
 *       200:
 *         description: Relatório detalhado dos empréstimos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RelatorioEmprestimos'
 */
router.get('/:id/relatorio/emprestimos', verifyToken, caixinhaController.getRelatorioEmprestimos);

/**
 * @swagger
 * /caixinha/{id}/relatorio/atividades-bonus:
 *   get:
 *     summary: Gera um relatório detalhado das atividades bônus de uma caixinha
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *     responses:
 *       200:
 *         description: Relatório detalhado das atividades bônus
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RelatorioAtividadesBonus'
 */
router.get('/:id/relatorio/atividades-bonus', verifyToken, caixinhaController.getRelatorioAtividadesBonus);

/**
 * @swagger
 * /caixinha/{id}/membros:
 *   post:
 *     summary: Adiciona um novo membro à caixinha
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Membro adicionado
 */
router.post('/:id/membros', verifyToken, caixinhaController.addMembro);

/**
 * @swagger
 * /caixinha/{id}/membros:
 *   get:
 *     summary: Lista todos os membros de uma caixinha
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *     responses:
 *       200:
 *         description: Lista de membros
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Membro'
 */
router.get('/:id/membros', verifyToken, caixinhaController.getMembros);

/**
 * @swagger
 * /caixinha/{id}/membros/{membroId}:
 *   get:
 *     summary: Retorna detalhes de um membro específico
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *       - in: path
 *         name: membroId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID do membro
 *     responses:
 *       200:
 *         description: Detalhes do membro
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Membro'
 */
router.get('/:id/membros/:membroId', verifyToken, caixinhaController.getMembroById);

/**
 * @swagger
 * /caixinha/{id}/membros/{membroId}:
 *   put:
 *     summary: Atualiza informações de um membro específico
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *       - in: path
 *         name: membroId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID do membro
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               role:
 *                 type: string
 *     responses:
 *       200:
 *         description: Informações do membro atualizadas
 */
router.put('/:id/membros/:membroId', verifyToken, caixinhaController.updateMembro);

/**
 * @swagger
 * /caixinha/{id}/membros/{membroId}:
 *   delete:
 *     summary: Remove um membro específico da caixinha
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *       - in: path
 *         name: membroId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID do membro
 *     responses:
 *       200:
 *         description: Membro removido
 */
router.delete('/:id/membros/:membroId', verifyToken, caixinhaController.deleteMembro);

/**
 * @swagger
 * /caixinha/{id}/configuracoes:
 *   get:
 *     summary: Retorna as configurações atuais da caixinha
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *     responses:
 *       200:
 *         description: Configurações da caixinha
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ConfiguracoesCaixinha'
 */
router.get('/:id/configuracoes', verifyToken, caixinhaController.getConfiguracoes);

/**
 * @swagger
 * /caixinha/{id}/configuracoes:
 *   put:
 *     summary: Atualiza as configurações da caixinha
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               regras:
 *                 type: string
 *               limites:
 *                 type: string
 *     responses:
 *       200:
 *         description: Configurações atualizadas
 */
router.put('/:id/configuracoes', verifyToken, caixinhaController.updateConfiguracoes);

/**
 * @swagger
 * /caixinha/{id}/transacoes:
 *   get:
 *     summary: Retorna o histórico completo de transações da caixinha
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *     responses:
 *       200:
 *         description: Histórico de transações
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Transacao'
 */
router.get('/:id/transacoes', verifyToken, caixinhaController.getTransacoes);

/**
 * @swagger
 * /caixinha/{id}/transacoes/{transacaoId}:
 *   get:
 *     summary: Retorna detalhes de uma transação específica
 *     tags: [Caixinha]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da caixinha
 *       - in: path
 *         name: transacaoId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID da transação
 *     responses:
 *       200:
 *         description: Detalhes da transação
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Transacao'
 */
router.get('/:id/transacoes/:transacaoId', verifyToken, caixinhaController.getTransacaoById);

module.exports = router;