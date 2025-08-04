/**
 * @fileoverview Serviço para gerenciar contribuições e relatórios financeiros de caixinhas.
 * @module services/contribuicaoService
 * @requires firebaseAdmin
 * @requires ../logger
 */
const { getFirestore } = require('../firebaseAdmin');
const { logger } = require('../logger');

/**
 * Registra uma nova contribuição para uma caixinha em uma transação.
 * @async
 * @function registrarContribuicao
 * @param {string} caixinhaId - O ID da caixinha à qual a contribuição pertence.
 * @param {Object} data - Os dados da contribuição.
 * @param {number} data.valor - O valor da contribuição.
 * @param {string} data.membroId - O ID do membro que realizou a contribuição.
 * @returns {Promise<Object>} Um objeto contendo o ID e os dados da contribuição registrada.
 * @throws {Error} Se o valor da contribuição for inválido ou ocorrer um erro durante o registro.
 * @description Realiza uma transação atômica para registrar uma contribuição, criar um registro de transação e atualizar o saldo da caixinha.
 */
exports.registrarContribuicao = async (caixinhaId, data) => {
  logger.info('Iniciando registro de contribuição', {
    service: 'contribuicaoService',
    method: 'registrarContribuicao',
    caixinhaId
  });

  const session = db.batch();

  try {
    validarContribuicao(data);

    const { contribuicaoRef, contribuicao } = await criarRegistroContribuicao(
      session,
      caixinhaId, 
      data
    );

    await criarTransacaoContribuicao(
      session,
      caixinhaId,
      data,
      contribuicaoRef.id
    );

    await atualizarSaldoCaixinha(
      session,
      caixinhaId,
      data.valor
    );

    await session.commit();

    logger.info('Contribuição registrada com sucesso', {
      service: 'contribuicaoService',
      method: 'registrarContribuicao',
      contribuicaoId: contribuicaoRef.id
    });

    return {
      id: contribuicaoRef.id,
      ...contribuicao
    };

  } catch (error) {
    logger.error('Erro ao registrar contribuição', {
      service: 'contribuicaoService',
      method: 'registrarContribuicao',
      error: error.message
    });
    throw error;
  }
};

/**
 * Busca contribuições para uma caixinha específica, com base em filtros.
 * @async
 * @function getContribuicoesByCaixinha
 * @param {string} caixinhaId - O ID da caixinha.
 * @param {Object} [filtros={}] - Objeto contendo os critérios de filtro (ex: `dataInicio`, `dataFim`, `membroId`).
 * @returns {Promise<Array<Object>>} Uma lista de objetos de contribuição.
 * @throws {Error} Se ocorrer um erro ao buscar as contribuições.
 * @description Constrói e executa uma query no banco de dados para recuperar contribuições de uma caixinha.
 */
exports.getContribuicoesByCaixinha = async (caixinhaId, filtros = {}) => {
  logger.info('Buscando contribuições', {
    service: 'contribuicaoService',
    method: 'getContribuicoesByCaixinha',
    caixinhaId
  });

  try {
    const query = construirQueryContribuicoes(caixinhaId, filtros);
    const snapshot = await query.get();

    const contribuicoes = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    logger.info('Contribuições recuperadas', {
      service: 'contribuicaoService',
      method: 'getContribuicoesByCaixinha',
      quantidade: contribuicoes.length
    });

    return contribuicoes;
  } catch (error) {
    logger.error('Erro ao buscar contribuições', {
      service: 'contribuicaoService',
      method: 'getContribuicoesByCaixinha',
      error: error.message
    });
    throw error;
  }
};

/**
 * Gera um relatório detalhado das contribuições de uma caixinha.
 * @async
 * @function gerarRelatorioContribuicoes
 * @param {string} caixinhaId - O ID da caixinha.
 * @param {Object} [periodo={}] - Objeto com `dataInicio` e `dataFim` para filtrar o período do relatório.
 * @returns {Promise<Object>} Um objeto de relatório contendo resumo, estatísticas, detalhamento por usuário, tendências e recomendações.
 * @throws {Error} Se ocorrer um erro ao gerar o relatório.
 * @description Coleta todas as contribuições de uma caixinha em um dado período e as processa para fornecer insights financeiros.
 */
