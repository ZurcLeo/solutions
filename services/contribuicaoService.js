/**
 * @fileoverview Serviço para gerenciar contribuições e relatórios financeiros de caixinhas.
 * @module services/contribuicaoService
 */
const { logger } = require('../logger');
const { getSupabaseClient } = require('../config/supabase');
const { randomUUID } = require('crypto');

// Firestore permanece como backup fire-and-forget durante a transição
const { getFirestore, FieldValue } = require('../firebaseAdmin');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sb = () => getSupabaseClient();

// ─── Pré-validações ───────────────────────────────────────────────────────────

const verificarMembroAtivo = async (caixinhaId, membroId) => {
  const supabase = sb();
  if (supabase) {
    const { data, error } = await supabase
      .from('caixinha_members')
      .select('status')
      .eq('caixinha_id', caixinhaId)
      .eq('user_id', membroId)
      .maybeSingle();

    if (error) {
      logger.warn('verificarMembroAtivo: erro Supabase, tentando Firestore', { error: error.message });
    } else {
      if (!data) throw new Error('Membro não encontrado nesta caixinha.');
      const status = data.status || 'ativo';
      if (status !== 'ativo') {
        throw new Error(`Membro com status '${status}' não pode realizar contribuições.`);
      }
      return;
    }
  }

  // Fallback Firestore
  const db = getFirestore();
  const snapshot = await db
    .collection('caixinhas')
    .doc(caixinhaId)
    .collection('membros')
    .where('userId', '==', membroId)
    .limit(1)
    .get();

  if (snapshot.empty) throw new Error('Membro não encontrado nesta caixinha.');
  const { status = 'ativo' } = snapshot.docs[0].data();
  if (status !== 'ativo') {
    throw new Error(`Membro com status '${status}' não pode realizar contribuições.`);
  }
};

const verificarDuplicidade = async (caixinhaId, membroId) => {
  const hoje = new Date();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);

  const supabase = sb();
  if (supabase) {
    const { data, error } = await supabase
      .from('contribuicoes')
      .select('id, status')
      .eq('caixinha_id', caixinhaId)
      .eq('user_id', membroId)
      .gte('data_contribuicao', inicioMes.toISOString())
      .neq('status', 'estornada')
      .limit(1);

    if (error) {
      logger.warn('verificarDuplicidade: erro Supabase, tentando Firestore', { error: error.message });
    } else {
      if (data && data.length > 0) {
        throw new Error('Membro já realizou contribuição neste mês.');
      }
      return;
    }
  }

  // Fallback Firestore
  const db = getFirestore();
  const snapshot = await db
    .collection('caixinhas')
    .doc(caixinhaId)
    .collection('contribuicoes')
    .where('membroId', '==', membroId)
    .where('dataContribuicao', '>=', inicioMes)
    .limit(5)
    .get();

  const ativa = snapshot.docs.find(doc => doc.data().status !== 'estornada');
  if (ativa) throw new Error('Membro já realizou contribuição neste mês.');
};

/**
 * Registra uma nova contribuição para uma caixinha.
 */
