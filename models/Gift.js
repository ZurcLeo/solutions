// models/Gift.js — Supabase-only
const { getSupabaseClient } = require('../config/supabase');
const { randomUUID } = require('crypto');
const { logger } = require('../logger');

const TABLE = 'gifts';

function mapGift(row) {
  if (!row) return null;
  return {
    id:              row.id,
    postId:          row.post_id,
    sender:          row.from_user_id,
    toUserId:        row.to_user_id,
    nome:            row.tipo,
    valor:           Number(row.valor),
    message:         row.message         || null,
    stickerImageUrl: row.sticker_catalog?.image_url || null,
    stickerName:     row.sticker_catalog?.name      || null,
    timestamp:       row.created_at ? new Date(row.created_at) : new Date(),
  };
}

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

class Gift {
  constructor(data) {
    this.id              = data.id             || null;
    this.giftId          = data.giftId         || data.id;
    this.senderName      = data.senderName     || null;
    this.sender          = data.sender;
    this.valor           = data.valor;
    this.nome            = data.nome;
    this.url             = data.url            || null;
    this.message         = data.message        || null;
    this.stickerImageUrl = data.stickerImageUrl || null;
    this.stickerName     = data.stickerName    || null;
    this.timestamp       = data.timestamp instanceof Date
      ? data.timestamp
      : data.timestamp?.seconds
        ? new Date(data.timestamp.seconds * 1000)
        : data.timestamp ? new Date(data.timestamp) : new Date();
  }

  static async getByPostId(postId) {
    const { data, error } = await sb()
      .from(TABLE)
      .select('*, sticker_catalog(image_url, name)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data || []).map(row => new Gift(mapGift(row)));
  }

  static async create(postId, data) {
    const giftId   = data.id       || randomUUID();
    const toUserId = data.toUserId || data.receiverId || null;

    const { data: created, error } = await sb()
      .from(TABLE)
      .insert({
        id:           giftId,
        post_id:      postId,
        from_user_id: data.sender    || data.fromUserId,
        to_user_id:   toUserId,
        tipo:         data.nome      || data.tipo || 'generic',
        valor:        data.valor     || 0,
      })
      .select()
      .single();

    if (error) throw error;
    return new Gift(mapGift(created));
  }

  /**
   * Envia um sticker como gift de forma atômica via RPC send_sticker_gift.
   * A RPC garante: validação do catálogo, debit/credit de EloCoins (FOR UPDATE),
   * idempotência, insert em gifts + user_stickers — tudo em uma única transação.
   *
   * Erros propagados com mensagens legíveis:
   *   'Saldo insuficiente'       → HTTP 402 (caller)
   *   'Sticker esgotado'         → HTTP 409
   *   'atingiu o limite'         → HTTP 409
   *   'não encontrado ou inativo'→ HTTP 404
   *   'fora do período'          → HTTP 409
   *
   * @param {object} params
   * @param {string} params.senderId
   * @param {string} params.receiverId
   * @param {string} params.stickerId       UUID do sticker_catalog
   * @param {string} [params.postId]        ID do post associado (opcional)
   * @param {string} [params.idempotencyKey] UUID gerado pelo caller para evitar double-spend
   * @returns {object} { gift_id, sticker_id, sticker_name, amount_spent, sender_new_balance, receiver_user_id, idempotent }
   */
  static async sendSticker({ senderId, receiverId, stickerId, postId = null, idempotencyKey = null, message = null }) {
    const { data, error } = await sb()
      .rpc('send_sticker_gift', {
        p_sender_id:       senderId,
        p_receiver_id:     receiverId,
        p_sticker_id:      stickerId,
        p_post_id:         postId,
        p_idempotency_key: idempotencyKey,
        p_message:         message || null,
      });

    if (error) {
      logger.error('[Gift.sendSticker] RPC send_sticker_gift falhou', {
        errorMessage: error.message,
        errorCode: error.code,
        errorDetails: error.details,
        errorHint: error.hint,
        senderId,
        receiverId,
        stickerId,
        postId,
      });
      const enrichedError = new Error(error.message || 'Erro ao enviar gift.');
      enrichedError.code = error.code;
      enrichedError.details = error.details;
      throw enrichedError;
    }
    return data;
  }

  static async delete(postId, giftId) {
    const { error } = await sb().from(TABLE).delete().eq('id', giftId);
    if (error) throw error;
  }
}

module.exports = Gift;
