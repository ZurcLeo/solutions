/**
 * @fileoverview Controller de rifas - gerencia rifas, bilhetes e sorteios em caixinhas
 * @module controllers/rifaController
 */

const { logger } = require('../logger');
const RifaService = require('../services/rifaService');

/**
 * Busca todas as rifas de uma caixinha específica
 * @async
 * @function listarRifas
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.caixinhaId - ID da caixinha
 * @param {Object} req.user - Usuário autenticado
 * @param {string} req.user.uid - ID do usuário
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Lista de rifas da caixinha
 */
const listarRifas = async (req, res) => {
  const { caixinhaId } = req.params;
  const userId = req.user.uid;

  logger.info('Iniciando busca de rifas', {
    controller: 'RifaController',
    function: 'listarRifas',
    caixinhaId,
    userId
  });

  try {
    if (!req.user) {
      logger.warn('Tentativa de acesso sem autenticação', {
        controller: 'RifaController',
        function: 'listarRifas'
      });
      return res.status(401).json({
        message: 'Usuário não autenticado'
      });
    }

    const rifas = await RifaService.getAllRifasByCaixinha(caixinhaId);
    
    logger.info('Rifas recuperadas com sucesso', {
      controller: 'RifaController',
      function: 'listarRifas',
      caixinhaId,
      userId,
      count: rifas.length
    });

    return res.status(200).json({
      success: true,
      data: rifas
    });
  } catch (error) {
    logger.error('Erro ao buscar rifas', {
      controller: 'RifaController',
      function: 'listarRifas',
      error: error.message,
      stack: error.stack,
      caixinhaId,
      userId
    });

    return res.status(500).json({
      success: false,
      message: 'Erro ao buscar rifas',
      error: error.message
    });
  }
};

/**
 * Busca uma rifa específica por ID dentro de uma caixinha
 * @async
 * @function obterRifa
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.caixinhaId - ID da caixinha
 * @param {string} req.params.rifaId - ID da rifa
 * @param {Object} req.user - Usuário autenticado
 * @param {string} req.user.uid - ID do usuário
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Dados da rifa
 */
const obterRifa = async (req, res) => {
  const { caixinhaId, rifaId } = req.params;
  const userId = req.user.uid;

  logger.info('Iniciando busca de rifa por ID', {
    controller: 'RifaController',
    function: 'obterRifa',
    caixinhaId,
    rifaId,
    userId
  });

  try {
    if (!req.user) {
      logger.warn('Tentativa de acesso sem autenticação', {
        controller: 'RifaController',
        function: 'obterRifa'
      });
      return res.status(401).json({
        message: 'Usuário não autenticado'
      });
    }

    const rifa = await RifaService.getRifaById(caixinhaId, rifaId);
    
    logger.info('Rifa recuperada com sucesso', {
      controller: 'RifaController',
      function: 'obterRifa',
      caixinhaId,
      rifaId,
      userId
    });

    return res.status(200).json({
      success: true,
      data: rifa
    });
  } catch (error) {
    logger.error('Erro ao buscar rifa', {
      controller: 'RifaController',
      function: 'obterRifa',
      error: error.message,
      stack: error.stack,
      caixinhaId,
      rifaId,
      userId
    });

    return res.status(500).json({
      success: false,
      message: 'Erro ao buscar rifa',
      error: error.message
    });
  }
};

/**
 * Cria uma nova rifa em uma caixinha
 * @async
 * @function criarRifa
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.caixinhaId - ID da caixinha
 * @param {Object} req.user - Usuário autenticado
 * @param {string} req.user.uid - ID do usuário
 * @param {Object} req.body - Dados da rifa
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Rifa criada
 */
