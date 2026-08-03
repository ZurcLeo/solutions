// src/services/transactionService.js
const { logger } = require('../logger');
const { getSupabaseClient } = require('../config/supabase');
const { randomUUID } = require('crypto');
const Transacao = require('../models/Transacao');

// Firestore como backup fire-and-forget durante a transição
const { getFirestore } = require('../firebaseAdmin');

const sb = () => getSupabaseClient();

// Criação de uma nova transação
exports.createTransaction = async (data) => {
  logger.info('Iniciando criação de transação', {
    service: 'transactionService',
    method: 'createTransaction',
    data
  });

  try {
    const transacao = new Transacao(data);
    const transacaoId = randomUUID();
    const now = new Date().toISOString();

    const supabase = sb();
    if (supabase) {
      // 1. Inserir transação
      const { error: errTrans } = await supabase
        .from('transacoes')
        .insert({
          id: transacaoId,
          caixinha_id: data.caixinhaId,
          user_id: data.usuarioId || data.userId || data.membroId,
          tipo: transacao.tipo || data.tipo || 'contribuicao',
          valor: data.valor,
          data: now
        });

      if (errTrans) throw new Error(`Supabase transacoes insert: ${errTrans.message}`);

      // 2. Atualizar saldo da caixinha
      const { data: caixinha } = await supabase
        .from('caixinhas')
        .select('saldo_total')
        .eq('id', data.caixinhaId)
        .single();

      if (caixinha) {
        await supabase
          .from('caixinhas')
          .update({
            saldo_total: (Number(caixinha.saldo_total) || 0) + data.valor,
            updated_at: now
          })
          .eq('id', data.caixinhaId);
      }
    }

    // Backup Firestore fire-and-forget
    try {
      const db = getFirestore();
      const batch = db.batch();
      const transacaoRef = db.collection('caixinhas').doc(data.caixinhaId).collection('transacoes').doc(transacaoId);
      const caixinhaRef = db.collection('caixinhas').doc(data.caixinhaId);
      const { FieldValue } = require('../firebaseAdmin');
      batch.set(transacaoRef, transacao);
      batch.update(caixinhaRef, {
        saldoTotal: FieldValue.increment(data.valor),
        dataUltimaTransacao: new Date()
      });
      batch.commit().catch(() => {});
    } catch (_) {}

    logger.info('Transação criada com sucesso', {
      service: 'transactionService',
      method: 'createTransaction',
      transacaoId,
      caixinhaId: data.caixinhaId
    });

    return { ...transacao, id: transacaoId };
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
    const supabase = sb();
    if (supabase) {
      const { data, error } = await supabase
        .from('transacoes')
        .select('*')
        .eq('caixinha_id', caixinhaId)
        .order('data', { ascending: false });

      if (!error && data) {
        const transacoes = data.map(row => new Transacao({
          id: row.id,
          caixinhaId: row.caixinha_id,
          usuarioId: row.user_id,
          tipo: row.tipo,
          valor: Number(row.valor),
          data: row.data,
          contribuicaoId: row.contribuicao_id,
          emprestimoId: row.emprestimo_id
        }));

        logger.info('Transações recuperadas (Supabase)', {
          service: 'transactionService',
          method: 'getTransacoesByCaixinha',
          count: transacoes.length
        });
        return transacoes;
      }

      logger.warn('Supabase retornou erro, fallback Firestore', { error: error?.message });
    }

    // Fallback Firestore
    const db = getFirestore();
    const snapshot = await db
      .collection('caixinhas')
      .doc(caixinhaId)
      .collection('transacoes')
      .orderBy('data', 'desc')
      .get();

    return snapshot.docs.map(doc => new Transacao({ id: doc.id, ...doc.data() }));
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

  try {
    const supabase = sb();

    if (supabase) {
      // Buscar empréstimo
      const { data: emprestimo, error: errBusca } = await supabase
        .from('emprestimos')
        .select('*')
        .eq('id', emprestimoId)
        .eq('caixinha_id', caixinhaId)
        .maybeSingle();

      if (errBusca || !emprestimo) {
        throw new Error('Empréstimo não encontrado');
      }

      if (emprestimo.status !== 'pendente') {
        throw new Error('Empréstimo já foi processado');
      }

      // Atualizar status do empréstimo
      const { error: errUpdate } = await supabase
        .from('emprestimos')
        .update({
          status: aprovado ? 'aprovado' : 'rejeitado',
          data_aprovacao: aprovado ? new Date().toISOString() : null,
          data_rejeitacao: aprovado ? null : new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', emprestimoId);

      if (errUpdate) throw new Error(`Supabase emprestimos update: ${errUpdate.message}`);

      // Se aprovado, criar transação de débito
      if (aprovado) {
        const { error: errTrans } = await supabase
          .from('transacoes')
          .insert({
            id: randomUUID(),
            caixinha_id: caixinhaId,
            user_id: emprestimo.user_id,
            tipo: 'emprestimo',
            valor: -Number(emprestimo.valor_solicitado),
            data: new Date().toISOString(),
            emprestimo_id: emprestimoId
          });

        if (errTrans) {
          logger.warn('Supabase transacoes insert (emprestimo) falhou', { error: errTrans.message });
        }
      }
    }

    // Backup Firestore fire-and-forget
    try {
      const db = getFirestore();
      const emprestimoRef = db.collection('caixinhas').doc(caixinhaId).collection('emprestimos').doc(emprestimoId);
      const emprestimoDoc = await emprestimoRef.get();
      if (emprestimoDoc.exists) {
        const emprestimo = emprestimoDoc.data();
        const batch = db.batch();
        batch.update(emprestimoRef, {
          status: aprovado ? 'aprovado' : 'rejeitado',
          dataProcessamento: new Date(),
          valorLiberado: aprovado ? emprestimo.valorSolicitado : 0
        });
        if (aprovado) {
          const transacaoRef = db.collection('caixinhas').doc(caixinhaId).collection('transacoes').doc();
          batch.set(transacaoRef, {
            tipo: 'emprestimo',
            valor: -emprestimo.valorSolicitado,
            usuarioId: emprestimo.usuarioId,
            data: new Date(),
            emprestimoId
          });
        }
        batch.commit().catch(() => {});
      }
    } catch (_) {}

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
    const supabase = sb();
    let transacoes;

    if (supabase) {
      let query = supabase
        .from('transacoes')
        .select('*')
        .eq('caixinha_id', caixinhaId)
        .order('data', { ascending: false });

      if (filtros.dataInicial) query = query.gte('data', new Date(filtros.dataInicial).toISOString());
      if (filtros.dataFinal) query = query.lte('data', new Date(filtros.dataFinal).toISOString());
      if (filtros.tipo) query = query.eq('tipo', filtros.tipo);

      const { data, error } = await query;
      if (!error && data) {
        transacoes = data.map(row => ({
          id: row.id,
          caixinhaId: row.caixinha_id,
          usuarioId: row.user_id,
          tipo: row.tipo,
          valor: Number(row.valor),
          data: row.data ? new Date(row.data) : new Date()
        }));
      }
    }

    // Fallback Firestore
    if (!transacoes) {
      const db = getFirestore();
      let query = db.collection('caixinhas').doc(caixinhaId).collection('transacoes').orderBy('data', 'desc');
      if (filtros.dataInicial) query = query.where('data', '>=', new Date(filtros.dataInicial));
      if (filtros.dataFinal) query = query.where('data', '<=', new Date(filtros.dataFinal));
      if (filtros.tipo) query = query.where('tipo', '==', filtros.tipo);
      const snapshot = await query.get();
      transacoes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), data: doc.data().data?.toDate?.() || new Date(doc.data().data) }));
    }

    const totais = calcularTotais(transacoes);

    logger.info('Extrato gerado com sucesso', {
      service: 'transactionService',
      method: 'gerarExtrato',
      totalTransacoes: transacoes.length
    });

    return { transacoes, totais, filtros, dataGeracao: new Date() };
  } catch (error) {
    logger.error('Erro ao gerar extrato', {
      service: 'transactionService',
      method: 'gerarExtrato',
      error: error.message
    });
    throw error;
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const calcularTotais = (transacoes) => {
  return transacoes.reduce((acc, trans) => {
    if (Number(trans.valor) > 0) {
      acc.creditos += Number(trans.valor);
    } else {
      acc.debitos += Math.abs(Number(trans.valor));
    }
    acc.saldo = acc.creditos - acc.debitos;
    return acc;
  }, { creditos: 0, debitos: 0, saldo: 0 });
};
