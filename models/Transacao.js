// models/Transacao.js — Supabase-first (migrado de Firestore em 2026-05-19)
// Fix: N+1 query eliminado — getByUserId agora faz query direta por user_id
const { getSupabaseClient } = require('../config/supabase');
const Joi = require('joi');
const { logger } = require('../logger');

const VALID_TIPOS = ['contribuicao', 'emprestimo', 'bonus', 'estorno', 'pagamento_emprestimo', 'distribuicao', 'saque', 'ajuste'];

const createSchema = Joi.object({
  caixinhaId: Joi.string().required(),
  userId: Joi.string().required(),
  type: Joi.string().valid(...VALID_TIPOS).required(),
  amount: Joi.number().required(),
}).unknown(true);

const TABLE = 'transacoes';
const SERVICE = 'transacaoModel';

function mapTransacao(row) {
  if (!row) return null;
  return {
    id:         row.id,
    caixinhaId: row.caixinha_id,
    userId:     row.user_id,
    type:       row.tipo,
    amount:     row.valor,
    date:       row.data ? new Date(row.data) : new Date(),
  };
}

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

class Transacao {
  constructor(data) {
    this.id = data.id;
    this.caixinhaId = data.caixinhaId;
    this.userId = data.userId;
    this.type = data.type;
    this.amount = data.amount;
    this.date = data.date ? new Date(data.date) : new Date();
  }

  static async getById(caixinhaId, id) {
    const { data, error } = await sb()
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .eq('caixinha_id', caixinhaId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Transação não encontrada.');
    return new Transacao(mapTransacao(data));
  }

  static async create(data) {
    const { error: vErr } = createSchema.validate(data);
    if (vErr) throw new Error(vErr.details[0].message);

    logger.info('Criando transação', { service: SERVICE, caixinhaId: data.caixinhaId });

    const row = {
      id:           data.id || undefined,
      caixinha_id:  data.caixinhaId,
      user_id:      data.userId,
      tipo:         data.type,
      valor:        data.amount,
      data:         data.date ? new Date(data.date).toISOString() : new Date().toISOString(),
      contribuicao_id: data.contribuicaoId || null,
      emprestimo_id:   data.emprestimoId || null,
    };

    const { data: created, error } = await sb()
      .from(TABLE)
      .insert(row)
      .select()
      .single();

    if (error) throw error;

    return new Transacao(mapTransacao(created));
  }

  /** Query direta por user_id — elimina o N+1 anterior que varria todas as caixinhas */
  static async getByUserId(userId, limit = 10) {
    try {
      const { data, error } = await sb()
        .from(TABLE)
        .select('*')
        .eq('user_id', userId)
        .order('data', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return (data || []).map(row => new Transacao(mapTransacao(row)));
    } catch (error) {
      logger.warn('Failed to get transactions by user ID', { service: SERVICE, error: error.message });
      return [];
    }
  }

  static async getByCaixinha(caixinhaId, limit = 50) {
    const { data, error } = await sb()
      .from(TABLE)
      .select('*')
      .eq('caixinha_id', caixinhaId)
      .order('data', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data || []).map(row => new Transacao(mapTransacao(row)));
  }
}

module.exports = Transacao;
