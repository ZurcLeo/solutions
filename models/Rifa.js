// models/Rifa.js — Supabase-first (migrado de Firestore em 2026-05-19)
// bilhetesVendidos array → tabela rifa_bilhetes normalizada
const { getSupabaseClient } = require('../config/supabase');
const { getFirestore } = require('../firebaseAdmin');
const { logger } = require('../logger');
const { randomUUID, createHash } = require('crypto');

const TABLE          = 'rifas';
const TABLE_BILHETES = 'rifa_bilhetes';
const SERVICE        = 'rifaModel';

function mapRifa(row, bilhetes = []) {
  if (!row) return null;
  return {
    id:                   row.id,
    caixinhaId:           row.caixinha_id,
    nome:                 row.nome,
    descricao:            row.descricao         || null,
    valorBilhete:         Number(row.valor_bilhete),
    quantidadeBilhetes:   row.quantidade_bilhetes,
    dataInicio:           row.data_inicio        ? new Date(row.data_inicio)  : new Date(),
    dataFim:              row.data_fim           ? new Date(row.data_fim)     : null,
    status:               row.status             || 'ABERTA',
    premio:               row.premio             || null,
    sorteioData:          row.sorteio_data       ? new Date(row.sorteio_data) : null,
    sorteioMetodo:        row.sorteio_metodo     || 'RANDOM_ORG',
    sorteioReferencia:    row.sorteio_referencia || null,
    sorteioResultado:     row.sorteio_resultado  || null,
    contestType:          row.contest_type       || 'SORTEIO',
    contestConfig:        row.contest_config     || {},
    bilhetesVendidos:     bilhetes.map(b => ({
      id:        b.id,
      numero:    b.numero,
      membroId:  b.user_id,
      dataCompra: b.data_compra || b.created_at,
    })),
    createdAt: row.created_at ? new Date(row.created_at) : new Date(),
    updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
  };
}

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

class Rifa {
  constructor(data) {
    this.id                  = data.id || null;
    this.caixinhaId          = data.caixinhaId;
    this.nome                = data.nome;
    this.descricao           = data.descricao;
    this.valorBilhete        = data.valorBilhete;
    this.quantidadeBilhetes  = data.quantidadeBilhetes;
    this.bilhetesVendidos    = data.bilhetesVendidos || [];
    this.dataInicio          = data.dataInicio  ? new Date(data.dataInicio)  : new Date();
    this.dataFim             = data.dataFim     ? new Date(data.dataFim)     : null;
    this.status              = data.status      || 'ABERTA';
    this.premio              = data.premio;
    this.sorteioData         = data.sorteioData ? new Date(data.sorteioData) : null;
    this.sorteioMetodo       = data.sorteioMetodo    || 'RANDOM_ORG';
    this.sorteioReferencia   = data.sorteioReferencia || null;
    this.sorteioResultado    = data.sorteioResultado  || null;
    this.contestType         = data.contestType       || data.contest_type  || 'SORTEIO';
    this.contestConfig       = data.contestConfig     || data.contest_config || {};
    this.createdAt           = data.createdAt ? new Date(data.createdAt) : new Date();
    this.updatedAt           = data.updatedAt ? new Date(data.updatedAt) : new Date();
  }

  // ── Leitura ──────────────────────────────────────────────────────────────

  static async getById(caixinhaId, rifaId) {
    logger.info('Buscando rifa', { service: SERVICE, caixinhaId, rifaId });

    try {
      if (!rifaId || typeof rifaId !== 'string' || !rifaId.trim()) {
        throw new Error('ID da rifa inválido ou não fornecido.');
      }

      const { data, error } = await sb()
        .from(TABLE)
        .select('*')
        .eq('id', rifaId)
        .eq('caixinha_id', caixinhaId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      const { data: bilhetes } = await sb()
        .from(TABLE_BILHETES)
        .select('*')
        .eq('rifa_id', rifaId)
        .order('numero', { ascending: true });

      return new Rifa(mapRifa(data, bilhetes || []));
    } catch (error) {
      logger.error('Erro ao buscar rifa', { service: SERVICE, caixinhaId, rifaId, error: error.message });
      throw error;
    }
  }

  static async getByCaixinha(caixinhaId) {
    logger.info('Buscando rifas por caixinha', { service: SERVICE, caixinhaId });

    try {
      const { data, error } = await sb()
        .from(TABLE)
        .select('*')
        .eq('caixinha_id', caixinhaId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(row => new Rifa(mapRifa(row)));
    } catch (error) {
      logger.error('Erro ao buscar rifas', { service: SERVICE, caixinhaId, error: error.message });
      throw error;
    }
  }

  // ── Escrita ──────────────────────────────────────────────────────────────

  static async create(data) {
    logger.info('Criando rifa', { service: SERVICE, caixinhaId: data.caixinhaId, nome: data.nome });

    try {
      const rifaId = randomUUID();
      const rifa   = new Rifa({ ...data, id: rifaId });

      const { data: created, error } = await sb()
        .from(TABLE)
        .insert({
          id:                  rifaId,
          caixinha_id:         rifa.caixinhaId,
          nome:                rifa.nome,
          descricao:           rifa.descricao  || null,
          valor_bilhete:       rifa.valorBilhete,
          quantidade_bilhetes: rifa.quantidadeBilhetes,
          data_inicio:         rifa.dataInicio.toISOString(),
          data_fim:            rifa.dataFim    ? rifa.dataFim.toISOString()    : null,
          status:              rifa.status,
          premio:              rifa.premio     || null,
          sorteio_metodo:      rifa.sorteioMetodo,
          contest_type:        rifa.contestType,
          contest_config:      rifa.contestConfig,
        })
        .select()
        .single();

      if (error) throw error;

      // Backup Firestore fire-and-forget
      try {
        getFirestore()
          .collection('caixinhas').doc(data.caixinhaId)
          .collection('rifas').doc(rifaId)
          .set({ ...rifa, id: rifaId }).catch(() => {});
      } catch (_) {}

      logger.info('Rifa criada', { service: SERVICE, rifaId });
      return new Rifa(mapRifa(created));
    } catch (error) {
      logger.error('Erro ao criar rifa', { service: SERVICE, error: error.message });
      throw error;
    }
  }

  static async update(caixinhaId, rifaId, data) {
    logger.info('Atualizando rifa', { service: SERVICE, caixinhaId, rifaId });

    try {
      const row = {};
      if (data.nome !== undefined)              row.nome = data.nome;
      if (data.descricao !== undefined)         row.descricao = data.descricao;
      if (data.status !== undefined)            row.status = data.status;
      if (data.premio !== undefined)            row.premio = data.premio;
      if (data.dataFim !== undefined)           row.data_fim = data.dataFim ? new Date(data.dataFim).toISOString() : null;
      if (data.sorteioData !== undefined)       row.sorteio_data = data.sorteioData ? new Date(data.sorteioData).toISOString() : null;
      if (data.sorteioMetodo !== undefined)     row.sorteio_metodo = data.sorteioMetodo;
      if (data.sorteioReferencia !== undefined) row.sorteio_referencia = data.sorteioReferencia;
      if (data.sorteioResultado !== undefined)  row.sorteio_resultado = data.sorteioResultado;

      const { data: updated, error } = await sb()
        .from(TABLE)
        .update(row)
        .eq('id', rifaId)
        .eq('caixinha_id', caixinhaId)
        .select()
        .single();

      if (error) throw error;

      // Backup Firestore fire-and-forget
      try {
        getFirestore()
          .collection('caixinhas').doc(caixinhaId)
          .collection('rifas').doc(rifaId)
          .update(data).catch(() => {});
      } catch (_) {}

      return new Rifa(mapRifa(updated));
    } catch (error) {
      logger.error('Erro ao atualizar rifa', { service: SERVICE, caixinhaId, rifaId, error: error.message });
      throw error;
    }
  }

  static async delete(caixinhaId, rifaId) {
    logger.info('Excluindo rifa', { service: SERVICE, caixinhaId, rifaId });

    try {
      const { error } = await sb()
        .from(TABLE)
        .delete()
        .eq('id', rifaId)
        .eq('caixinha_id', caixinhaId);

      if (error) throw error;

      // Backup Firestore fire-and-forget
      try {
        getFirestore()
          .collection('caixinhas').doc(caixinhaId)
          .collection('rifas').doc(rifaId)
          .delete().catch(() => {});
      } catch (_) {}

      return true;
    } catch (error) {
      logger.error('Erro ao excluir rifa', { service: SERVICE, caixinhaId, rifaId, error: error.message });
      throw error;
    }
  }

  // ── Métodos de instância ─────────────────────────────────────────────────

  async venderBilhete(caixinhaId, rifaId, membroId, numeroBilhete) {
    try {
      if (numeroBilhete < 1 || numeroBilhete > this.quantidadeBilhetes) {
        throw new Error(`Número inválido. Deve estar entre 1 e ${this.quantidadeBilhetes}.`);
      }
      if (this.dataFim && new Date() > this.dataFim) {
        throw new Error('Esta rifa já foi encerrada.');
      }

      const { data: bilhete, error } = await sb()
        .from(TABLE_BILHETES)
        .insert({ rifa_id: rifaId, numero: numeroBilhete, user_id: membroId })
        .select()
        .single();

      if (error) {
        // UNIQUE violation → bilhete já vendido
        if (error.code === '23505') throw new Error('Este bilhete já foi vendido.');
        throw error;
      }

      const novoBilhete = { id: bilhete.id, numero: numeroBilhete, membroId, dataCompra: bilhete.data_compra };
      this.bilhetesVendidos.push(novoBilhete);
      this.updatedAt = new Date();

      logger.info('Bilhete vendido', { service: SERVICE, rifaId, membroId, numeroBilhete });
      return novoBilhete;
    } catch (error) {
      logger.error('Erro ao vender bilhete', { service: SERVICE, rifaId, membroId, numeroBilhete, error: error.message });
      throw error;
    }
  }

  async registrarSorteio(caixinhaId, rifaId, resultado, metodo, referencia) {
    try {
      if (this.status !== 'ABERTA') throw new Error('Esta rifa não está aberta para sorteio.');
      if (this.bilhetesVendidos.length === 0) throw new Error('Não há bilhetes vendidos.');

      const numeroSorteado = parseInt(resultado);
      if (isNaN(numeroSorteado) || numeroSorteado < 1 || numeroSorteado > this.quantidadeBilhetes) {
        throw new Error(`Número sorteado inválido. Deve estar entre 1 e ${this.quantidadeBilhetes}.`);
      }

      const bilheteVencedor = this.bilhetesVendidos.find(b => b.numero === numeroSorteado) || null;
      const verificacaoHash = createHash('sha256')
        .update(JSON.stringify({ caixinhaId, rifaId, numeroSorteado, metodo, referencia, timestamp: new Date().toISOString() }))
        .digest('hex');

      const sorteioResultado = {
        numeroSorteado,
        bilheteVencedor,
        verificacaoHash,
        dataSorteio: new Date().toISOString(),
        comprovante: null,
      };

      await Rifa.update(caixinhaId, rifaId, {
        status:            'FINALIZADA',
        sorteioResultado,
        sorteioMetodo:     metodo,
        sorteioReferencia: referencia,
        sorteioData:       new Date(),
      });

      this.status           = 'FINALIZADA';
      this.sorteioResultado = sorteioResultado;
      this.sorteioMetodo    = metodo;
      this.sorteioReferencia = referencia;
      this.updatedAt        = new Date();

      logger.info('Sorteio realizado', { service: SERVICE, rifaId, numeroSorteado });
      return sorteioResultado;
    } catch (error) {
      logger.error('Erro ao registrar sorteio', { service: SERVICE, rifaId, error: error.message });
      throw error;
    }
  }

  /** @deprecated Use createHash from 'crypto' directly */
  _gerarHashVerificacao(dados) {
    return createHash('sha256').update(JSON.stringify(dados)).digest('hex');
  }
}

module.exports = Rifa;
