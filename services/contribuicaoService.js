// src/services/contribuicaoService.js
const { getFirestore } = require('../firebaseAdmin');
const { logger } = require('../logger');

// Função principal para registrar uma nova contribuição
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

// Busca de contribuições com filtros
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

// Geração de relatório detalhado
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

// Funções auxiliares internas
const validarContribuicao = (data) => {
  if (!data.valor || data.valor <= 0) {
    throw new Error('Valor da contribuição deve ser maior que zero');
  }
};

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

const atualizarSaldoCaixinha = async (session, caixinhaId, valor) => {
  const caixinhaRef = db.collection('caixinhas').doc(caixinhaId);
  const caixinhaDoc = await caixinhaRef.get();
  const saldoAtual = caixinhaDoc.data().saldoTotal || 0;

  session.update(caixinhaRef, {
    saldoTotal: saldoAtual + valor,
    dataUltimaContribuicao: new Date()
  });
};
