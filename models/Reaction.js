// models/Reaction.js — Supabase-only
const { getSupabaseClient } = require('../config/supabase');
const { randomUUID } = require('crypto');

const TABLE   = 'reactions';
const SERVICE = 'reactionModel';

function mapReaction(row) {
  if (!row) return null;
  return {
    id:            row.id,
    postId:        row.post_id,
    usuarioId:     row.usuario_id,
    tipoDeReacao:  row.tipo,
    timestamp:     row.created_at ? new Date(row.created_at) : new Date(),
  };
}

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

class Reaction {
  constructor(data) {
    this.id           = data.id;
    this.tipoDeReacao = data.tipoDeReacao || data.tipo;
    this.senderName   = data.senderName;
    this.senderFoto   = data.senderFoto;
    this.timestamp    = data.timestamp instanceof Date
      ? data.timestamp
      : data.timestamp?.seconds
        ? new Date(data.timestamp.seconds * 1000)
        : data.timestamp ? new Date(data.timestamp) : new Date();
  }

  static async getByPostId(postId) {
    const { data, error } = await sb()
      .from(TABLE)
      .select('*')
      .eq('post_id', postId);

    if (error) throw error;
    return (data || []).map(row => new Reaction(mapReaction(row)));
  }

  /**
   * Toggle de reação: se já existe → remove (unlike); se não existe → insere (like).
   * Retorna { liked: boolean, usuarioId, ...campos da reação se liked }
   */
  static async toggle(postId, data) {
    const { data: existing } = await sb()
      .from(TABLE)
      .select('id')
      .eq('post_id', postId)
      .eq('usuario_id', data.usuarioId)
      .maybeSingle();

    if (existing) {
      const { error } = await sb().from(TABLE).delete().eq('id', existing.id);
      if (error) throw error;
      return { liked: false, usuarioId: data.usuarioId, postId };
    }

    const { data: created, error } = await sb()
      .from(TABLE)
      .insert({
        id:         randomUUID(),
        post_id:    postId,
        usuario_id: data.usuarioId,
        tipo:       data.tipoDeReacao || data.tipo || 'heart',
      })
      .select()
      .single();

    if (error) throw error;
    return { liked: true, usuarioId: data.usuarioId, ...mapReaction(created) };
  }

  static async delete(postId, reactionId) {
    const { error } = await sb().from(TABLE).delete().eq('id', reactionId);
    if (error) throw error;
  }
}

module.exports = Reaction;