const criarRifa = async (req, res) => {
  const { caixinhaId } = req.params;
  const userId = req.user.uid;
  const rifaData = req.body;

  logger.info('Iniciando criação de rifa', {
    controller: 'RifaController',
    function: 'criarRifa',
    caixinhaId,
    userId,
    rifaData
  });

  try {
    if (!req.user) {
      logger.warn('Tentativa de acesso sem autenticação', {
        controller: 'RifaController',
        function: 'criarRifa'
      });
      return res.status(401).json({
        message: 'Usuário não autenticado'
      });
    }

    // Adicionar o ID da caixinha aos dados da rifa
    const rifa = await RifaService.createRifa({
      ...rifaData,
      caixinhaId
    });
    
    logger.info('Rifa criada com sucesso', {
      controller: 'RifaController',
      function: 'criarRifa',
      caixinhaId,
      userId,
      rifaId: rifa.id
    });

    return res.status(201).json({
      success: true,
      data: rifa
    });
  } catch (error) {
    logger.error('Erro ao criar rifa', {
      controller: 'RifaController',
      function: 'criarRifa',
      error: error.message,
      stack: error.stack,
      caixinhaId,
      userId
    });

    return res.status(500).json({
      success: false,
      message: 'Erro ao criar rifa',
      error: error.message
    });
  }
};

/**
 * Atualiza dados de uma rifa existente
 * @async
 * @function atualizarRifa
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.caixinhaId - ID da caixinha
 * @param {string} req.params.rifaId - ID da rifa
 * @param {Object} req.user - Usuário autenticado
 * @param {string} req.user.uid - ID do usuário
 * @param {Object} req.body - Dados atualizados da rifa
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Rifa atualizada
 */
const atualizarRifa = async (req, res) => {
  const { caixinhaId, rifaId } = req.params;
  const userId = req.user.uid;
  const rifaData = req.body;

  logger.info('Iniciando atualização de rifa', {
    controller: 'RifaController',
    function: 'atualizarRifa',
    caixinhaId,
    rifaId,
    userId,
    rifaData
  });

  try {
    if (!req.user) {
      logger.warn('Tentativa de acesso sem autenticação', {
        controller: 'RifaController',
        function: 'atualizarRifa'
      });
      return res.status(401).json({
        message: 'Usuário não autenticado'
      });
    }

    const rifa = await RifaService.updateRifa(caixinhaId, rifaId, rifaData);
    
    logger.info('Rifa atualizada com sucesso', {
      controller: 'RifaController',
      function: 'atualizarRifa',
      caixinhaId,
      rifaId,
      userId
    });

    return res.status(200).json({
      success: true,
      data: rifa
    });
  } catch (error) {
    logger.error('Erro ao atualizar rifa', {
      controller: 'RifaController',
      function: 'atualizarRifa',
      error: error.message,
      stack: error.stack,
      caixinhaId,
      rifaId,
      userId
    });

    return res.status(500).json({
      success: false,
      message: 'Erro ao atualizar rifa',
      error: error.message
    });
  }
};

/**
 * Cancela uma rifa existente com motivo
 * @async
 * @function cancelarRifa
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.caixinhaId - ID da caixinha
 * @param {string} req.params.rifaId - ID da rifa
 * @param {Object} req.user - Usuário autenticado
 * @param {string} req.user.uid - ID do usuário
 * @param {string} req.body.motivo - Motivo do cancelamento
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Rifa cancelada
 */
const cancelarRifa = async (req, res) => {
  const { caixinhaId, rifaId } = req.params;
  const userId = req.user.uid;
  const { motivo } = req.body;

  logger.info('Iniciando cancelamento de rifa', {
    controller: 'RifaController',
    function: 'cancelarRifa',
    caixinhaId,
    rifaId,
    userId,
    motivo
  });

  try {
    if (!req.user) {
      logger.warn('Tentativa de acesso sem autenticação', {
        controller: 'RifaController',
        function: 'cancelarRifa'
      });
      return res.status(401).json({
        message: 'Usuário não autenticado'
      });
    }

    const rifa = await RifaService.cancelarRifa(caixinhaId, rifaId, motivo);
    
    logger.info('Rifa cancelada com sucesso', {
      controller: 'RifaController',
      function: 'cancelarRifa',
      caixinhaId,
      rifaId,
      userId
    });

    return res.status(200).json({
      success: true,
      data: rifa
    });
  } catch (error) {
    logger.error('Erro ao cancelar rifa', {
      controller: 'RifaController',
      function: 'cancelarRifa',
      error: error.message,
      stack: error.stack,
      caixinhaId,
      rifaId,
      userId
    });

    return res.status(500).json({
      success: false,
      message: 'Erro ao cancelar rifa',
      error: error.message
    });
  }
};

