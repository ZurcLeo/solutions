/**
 * @fileoverview Serviço para gerenciar operações relacionadas a caixinhas.
 * @module services/caixinhaService
 * @requires ../logger
 * @requires ../models/Caixinhas
 */
const { logger } = require('../logger');
const Caixinha = require('../models/Caixinhas');

/**
 * Recupera todas as caixinhas associadas a um usuário.
 * @async
 * @function getAllCaixinhas
 * @param {string} userId - O ID do usuário para o qual as caixinhas serão buscadas.
 * @returns {Promise<Array<Object>>} Uma lista de objetos de caixinha.
 * @throws {Error} Se o ID do usuário não for fornecido ou ocorrer um erro ao buscar as caixinhas.
 * @description Busca e retorna todas as caixinhas que um determinado usuário possui ou às quais ele está associado.
 */
const getAllCaixinhas = async (userId) => {
  if (!userId) {
    throw new Error('ID do usuário não fornecido 2');
  } else {
  try {
    // Recupera todas as caixinhas do banco de dados
    const caixinhas = await Caixinha.getAll(userId);
    
    logger.info('Caixinhas recuperadas com sucesso', {
      service: 'caixinhaService',
      method: 'getAllCaixinhas',
      quantidade: caixinhas.length
    });
    
    return caixinhas;
  } catch (error) {
    logger.error('Erro ao recuperar caixinhas', {
      service: 'caixinhaService',
      method: 'getAllCaixinhas',
      error: error.message
    });
    throw error;
  }
}
}

/**
 * Cria uma nova caixinha.
 * @async
 * @function createCaixinha
 * @param {Object} data - Os dados para criação da caixinha.
 * @param {string} data.name - O nome da caixinha.
 * @param {string} data.description - A descrição da caixinha.
 * @param {string} data.adminId - O ID do usuário administrador da caixinha.
 * @param {number} [data.initialBalance=0] - O saldo inicial da caixinha.
 * @returns {Promise<Object>} O objeto da caixinha recém-criada.
 * @throws {Error} Se ocorrer um erro ao criar a caixinha.
 * @description Persiste os dados de uma nova caixinha no banco de dados.
 */
const createCaixinha = async (data) => {
  try {
    const caixinha = await Caixinha.create(data);
    
    logger.info('Caixinha criada com sucesso', {
      service: 'caixinhaService',
      method: 'createCaixinha',
      caixinhaId: caixinha.id
    });
    
    return caixinha;
  } catch (error) {
    logger.error('Erro ao criar caixinha', {
      service: 'caixinhaService',
      method: 'createCaixinha',
      error: error.message
    });
    throw error;
  }
};

/**
 * Busca uma caixinha pelo seu ID.
 * @async
 * @function getCaixinhaById
 * @param {string} caixinhaId - O ID da caixinha a ser buscada.
 * @returns {Promise<Object>} O objeto da caixinha encontrada.
 * @throws {Error} Se a caixinha não for encontrada ou ocorrer um erro na busca.
 * @description Recupera os detalhes de uma caixinha específica usando seu identificador único.
 */
const getCaixinhaById = async (caixinhaId) => {
  try {
    const caixinha = await Caixinha.getById(caixinhaId);
    
    logger.info('Caixinha encontrada', {
      service: 'caixinhaService',
      method: 'getCaixinhaById',
      caixinhaId
    });
    
    return caixinha;
  } catch (error) {
    logger.error('Erro ao buscar caixinha', {
      service: 'caixinhaService',
      method: 'getCaixinhaById',
      caixinhaId,
      error: error.message
    });
    throw error;
  }
};

/**
 * Atualiza os dados de uma caixinha existente.
 * @async
 * @function updateCaixinha
 * @param {string} id - O ID da caixinha a ser atualizada.
 * @param {Object} data - Os dados a serem atualizados na caixinha.
 * @returns {Promise<Object>} O objeto da caixinha atualizada.
 * @throws {Error} Se ocorrer um erro ao atualizar a caixinha.
 * @description Modifica as informações de uma caixinha específica no banco de dados.
 */
const updateCaixinha = async (id, data) => {
  try {
    const caixinha = await Caixinha.update(id, data);
    
    logger.info('Caixinha atualizada com sucesso', {
      service: 'caixinhaService',
      method: 'updateCaixinha',
      caixinhaId: id
    });
    
    return caixinha;
  } catch (error) {
    logger.error('Erro ao atualizar caixinha', {
      service: 'caixinhaService',
      method: 'updateCaixinha',
      caixinhaId: id,
      error: error.message
    });
    throw error;
  }
};

