// src/services/transactionService.js
const { getFirestore } = require('../firebaseAdmin');
const { logger } = require('../logger');
const Transacao = require('../models/Transacao');

const db = getFirestore();

// Criação de uma nova transação
exports.createTransaction = async (data) => {
  logger.info('Iniciando criação de transação', {
    service: 'transactionService',
    method: 'createTransaction',
    data
  });

  const session = db.batch();

  try {
    const transacao = new Transacao(data);
    const transacaoRef = db
      .collection('caixinhas')
      .doc(data.caixinhaId)
      .collection('transacoes')
      .doc();

    session.set(transacaoRef, transacao);

    // Atualização do saldo da caixinha
    const caixinhaRef = db.collection('caixinhas').doc(data.caixinhaId);
    const caixinhaDoc = await caixinhaRef.get();
    const saldoAtual = caixinhaDoc.data().saldoTotal || 0;

    session.update(caixinhaRef, {
      saldoTotal: saldoAtual + data.valor,
      dataUltimaTransacao: new Date()
    });

    await session.commit();

    logger.info('Transação criada com sucesso', {
      service: 'transactionService',
      method: 'createTransaction',
      transacaoId: transacaoRef.id,
      caixinhaId: data.caixinhaId
    });

    return { ...transacao, id: transacaoRef.id };
  } catch (error) {
    logger.error('Erro ao criar transação', {
      service: 'transactionService',
      method: 'createTransaction',
      error: error.message
    });
    throw error;
  }
};

// Busca de transações por caixinha
exports.getTransacoesByCaixinha = async (caixinhaId) => {
  logger.info('Buscando transações da caixinha', {
    service: 'transactionService',
    method: 'getTransacoesByCaixinha',
    caixinhaId
  });

  try {
    const snapshot = await db
      .collection('caixinhas')
      .doc(caixinhaId)
      .collection('transacoes')
      .orderBy('data', 'desc')
      .get();

    const transacoes = snapshot.docs.map(doc => 
      new Transacao({ id: doc.id, ...doc.data() })
    );

    logger.info('Transações recuperadas com sucesso', {
      service: 'transactionService',
      method: 'getTransacoesByCaixinha',
      count: transacoes.length
    });

    return transacoes;
  } catch (error) {
    logger.error('Erro ao buscar transações', {
      service: 'transactionService',
      method: 'getTransacoesByCaixinha',
      error: error.message
    });
    throw error;
  }
};

// Processamento de empréstimos
exports.processarEmprestimo = async (caixinhaId, emprestimoId, aprovado) => {
  logger.info('Processando empréstimo', {
    service: 'transactionService',
    method: 'processarEmprestimo',
    caixinhaId,
    emprestimoId
  });

  const session = db.batch();

  try {
    const emprestimoRef = db
      .collection('caixinhas')
      .doc(caixinhaId)
      .collection('emprestimos')
      .doc(emprestimoId);
    
    const emprestimoDoc = await emprestimoRef.get();
    const emprestimo = emprestimoDoc.data();

    // Validações básicas
    if (!emprestimoDoc.exists) {
      throw new Error('Empréstimo não encontrado');
    }

    if (emprestimo.status !== 'pendente') {
      throw new Error('Empréstimo já foi processado');
    }

    await atualizarEmprestimo(session, emprestimoRef, emprestimo, aprovado);
    
    if (aprovado) {
      await criarTransacaoEmprestimo(session, caixinhaId, emprestimo, emprestimoId);
    }

    await session.commit();

    logger.info('Empréstimo processado com sucesso', {
      service: 'transactionService',
      method: 'processarEmprestimo',
      status: aprovado ? 'aprovado' : 'rejeitado'
    });

    return { success: true };
  } catch (error) {
    logger.error('Erro ao processar empréstimo', {
      service: 'transactionService',
      method: 'processarEmprestimo',
      error: error.message
    });
    throw error;
  }
};

// Geração de extrato
exports.gerarExtrato = async (caixinhaId, filtros = {}) => {
  logger.info('Gerando extrato', {
    service: 'transactionService',
    method: 'gerarExtrato',
    caixinhaId,
    filtros
  });

  try {
    let query = construirQueryExtrato(caixinhaId, filtros);
    const snapshot = await query.get();

    const transacoes = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      data: doc.data().data.toDate()
    }));

    const totais = calcularTotais(transacoes);

    logger.info('Extrato gerado com sucesso', {
      service: 'transactionService',
      method: 'gerarExtrato',
      totalTransacoes: transacoes.length
    });

    return {
      transacoes,
      totais,
      filtros,
      dataGeracao: new Date()
    };
  } catch (error) {
    logger.error('Erro ao gerar extrato', {
      service: 'transactionService',
      method: 'gerarExtrato',
      error: error.message
    });
    throw error;
  }
};

// Funções auxiliares internas
const construirQueryExtrato = (caixinhaId, filtros) => {
  let query = db
    .collection('caixinhas')
    .doc(caixinhaId)
    .collection('transacoes')
    .orderBy('data', 'desc');

  if (filtros.dataInicial) {
    query = query.where('data', '>=', new Date(filtros.dataInicial));
  }
  if (filtros.dataFinal) {
    query = query.where('data', '<=', new Date(filtros.dataFinal));
  }
  if (filtros.tipo) {
    query = query.where('tipo', '==', filtros.tipo);
  }

  return query;
};

const calcularTotais = (transacoes) => {
  return transacoes.reduce((acc, trans) => {
    if (trans.valor > 0) {
      acc.creditos += trans.valor;
    } else {
      acc.debitos += Math.abs(trans.valor);
    }
    acc.saldo = acc.creditos - acc.debitos;
    return acc;
  }, { creditos: 0, debitos: 0, saldo: 0 });
};

const atualizarEmprestimo = async (session, emprestimoRef, emprestimo, aprovado) => {
  session.update(emprestimoRef, {
    status: aprovado ? 'aprovado' : 'rejeitado',
    dataProcessamento: new Date(),
    valorLiberado: aprovado ? emprestimo.valorSolicitado : 0
  });
};

const criarTransacaoEmprestimo = async (session, caixinhaId, emprestimo, emprestimoId) => {
  const transacaoRef = db
    .collection('caixinhas')
    .doc(caixinhaId)
    .collection('transacoes')
    .doc();

  session.set(transacaoRef, {
    tipo: 'emprestimo',
    valor: -emprestimo.valorSolicitado,
    usuarioId: emprestimo.usuarioId,
    data: new Date(),
    emprestimoId: emprestimoId
  });
};