/**
 * Processa venda de bilhete da rifa para um usuário
 * @async
 * @function venderBilhete
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.caixinhaId - ID da caixinha
 * @param {string} req.params.rifaId - ID da rifa
 * @param {Object} req.user - Usuário autenticado
 * @param {string} req.user.uid - ID do usuário
 * @param {number} req.body.numeroBilhete - Número do bilhete
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Bilhete vendido
 */
const venderBilhete = async (req, res) => {
  const { caixinhaId, rifaId } = req.params;
  const userId = req.user.uid;
  const { numeroBilhete } = req.body;

  logger.info('Iniciando venda de bilhete', {
    controller: 'RifaController',
    function: 'venderBilhete',
    caixinhaId,
    rifaId,
    userId,
    numeroBilhete
  });

  try {
    if (!req.user) {
      logger.warn('Tentativa de acesso sem autenticação', {
        controller: 'RifaController',
        function: 'venderBilhete'
      });
      return res.status(401).json({
        message: 'Usuário não autenticado'
      });
    }

    const bilhete = await RifaService.venderBilhete(caixinhaId, rifaId, userId, numeroBilhete);
    
    logger.info('Bilhete vendido com sucesso', {
      controller: 'RifaController',
      function: 'venderBilhete',
      caixinhaId,
      rifaId,
      userId,
      numeroBilhete
    });

    return res.status(200).json({
      success: true,
      data: bilhete
    });
  } catch (error) {
    logger.error('Erro ao vender bilhete', {
      controller: 'RifaController',
      function: 'venderBilhete',
      error: error.message,
      stack: error.stack,
      caixinhaId,
      rifaId,
      userId,
      numeroBilhete
    });

    return res.status(500).json({
      success: false,
      message: 'Erro ao vender bilhete',
      error: error.message
    });
  }
};

/**
 * Executa sorteio da rifa com método e referência específicos
 * @async
 * @function realizarSorteio
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.caixinhaId - ID da caixinha
 * @param {string} req.params.rifaId - ID da rifa
 * @param {Object} req.user - Usuário autenticado
 * @param {string} req.user.uid - ID do usuário
 * @param {string} req.body.metodo - Método do sorteio
 * @param {string} req.body.referencia - Referência do sorteio
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Resultado do sorteio
 */
const realizarSorteio = async (req, res) => {
  const { caixinhaId, rifaId } = req.params;
  const userId = req.user.uid;
  const { metodo, referencia } = req.body;

  logger.info('Iniciando sorteio de rifa', {
    controller: 'RifaController',
    function: 'realizarSorteio',
    caixinhaId,
    rifaId,
    userId,
    metodo,
    referencia
  });

  try {
    if (!req.user) {
      logger.warn('Tentativa de acesso sem autenticação', {
        controller: 'RifaController',
        function: 'realizarSorteio'
      });
      return res.status(401).json({
        message: 'Usuário não autenticado'
      });
    }

    const resultado = await RifaService.realizarSorteio(caixinhaId, rifaId, metodo, referencia);
    
    logger.info('Sorteio realizado com sucesso', {
      controller: 'RifaController',
      function: 'realizarSorteio',
      caixinhaId,
      rifaId,
      userId,
      numeroSorteado: resultado.numeroSorteado
    });

    return res.status(200).json({
      success: true,
      data: resultado
    });
  } catch (error) {
    logger.error('Erro ao realizar sorteio', {
      controller: 'RifaController',
      function: 'realizarSorteio',
      error: error.message,
      stack: error.stack,
      caixinhaId,
      rifaId,
      userId
    });

    return res.status(500).json({
      success: false,
      message: 'Erro ao realizar sorteio',
      error: error.message
    });
  }
};