/**
 * Remove uma caixinha do sistema.
 * @async
 * @function deleteCaixinha
 * @param {string} id - O ID da caixinha a ser removida.
 * @returns {Promise<void>}
 * @throws {Error} Se ocorrer um erro ao remover a caixinha.
 * @description Exclui uma caixinha e todos os seus dados associados do banco de dados.
 */
const deleteCaixinha = async (id) => {
  try {
    await Caixinha.delete(id);
    
    logger.info('Caixinha removida com sucesso', {
      service: 'caixinhaService',
      method: 'deleteCaixinha',
      caixinhaId: id
    });
  } catch (error) {
    logger.error('Erro ao remover caixinha', {
      service: 'caixinhaService',
      method: 'deleteCaixinha',
      caixinhaId: id,
      error: error.message
    });
    throw error;
  }
};

/**
 * Adiciona um novo membro a uma caixinha.
 * @async
 * @function addMembro
 * @param {string} caixinhaId - O ID da caixinha.
 * @param {string} userId - O ID do usuário a ser adicionado como membro.
 * @returns {Promise<Object>} O objeto da caixinha atualizada com o novo membro.
 * @throws {Error} Se o usuário já for membro ou ocorrer um erro ao adicionar o membro.
 * @description Inclui um usuário como participante de uma caixinha existente.
 */
const addMembro = async (caixinhaId, userId) => {
  try {
    const caixinha = await Caixinha.getById(caixinhaId);
    
    if (caixinha.members.includes(userId)) {
      throw new Error('Usuário já é membro desta caixinha');
    }
    
    const updatedCaixinha = await Caixinha.update(caixinhaId, {
      membros: [...caixinha.members, userId]
    });
    
    logger.info('Membro adicionado com sucesso', {
      service: 'caixinhaService',
      method: 'addMembro',
      caixinhaId,
      userId
    });
    
    return updatedCaixinha;
  } catch (error) {
    logger.error('Erro ao adicionar membro', {
      service: 'caixinhaService',
      method: 'addMembro',
      caixinhaId,
      userId,
      error: error.message
    });
    throw error;
  }
};

/**
 * Atualiza o saldo total de uma caixinha.
 * @async
 * @function updateSaldo
 * @param {string} caixinhaId - O ID da caixinha cujo saldo será atualizado.
 * @param {number} valor - O valor a ser adicionado (crédito) ou subtraído (débito) do saldo.
 * @param {('credito'|'debito')} tipo - O tipo de operação ('credito' para adicionar, 'debito' para subtrair).
 * @returns {Promise<Object>} O objeto da caixinha com o saldo atualizado.
 * @throws {Error} Se houver saldo insuficiente para uma operação de débito ou ocorrer um erro na atualização.
 * @description Realiza operações de crédito ou débito no saldo de uma caixinha específica.
 */
const updateSaldo = async (caixinhaId, valor, tipo) => {
  try {
    const caixinha = await Caixinha.getById(caixinhaId);
    let novoSaldo;

    if (tipo === 'credito') {
      novoSaldo = caixinha.saldoTotal + valor;
    } else if (tipo === 'debito') {
      if (caixinha.saldoTotal < valor) {
        throw new Error('Saldo insuficiente');
      }
      novoSaldo = caixinha.saldoTotal - valor;
    }

    const caixinhaAtualizada = await Caixinha.update(caixinhaId, {
      saldoTotal: novoSaldo
    });

    logger.info('Saldo atualizado com sucesso', {
      service: 'caixinhaService',
      method: 'updateSaldo',
      caixinhaId,
      tipo,
      valorAnterior: caixinha.saldoTotal,
      valorNovo: novoSaldo
    });

    return caixinhaAtualizada;
  } catch (error) {
    logger.error('Erro ao atualizar saldo', {
      service: 'caixinhaService',
      method: 'updateSaldo',
      caixinhaId,
      error: error.message
    });
    throw error;
  }
};

module.exports = {
    updateSaldo,
    getAllCaixinhas,
    addMembro,
    deleteCaixinha,
    updateCaixinha,
    getCaixinhaById,
    createCaixinha
}