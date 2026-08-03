// models/Emprestimos.js — Supabase-first (migrado de Firestore em 2026-05-19)
// Fix: N+1 query eliminado — getAllByUsuario agora faz query direta por user_id
const { getSupabaseClient } = require('../config/supabase');
const Joi = require('joi');
const { logger } = require('../logger');
const { randomUUID } = require('crypto');

const VALID_STATUSES = ['pendente', 'aprovado', 'rejeitado', 'parcial', 'quitado'];

const createSchema = Joi.object({
  userId: Joi.string(),
  memberId: Joi.string(),
  valor: Joi.number().positive(),
  valorSolicitado: Joi.number().positive(),
  parcelas: Joi.number().integer().min(1),
  prazoMeses: Joi.number().integer().min(1),
}).unknown(true).or('userId', 'memberId').or('valor', 'valorSolicitado');

const updateSchema = Joi.object({
  status: Joi.string().valid(...VALID_STATUSES).optional(),
  valorPago: Joi.number().min(0).optional(),
}).unknown(true);

const TABLE          = 'emprestimos';
const TABLE_PAG      = 'emprestimo_pagamentos';
const TABLE_SETTINGS = 'caixinha_loan_settings';
const SERVICE        = 'emprestimosModel';

function mapEmprestimo(row, pagamentos = []) {
  if (!row) return null;
  return {
    id:                 row.id,
    caixinhaId:         row.caixinha_id,
    memberId:           row.user_id,
    userId:             row.user_id,
    valorSolicitado:    Number(row.valor_solicitado) || 0,
    valorTotal:         Number(row.valor_total) || 0,
    valorPago:          Number(row.valor_pago) || 0,
    prazoMeses:         row.prazo_meses || 12,
    status:             row.status || 'pendente',
    taxaJurosAplicada:  Number(row.taxa_juros_aplicada) || 0,
    valorMultaAplicada: Number(row.valor_multa_aplicada) || 0,
    dataSolicitacao:    row.data_solicitacao   ? new Date(row.data_solicitacao)  : new Date(),
    dataAprovacao:      row.data_aprovacao     ? new Date(row.data_aprovacao)    : null,
    adminAprovador:     row.admin_aprovador    || null,
    dataRejeitacao:     row.data_rejeitacao    ? new Date(row.data_rejeitacao)   : null,
    adminRejeitador:    row.admin_rejeitador   || null,
    motivoRejeitacao:   row.motivo_rejeitacao  || '',
    dataQuitacao:       row.data_quitacao      ? new Date(row.data_quitacao)     : null,
    parcelas: pagamentos.map(p => ({
      id:         p.id,
      data:       p.data || p.created_at,
      valor:      Number(p.valor),
      observacao: p.observacao || '',
    })),
    votos: {}, // Compat legado — votação migrada para tabela disputes
  };
}

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

class Emprestimos {
  constructor(data) {
    this.id                 = data.id || null;
    this.caixinhaId         = data.caixinhaId;
    this.memberId           = data.memberId;
    this.valorSolicitado    = parseFloat(data.valorSolicitado) || 0;
    this.dataSolicitacao    = data.dataSolicitacao instanceof Date
      ? data.dataSolicitacao : new Date(data.dataSolicitacao || Date.now());
    this.status             = data.status || 'pendente';
    this.votos              = data.votos || {};
    this.prazoMeses         = parseInt(data.prazoMeses) || 12;
    this.parcelas           = data.parcelas || [];
    this.valorTotal         = parseFloat(data.valorTotal) || this.valorSolicitado;
    this.valorPago          = parseFloat(data.valorPago) || 0;
    this.taxaJurosAplicada  = parseFloat(data.taxaJurosAplicada) || 0;
    this.valorMultaAplicada = parseFloat(data.valorMultaAplicada) || 0;
    this.dataAprovacao      = data.dataAprovacao   ? new Date(data.dataAprovacao)  : null;
    this.adminAprovador     = data.adminAprovador  || null;
    this.dataRejeitacao     = data.dataRejeitacao  ? new Date(data.dataRejeitacao) : null;
    this.adminRejeitador    = data.adminRejeitador || null;
    this.motivoRejeitacao   = data.motivoRejeitacao || '';
    this.dataQuitacao       = data.dataQuitacao    ? new Date(data.dataQuitacao)   : null;
  }

