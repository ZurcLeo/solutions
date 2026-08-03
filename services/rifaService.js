// src/services/rifaService.js
const { logger } = require('../logger');
const Rifa = require('../models/Rifa');
const CaixinhaService = require('./caixinhaService');
const SorteioService = require('./sorteioService');
const ledgerService = require('./ledgerService');
const { getSupabaseClient } = require('../config/supabase');
const { createHash } = require('crypto');

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
      caixinhaId: data.caixinhaId,
      contest_type: data.contest_type || 'SORTEIO'
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

    // Debitar saldo virtual do membro no ledger
    await ledgerService.debitMember({
      caixinhaId,
      userId: membroId,
      amount: rifa.valorBilhete,
      reason: 'compra_bilhete',
      description: `Bilhete #${numeroBilhete} — ${rifa.nome}`
    });

    // Notificar comprador
    setImmediate(async () => {
      try {
        const NotificationDispatcher = require('./NotificationDispatcher');
        await NotificationDispatcher.dispatch({
          userId: membroId, // Assuming membroId is userId here (common in this app)
          type: 'rifa_ticket_purchased',
          importance: 'medium',
          data: {
            ticketNumber: numeroBilhete,
            rifaName: rifa.nome,
            rifaId: rifaId
          },
          metadata: { triggeredBy: 'system', correlationId: `${rifaId}_${numeroBilhete}` }
        });
      } catch (err) {
        logger.warn('Falha ao notificar compra de bilhete', { error: err.message, membroId, rifaId });
      }
    });

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
    
    // Notificar participantes e vencedor
    setImmediate(async () => {
      try {
        const NotificationDispatcher = require('./NotificationDispatcher');
        const participants = [...new Set(rifa.bilhetesVendidos.map(b => b.membroId))];
        
        for (const userId of participants) {
          const isWinner = resultado.bilheteVencedor && resultado.bilheteVencedor.membroId === userId && resultado.bilheteVencedor.numero === numeroSorteado;
          
          await NotificationDispatcher.dispatch({
            userId,
            type: isWinner ? 'rifa_winner_announced' : 'rifa_draw_held',
            importance: isWinner ? 'high' : 'medium',
            data: {
              rifaName: rifa.nome,
              winningNumber: numeroSorteado,
              prize: rifa.premio,
              rifaId: rifaId
            },
            metadata: { triggeredBy: 'system', correlationId: `draw_${rifaId}` }
          });
        }
      } catch (err) {
        logger.warn('Falha ao notificar resultado do sorteio', { error: err.message, rifaId });
      }
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
    const comprovante = await SorteioService.gerarComprovante(rifaId, rifa.sorteioResultado);
    
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

// ── Amigo Secreto (AMIGO_SECRETO) — Sattolo Cycle ─────────────────────────

/**
 * Sattolo cycle — gera derangement de ciclo único.
 * Garante: ninguém tira a si mesmo; todos pertencem a um único loop.
 * @param {string[]} participantes — lista de user IDs (mín. 2)
 * @returns {{ giver: string, receiver: string }[]}
 */
function sattoloCycle(participantes) {
  if (participantes.length < 2) {
    throw new Error('Amigo Secreto requer pelo menos 2 participantes');
  }
  const arr = [...participantes];
  // Diferença do Fisher-Yates: j ∈ [0, i-1] (não inclui i → derangement garantido)
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return participantes.map((giver, i) => ({ giver, receiver: arr[i] }));
}

/**
 * Executa o sorteio de pares do Amigo Secreto via Sattolo cycle.
 * Insere em contest_pairs e finaliza a rifa.
 */
const sortearPares = async (caixinhaId, contestId, participantesOverride) => {
  try {
    logger.info('Sorteando pares do Amigo Secreto', {
      service: 'rifaService', method: 'sortearPares', caixinhaId, contestId
    });

    const rifa = await Rifa.getById(caixinhaId, contestId);
    if (!rifa) throw new Error('Concurso não encontrado');
    if (rifa.status !== 'ABERTA') throw new Error('Concurso não está aberto');
    if (rifa.contestType !== 'AMIGO_SECRETO') throw new Error('Este concurso não é do tipo Amigo Secreto');

    // Obter participantes: override manual ou todos os membros da caixinha
    let participantes = participantesOverride;
    if (!participantes || participantes.length < 2) {
      const caixinha = await CaixinhaService.getCaixinhaById(caixinhaId);
      participantes = (caixinha?.membros || []).map(m => m.userId || m.id || m).filter(Boolean);
    }
    if (participantes.length < 2) throw new Error('São necessários pelo menos 2 participantes');

    // Algoritmo Sattolo — derangement auditável
    const pares = sattoloCycle(participantes);

    // Hash do resultado para auditabilidade (sem revelar pares individuais)
    const resultadoHash = createHash('sha256')
      .update(JSON.stringify({ contestId, pares, timestamp: new Date().toISOString() }))
      .digest('hex');

    // Inserir pares no banco (em lote)
    const sb = getSupabaseClient();
    const rows = pares.map(({ giver, receiver }) => ({
      contest_id: contestId,
      giver_id: giver,
      receiver_id: receiver,
    }));

    const { error: insertError } = await sb.from('contest_pairs').insert(rows);
    if (insertError) {
      if (insertError.code === '23505') throw new Error('Os pares deste concurso já foram sorteados');
      throw insertError;
    }

    // Finalizar rifa
    const sorteioResultado = {
      totalParticipantes: participantes.length,
      resultadoHash, // hash público, sem revelar pares
      dataSorteio: new Date().toISOString(),
      algoritmo: 'sattolo-cycle',
    };

    await Rifa.update(caixinhaId, contestId, {
      status: 'FINALIZADA',
      sorteioResultado,
      sorteioData: new Date(),
    });

    // Notificar cada participante (fire-and-forget)
    setImmediate(async () => {
      try {
        const NotificationDispatcher = require('./NotificationDispatcher');
        for (const userId of participantes) {
          await NotificationDispatcher.dispatch({
            userId,
            type: 'rifa_draw_held',
            importance: 'high',
            data: { rifaName: rifa.nome, rifaId: contestId, action: 'reveal_pair' },
            metadata: { triggeredBy: 'system', correlationId: `amigo_secreto_${contestId}` }
          });
        }
      } catch (err) {
        logger.warn('Falha ao notificar pares do Amigo Secreto', { error: err.message, contestId });
      }
    });

    // Gamification
    setImmediate(async () => {
      try {
        const gamificationService = require('./gamificationService');
        for (const userId of participantes) {
          await gamificationService.triggerEvent('amigo_secreto_participou', userId);
        }
      } catch (err) {
        logger.warn('Falha no trigger de gamificação do Amigo Secreto', { error: err.message });
      }
    });

    logger.info('Pares do Amigo Secreto sorteados com sucesso', {
      service: 'rifaService', contestId, total: participantes.length, resultadoHash
    });
    return { sorteioResultado, totalPares: participantes.length };
  } catch (error) {
    logger.error('Erro ao sortear pares', {
      service: 'rifaService', contestId, error: error.message, stack: error.stack
    });
    throw error;
  }
};

/**
 * Retorna o par do usuário (a quem ele deve presentear).
 * Marca revealed_at na primeira consulta.
 */
const getMeuPar = async (caixinhaId, contestId, userId) => {
  try {
    logger.info('Buscando par do Amigo Secreto', {
      service: 'rifaService', method: 'getMeuPar', caixinhaId, contestId, userId
    });

    const rifa = await Rifa.getById(caixinhaId, contestId);
    if (!rifa) throw new Error('Concurso não encontrado');
    if (rifa.contestType !== 'AMIGO_SECRETO') throw new Error('Este concurso não é do tipo Amigo Secreto');
    if (rifa.status !== 'FINALIZADA') throw new Error('Os pares ainda não foram sorteados');

    const sb = getSupabaseClient();

    // Buscar o par deste usuário
    const { data, error } = await sb
      .from('contest_pairs')
      .select('id, receiver_id, revealed_at')
      .eq('contest_id', contestId)
      .eq('giver_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Você não está participando deste Amigo Secreto');

    // Marcar como revelado na primeira vez
    if (!data.revealed_at) {
      await sb
        .from('contest_pairs')
        .update({ revealed_at: new Date().toISOString() })
        .eq('id', data.id);
    }

    logger.info('Par revelado com sucesso', { service: 'rifaService', contestId, userId });
    return {
      receiverId: data.receiver_id,
      revealedAt: data.revealed_at || new Date().toISOString(),
      isFirstReveal: !data.revealed_at,
    };
  } catch (error) {
    logger.error('Erro ao buscar par', {
      service: 'rifaService', contestId, userId, error: error.message, stack: error.stack
    });
    throw error;
  }
};

/**
 * Admin-only: retorna todos os pares do concurso.
 */
const getTodasPares = async (caixinhaId, contestId) => {
  try {
    logger.info('Buscando todos os pares do Amigo Secreto (admin)', {
      service: 'rifaService', method: 'getTodasPares', caixinhaId, contestId
    });

    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('contest_pairs')
      .select('giver_id, receiver_id, revealed_at')
      .eq('contest_id', contestId)
      .order('giver_id');

    if (error) throw error;
    return data || [];
  } catch (error) {
    logger.error('Erro ao listar todos os pares', {
      service: 'rifaService', contestId, error: error.message, stack: error.stack
    });
    throw error;
  }
};

// ── Votação em concursos (ELEICAO, SOLIDARIA) ─────────────────────────────

/**
 * Registra o voto de um membro em um concurso
 */
const votar = async (caixinhaId, contestId, userId, candidato) => {
  try {
    logger.info('Registrando voto', { service: 'rifaService', method: 'votar', caixinhaId, contestId, userId, candidato });

    const rifa = await Rifa.getById(caixinhaId, contestId);
    if (!rifa) throw new Error('Concurso não encontrado');
    if (rifa.status !== 'ABERTA') throw new Error('Este concurso não está aberto para votação');
    if (!['ELEICAO', 'SOLIDARIA'].includes(rifa.contestType)) {
      throw new Error('Este tipo de concurso não suporta votação direta');
    }

    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('contest_votes')
      .insert({ contest_id: contestId, voter_id: userId, candidate: candidato })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') throw new Error('Você já votou neste concurso');
      throw error;
    }

    // Gamification trigger
    setImmediate(async () => {
      try {
        const gamificationService = require('./gamificationService');
        await gamificationService.triggerEvent('contest_vote_cast', userId);
      } catch (err) {
        logger.warn('Falha no trigger de gamificação após voto', { error: err.message });
      }
    });

    logger.info('Voto registrado com sucesso', { service: 'rifaService', contestId, userId });
    return data;
  } catch (error) {
    logger.error('Erro ao registrar voto', { service: 'rifaService', contestId, userId, error: error.message, stack: error.stack });
    throw error;
  }
};

/**
 * Retorna contagem de votos agrupada por candidato
 */
const getVotos = async (caixinhaId, contestId) => {
  try {
    logger.info('Buscando votos', { service: 'rifaService', method: 'getVotos', caixinhaId, contestId });

    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('contest_votes')
      .select('candidate, voter_id')
      .eq('contest_id', contestId);

    if (error) throw error;

    const contagem = {};
    for (const row of (data || [])) {
      contagem[row.candidate] = (contagem[row.candidate] || 0) + 1;
    }

    const totalVotos = data?.length || 0;
    const candidatos = Object.entries(contagem)
      .map(([candidato, votos]) => ({
        candidato,
        votos,
        percentual: totalVotos > 0 ? Math.round((votos / totalVotos) * 100) : 0,
      }))
      .sort((a, b) => b.votos - a.votos);

    return { totalVotos, candidatos };
  } catch (error) {
    logger.error('Erro ao buscar votos', { service: 'rifaService', contestId, error: error.message, stack: error.stack });
    throw error;
  }
};

/**
 * Finaliza o concurso, determina vencedor com quórum e SHA-256 tie-breaking
 */
const resolverConcurso = async (caixinhaId, contestId, forcar = false) => {
  try {
    logger.info('Resolvendo concurso', { service: 'rifaService', method: 'resolverConcurso', caixinhaId, contestId, forcar });

    const rifa = await Rifa.getById(caixinhaId, contestId);
    if (!rifa) throw new Error('Concurso não encontrado');
    if (rifa.status !== 'ABERTA') throw new Error('Concurso não está aberto');

    const { totalVotos, candidatos } = await getVotos(caixinhaId, contestId);

    // Verificar quórum
    const QUORUM_RATES = { MAJORITY: 0.51, TWO_THIRDS: 0.67, UNANIMOUS: 1.0 };
    const rate = QUORUM_RATES[rifa.sorteioMetodo] || 0.51;
    const totalMembros = rifa.quantidadeBilhetes || 1;
    const votosNecessarios = rifa.sorteioMetodo === 'UNANIMOUS'
      ? totalMembros
      : Math.ceil(totalMembros * rate);

    if (!forcar && totalVotos < votosNecessarios) {
      throw new Error(`Quórum insuficiente. Necessário: ${votosNecessarios} votos, recebidos: ${totalVotos}`);
    }
    if (candidatos.length === 0) throw new Error('Nenhum voto registrado');

    // Determinar vencedor — SHA-256 tie-breaking auditável
    const maxVotos = candidatos[0].votos;
    const empatados = candidatos.filter(c => c.votos === maxVotos);

    let vencedor;
    if (empatados.length === 1) {
      vencedor = empatados[0].candidato;
    } else {
      const tieInput = JSON.stringify({
        contestId, empatados: empatados.map(c => c.candidato).sort(), timestamp: new Date().toISOString(),
      });
      const tieHash = createHash('sha256').update(tieInput).digest('hex');
      const idx = parseInt(tieHash.slice(0, 8), 16) % empatados.length;
      vencedor = empatados[idx].candidato;
    }

    const verificacaoHash = createHash('sha256')
      .update(JSON.stringify({ caixinhaId, contestId, vencedor, totalVotos, candidatos, timestamp: new Date().toISOString() }))
      .digest('hex');

    const sorteioResultado = {
      vencedor,
      totalVotos,
      candidatos,
      verificacaoHash,
      dataSorteio: new Date().toISOString(),
      quorumAtingido: totalVotos >= votosNecessarios,
      resolvidoForcar: forcar && totalVotos < votosNecessarios ? true : false,
    };

    const rifaAtualizada = await Rifa.update(caixinhaId, contestId, {
      status: 'FINALIZADA',
      sorteioResultado,
      sorteioData: new Date(),
    });

    // Notificar participantes
    setImmediate(async () => {
      try {
        const NotificationDispatcher = require('./NotificationDispatcher');
        const sb = getSupabaseClient();
        const { data: votos } = await sb.from('contest_votes').select('voter_id').eq('contest_id', contestId);
        const participants = [...new Set((votos || []).map(v => v.voter_id))];
        for (const uid of participants) {
          await NotificationDispatcher.dispatch({
            userId: uid,
            type: uid === vencedor ? 'rifa_winner_announced' : 'rifa_draw_held',
            importance: uid === vencedor ? 'high' : 'medium',
            data: { rifaName: rifa.nome, vencedor, rifaId: contestId },
            metadata: { triggeredBy: 'system', correlationId: `resolve_${contestId}` }
          });
        }
      } catch (err) {
        logger.warn('Falha ao notificar resultado do concurso', { error: err.message, contestId });
      }
    });

    logger.info('Concurso resolvido com sucesso', { service: 'rifaService', contestId, vencedor, totalVotos });
    return { ...rifaAtualizada, sorteioResultado };
  } catch (error) {
    logger.error('Erro ao resolver concurso', { service: 'rifaService', contestId, error: error.message, stack: error.stack });
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
  gerarComprovanteSorteio,
  votar,
  getVotos,
  resolverConcurso,
  sortearPares,
  getMeuPar,
  getTodasPares,
};