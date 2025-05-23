// src/controllers/rifaController.js
const { logger } = require('../logger');
const RifaService = require('../services/rifaService');

/**
 * Busca todas as rifas de uma caixinha
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
 * Busca uma rifa específica por ID
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
 * Cria uma nova rifa
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
 * Atualiza uma rifa existente
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
 * Cancela uma rifa
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
 * Vende um bilhete da rifa
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
 * Realiza o sorteio da rifa
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
 * Verifica a autenticidade do sorteio
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
 * Gera o comprovante do sorteio
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
  gerarComprovante
};