/**
 * Verifica autenticidade e integridade de um sorteio realizado
 * @async
 * @function verificarAutenticidade
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.caixinhaId - ID da caixinha
 * @param {string} req.params.rifaId - ID da rifa
 * @param {Object} req.user - Usuário autenticado
 * @param {string} req.user.uid - ID do usuário
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Resultado da verificação
 */
const verificarAutenticidade = async (req, res) => {
  const { caixinhaId, rifaId } = req.params;
  const userId = req.user.uid;

  logger.info('Iniciando verificação de autenticidade do sorteio', {
    controller: 'RifaController',
    function: 'verificarAutenticidade',
    caixinhaId,
    rifaId,
    userId
  });

  try {
    if (!req.user) {
      logger.warn('Tentativa de acesso sem autenticação', {
        controller: 'RifaController',
        function: 'verificarAutenticidade'
      });
      return res.status(401).json({
        message: 'Usuário não autenticado'
      });
    }

    const resultado = await RifaService.verificarAutenticidadeSorteio(caixinhaId, rifaId);
    
    logger.info('Autenticidade do sorteio verificada com sucesso', {
      controller: 'RifaController',
      function: 'verificarAutenticidade',
      caixinhaId,
      rifaId,
      userId
    });

    return res.status(200).json({
      success: true,
      data: resultado
    });
  } catch (error) {
    logger.error('Erro ao verificar autenticidade do sorteio', {
      controller: 'RifaController',
      function: 'verificarAutenticidade',
      error: error.message,
      stack: error.stack,
      caixinhaId,
      rifaId,
      userId
    });

    return res.status(500).json({
      success: false,
      message: 'Erro ao verificar autenticidade do sorteio',
      error: error.message
    });
  }
};

/**
 * Gera comprovante oficial do sorteio realizado
 * @async
 * @function gerarComprovante
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.caixinhaId - ID da caixinha
 * @param {string} req.params.rifaId - ID da rifa
 * @param {Object} req.user - Usuário autenticado
 * @param {string} req.user.uid - ID do usuário
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Comprovante do sorteio
 */
const gerarComprovante = async (req, res) => {
  const { caixinhaId, rifaId } = req.params;
  const userId = req.user.uid;

  logger.info('Iniciando geração de comprovante do sorteio', {
    controller: 'RifaController',
    function: 'gerarComprovante',
    caixinhaId,
    rifaId,
    userId
  });

  try {
    if (!req.user) {
      logger.warn('Tentativa de acesso sem autenticação', {
        controller: 'RifaController',
        function: 'gerarComprovante'
      });
      return res.status(401).json({
        message: 'Usuário não autenticado'
      });
    }

    const comprovante = await RifaService.gerarComprovanteSorteio(caixinhaId, rifaId);
    
    logger.info('Comprovante do sorteio gerado com sucesso', {
      controller: 'RifaController',
      function: 'gerarComprovante',
      caixinhaId,
      rifaId,
      userId
    });

    return res.status(200).json({
      success: true,
      data: comprovante
    });
  } catch (error) {
    logger.error('Erro ao gerar comprovante do sorteio', {
      controller: 'RifaController',
      function: 'gerarComprovante',
      error: error.message,
      stack: error.stack,
      caixinhaId,
      rifaId,
      userId
    });

    return res.status(500).json({
      success: false,
      message: 'Erro ao gerar comprovante do sorteio',
      error: error.message
    });
  }
};

// ── Votação em concursos ──────────────────────────────────────────────────

const votarConcurso = async (req, res) => {
  const { caixinhaId, rifaId } = req.params;
  const userId = req.user.uid;
  const { candidato } = req.body;

  logger.info('Registrando voto em concurso', {
    controller: 'RifaController', function: 'votarConcurso', caixinhaId, rifaId, userId, candidato
  });

  try {
    const voto = await RifaService.votar(caixinhaId, rifaId, userId, candidato);
    return res.status(201).json({ success: true, data: voto });
  } catch (error) {
    logger.error('Erro ao votar', { controller: 'RifaController', error: error.message, caixinhaId, rifaId, userId });
    const status = error.message.includes('já votou') ? 409 : 400;
    return res.status(status).json({ success: false, message: error.message });
  }
};