exports.gerarRelatorioContribuicoes = async (caixinhaId, periodo = {}) => {
  logger.info('Gerando relatório', {
    service: 'contribuicaoService',
    method: 'gerarRelatorioContribuicoes',
    caixinhaId
  });

  try {
    const contribuicoes = await exports.getContribuicoesByCaixinha(caixinhaId, periodo);
    const estatisticas = calcularEstatisticas(contribuicoes);
    const porUsuario = agruparPorUsuario(contribuicoes);
    const tendencias = analisarTendencias(contribuicoes);
    const atingimentoMeta = await calcularAtingimentoMeta(caixinhaId, estatisticas.totalGeral);

    const relatorio = {
      resumo: {
        totalContribuicoes: contribuicoes.length,
        valorTotalArrecadado: estatisticas.totalGeral,
        mediaContribuicaoPorUsuario: estatisticas.mediaContribuicao,
        percentualAtingimentoMeta: atingimentoMeta
      },
      estatisticas,
      contribuintesPorFaixa: agruparPorFaixaValor(contribuicoes),
      detalhamentoPorUsuario: porUsuario,
      tendencias,
      recomendacoes: gerarRecomendacoes(tendencias, estatisticas),
      dataGeracao: new Date()
    };

    logger.info('Relatório gerado com sucesso', {
      service: 'contribuicaoService',
      method: 'gerarRelatorioContribuicoes',
      totalContribuicoes: contribuicoes.length
    });

    return relatorio;
  } catch (error) {
    logger.error('Erro ao gerar relatório', {
      service: 'contribuicaoService',
      method: 'gerarRelatorioContribuicoes',
      error: error.message
    });
    throw error;
  }
};

/**
 * Valida os dados de uma contribuição.
 * @private
 * @function validarContribuicao
 * @param {Object} data - Os dados da contribuição.
 * @param {number} data.valor - O valor da contribuição.
 * @throws {Error} Se o valor da contribuição for inválido.
 * @description Garante que o valor da contribuição seja positivo.
 */
const validarContribuicao = (data) => {
  if (!data.valor || data.valor <= 0) {
    throw new Error('Valor da contribuição deve ser maior que zero');
  }
};

/**
 * Cria o registro de uma nova contribuição no Firestore.
 * @private
 * @async
 * @function criarRegistroContribuicao
 * @param {Object} session - A sessão de batch do Firestore.
 * @param {string} caixinhaId - O ID da caixinha.
 * @param {Object} data - Os dados da contribuição.
 * @returns {Promise<{contribuicaoRef: Object, contribuicao: Object}>} Um objeto contendo a referência do documento e os dados da contribuição.
 * @description Adiciona um novo documento na subcoleção 'contribuicoes' da caixinha.
 */
const criarRegistroContribuicao = async (session, caixinhaId, data) => {
  const contribuicaoRef = db
    .collection('caixinhas')
    .doc(caixinhaId)
    .collection('contribuicoes')
    .doc();

  const contribuicao = {
    ...data,
    dataContribuicao: new Date(),
    status: 'confirmada'
  };

  session.set(contribuicaoRef, contribuicao);

  return { contribuicaoRef, contribuicao };
};

/**
 * Cria um registro de transação para a contribuição.
 * @private
 * @async
 * @function criarTransacaoContribuicao
 * @param {Object} session - A sessão de batch do Firestore.
 * @param {string} caixinhaId - O ID da caixinha.
 * @param {Object} data - Os dados da contribuição.
 * @param {string} contribuicaoId - O ID da contribuição associada.
 * @returns {Promise<void>}
 * @description Adiciona um novo documento na subcoleção 'transacoes' da caixinha, registrando a contribuição como uma transação.
 */
const criarTransacaoContribuicao = async (session, caixinhaId, data, contribuicaoId) => {
  const transacaoRef = db
    .collection('caixinhas')
    .doc(caixinhaId)
    .collection('transacoes')
    .doc();

  const transacao = {
    tipo: 'contribuicao',
    valor: data.valor,
    membroId: data.membroId,
    data: new Date(),
    contribuicaoId
  };

  session.set(transacaoRef, transacao);
};

/**
 * Atualiza o saldo total da caixinha e a data da última contribuição.
 * @private
 * @async
 * @function atualizarSaldoCaixinha
 * @param {Object} session - A sessão de batch do Firestore.
 * @param {string} caixinhaId - O ID da caixinha.
 * @param {number} valor - O valor da contribuição a ser adicionado ao saldo.
 * @returns {Promise<void>}
 * @description Incrementa o `saldoTotal` e atualiza `dataUltimaContribuicao` no documento principal da caixinha.
 */
const atualizarSaldoCaixinha = async (session, caixinhaId, valor) => {
  const caixinhaRef = db.collection('caixinhas').doc(caixinhaId);
  const caixinhaDoc = await caixinhaRef.get();
  const saldoAtual = caixinhaDoc.data().saldoTotal || 0;

  session.update(caixinhaRef, {
    saldoTotal: saldoAtual + valor,
    dataUltimaContribuicao: new Date()
  });
};
