// src/services/rifaService.js
const { logger } = require('../logger');
const Rifa = require('../models/Rifa');
const CaixinhaService = require('./caixinhaService');
const SorteioService = require('./sorteioService');

/**
 * Serviço para gerenciamento de rifas
 */
const getAllRifasByCaixinha = async (caixinhaId) => {
  try {
    logger.info('Buscando todas as rifas da caixinha', {
      service: 'rifaService',
      method: 'getAllRifasByCaixinha',
      caixinhaId
    });

    const rifas = await Rifa.getByCaixinha(caixinhaId);
    
    return rifas;
  } catch (error) {
    logger.error('Erro ao buscar rifas da caixinha', {
      service: 'rifaService',
      method: 'getAllRifasByCaixinha',
      caixinhaId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

/**
 * Busca uma rifa específica pelo ID
 */
const getRifaById = async (caixinhaId, rifaId) => {
  try {
    logger.info('Buscando rifa por ID', {
      service: 'rifaService',
      method: 'getRifaById',
      caixinhaId,
      rifaId
    });

    const rifa = await Rifa.getById(caixinhaId, rifaId);
    if (!rifa) {
      throw new Error('Rifa não encontrada');
    }
    
    return rifa;
  } catch (error) {
    logger.error('Erro ao buscar rifa', {
      service: 'rifaService',
      method: 'getRifaById',
      caixinhaId,
      rifaId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

/**
 * Cria uma nova rifa
 */
const createRifa = async (data) => {
  try {
    logger.info('Criando nova rifa', {
      service: 'rifaService',
      method: 'createRifa',
      caixinhaId: data.caixinhaId,
      nome: data.nome
    });

    // Verificar se a caixinha existe
    const caixinha = await CaixinhaService.getCaixinhaById(data.caixinhaId);
    if (!caixinha) {
      throw new Error('Caixinha não encontrada');
    }

    // Criar a rifa
    const rifa = await Rifa.create(data);
    
    logger.info('Rifa criada com sucesso', {
      service: 'rifaService',
      method: 'createRifa',
      rifaId: rifa.id,
      caixinhaId: data.caixinhaId
    });
    
    return rifa;
  } catch (error) {
    logger.error('Erro ao criar rifa', {
      service: 'rifaService',
      method: 'createRifa',
      error: error.message,
      stack: error.stack,
      requestData: data
    });
    throw error;
  }
};

/**
 * Atualiza uma rifa existente
 */
const updateRifa = async (caixinhaId, rifaId, data) => {
  try {
    logger.info('Atualizando rifa', {
      service: 'rifaService',
      method: 'updateRifa',
      caixinhaId,
      rifaId,
      updateData: data
    });

    // Verificar se a rifa existe
    const rifa = await Rifa.getById(caixinhaId, rifaId);
    if (!rifa) {
      throw new Error('Rifa não encontrada');
    }

    // Não permitir alterações em rifas finalizadas ou canceladas
    if (rifa.status !== 'ABERTA' && !data.status) {
      throw new Error('Não é possível alterar uma rifa que não está aberta');
    }

    // Atualizar a rifa
    const rifaAtualizada = await Rifa.update(caixinhaId, rifaId, data);
    
    logger.info('Rifa atualizada com sucesso', {
      service: 'rifaService',
      method: 'updateRifa',
      caixinhaId,
      rifaId
    });
    
    return rifaAtualizada;
  } catch (error) {
    logger.error('Erro ao atualizar rifa', {
      service: 'rifaService',
      method: 'updateRifa',
      caixinhaId,
      rifaId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

/**
 * Cancela uma rifa
 */
const cancelarRifa = async (caixinhaId, rifaId, motivo) => {
  try {
    logger.info('Cancelando rifa', {
      service: 'rifaService',
      method: 'cancelarRifa',
      caixinhaId,
      rifaId,
      motivo
    });

    // Verificar se a rifa existe
    const rifa = await Rifa.getById(caixinhaId, rifaId);
    if (!rifa) {
      throw new Error('Rifa não encontrada');
    }

    // Não permitir cancelamento de rifas já finalizadas
    if (rifa.status === 'FINALIZADA') {
      throw new Error('Não é possível cancelar uma rifa já finalizada');
    }

    // Atualizar para status cancelado
    const rifaAtualizada = await Rifa.update(caixinhaId, rifaId, { 
      status: 'CANCELADA',
      motivoCancelamento: motivo || 'Não especificado'
    });
    
    logger.info('Rifa cancelada com sucesso', {
      service: 'rifaService',
      method: 'cancelarRifa',
      caixinhaId,
      rifaId
    });
    
    return rifaAtualizada;
  } catch (error) {
    logger.error('Erro ao cancelar rifa', {
      service: 'rifaService',
      method: 'cancelarRifa',
      caixinhaId,
      rifaId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

/**
 * Vende um bilhete da rifa
 */
const venderBilhete = async (caixinhaId, rifaId, membroId, numeroBilhete) => {
  try {
    logger.info('Vendendo bilhete', {
      service: 'rifaService',
      method: 'venderBilhete',
      caixinhaId,
      rifaId,
      membroId,
      numeroBilhete
    });

    // Verificar se a rifa existe
    const rifa = await Rifa.getById(caixinhaId, rifaId);
    if (!rifa) {
      throw new Error('Rifa não encontrada');
    }

    // Vender o bilhete
    const bilhete = await rifa.venderBilhete(caixinhaId, rifaId, membroId, numeroBilhete);
    
    logger.info('Bilhete vendido com sucesso', {
      service: 'rifaService',
      method: 'venderBilhete',
      caixinhaId,
      rifaId,
      membroId,
      numeroBilhete
    });
    
    return bilhete;
  } catch (error) {
    logger.error('Erro ao vender bilhete', {
      service: 'rifaService',
      method: 'venderBilhete',
      caixinhaId,
      rifaId,
      membroId,
      numeroBilhete,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

/**
 * Realiza o sorteio da rifa
 */
const realizarSorteio = async (caixinhaId, rifaId, metodo, referencia) => {
  try {
    logger.info('Realizando sorteio', {
      service: 'rifaService',
      method: 'realizarSorteio',
      caixinhaId,
      rifaId,
      metodo,
      referencia
    });

    // Verificar se a rifa existe
    const rifa = await Rifa.getById(caixinhaId, rifaId);
    if (!rifa) {
      throw new Error('Rifa não encontrada');
    }

    let numeroSorteado;

    // Obter o número sorteado de acordo com o método escolhido
    switch (metodo) {
      case 'LOTERIA':
        // Verificar se a referência (número do concurso) foi informada
        if (!referencia) {
          throw new Error('É necessário informar o número do concurso da loteria');
        }
        numeroSorteado = await SorteioService.obterResultadoLoteria(referencia);
        break;
        
      case 'RANDOM_ORG':
        numeroSorteado = await SorteioService.obterNumeroAleatorioRandomOrg(1, rifa.quantidadeBilhetes, 1);
        break;
        
      case 'NIST':
        numeroSorteado = await SorteioService.obterNumeroAleatorioNIST(rifa.quantidadeBilhetes);
        break;
        
      default:
        throw new Error('Método de sorteio inválido');
    }

    // Registrar o resultado do sorteio
    const resultado = await rifa.registrarSorteio(caixinhaId, rifaId, numeroSorteado, metodo, referencia);
    
    // Gerar comprovante do sorteio
    const comprovante = await SorteioService.gerarComprovante(caixinhaId, rifaId, resultado);
    
    // Atualizar o comprovante na rifa
    await Rifa.update(caixinhaId, rifaId, {
      'sorteioResultado.comprovante': comprovante
    });
    
    logger.info('Sorteio realizado com sucesso', {
      service: 'rifaService',
      method: 'realizarSorteio',
      caixinhaId,
      rifaId,
      numeroSorteado,
      metodo,
      vencedor: resultado.bilheteVencedor ? resultado.bilheteVencedor.membroId : 'Nenhum vencedor'
    });
    
    return {
      ...resultado,
      comprovante
    };
  } catch (error) {
    logger.error('Erro ao realizar sorteio', {
      service: 'rifaService',
      method: 'realizarSorteio',
      caixinhaId,
      rifaId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

/**
 * Verifica a autenticidade de um sorteio
 */
const verificarAutenticidadeSorteio = async (caixinhaId, rifaId) => {
  try {
    logger.info('Verificando autenticidade do sorteio', {
      service: 'rifaService',
      method: 'verificarAutenticidadeSorteio',
      caixinhaId,
      rifaId
    });

    // Verificar se a rifa existe
    const rifa = await Rifa.getById(caixinhaId, rifaId);
    if (!rifa) {
      throw new Error('Rifa não encontrada');
    }

    // Verificar se a rifa foi sorteada
    if (rifa.status !== 'FINALIZADA' || !rifa.sorteioResultado) {
      throw new Error('Esta rifa ainda não foi sorteada');
    }

    // Verificar a autenticidade do sorteio
    const autenticidade = await SorteioService.verificarIntegridade(caixinhaId, rifaId, rifa.sorteioResultado);
    
    logger.info('Autenticidade do sorteio verificada', {
      service: 'rifaService',
      method: 'verificarAutenticidadeSorteio',
      caixinhaId,
      rifaId,
      autenticidade
    });
    
    return autenticidade;
  } catch (error) {
    logger.error('Erro ao verificar autenticidade do sorteio', {
      service: 'rifaService',
      method: 'verificarAutenticidadeSorteio',
      caixinhaId,
      rifaId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

/**
 * Gera o comprovante do sorteio
 */
const gerarComprovanteSorteio = async (caixinhaId, rifaId) => {
  try {
    logger.info('Gerando comprovante do sorteio', {
      service: 'rifaService',
      method: 'gerarComprovanteSorteio',
      caixinhaId,
      rifaId
    });

    // Verificar se a rifa existe
    const rifa = await Rifa.getById(caixinhaId, rifaId);
    if (!rifa) {
      throw new Error('Rifa não encontrada');
    }

    // Verificar se a rifa foi sorteada
    if (rifa.status !== 'FINALIZADA' || !rifa.sorteioResultado) {
      throw new Error('Esta rifa ainda não foi sorteada');
    }

    // Gerar comprovante
    const comprovante = await SorteioService.gerarComprovante(caixinhaId, rifaId, rifa.sorteioResultado);
    
    // Atualizar rifa com o comprovante gerado, se ainda não tiver
    if (!rifa.sorteioResultado.comprovante) {
      await Rifa.update(caixinhaId, rifaId, {
        'sorteioResultado.comprovante': comprovante
      });
    }
    
    logger.info('Comprovante do sorteio gerado com sucesso', {
      service: 'rifaService',
      method: 'gerarComprovanteSorteio',
      caixinhaId,
      rifaId,
      comprovante
    });
    
    return comprovante;
  } catch (error) {
    logger.error('Erro ao gerar comprovante do sorteio', {
      service: 'rifaService',
      method: 'gerarComprovanteSorteio',
      caixinhaId,
      rifaId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

module.exports = {
  getAllRifasByCaixinha,
  getRifaById,
  createRifa,
  updateRifa,
  cancelarRifa,
  venderBilhete,
  realizarSorteio,
  verificarAutenticidadeSorteio,
  gerarComprovanteSorteio
};