exports.registrarContribuicao = async (caixinhaId, data) => {
  logger.info('Iniciando registro de contribuição', {
    service: 'contribuicaoService',
    method: 'registrarContribuicao',
    caixinhaId
  });

  try {
    validarContribuicao(data);
    await verificarMembroAtivo(caixinhaId, data.membroId);
    await verificarDuplicidade(caixinhaId, data.membroId);

    const contribuicaoId = randomUUID();
    const now = new Date().toISOString();

    const supabase = sb();
    if (supabase) {
      // 1. Inserir contribuição
      const { error: errContrib } = await supabase
        .from('contribuicoes')
        .insert({
          id: contribuicaoId,
          caixinha_id: caixinhaId,
          user_id: data.membroId,
          valor: data.valor,
          status: 'confirmada',
          data_contribuicao: now
        });

      if (errContrib) throw new Error(`Supabase contribuicoes insert: ${errContrib.message}`);

      // 2. Inserir transação
      const { error: errTrans } = await supabase
        .from('transacoes')
        .insert({
          id: randomUUID(),
          caixinha_id: caixinhaId,
          user_id: data.membroId,
          tipo: 'contribuicao',
          valor: data.valor,
          data: now,
          contribuicao_id: contribuicaoId
        });

      if (errTrans) {
        logger.warn('Supabase transacoes insert falhou (não crítico)', { error: errTrans.message });
      }

      // 3. Atualizar saldo da caixinha (RPC atômica — sem race condition) (RISCO-03)
      const { error: errSaldo } = await supabase.rpc('update_caixinha_saldo', {
        p_caixinha_id: caixinhaId,
        p_delta: data.valor,
        p_min_saldo: 0
      });

      if (errSaldo) {
        logger.warn('Falha ao atualizar saldo via RPC (não crítico)', {
          service: 'contribuicaoService', caixinhaId, error: errSaldo.message
        });
      }
    }

    // Backup Firestore fire-and-forget
    try {
      const db = getFirestore();
      const batch = db.batch();
      const contribRef = db.collection('caixinhas').doc(caixinhaId).collection('contribuicoes').doc(contribuicaoId);
      const transacaoRef = db.collection('caixinhas').doc(caixinhaId).collection('transacoes').doc();
      const caixinhaRef = db.collection('caixinhas').doc(caixinhaId);
      batch.set(contribRef, { ...data, dataContribuicao: new Date(), status: 'confirmada' });
      batch.set(transacaoRef, { tipo: 'contribuicao', valor: data.valor, membroId: data.membroId, data: new Date(), contribuicaoId });
      batch.update(caixinhaRef, { saldoTotal: FieldValue.increment(data.valor), dataUltimaContribuicao: new Date() });
      batch.commit().catch(() => {});
    } catch (_) {}

    // [GAME-COV-003] fire-and-forget
    setImmediate(() => {
      const gamificationService = require('./gamificationService');
      gamificationService.triggerEvent('contribution_paid', data.membroId)
        .catch(err => logger.warn('Falha ao acionar gamificação em contribuição paga', {
          service: 'contribuicaoService', userId: data.membroId, error: err.message
        }));

      // Trust Passport — contribuição paga (+2 financial)
      const trustPassportService = require('./trustPassportService');
      trustPassportService.recordEvent(data.membroId, 'financial', 'contribution_paid', 2, false, { contribuicaoId })
        .catch(err => logger.warn('Falha ao registrar trust event contribution_paid', {
          service: 'contribuicaoService', userId: data.membroId, error: err.message
        }));
    });

    logger.info('Contribuição registrada com sucesso', {
      service: 'contribuicaoService',
      method: 'registrarContribuicao',
      contribuicaoId
    });

    return { id: contribuicaoId, caixinhaId, ...data, dataContribuicao: now, status: 'confirmada' };

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
 * Busca contribuições de uma caixinha com filtros opcionais.
 */
exports.getContribuicoesByCaixinha = async (caixinhaId, filtros = {}) => {
  logger.info('Buscando contribuições', {
    service: 'contribuicaoService',
    method: 'getContribuicoesByCaixinha',
    caixinhaId
  });

  try {
    const supabase = sb();
    if (supabase) {
      let query = supabase
        .from('contribuicoes')
        .select('*')
        .eq('caixinha_id', caixinhaId)
        .order('data_contribuicao', { ascending: false });

      if (filtros.membroId) query = query.eq('user_id', filtros.membroId);
      if (filtros.dataInicio) query = query.gte('data_contribuicao', new Date(filtros.dataInicio).toISOString());
      if (filtros.dataFim) query = query.lte('data_contribuicao', new Date(filtros.dataFim).toISOString());

      const { data, error } = await query;
      if (!error && data) {
        // Normaliza snake_case → camelCase para compatibilidade com código existente
        const contribuicoes = data.map(row => ({
          id: row.id,
          caixinhaId: row.caixinha_id,
          membroId: row.user_id,
          valor: Number(row.valor),
          status: row.status,
          dataContribuicao: row.data_contribuicao,
          ...row
        }));

        logger.info('Contribuições recuperadas (Supabase)', {
          service: 'contribuicaoService',
          quantidade: contribuicoes.length
        });
        return contribuicoes;
      }

      logger.warn('Supabase retornou erro, fallback Firestore', { error: error?.message });
    }

    // Fallback Firestore
    const db = getFirestore();
    let query = db.collection('caixinhas').doc(caixinhaId).collection('contribuicoes');
    if (filtros.membroId) query = query.where('membroId', '==', filtros.membroId);
    if (filtros.dataInicio) query = query.where('dataContribuicao', '>=', filtros.dataInicio);
    if (filtros.dataFim) query = query.where('dataContribuicao', '<=', filtros.dataFim);

    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

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
 * Gera relatório de contribuições de uma caixinha.
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

// ─── Helpers privados ─────────────────────────────────────────────────────────

const validarContribuicao = (data) => {
  if (!data.valor || data.valor <= 0) {
    throw new Error('Valor da contribuição deve ser maior que zero');
  }
};

const calcularEstatisticas = (contribuicoes) => {
  const ativas = contribuicoes.filter(c => c.status !== 'estornada');
  const totalGeral = ativas.reduce((sum, c) => sum + Number(c.valor || 0), 0);
  const usuariosUnicos = new Set(ativas.map(c => c.membroId || c.user_id)).size;
  return {
    totalGeral,
    totalContribuicoes: ativas.length,
    mediaContribuicao: usuariosUnicos > 0 ? totalGeral / usuariosUnicos : 0,
    totalEstornadas: contribuicoes.length - ativas.length
  };
};

const agruparPorUsuario = (contribuicoes) => {
  const mapa = {};
  for (const c of contribuicoes) {
    const uid = c.membroId || c.user_id;
    if (!mapa[uid]) mapa[uid] = { userId: uid, total: 0, contribuicoes: [] };
    mapa[uid].total += Number(c.valor || 0);
    mapa[uid].contribuicoes.push(c);
  }
  return Object.values(mapa);
};

const agruparPorFaixaValor = (contribuicoes) => {
  const faixas = { ate50: 0, de50a100: 0, acima100: 0 };
  for (const c of contribuicoes) {
    const v = Number(c.valor || 0);
    if (v <= 50) faixas.ate50++;
    else if (v <= 100) faixas.de50a100++;
    else faixas.acima100++;
  }
  return faixas;
};

const analisarTendencias = (contribuicoes) => {
  const porMes = {};
  for (const c of contribuicoes) {
    const d = new Date(c.dataContribuicao || c.data_contribuicao);
    if (isNaN(d)) continue;
    const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    porMes[chave] = (porMes[chave] || 0) + Number(c.valor || 0);
  }
  return Object.entries(porMes).map(([mes, total]) => ({ mes, total }));
};

const calcularAtingimentoMeta = async (caixinhaId, totalArrecadado) => {
  try {
    const supabase = sb();
    if (supabase) {
      const { data } = await supabase
        .from('caixinhas')
        .select('contribuicao_mensal')
        .eq('id', caixinhaId)
        .maybeSingle();
      if (data?.contribuicao_mensal) {
        return Math.round((totalArrecadado / data.contribuicao_mensal) * 100);
      }
    }
  } catch (_) {}
  return 0;
};

const gerarRecomendacoes = (tendencias, estatisticas) => {
  const recomendacoes = [];
  if (estatisticas.totalEstornadas > 0) {
    recomendacoes.push(`${estatisticas.totalEstornadas} contribuições foram estornadas. Verifique irregularidades.`);
  }
  if (tendencias.length >= 2) {
    const ultima = tendencias[tendencias.length - 1];
    const penultima = tendencias[tendencias.length - 2];
    if (ultima.total < penultima.total * 0.8) {
      recomendacoes.push('Queda de mais de 20% nas contribuições no último mês. Engajamento pode estar diminuindo.');
    }
  }
  return recomendacoes;
};
