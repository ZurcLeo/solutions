// src/services/caixinhaService.js
const { logger } = require('../logger');
const Caixinha = require('../models/Caixinhas');


// Busca de todas as caixinhas
const getAllCaixinhas = async (userId) => {
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
};

// Criação de uma nova caixinha
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

// Busca de caixinha por ID
const getCaixinhaById = async (id) => {
  try {
    const caixinha = await Caixinha.getById(id);
    
    logger.info('Caixinha encontrada', {
      service: 'caixinhaService',
      method: 'getCaixinhaById',
      caixinhaId: id
    });
    
    return caixinha;
  } catch (error) {
    logger.error('Erro ao buscar caixinha', {
      service: 'caixinhaService',
      method: 'getCaixinhaById',
      caixinhaId: id,
      error: error.message
    });
    throw error;
  }
};

// Atualização de caixinha
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

// Remoção de caixinha
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

// Adição de membro à caixinha
const addMembro = async (caixinhaId, userId) => {
  try {
    const caixinha = await Caixinha.getById(caixinhaId);
    
    if (caixinha.membros.includes(userId)) {
      throw new Error('Usuário já é membro desta caixinha');
    }
    
    const updatedCaixinha = await Caixinha.update(caixinhaId, {
      membros: [...caixinha.membros, userId]
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

// Atualização do saldo da caixinha
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