  // ── Leitura ──────────────────────────────────────────────────────────────

  static async getConfiguracao(caixinhaId) {
    try {
      const { data, error } = await sb()
        .from(TABLE_SETTINGS)
        .select('*')
        .eq('caixinha_id', caixinhaId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      return {
        limiteEmprestimo:      Number(data.limite_emprestimo)      || 0,
        prazoMaximoEmprestimo: data.prazo_maximo_emprestimo        || 12,
        taxaJuros:             Number(data.taxa_juros)             || 0,
        valorMulta:            Number(data.valor_multa)            || 0,
        valorJuros:            Number(data.valor_juros)            || 0,
      };
    } catch (error) {
      logger.error('Erro ao obter configuração de empréstimos', { service: SERVICE, caixinhaId, error: error.message });
      throw error;
    }
  }

  static async getById(caixinhaId, emprestimoId) {
    logger.info('Buscando empréstimo', { service: SERVICE, caixinhaId, emprestimoId });

    try {
      const { data, error } = await sb()
        .from(TABLE)
        .select('*')
        .eq('id', emprestimoId)
        .eq('caixinha_id', caixinhaId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      const { data: pagamentos } = await sb()
        .from(TABLE_PAG)
        .select('*')
        .eq('emprestimo_id', emprestimoId)
        .order('data', { ascending: true });

      return new Emprestimos(mapEmprestimo(data, pagamentos || []));
    } catch (error) {
      logger.error('Erro ao buscar empréstimo', { service: SERVICE, caixinhaId, emprestimoId, error: error.message });
      throw error;
    }
  }

  static async getAllByCaixinha(caixinhaId, filtros = {}) {
    logger.info('Buscando empréstimos da caixinha', { service: SERVICE, caixinhaId });

    try {
      let query = sb().from(TABLE).select('*').eq('caixinha_id', caixinhaId);
      if (filtros.status) query = query.eq('status', filtros.status);
      if (filtros.userId) query = query.eq('user_id', filtros.userId);
      query = query.order('data_solicitacao', { ascending: false });

      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map(row => new Emprestimos(mapEmprestimo(row)));
    } catch (error) {
      logger.error('Erro ao buscar empréstimos da caixinha', { service: SERVICE, caixinhaId, error: error.message });
      throw error;
    }
  }

  /** Query direta — elimina o N+1 anterior que varreia todas as caixinhas */
  static async getAllByUsuario(userId, filtros = {}) {
    logger.info('Buscando empréstimos do usuário', { service: SERVICE, userId });

    try {
      let query = sb().from(TABLE).select('*').eq('user_id', userId);
      if (filtros.status) query = query.eq('status', filtros.status);
      query = query.order('data_solicitacao', { ascending: false });

      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map(row => new Emprestimos(mapEmprestimo(row)));
    } catch (error) {
      logger.error('Erro ao buscar empréstimos do usuário', { service: SERVICE, userId, error: error.message });
      throw error;
    }
  }

  static async getByUserId(userId, limit = 10) {
    try {
      const { data, error } = await sb()
        .from(TABLE)
        .select('*')
        .eq('user_id', userId)
        .order('data_solicitacao', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return (data || []).map(row => new Emprestimos(mapEmprestimo(row)));
    } catch (error) {
      logger.warn('Erro ao buscar empréstimos por userId', { service: SERVICE, error: error.message });
      return [];
    }
  }

  // ── Escrita ──────────────────────────────────────────────────────────────

  static async create(caixinhaId, data) {
    const { error: vErr } = createSchema.validate(data);
    if (vErr) throw new Error(vErr.details[0].message);

    logger.info('Criando empréstimo', { service: SERVICE, caixinhaId, userId: data.userId });

    try {
      // Valida caixinha
      const { data: cx, error: cxErr } = await sb()
        .from('caixinhas')
        .select('permite_emprestimos')
        .eq('id', caixinhaId)
        .single();

      if (cxErr) throw cxErr;
      if (!cx) throw new Error('Caixinha não encontrada');
      if (!cx.permite_emprestimos) throw new Error('Esta caixinha não permite empréstimos');

      const configuracao = await this.getConfiguracao(caixinhaId);
      if (!configuracao) throw new Error('Configuração de empréstimos não encontrada');

      const valorSolicitado = parseFloat(data.valor || data.valorSolicitado);
      const prazoMeses      = parseInt(data.parcelas || data.prazoMeses || 12);

      if (configuracao.limiteEmprestimo > 0 && valorSolicitado > configuracao.limiteEmprestimo) {
        throw new Error(`Valor excede o limite de empréstimo (${configuracao.limiteEmprestimo})`);
      }
      if (prazoMeses > configuracao.prazoMaximoEmprestimo) {
        throw new Error(`Prazo excede o máximo permitido (${configuracao.prazoMaximoEmprestimo} meses)`);
      }

      const taxaJuros   = parseFloat(configuracao.taxaJuros || 0);
      const valorTotal  = valorSolicitado * (1 + (taxaJuros / 100) * (prazoMeses / 12));
      const emprestimoId = randomUUID();

      const { data: created, error } = await sb()
        .from(TABLE)
        .insert({
          id:                   emprestimoId,
          caixinha_id:          caixinhaId,
          user_id:              data.userId || data.memberId,
          valor_solicitado:     valorSolicitado,
          valor_total:          valorTotal,
          valor_pago:           0,
          prazo_meses:          prazoMeses,
          status:               'pendente',
          taxa_juros_aplicada:  taxaJuros,
          valor_multa_aplicada: parseFloat(configuracao.valorMulta || 0),
          data_solicitacao:     new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      logger.info('Empréstimo criado', { service: SERVICE, emprestimoId });
      return new Emprestimos(mapEmprestimo(created));
    } catch (error) {
      logger.error('Erro ao criar empréstimo', { service: SERVICE, caixinhaId, error: error.message });
      throw error;
    }
  }

  static async update(caixinhaId, emprestimoId, data) {
    const { error: vErr } = updateSchema.validate(data);
    if (vErr) throw new Error(vErr.details[0].message);

    logger.info('Atualizando empréstimo', { service: SERVICE, caixinhaId, emprestimoId });

    try {
      const row = {};
      if (data.status !== undefined)           row.status = data.status;
      if (data.valorPago !== undefined)        row.valor_pago = data.valorPago;
      if (data.dataAprovacao !== undefined)    row.data_aprovacao = data.dataAprovacao ? new Date(data.dataAprovacao).toISOString() : null;
      if (data.adminAprovador !== undefined)   row.admin_aprovador = data.adminAprovador;
      if (data.dataRejeitacao !== undefined)   row.data_rejeitacao = data.dataRejeitacao ? new Date(data.dataRejeitacao).toISOString() : null;
      if (data.adminRejeitador !== undefined)  row.admin_rejeitador = data.adminRejeitador;
      if (data.motivoRejeitacao !== undefined) row.motivo_rejeitacao = data.motivoRejeitacao;
      if (data.dataQuitacao !== undefined)     row.data_quitacao = data.dataQuitacao ? new Date(data.dataQuitacao).toISOString() : null;

      const { data: updated, error } = await sb()
        .from(TABLE)
        .update(row)
        .eq('id', emprestimoId)
        .eq('caixinha_id', caixinhaId)
        .select()
        .single();

      if (error) throw error;

      return new Emprestimos(mapEmprestimo(updated));
    } catch (error) {
      logger.error('Erro ao atualizar empréstimo', { service: SERVICE, caixinhaId, emprestimoId, error: error.message });
      throw error;
    }
  }

  static async aprovar(caixinhaId, emprestimoId, adminId) {
    logger.info('Aprovando empréstimo', { service: SERVICE, caixinhaId, emprestimoId, adminId });

    const emprestimo = await this.getById(caixinhaId, emprestimoId);
    if (!emprestimo) throw new Error('Empréstimo não encontrado');
    if (emprestimo.status !== 'pendente') throw new Error(`Status atual inválido para aprovação: ${emprestimo.status}`);

    return this.update(caixinhaId, emprestimoId, {
      status: 'aprovado', dataAprovacao: new Date(), adminAprovador: adminId,
    });
  }

  static async rejeitar(caixinhaId, emprestimoId, adminId, motivo = '') {
    logger.info('Rejeitando empréstimo', { service: SERVICE, caixinhaId, emprestimoId, adminId });

    const emprestimo = await this.getById(caixinhaId, emprestimoId);
    if (!emprestimo) throw new Error('Empréstimo não encontrado');
    if (emprestimo.status !== 'pendente') throw new Error(`Status atual inválido para rejeição: ${emprestimo.status}`);

    return this.update(caixinhaId, emprestimoId, {
      status: 'rejeitado', dataRejeitacao: new Date(), adminRejeitador: adminId, motivoRejeitacao: motivo,
    });
  }

  static async registrarPagamento(caixinhaId, emprestimoId, valor, observacao = '', userId = 'system') {
    logger.info('Registrando pagamento', { service: SERVICE, caixinhaId, emprestimoId, valor });

    try {
      // RPC atômica: lock + insert pagamento + update empréstimo + transação audit + saldo
      const { data: result, error: rpcError } = await sb().rpc('registrar_pagamento_emprestimo', {
        p_emprestimo_id: emprestimoId,
        p_caixinha_id: caixinhaId,
        p_user_id: userId,
        p_valor: valor,
        p_observacao: observacao
      });

      if (rpcError) throw new Error(rpcError.message || 'Erro ao registrar pagamento');

      logger.info('Pagamento registrado via RPC', { service: SERVICE, emprestimoId, novoStatus: result.novo_status });

      // Return updated loan
      return await this.getById(caixinhaId, emprestimoId);
    } catch (error) {
      logger.error('Erro ao registrar pagamento', { service: SERVICE, caixinhaId, emprestimoId, error: error.message });
      throw error;
    }
  }

  static async delete(caixinhaId, emprestimoId) {
    logger.info('Excluindo empréstimo', { service: SERVICE, caixinhaId, emprestimoId });

    try {
      const emprestimo = await this.getById(caixinhaId, emprestimoId);
      if (!emprestimo) throw new Error('Empréstimo não encontrado');
      if (!['pendente', 'rejeitado'].includes(emprestimo.status)) {
        throw new Error(`Só é possível excluir empréstimos pendentes ou rejeitados. Status: ${emprestimo.status}`);
      }

      const { error } = await sb()
        .from(TABLE)
        .delete()
        .eq('id', emprestimoId)
        .eq('caixinha_id', caixinhaId);

      if (error) throw error;
    } catch (error) {
      logger.error('Erro ao excluir empréstimo', { service: SERVICE, caixinhaId, emprestimoId, error: error.message });
      throw error;
    }
  }

  static async getEstatisticas(caixinhaId) {
    logger.info('Obtendo estatísticas de empréstimos', { service: SERVICE, caixinhaId });

    try {
      const { data, error } = await sb()
        .from(TABLE)
        .select('status, valor_solicitado')
        .eq('caixinha_id', caixinhaId);

      if (error) throw error;
      const rows = data || [];

      const total      = rows.length;
      const pendentes  = rows.filter(e => e.status === 'pendente').length;
      const aprovados  = rows.filter(e => ['aprovado', 'parcial'].includes(e.status)).length;
      const quitados   = rows.filter(e => e.status === 'quitado').length;
      const rejeitados = rows.filter(e => e.status === 'rejeitado').length;

      const sum = (filter) => rows.filter(filter).reduce((acc, e) => acc + Number(e.valor_solicitado), 0);

      return {
        total, pendentes, aprovados, quitados, rejeitados,
        valorTotal:    sum(e => ['aprovado','parcial','quitado'].includes(e.status)),
        valorQuitado:  sum(e => e.status === 'quitado'),
        valorEmAberto: sum(e => ['aprovado','parcial'].includes(e.status)),
      };
    } catch (error) {
      logger.error('Erro ao obter estatísticas', { service: SERVICE, caixinhaId, error: error.message });
      throw error;
    }
  }
}

module.exports = Emprestimos;
