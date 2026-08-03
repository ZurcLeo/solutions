// models/Contribuicao.js — Supabase-first (migrado de Firestore em 2026-05-19)
const { getSupabaseClient } = require('../config/supabase');
const Joi = require('joi');
const { logger } = require('../logger');

const VALID_STATUSES = ['confirmada', 'estornada', 'pendente', 'pendente_confirmacao', 'rejeitada', 'sem_comprovante'];

const createSchema = Joi.object({
  caixinhaId: Joi.string().required(),
  valor: Joi.number().positive().required(),
  status: Joi.string().valid(...VALID_STATUSES).default('confirmada'),
}).unknown(true).or('membroId', 'userId');

const updateSchema = Joi.object({
  status: Joi.string().valid(...VALID_STATUSES).optional(),
  valor: Joi.number().positive().optional(),
}).unknown(true);

const TABLE = 'contribuicoes';
const SERVICE = 'contribuicaoModel';

function mapContribuicao(row) {
  if (!row) return null;
  return {
    id:               row.id,
    caixinhaId:       row.caixinha_id,
    membroId:         row.user_id,
    userId:           row.user_id,
    valor:            Number(row.valor),
    status:           row.status || 'confirmada',
    dataContribuicao: row.data_contribuicao ? new Date(row.data_contribuicao) : new Date(),
    estornadoEm:      row.estornado_em ? new Date(row.estornado_em) : null,
    estornadoPor:     row.estornado_por || null,
  };
}

/** Normaliza dataContribuicao para ISO string — aceita Date, ISO string ou Firestore Timestamp {seconds} */
function toIso(val) {
  if (!val) return new Date().toISOString();
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return val;
  if (val.seconds) return new Date(val.seconds * 1000).toISOString();
  return new Date(val).toISOString();
}

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

class Contribuicao {
  constructor(data) {
    this.id              = data.id;
    this.caixinhaId      = data.caixinhaId;
    this.membroId        = data.membroId || data.userId;
    this.valor           = data.valor ?? data.contribuicao;
    this.status          = data.status || 'confirmada';
    // Aceita Date, ISO string ou Firestore Timestamp { seconds }
    this.dataContribuicao = data.dataContribuicao instanceof Date
      ? data.dataContribuicao
      : data.dataContribuicao?.seconds
        ? new Date(data.dataContribuicao.seconds * 1000)
        : data.dataContribuicao
          ? new Date(data.dataContribuicao)
          : new Date();
  }

  // ── Leitura ─────────────────────────────────────────────────────────────

  static async getById(caixinhaId, id) {
    const { data, error } = await sb()
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .eq('caixinha_id', caixinhaId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Contribuição não encontrada.');
    return new Contribuicao(mapContribuicao(data));
  }

  static async getByCaixinha(caixinhaId, limit = 100) {
    const { data, error } = await sb()
      .from(TABLE)
      .select('*')
      .eq('caixinha_id', caixinhaId)
      .order('data_contribuicao', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data || []).map(row => new Contribuicao(mapContribuicao(row)));
  }

  static async getByUserId(userId, limit = 10) {
    try {
      const { data, error } = await sb()
        .from(TABLE)
        .select('*')
        .eq('user_id', userId)
        .order('data_contribuicao', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return (data || []).map(row => new Contribuicao(mapContribuicao(row)));
    } catch (error) {
      logger.warn('Failed to get contributions by user ID', { service: SERVICE, error: error.message });
      return [];
    }
  }

  // ── Escrita ──────────────────────────────────────────────────────────────

  static async create(data) {
    const { error: vErr } = createSchema.validate(data);
    if (vErr) throw new Error(vErr.details[0].message);

    logger.info('Criando contribuição', { service: SERVICE, caixinhaId: data.caixinhaId });

    const row = {
      caixinha_id:      data.caixinhaId,
      user_id:          data.membroId || data.userId,
      valor:            data.valor ?? data.contribuicao,
      status:           data.status || 'confirmada',
      data_contribuicao: toIso(data.dataContribuicao),
    };

    const { data: created, error } = await sb()
      .from(TABLE)
      .insert(row)
      .select()
      .single();

    if (error) throw error;

    return new Contribuicao(mapContribuicao(created));
  }

  static async update(caixinhaId, id, data) {
    const { error: vErr } = updateSchema.validate(data);
    if (vErr) throw new Error(vErr.details[0].message);

    const row = {};
    if (data.status !== undefined)           row.status = data.status;
    if (data.valor !== undefined)            row.valor = data.valor;
    if (data.dataContribuicao !== undefined) row.data_contribuicao = toIso(data.dataContribuicao);

    const { data: updated, error } = await sb()
      .from(TABLE)
      .update(row)
      .eq('id', id)
      .eq('caixinha_id', caixinhaId)
      .select()
      .single();

    if (error) throw error;

    return new Contribuicao(mapContribuicao(updated));
  }

  /**
   * Estorna uma contribuição atomicamente via RPC SQL.
   * Marca como 'estornada', cria transação de reversão e decrementa saldo —
   * tudo em uma única transação com SELECT FOR UPDATE (sem race conditions).
   */
  static async reverter(caixinhaId, id, adminId) {
    const { data, error } = await sb().rpc('reverter_contribuicao', {
      p_contribuicao_id: id,
      p_caixinha_id: caixinhaId,
      p_admin_id: adminId || null,
    });

    if (error) {
      // Map PostgreSQL error codes to user-friendly messages
      if (error.message?.includes('não encontrada')) throw new Error('Contribuição não encontrada.');
      if (error.message?.includes('já foi estornada')) throw new Error('Contribuição já foi estornada.');
      if (error.message?.includes('inválido para estorno')) throw new Error('Valor da contribuição inválido para estorno.');
      throw error;
    }

    logger.info('Contribuição estornada atomicamente', {
      service: SERVICE, contribuicaoId: id, caixinhaId,
      valorEstornado: data?.valor_estornado, novoSaldo: data?.novo_saldo,
    });

    return data;
  }
}

module.exports = Contribuicao;