const listarVotos = async (req, res) => {
  const { caixinhaId, rifaId } = req.params;
  const userId = req.user.uid;

  logger.info('Listando votos do concurso', {
    controller: 'RifaController', function: 'listarVotos', caixinhaId, rifaId, userId
  });

  try {
    const votos = await RifaService.getVotos(caixinhaId, rifaId);
    return res.status(200).json({ success: true, data: votos });
  } catch (error) {
    logger.error('Erro ao listar votos', { controller: 'RifaController', error: error.message, caixinhaId, rifaId });
    return res.status(500).json({ success: false, message: error.message });
  }
};

const resolverConcurso = async (req, res) => {
  const { caixinhaId, rifaId } = req.params;
  const userId = req.user.uid;
  const { forcar } = req.body;

  logger.info('Resolvendo concurso', {
    controller: 'RifaController', function: 'resolverConcurso', caixinhaId, rifaId, userId, forcar
  });

  try {
    const resultado = await RifaService.resolverConcurso(caixinhaId, rifaId, !!forcar);
    return res.status(200).json({ success: true, data: resultado });
  } catch (error) {
    logger.error('Erro ao resolver concurso', { controller: 'RifaController', error: error.message, caixinhaId, rifaId });
    const status = error.message.includes('Quórum') ? 422 : 400;
    return res.status(status).json({ success: false, message: error.message });
  }
};

// ── Amigo Secreto ─────────────────────────────────────────────────────────

const executarSorteioAmigo = async (req, res) => {
  const { caixinhaId, rifaId } = req.params;
  const userId = req.user.uid;
  const { participantes, limitePresente } = req.body;

  logger.info('Executando sorteio de Amigo Secreto', {
    controller: 'RifaController', function: 'executarSorteioAmigo', caixinhaId, rifaId, userId
  });

  try {
    const resultado = await RifaService.sortearPares(caixinhaId, rifaId, participantes);
    return res.status(200).json({ success: true, data: resultado });
  } catch (error) {
    logger.error('Erro ao sortear pares', { controller: 'RifaController', error: error.message, caixinhaId, rifaId });
    const status = error.message.includes('já foram sorteados') ? 409
      : error.message.includes('pelo menos 2') ? 422 : 400;
    return res.status(status).json({ success: false, message: error.message });
  }
};

const revelarMeuPar = async (req, res) => {
  const { caixinhaId, rifaId } = req.params;
  const userId = req.user.uid;

  logger.info('Revelando par do Amigo Secreto', {
    controller: 'RifaController', function: 'revelarMeuPar', caixinhaId, rifaId, userId
  });

  try {
    const par = await RifaService.getMeuPar(caixinhaId, rifaId, userId);
    return res.status(200).json({ success: true, data: par });
  } catch (error) {
    logger.error('Erro ao revelar par', { controller: 'RifaController', error: error.message, caixinhaId, rifaId, userId });
    return res.status(404).json({ success: false, message: error.message });
  }
};

const listarTodosPares = async (req, res) => {
  const { caixinhaId, rifaId } = req.params;
  const userId = req.user.uid;

  logger.info('Listando todos os pares do Amigo Secreto (admin)', {
    controller: 'RifaController', function: 'listarTodosPares', caixinhaId, rifaId, userId
  });

  try {
    const pares = await RifaService.getTodasPares(caixinhaId, rifaId);
    return res.status(200).json({ success: true, data: pares });
  } catch (error) {
    logger.error('Erro ao listar pares', { controller: 'RifaController', error: error.message, caixinhaId, rifaId });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Adicionar os controladores ao módulo exportado
module.exports = {
  listarRifas,
  obterRifa,
  criarRifa,
  atualizarRifa,
  cancelarRifa,
  venderBilhete,
  realizarSorteio,
  verificarAutenticidade,
  gerarComprovante,
  votarConcurso,
  listarVotos,
  resolverConcurso,
  executarSorteioAmigo,
  revelarMeuPar,
  listarTodosPares,
};