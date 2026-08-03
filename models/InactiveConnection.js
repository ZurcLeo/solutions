// models/InactiveConnection.js — Supabase-first (migrado de Firestore em 2026-05-19)
const { getSupabaseClient } = require('../config/supabase');

const TABLE = 'user_connections';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

class InactiveConnection {
  constructor(data) {
    this.id                  = data.id;
    this.nome                = data.nome;
    this.fotoDoPerfil        = data.fotoDoPerfil;
    this.status              = data.status;
    this.dataSolicitacao     = data.dataSolicitacao     ? new Date(data.dataSolicitacao)     : new Date();
    this.dataDesfeita        = data.dataDesfeita        ? new Date(data.dataDesfeita)        : null;
    this.dataAmizadeDesfeita = data.dataAmizadeDesfeita ? new Date(data.dataAmizadeDesfeita) : null;
  }

  static async getById(id) {
    const { data, error } = await sb()
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .eq('status', 'inactive')
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Conexão inativa não encontrada.');

    return new InactiveConnection({
      id:              data.id,
      nome:            data.sender_name      || 'Desconhecido',
      fotoDoPerfil:    data.sender_photo_url || '',
      status:          data.status,
      dataSolicitacao: data.created_at,
      dataDesfeita:    data.updated_at,
    });
  }

  static async create(data) {
    const { data: created, error } = await sb()
      .from(TABLE)
      .insert({
        user_id:           data.userId,
        connected_user_id: data.friendId,
        status:            'inactive',
        sender_name:       data.nome          || null,
        sender_photo_url:  data.fotoDoPerfil  || null,
      })
      .select()
      .single();

    if (error) throw error;
    return new InactiveConnection({ ...data, id: created.id });
  }

  static async update(id, data) {
    const { data: updated, error } = await sb()
      .from(TABLE)
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return new InactiveConnection({ id, ...data });
  }

  static async delete(id) {
    const { error } = await sb().from(TABLE).delete().eq('id', id);
    if (error) throw error;
  }
}

module.exports = InactiveConnection;
