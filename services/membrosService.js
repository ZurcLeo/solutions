// src/services/membrosService.js
const { getFirestore } = require('../firebaseAdmin');
const { logger } = require('../logger');
const Membro = require('../models/Membro');

const db = getFirestore();

exports.adicionarMembro = async (caixinhaId, dados) => {
    logger.info('Adicionando novo membro à caixinha', {
      service: 'MembrosService',
      method: 'adicionarMembro',
      caixinhaId,
      userId: dados.userId
    });

    const session = db.batch();

    try {
      // Verifica se o usuário já é membro
      const membroExistente = await db
        .collection('caixinhas')
        .doc(caixinhaId)
        .collection('membros')
        .where('userId', '==', dados.userId)
        .get();

      if (!membroExistente.empty) {
        throw new Error('Usuário já é membro desta caixinha');
      }

      // Cria o novo membro
      const membroRef = db
        .collection('caixinhas')
        .doc(caixinhaId)
        .collection('membros')
        .doc();

      const membro = {
        ...dados,
        dataEntrada: new Date(),
        status: 'ativo',
        contribuicoes: [],
        emprestimos: []
      };

      session.set(membroRef, membro);

      // Atualiza contador de membros na caixinha
      const caixinhaRef = db.collection('caixinhas').doc(caixinhaId);
      session.update(caixinhaRef, {
        totalMembros: db.FieldValue.increment(1),
        dataUltimaAtualizacao: new Date()
      });

      await session.commit();

      logger.info('Membro adicionado com sucesso', {
        service: 'MembrosService',
        method: 'adicionarMembro',
        caixinhaId,
        membroId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
    catch {
        console.log('MEMBRO SERVICE - ADICIONAR MEMBRO - resolver este problema')
    }
  }

  exports.validarTransicaoStatus = async (statusAtual, novoStatus) => {
    // Define as transições válidas de status
    const transicoesValidas = {
      'ativo': ['suspenso', 'inativo'],
      'suspenso': ['ativo', 'inativo'],
      'inativo': ['ativo'],
      'pendente': ['ativo', 'inativo']
    };

    return transicoesValidas[statusAtual]?.includes(novoStatus) || false;
  }

  exports.gerarRelatorioParticipacao = async (caixinhaId, periodo = {}) => {
    logger.info('Gerando relatório de participação dos membros', {
      service: 'MembrosService',
      method: 'gerarRelatorioParticipacao',
      caixinhaId,
      periodo
    });

    try {
      // Busca membros e suas contribuições
      const membros = await this.getMembros(caixinhaId);
      
      const relatorioMembros = await Promise.all(membros.map(async (membro) => {
        // Busca contribuições do período
        const contribuicoes = await db
          .collection('caixinhas')
          .doc(caixinhaId)
          .collection('contribuicoes')
          .where('usuarioId', '==', membro.userId)
          .where('dataContribuicao', '>=', new Date(periodo.inicio || 0))
          .where('dataContribuicao', '<=', new Date(periodo.fim || Date.now()))
          .get();

        // Busca participação em votações
        const votacoes = await db
          .collection('caixinhas')
          .doc(caixinhaId)
          .collection('votacoes')
          .where('participantes', 'array-contains', membro.userId)
          .get();

        return {
          membro,
          estatisticas: {
            totalContribuicoes: contribuicoes.size,
            valorTotalContribuido: contribuicoes.docs.reduce((sum, doc) => 
              sum + doc.data().valor, 0
            ),
            participacaoVotacoes: votacoes.size,
            ultimaContribuicao: contribuicoes.docs[0]?.data().dataContribuicao,
            statusAtual: membro.status,
            tempoNaCaixinha: this.calcularTempoParticipacao(membro.dataEntrada)
          }
        };
      }));

      // Calcula métricas gerais
      const metricas = this.calcularMetricasGerais(relatorioMembros);

      // Identifica padrões e gera recomendações
      const analise = this.analisarPadroesParticipacao(relatorioMembros, metricas);

      logger.info('Relatório de participação gerado com sucesso', {
        service: 'MembrosService',
        method: 'gerarRelatorioParticipacao',
        caixinhaId,
        totalMembros: membros.length,
        metricas
      });

      return {
        membros: relatorioMembros,
        metricas,
        analise,
        recomendacoes: this.gerarRecomendacoesParticipacao(analise),
        periodo,
        dataGeracao: new Date()
      };

    } catch (error) {
      logger.error('Erro ao gerar relatório de participação', {
        service: 'MembrosService',
        method: 'gerarRelatorioParticipacao',
        caixinhaId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  exports.calcularTempoParticipacao = async (dataEntrada) => {
    const hoje = new Date();
    const entrada = new Date(dataEntrada);
    const diffTime = Math.abs(hoje - entrada);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return {
      dias: diffDays,
      meses: Math.floor(diffDays / 30),
      anos: Math.floor(diffDays / 365)
    };
  }

  exports.calcularMetricasGerais = async (relatorioMembros) => {
    return {
      membrosAtivos: relatorioMembros.filter(r => r.membro.status === 'ativo').length,
      membrosSuspensos: relatorioMembros.filter(r => r.membro.status === 'suspenso').length,
      membrosInativos: relatorioMembros.filter(r => r.membro.status === 'inativo').length,
      
      mediaContribuicoesPorMembro: relatorioMembros.reduce((sum, r) => 
        sum + r.estatisticas.totalContribuicoes, 0) / relatorioMembros.length,
      
      mediaParticipacaoVotacoes: relatorioMembros.reduce((sum, r) => 
        sum + r.estatisticas.participacaoVotacoes, 0) / relatorioMembros.length,
      
      mediaTempoParticipacao: relatorioMembros.reduce((sum, r) => 
        sum + r.estatisticas.tempoNaCaixinha.dias, 0) / relatorioMembros.length
    };
  }

  exports.analisarPadroesParticipacao = async (relatorioMembros, metricas) => {
    const analise = {
      participacaoAtiva: [],
      riscosIdentificados: [],
      tendencias: {
        crescimento: false,
        estabilidade: false,
        reducao: false
      }
    };

    // Análise de participação individual
    relatorioMembros.forEach(r => {
      const membro = r.membro;
      const stats = r.estatisticas;

      // Identifica membros muito ativos
      if (stats.totalContribuicoes > metricas.mediaContribuicoesPorMembro * 1.5) {
        analise.participacaoAtiva.push({
          membroId: membro.id,
          nivel: 'alto',
          indicadores: ['contribuições acima da média', 'participação constante']
        });
      }

      // Identifica riscos de evasão
      if (stats.totalContribuicoes < metricas.mediaContribuicoesPorMembro * 0.5) {
        analise.riscosIdentificados.push({
          membroId: membro.id,
          tipo: 'baixa participação',
          indicadores: ['contribuições abaixo da média']
        });
      }
    });

    // Análise de tendências
    const contribuicoesRecentes = relatorioMembros
      .filter(r => r.estatisticas.ultimaContribuicao)
      .length;

    analise.tendencias.crescimento = contribuicoesRecentes > relatorioMembros.length * 0.7;
    analise.tendencias.estabilidade = contribuicoesRecentes > relatorioMembros.length * 0.5;
    analise.tendencias.reducao = contribuicoesRecentes < relatorioMembros.length * 0.3;

    return analise;
  }

  exports.gerarRecomendacoesParticipacao = async (analise) => {
    const recomendacoes = [];

    // Recomendações baseadas nos riscos identificados
    if (analise.riscosIdentificados.length > 0) {
      recomendacoes.push({
        tipo: 'preventiva',
        prioridade: 'alta',
        acao: 'Implementar programa de reengajamento',
        detalhes: 'Contatar membros com baixa participação e entender suas dificuldades',
        membrosAlvo: analise.riscosIdentificados.map(r => r.membroId)
      });
    }

    // Recomendações baseadas nas tendências
    if (analise.tendencias.reducao) {
      recomendacoes.push({
        tipo: 'corretiva',
        prioridade: 'alta',
        acao: 'Revisar modelo de participação',
        detalhes: 'Avaliar barreiras à participação e propor mudanças no modelo atual',
        impactoEsperado: 'Aumento na taxa de participação em 30 dias'
      });
    }

    // Recomendações para membros ativos
    if (analise.participacaoAtiva.length > 0) {
      recomendacoes.push({
        tipo: 'incentivo',
        prioridade: 'média',
        acao: 'Programa de reconhecimento',
        detalhes: 'Implementar sistema de reconhecimento para membros mais participativos',
        membrosAlvo: analise.participacaoAtiva.map(p => p.membroId)
      });
    }

    return recomendacoes;
  }

  exports.verificarRegrasParticipacao = async (caixinhaId, membroId) => {
    logger.info('Verificando regras de participação', {
      service: 'MembrosService',
      method: 'verificarRegrasParticipacao',
      caixinhaId,
      membroId
    });

    try {
      const membro = await db
        .collection('caixinhas')
        .doc(caixinhaId)
        .collection('membros')
        .doc(membroId)
        .get();

      if (!membro.exists) {
        throw new Error('Membro não encontrado');
      }

      const membroData = membro.data();
      const regrasVioladas = [];

      // Verifica contribuições mínimas
      const contribuicoes = await this.getContribuicoesPeriodo(caixinhaId, membroId, 3); // últimos 3 meses
      if (contribuicoes.length < 3) {
        regrasVioladas.push({
          tipo: 'contribuição',
          descricao: 'Mínimo de contribuições mensais não atingido',
          detalhe: `${contribuicoes.length}/3 contribuições realizadas`
        });
      }

      // Verifica participação em votações
      const participacaoVotacoes = await this.getParticipacaoVotacoes(caixinhaId, membroId, 30); // últimos 30 dias
      if (participacaoVotacoes.percentual < 50) {
        regrasVioladas.push({
          tipo: 'votação',
          descricao: 'Participação mínima em votações não atingida',
          detalhe: `${participacaoVotacoes.percentual}% de participação`
        });
      }

      logger.info('Verificação de regras concluída', {
        service: 'MembrosService',
        method: 'verificarRegrasParticipacao',
        caixinhaId,
        membroId,
        regrasVioladas
      });

      return {
        membroId,
        status: membroData.status,
        regrasVioladas,
        emConformidade: regrasVioladas.length === 0,
        dataVerificacao: new Date()
      };

    } catch (error) {
      logger.error('Erro ao verificar regras de participação', {
        service: 'MembrosService',
        method: 'verificarRegrasParticipacao',
        caixinhaId,
        membroId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  exports.getContribuicoesPeriodo = async (caixinhaId, membroId, meses) => {
    const dataLimite = new Date();
    dataLimite.setMonth(dataLimite.getMonth() - meses);

    const snapshot = await db
      .collection('caixinhas')
      .doc(caixinhaId)
      .collection('contribuicoes')
      .where('usuarioId', '==', membroId)
      .where('dataContribuicao', '>=', dataLimite)
      .get();

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  }

  exports.getParticipacaoVotacoes = async (caixinhaId, membroId, dias) => {
    logger.info('Buscando participação em votações', {
      service: 'MembrosService',
      method: 'getParticipacaoVotacoes',
      caixinhaId,
      membroId,
      periodoEmDias: dias
    });

    try {
      // Calcula a data limite com precisão até o segundo
      const dataLimite = new Date();
      dataLimite.setDate(dataLimite.getDate() - dias);
      dataLimite.setHours(0, 0, 0, 0);

      // Busca todas as votações no período
      const todasVotacoesQuery = db
        .collection('caixinhas')
        .doc(caixinhaId)
        .collection('votacoes')
        .where('dataInicio', '>=', dataLimite)
        .where('status', 'in', ['ativa', 'encerrada']); // Considera apenas votações válidas

      // Busca votações participadas pelo membro
      const votacoesParticipadasQuery = db
        .collection('caixinhas')
        .doc(caixinhaId)
        .collection('votacoes')
        .where('dataInicio', '>=', dataLimite)
        .where('status', 'in', ['ativa', 'encerrada'])
        .where('participantes', 'array-contains', membroId);

      // Executa as queries em paralelo para melhor performance
      const [todasVotacoes, votacoesParticipadas] = await Promise.all([
        todasVotacoesQuery.get(),
        votacoesParticipadasQuery.get()
      ]);

      // Calcula as estatísticas
      const totalVotacoes = todasVotacoes.size;
      const totalParticipadas = votacoesParticipadas.size;
      
      // Calcula o percentual com tratamento de casos especiais
      const percentual = totalVotacoes === 0 
        ? 0 // Se não houver votações, percentual é 0
        : Math.round((totalParticipadas / totalVotacoes) * 100);

      const resultado = {
        total: totalVotacoes,
        participadas: totalParticipadas,
        percentual: percentual,
        periodoAnalisado: {
          inicio: dataLimite,
          fim: new Date()
        }
      };

      logger.info('Participação em votações calculada com sucesso', {
        service: 'MembrosService',
        method: 'getParticipacaoVotacoes',
        caixinhaId,
        membroId,
        resultado
      });

      return resultado;

    } catch (error) {
      logger.error('Erro ao buscar participação em votações', {
        service: 'MembrosService',
        method: 'getParticipacaoVotacoes',
        caixinhaId,
        membroId,
        error: error.message,
        stack: error.stack
      });

      throw new Error(`Erro ao buscar participação em votações: ${error.message}`);
    }
  }

  exports.getMembros = async (caixinhaId, filtros = {}) => {
    logger.info('Buscando membros da caixinha', {
      service: 'MembrosService',
      method: 'getMembros',
      caixinhaId,
      filtros
    });

    try {
      let query = db
        .collection('caixinhas')
        .doc(caixinhaId)
        .collection('membros');

      if (filtros.status) {
        query = query.where('status', '==', filtros.status);
      }
      if (filtros.role) {
        query = query.where('role', '==', filtros.role);
      }

      const snapshot = await query.get();
      const membros = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      logger.info('Membros recuperados com sucesso', {
        service: 'MembrosService',
        method: 'getMembros',
        caixinhaId,
        count: membros.length
      });

      return membros;

    } catch (error) {
      logger.error('Erro ao buscar membros', {
        service: 'MembrosService',
        method: 'getMembros',
        caixinhaId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  exports.atualizarStatusMembro = async (caixinhaId, membroId, novoStatus, motivo) => {
    logger.info('Atualizando status do membro', {
      service: 'MembrosService',
      method: 'atualizarStatusMembro',
      caixinhaId,
      membroId,
      novoStatus
    });

    try {
      const membroRef = db
        .collection('caixinhas')
        .doc(caixinhaId)
        .collection('membros')
        .doc(membroId);

      const membroDoc = await membroRef.get();
      
      if (!membroDoc.exists) {
        throw new Error('Membro não encontrado');
      }

      // Valida transição de status
      const statusAtual = membroDoc.data().status;
      if (!this.validarTransicaoStatus(statusAtual, novoStatus)) {
        throw new Error(`Transição de status inválida: ${statusAtual} -> ${novoStatus}`);
      }

      await membroRef.update({
        status: novoStatus,
        dataAtualizacao: new Date(),
        motivoMudancaStatus: motivo || null,
        historicoStatus: db.FieldValue.arrayUnion({
          de: statusAtual,
          para: novoStatus,
          data: new Date(),
          motivo: motivo || null
        })
      });

      logger.info('Status do membro atualizado com sucesso', {
        service: 'MembrosService',
        method: 'atualizarStatusMembro',
        caixinhaId,
        membroId,
        novoStatus
      });

      return true;

    } catch (error) {
      logger.error('Erro ao atualizar status do membro', {
        service: 'MembrosService',
        method: 'atualizarStatusMembro',
        caixinhaId,
        membroId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  exports.removerMembro = async (caixinhaId, membroId, motivo) => {
    logger.info('Iniciando remoção de membro', {
      service: 'MembrosService',
      method: 'removerMembro',
      caixinhaId,
      membroId,
      motivo
    });

    const session = db.batch();

    try {
      // Verifica pendências do membro
      const pendencias = await this.verificarPendenciasMembro(caixinhaId, membroId);
      if (pendencias.length > 0) {
        throw new Error(`Membro possui pendências: ${pendencias.join(', ')}`);
      }

      // Atualiza status para inativo
      const membroRef = db
        .collection('caixinhas')
        .doc(caixinhaId)
        .collection('membros')
        .doc(membroId);

      session.update(membroRef, {
        status: 'inativo',
        dataSaida: new Date(),
        motivoSaida: motivo,
        historicoStatus: db.FieldValue.arrayUnion({
          de: 'ativo',
          para: 'inativo',
          data: new Date(),
          motivo
        })
      });

      // Atualiza contadores na caixinha
      const caixinhaRef = db.collection('caixinhas').doc(caixinhaId);
      session.update(caixinhaRef, {
        totalMembros: db.FieldValue.increment(-1),
        membrosInativos: db.FieldValue.increment(1),
        dataUltimaAtualizacao: new Date()
      });

      await session.commit();

      logger.info('Membro removido com sucesso', {
        service: 'MembrosService',
        method: 'removerMembro',
        caixinhaId,
        membroId
      });

      return true;

    } catch (error) {
      logger.error('Erro ao remover membro', {
        service: 'MembrosService',
        method: 'removerMembro',
        caixinhaId,
        membroId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  exports.verificarPendenciasMembro = async (caixinhaId, membroId)  => {
    const pendencias = [];

    // Verifica empréstimos ativos
    const emprestimos = await db
      .collection('caixinhas')
      .doc(caixinhaId)
      .collection('emprestimos')
      .where('usuarioId', '==', membroId)
      .where('status', 'in', ['ativo', 'pendente'])
      .get();

    if (!emprestimos.empty) {
      pendencias.push('empréstimos ativos');
    }

    // Verifica contribuições pendentes
    const contribuicoes = await this.verificarContribuicoesPendentes(caixinhaId, membroId);
    if (contribuicoes.pendentes) {
      pendencias.push('contribuições pendentes');
    }

    return pendencias;
  }

  exports.verificarContribuicoesPendentes = async (caixinhaId, membroId) => {
    const hoje = new Date();
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);

    const contribuicoes = await db
      .collection('caixinhas')
      .doc(caixinhaId)
      .collection('contribuicoes')
      .where('usuarioId', '==', membroId)
      .where('dataContribuicao', '>=', inicioMes)
      .get();

    return {
      pendentes: contribuicoes.empty,
      ultimaContribuicao: contribuicoes.docs[0]?.data().dataContribuicao
    };
  }

  exports.transferirAdministracao = async (caixinhaId, novoAdminId, motivoTransferencia) => {
    logger.info('Iniciando transferência de administração', {
      service: 'MembrosService',
      method: 'transferirAdministracao',
      caixinhaId,
      novoAdminId
    });

    const session = db.batch();

    try {
      // Verifica se novo admin é membro ativo
      const membroRef = db
        .collection('caixinhas')
        .doc(caixinhaId)
        .collection('membros')
        .doc(novoAdminId);

      const membroDoc = await membroRef.get();
      if (!membroDoc.exists || membroDoc.data().status !== 'ativo') {
        throw new Error('Novo administrador deve ser um membro ativo');
      }

      // Atualiza caixinha
      const caixinhaRef = db.collection('caixinhas').doc(caixinhaId);
      session.update(caixinhaRef, {
        adminId: novoAdminId,
        dataTransferenciaAdmin: new Date(),
        motivoTransferenciaAdmin: motivoTransferencia,
        historicoAdmin: db.FieldValue.arrayUnion({
          de: membroDoc.data().adminId,
          para: novoAdminId,
          data: new Date(),
          motivo: motivoTransferencia
        })
      });

      // Atualiza papéis dos membros
      session.update(membroRef, {
        role: 'admin',
        dataPromocao: new Date()
      });

      const antigoAdminRef = db
        .collection('caixinhas')
        .doc(caixinhaId)
        .collection('membros')
        .doc(membroDoc.data().adminId);

      session.update(antigoAdminRef, {
        role: 'membro',
        dataAlteracaoRole: new Date()
      });

      await session.commit();

      logger.info('Administração transferida com sucesso', {
        service: 'MembrosService',
        method: 'transferirAdministracao',
        caixinhaId,
        novoAdminId
      });

      return true;

    } catch (error) {
      logger.error('Erro ao transferir administração', {
        service: 'MembrosService',
        method: 'transferirAdministracao',
        caixinhaId,
        novoAdminId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }