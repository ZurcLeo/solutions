/**
 * @fileoverview Serviço para gerenciar operações relacionadas a caixinhas.
 * @module services/caixinhaService
 * @requires ../logger
 * @requires ../models/Caixinhas
 */
const { logger } = require('../logger');
const Caixinha = require('../models/Caixinhas');
const { getSupabaseClient } = require('../config/supabase');
const asaasService = require('./asaasService');

// ─── Helper: busca dados do admin necessários para criar subconta Asaas ────────

async function _fetchAdminDataForSubconta(adminId) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return {};

    const encryptionService = require('./encryptionService');

    const { data } = await supabase
      .from('users')
      .select('nome, cpf_encrypted, cpf_last4, data_nascimento, telefone')
      .eq('id', adminId)
      .maybeSingle();

    if (!data) return {};

    let cpfRaw;
    if (data.cpf_encrypted) {
      try {
        cpfRaw = await encryptionService.decrypt(JSON.parse(data.cpf_encrypted));
      } catch (decryptErr) {
        logger.warn('Falha ao decriptar CPF do admin', {
          service: 'caixinhaService', adminId, error: decryptErr.message
        });
      }
    }

    return {
      name: data.nome || undefined,
      cpf: cpfRaw || undefined,
      birthDate: data.data_nascimento
        ? new Date(data.data_nascimento).toISOString().split('T')[0]
        : undefined,
      phone: data.telefone || undefined
    };
  } catch (err) {
    logger.warn('Falha ao buscar dados do admin para subconta Asaas', {
      service: 'caixinhaService', adminId, error: err.message
    });
    return {};
  }
}

// ─── Helper: criação assíncrona da subconta Asaas ─────────────────────────────

async function _createAsaasSubconta(caixinhaId, adminId) {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  const adminData = await _fetchAdminDataForSubconta(adminId);

  if (!adminData.cpf) {
    logger.warn('Subconta Asaas não criada: CPF do admin ausente', {
      service: 'caixinhaService', caixinhaId, adminId
    });
    await supabase.from('caixinhas')
      .update({ asaas_subconta_status: 'pending_data' })
      .eq('id', caixinhaId);
    throw new Error('CPF do admin ausente');
  }

  const subconta = await asaasService.createSubconta({
    caixinhaId,
    adminName: adminData.name || adminId,
    cpfCnpj: adminData.cpf,
    birthDate: adminData.birthDate,
    phone: adminData.phone
  });

  await supabase.from('caixinhas')
    .update({
      asaas_wallet_id: subconta.walletId,
      asaas_subconta_status: 'active'
    })
    .eq('id', caixinhaId);

  await supabase.from('caixinha_asaas_secrets')
    .insert({ caixinha_id: caixinhaId, asaas_api_key: subconta.apiKey });

  logger.info('Subconta Asaas criada com sucesso', {
    service: 'caixinhaService', caixinhaId, walletId: subconta.walletId
  });
}

/**
 * Notifica o admin sobre o status da subconta Asaas (fire-and-forget).
 * CAI-H0-006
 */
function _notifyAdminSubcontaStatus(adminId, caixinhaId, status) {
  setImmediate(async () => {
    try {
      const NotificationDispatcher = require('./NotificationDispatcher');
      const dispatcher = new NotificationDispatcher();
      const isPendingData = status === 'pending_data';

      await dispatcher.dispatch({
        userId: adminId,
        type: 'caixinha_subconta_status',
        importance: isPendingData ? 'low' : 'high',
        data: {
          caixinhaId,
          status,
          message: isPendingData
            ? 'Sua caixinha foi criada, mas o cadastro financeiro ainda está pendente. Você não poderá receber contribuições até que seja ativado.'
            : 'Houve um problema ao configurar o sistema financeiro da sua caixinha. Entre em contato com o suporte.'
        },
        metadata: { triggeredBy: 'system', source: 'caixinhaService._notifyAdminSubcontaStatus' },
        dedupKey: `subconta_status_${caixinhaId}_${status}`
      });
    } catch (notifErr) {
      logger.warn('Falha ao notificar admin sobre status da subconta', {
        service: 'caixinhaService', caixinhaId, adminId, status, error: notifErr.message
      });
    }
  });
}

/**
 * CAI-H0-005: Retry automático com backoff exponencial (3 tentativas).
 * Tentativa 1: imediata | Tentativa 2: +5 min | Tentativa 3: +30 min
 */
async function _createAsaasSubcontaWithRetry(caixinhaId, adminId, attempt = 1) {
  const RETRY_DELAYS_MS = [0, 5 * 60 * 1000, 30 * 60 * 1000]; // índice = attempt-1

  try {
    await _createAsaasSubconta(caixinhaId, adminId);
  } catch (err) {
    const isCpfMissing = err.message === 'CPF do admin ausente';

    if (isCpfMissing) {
      // CPF ausente não é um erro transitório — notificar e não tentar novamente
      logger.warn('Subconta não criada por falta de CPF — sem retry', {
        service: 'caixinhaService', caixinhaId, adminId, action: 'SUBCONTA_PENDING_DATA'
      });
      _notifyAdminSubcontaStatus(adminId, caixinhaId, 'pending_data');
      return;
    }

    if (attempt < 3) {
      const delay = RETRY_DELAYS_MS[attempt]; // attempt=1→5min, attempt=2→30min
      logger.warn(`Subconta Asaas falhou — retry ${attempt}/3 em ${delay / 60000} min`, {
        service: 'caixinhaService', caixinhaId, attempt, error: err.message
      });
      setTimeout(() => _createAsaasSubcontaWithRetry(caixinhaId, adminId, attempt + 1), delay);
    } else {
      // Esgotou as 3 tentativas
      logger.error('Subconta Asaas falhou após 3 tentativas — marcando como failed', {
        service: 'caixinhaService', caixinhaId, error: err.message,
        action: 'SUBCONTA_CREATION_EXHAUSTED'
      });
      const supabase = getSupabaseClient();
      if (supabase) {
        await supabase.from('caixinhas')
          .update({ asaas_subconta_status: 'failed' })
          .eq('id', caixinhaId)
          .catch(() => {});
      }
      _notifyAdminSubcontaStatus(adminId, caixinhaId, 'failed');
    }
  }
}

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

    // [GAME-COV-002] fire-and-forget — não bloqueia o fluxo principal
    setImmediate(() => {
      try {
        const gamificationService = require('./gamificationService');
        gamificationService.triggerEvent('caixinha_created', data.adminId)
          .catch(err =>
            logger.warn('Falha ao acionar gamificação em criação de caixinha', {
              service: 'caixinhaService', userId: data.adminId, error: err.message
            })
          );
      } catch (err) {
        logger.warn('Erro síncrono ao acionar gamificação (caixinha_created)', { error: err.message });
      }
    });

    // [PAYMENT-001] fire-and-forget — cria subconta Asaas com retry automático (CAI-H0-005)
    setImmediate(() => _createAsaasSubcontaWithRetry(caixinha.id, data.adminId));

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
const updateCaixinha = async (id, data, requesterId) => {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase indisponível');

    // ── Busca estado atual para comparação de governança ─────────────────
    const { data: current, error: fetchErr } = await supabase
      .from('caixinhas')
      .select('contribuicao_mensal, dia_vencimento')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) throw new Error(fetchErr.message);
    if (!current) throw new Error('Caixinha não encontrada');

    // Conta membros ativos (admin incluso — >1 significa há outros membros)
    const { count: membrosCount } = await supabase
      .from('caixinha_members')
      .select('id', { count: 'exact', head: true })
      .eq('caixinha_id', id)
      .eq('active', true);

    const temMembros = (membrosCount ?? 0) > 1;

    // Regra 1: contribuicaoMensal mudou + caixinha tem membros → requer disputa
    if (
      data.contribuicaoMensal !== undefined &&
      Number(data.contribuicaoMensal) !== Number(current.contribuicao_mensal) &&
      temMembros
    ) {
      logger.info('Mudança de contribuicaoMensal requer disputa', {
        service: 'caixinhaService', method: 'updateCaixinha', caixinhaId: id,
        de: current.contribuicao_mensal, para: data.contribuicaoMensal
      });
      const err = new Error('Esta alteração requer aprovação do grupo via disputa.');
      err.requiresDispute = true;
      err.field = 'contribuicaoMensal';
      throw err;
    }

    // Regra 2: diaVencimento mudou + tem membros → aplica mas registra audit_log
    const diaVencimentoMudou =
      data.diaVencimento !== undefined &&
      Number(data.diaVencimento) !== Number(current.dia_vencimento) &&
      temMembros;

    // ── Persistência ──────────────────────────────────────────────────────
    const caixinha = await Caixinha.update(id, data);

    if (diaVencimentoMudou && requesterId) {
      setImmediate(() => {
        supabase.from('audit_log').insert({
          user_id:     requesterId,
          action:      'caixinha_dia_vencimento_changed',
          entity_type: 'caixinha',
          entity_id:   id,
          metadata: { de: current.dia_vencimento, para: data.diaVencimento },
        }).catch(err =>
          logger.warn('Falha ao gravar audit_log de diaVencimento', {
            service: 'caixinhaService', caixinhaId: id, error: err.message
          })
        );
      });
    }

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
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase indisponível');

    const delta = tipo === 'credito' ? valor : -valor;
    const minSaldo = tipo === 'debito' ? valor : 0;

    const { data: novoSaldo, error } = await supabase.rpc('update_caixinha_saldo', {
      p_caixinha_id: caixinhaId,
      p_delta: delta,
      p_min_saldo: minSaldo
    });

    if (error) throw new Error(error.message);

    logger.info('Saldo atualizado com sucesso (RPC atômica)', {
      service: 'caixinhaService',
      method: 'updateSaldo',
      caixinhaId,
      tipo,
      delta,
      novoSaldo
    });

    // Firestore fire-and-forget
    setImmediate(() => {
      Caixinha.update(caixinhaId, { saldoTotal: novoSaldo }).catch(() => {});
    });

    return { saldoTotal: novoSaldo };
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

/**
 * Gera um relatório para uma caixinha.
 * @async
 * @function getRelatorio
 * @param {string} caixinhaId - O ID da caixinha.
 * @param {string} tipo - O tipo de relatório (mensal, anual, etc).
 * @returns {Promise<Object>} O objeto do relatório.
 * @description Gera e retorna um relatório financeiro ou de atividades de uma caixinha.
 */
const getConfiguracoes = async (caixinhaId) => {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase indisponível');

    const { data, error } = await supabase
      .from('caixinhas')
      .select(`
        name, description, contribuicao_mensal, dia_vencimento,
        permite_emprestimos, allow_rifas, distribuicao_tipo,
        duracao_meses, assentos, concursos_habilitados
      `)
      .eq('id', caixinhaId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new Error('Caixinha não encontrada');

    const { count: membrosCount, error: countErr } = await supabase
      .from('caixinha_members')
      .select('id', { count: 'exact', head: true })
      .eq('caixinha_id', caixinhaId)
      .eq('active', true);

    if (countErr) {
      logger.warn('Falha ao contar membros nas configurações', {
        service: 'caixinhaService', method: 'getConfiguracoes',
        caixinhaId, error: countErr.message
      });
    }

    logger.info('Configurações recuperadas com sucesso', {
      service: 'caixinhaService', method: 'getConfiguracoes', caixinhaId
    });

    return {
      nome:                 data.name,
      descricao:            data.description || null,
      contribuicaoMensal:   Number(data.contribuicao_mensal) || 0,
      diaVencimento:        data.dia_vencimento || 1,
      allowLoans:           data.permite_emprestimos || false,
      allowRifas:           data.allow_rifas || false,
      distribuicaoTipo:     data.distribuicao_tipo || 'padrão',
      duracaoMeses:         data.duracao_meses || 12,
      assentos:             data.assentos ?? null,
      concursosHabilitados: data.concursos_habilitados ?? false,
      membrosCount:         membrosCount ?? 0,
    };
  } catch (error) {
    logger.error('Erro ao buscar configurações da caixinha', {
      service: 'caixinhaService', method: 'getConfiguracoes',
      caixinhaId, error: error.message
    });
    throw error;
  }
};

const getRelatorio = async (caixinhaId, filtros = {}) => {
  try {
    logger.info('Gerando relatório da caixinha', { caixinhaId, filtros });

    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client indisponível');

    // Buscar dados em paralelo
    const [caixinhaRes, membrosRes, contribRes, emprestimosRes, transacoesRes] = await Promise.all([
      supabase.from('caixinhas').select('name, saldo_total, contribuicao_mensal, created_at').eq('id', caixinhaId).single(),
      supabase.from('caixinha_members').select('user_id, role, status, joined_at, users(full_name)').eq('caixinha_id', caixinhaId),
      supabase.from('contribuicoes').select('id, user_id, valor, status, data_contribuicao').eq('caixinha_id', caixinhaId).order('data_contribuicao', { ascending: false }),
      supabase.from('emprestimos').select('id, user_id, valor_solicitado, valor_total, valor_pago, status, data_solicitacao').eq('caixinha_id', caixinhaId),
      supabase.from('transacoes').select('id, tipo, valor, data').eq('caixinha_id', caixinhaId).order('data', { ascending: false }).limit(50),
    ]);

    if (caixinhaRes.error) throw caixinhaRes.error;

    const caixinha = caixinhaRes.data;
    const membros = membrosRes.data || [];
    const contribuicoes = contribRes.data || [];
    const emprestimos = emprestimosRes.data || [];
    const transacoes = transacoesRes.data || [];

    // Membros ativos (excluindo removidos)
    const membrosAtivos = membros.filter(m => m.role !== 'removed' && m.status !== 'inativo');

    // Contribuições por status
    const contribConfirmadas = contribuicoes.filter(c => c.status === 'confirmada');
    const contribEstornadas = contribuicoes.filter(c => c.status === 'estornada');
    const totalContribuido = contribConfirmadas.reduce((s, c) => s + Number(c.valor), 0);

    // Empréstimos por status
    const empAtivos = emprestimos.filter(e => ['aprovado', 'parcial'].includes(e.status));
    const empQuitados = emprestimos.filter(e => e.status === 'quitado');
    const totalEmprestado = empAtivos.reduce((s, e) => s + Number(e.valor_total), 0);
    const totalPago = emprestimos.reduce((s, e) => s + Number(e.valor_pago || 0), 0);

    // Transações por tipo
    const transacoesPorTipo = {};
    transacoes.forEach(t => {
      transacoesPorTipo[t.tipo] = (transacoesPorTipo[t.tipo] || 0) + 1;
    });

    // Inadimplência: membros sem contribuição nos últimos 60 dias
    const dias60 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const membrosComContribRecente = new Set(
      contribConfirmadas.filter(c => c.data_contribuicao >= dias60).map(c => c.user_id)
    );
    const inadimplentes = membrosAtivos.filter(m => !membrosComContribRecente.has(m.user_id));

    return {
      caixinhaId,
      nome: caixinha.name,
      geradoEm: new Date().toISOString(),
      resumo: {
        saldoTotal: Number(caixinha.saldo_total),
        contribuicaoMensal: Number(caixinha.contribuicao_mensal),
        totalMembros: membrosAtivos.length,
        totalContribuicoes: contribConfirmadas.length,
        totalContribuido,
        totalEstornos: contribEstornadas.length,
        totalEmprestimosAtivos: empAtivos.length,
        totalEmprestimosQuitados: empQuitados.length,
        totalEmprestado,
        totalPago,
        inadimplentes: inadimplentes.length,
      },
      membros: membrosAtivos.map(m => ({
        userId: m.user_id,
        nome: m.users?.full_name || m.user_id,
        role: m.role,
        joinedAt: m.joined_at,
      })),
      inadimplentes: inadimplentes.map(m => ({
        userId: m.user_id,
        nome: m.users?.full_name || m.user_id,
      })),
      transacoesPorTipo,
      ultimasTransacoes: transacoes.slice(0, 20).map(t => ({
        id: t.id, tipo: t.tipo, valor: Number(t.valor), data: t.data,
      })),
    };
  } catch (error) {
    logger.error('Erro ao gerar relatório', { caixinhaId, error: error.message });
    throw error;
  }
};

module.exports = {
    getRelatorio,
    getConfiguracoes,
    updateSaldo,
    getAllCaixinhas,
    addMembro,
    deleteCaixinha,
    updateCaixinha,
    getCaixinhaById,
    createCaixinha,
    createAsaasSubconta: _createAsaasSubconta,
    createAsaasSubcontaWithRetry: _createAsaasSubcontaWithRetry
}