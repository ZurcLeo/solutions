// models/Invite.js — Supabase-only (fallback Firestore removido em 2026-05-19)

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const TABLE = 'invites';
const SERVICE = 'inviteModel';

// ──────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────

/** Converte linha Supabase (snake_case) → objeto camelCase compatível com o serviço. */
function rowToInvite(row) {
  if (!row) return null;
  return {
    id: row.invite_id,
    inviteId: row.invite_id,
    email: row.email,
    friendName: row.friend_name || '',
    senderId: row.sender_id,
    senderName: row.sender_name || '',
    senderPhotoURL: row.sender_photo_url || '',
    status: row.status || 'pending',
    // Retornar JS Date — inviteService usa o helper toDate() para tratar ambos os formatos
    createdAt: row.created_at ? new Date(row.created_at) : new Date(),
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    lastSentAt: row.last_sent_at ? new Date(row.last_sent_at) : null,
    validatedAt: row.validated_at ? new Date(row.validated_at) : null,
    validatedBy: row.validated_by || null,
    usedAt: row.used_at ? new Date(row.used_at) : null,
    usedBy: row.used_by || null,
    canceledAt: row.canceled_at ? new Date(row.canceled_at) : null,
    canceledBy: row.canceled_by || null,
    resendCount: row.resend_count || 0,
    caxinhaInviteId: row.caixinha_invite_id || null,
    caixinhaId: row.caixinha_id || null
  };
}

/** Converte objeto camelCase → linha snake_case para inserção/atualização no Supabase. */
function toRow(data) {
  const row = {};
  if (data.inviteId !== undefined)       row.invite_id         = data.inviteId;
  if (data.email !== undefined)          row.email             = data.email;
  if (data.friendName !== undefined)     row.friend_name       = data.friendName;
  if (data.senderId !== undefined)       row.sender_id         = data.senderId;
  if (data.senderName !== undefined)     row.sender_name       = data.senderName;
  if (data.senderPhotoURL !== undefined) row.sender_photo_url  = data.senderPhotoURL;
  if (data.status !== undefined)         row.status            = data.status;
  if (data.createdAt !== undefined)      row.created_at        = data.createdAt;
  if (data.expiresAt !== undefined)      row.expires_at        = data.expiresAt;
  if (data.lastSentAt !== undefined)     row.last_sent_at      = data.lastSentAt;
  if (data.resendCount !== undefined)    row.resend_count      = data.resendCount;
  if (data.validatedAt !== undefined)    row.validated_at      = data.validatedAt;
  if (data.validatedBy !== undefined)    row.validated_by      = data.validatedBy;
  if (data.usedAt !== undefined)         row.used_at           = data.usedAt;
  if (data.usedBy !== undefined)         row.used_by           = data.usedBy;
  if (data.canceledAt !== undefined)     row.canceled_at       = data.canceledAt;
  if (data.canceledBy !== undefined)     row.canceled_by       = data.canceledBy;
  if (data.caxinhaInviteId !== undefined) row.caixinha_invite_id = data.caxinhaInviteId;
  if (data.caixinhaId !== undefined)     row.caixinha_id       = data.caixinhaId;
  return row;
}

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

// ──────────────────────────────────────────────────────
// Model
// ──────────────────────────────────────────────────────

class Invite {
  constructor(data) {
    Object.assign(this, data);
  }

  toPlainObject() {
    return { ...this };
  }

  // ── Leitura ────────────────────────────────────────

  /**
   * Busca um convite pelo seu inviteId (UUID).
   * Tenta Supabase primeiro; se não encontrado, cai no Firestore (legado).
   * @returns {Promise<{ invite: Object }>}
   */
  static async getById(inviteId) {
    logger.info(`Buscando convite ${inviteId}`, { service: SERVICE, function: 'getById', inviteId });

    try {
      // 1. Supabase
      let invite = null;
      try {
        const { data, error } = await sb()
          .from(TABLE)
          .select('*')
          .eq('invite_id', inviteId)
          .maybeSingle();

        if (error) {
          logger.warn('Supabase getById error, tentando Firestore', { service: SERVICE, error: error.message });
        } else {
          invite = rowToInvite(data);
        }
      } catch (sbErr) {
        logger.warn('Supabase indisponível, tentando Firestore', { service: SERVICE, error: sbErr.message });
      }

      if (!invite) {
        throw new Error('Convite não encontrado.');
      }

      logger.info(`Convite ${inviteId} encontrado`, { service: SERVICE, function: 'getById' });
      return { invite };
    } catch (error) {
      logger.error(`Erro ao buscar convite ${inviteId}`, { service: SERVICE, function: 'getById', error: error.message });
      throw error;
    }
  }

  /**
   * Busca o convite mais recente para um dado email.
   * Tenta Supabase primeiro; fallback Firestore.
   * @returns {Promise<Object|null>}
   */
  static async findByEmail(email) {
    logger.info(`Buscando convite por email`, { service: SERVICE, function: 'findByEmail', email });

    try {
      // 1. Supabase
      let invite = null;
      try {
        const { data, error } = await sb()
          .from(TABLE)
          .select('*')
          .eq('email', email.toLowerCase())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          logger.warn('Supabase findByEmail error, tentando Firestore', { service: SERVICE, error: error.message });
        } else {
          invite = rowToInvite(data);
        }
      } catch (sbErr) {
        logger.warn('Supabase indisponível, tentando Firestore', { service: SERVICE, error: sbErr.message });
      }

      return invite;
    } catch (error) {
      logger.error(`Erro ao buscar convite por email`, { service: SERVICE, function: 'findByEmail', error: error.message });
      throw error;
    }
  }

  /** Busca convites pendentes do remetente (Supabase apenas — janela de transição aceitável). */
  static async getPendingBySender(userId) {
    logger.info(`Buscando convites pendentes de ${userId}`, { service: SERVICE, function: 'getPendingBySender' });

    try {
      const { data, error } = await sb()
        .from(TABLE)
        .select('*')
        .eq('sender_id', userId)
        .eq('status', 'pending');

      if (error) throw error;
      return (data || []).map(rowToInvite);
    } catch (error) {
      logger.error('Erro ao buscar convites pendentes', { service: SERVICE, function: 'getPendingBySender', error: error.message });
      throw error;
    }
  }

  /** Busca todos os convites do remetente (Supabase apenas). */
  static async getBySenderId(userId) {
    logger.info(`Buscando convites de ${userId}`, { service: SERVICE, function: 'getBySenderId' });

    try {
      const { data, error } = await sb()
        .from(TABLE)
        .select('*')
        .eq('sender_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(rowToInvite);
    } catch (error) {
      logger.error('Erro ao buscar convites por remetente', { service: SERVICE, function: 'getBySenderId', error: error.message });
      throw error;
    }
  }

  /** Busca convites pendentes criados há mais de `expirationDays` dias. */
  static async getExpiredInvites(expirationDays = 5) {
    logger.info(`Buscando convites expirados (${expirationDays} dias)`, { service: SERVICE, function: 'getExpiredInvites' });

    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - expirationDays);

      const { data, error } = await sb()
        .from(TABLE)
        .select('*')
        .eq('status', 'pending')
        .lt('created_at', cutoff.toISOString());

      if (error) throw error;
      return (data || []).map(rowToInvite);
    } catch (error) {
      logger.error('Erro ao buscar convites expirados', { service: SERVICE, function: 'getExpiredInvites', error: error.message });
      throw error;
    }
  }

  // ── Escrita ────────────────────────────────────────

  /**
   * Insere um novo convite no Supabase.
   * @returns {Promise<Object>} O convite criado.
   */
  static async create(data) {
    logger.info('Criando convite', { service: SERVICE, function: 'create', inviteId: data.inviteId });

    try {
      const row = toRow({
        ...data,
        email: data.email ? data.email.toLowerCase() : null
      });

      const { data: inserted, error } = await sb()
        .from(TABLE)
        .insert(row)
        .select()
        .single();

      if (error) throw error;

      logger.info(`Convite ${data.inviteId} criado no Supabase`, { service: SERVICE, function: 'create' });
      return rowToInvite(inserted);
    } catch (error) {
      logger.error('Erro ao criar convite', { service: SERVICE, function: 'create', error: error.message });
      throw error;
    }
  }

  /**
   * Atualiza um convite pelo inviteId.
   * Tenta Supabase primeiro; se o convite for legado (Firestore), atualiza lá.
   */
  static async updateByInviteId(inviteId, data) {
    logger.info(`Atualizando convite ${inviteId}`, { service: SERVICE, function: 'updateByInviteId' });

    try {
      const row = toRow(data);
      const { data: updated, error } = await sb()
        .from(TABLE)
        .update(row)
        .eq('invite_id', inviteId)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!updated) logger.warn(`Convite ${inviteId} não encontrado para atualização`, { service: SERVICE });
      else logger.info(`Convite ${inviteId} atualizado`, { service: SERVICE });
    } catch (error) {
      logger.error(`Erro ao atualizar convite ${inviteId}`, { service: SERVICE, function: 'updateByInviteId', error: error.message });
      throw error;
    }
  }

  /** Cancela em lote convites expirados (Supabase apenas). */
  static async cancelExpiredInvites(expirationDays = 5) {
    logger.info(`Cancelando convites expirados (${expirationDays} dias)`, { service: SERVICE, function: 'cancelExpiredInvites' });

    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - expirationDays);

      const { data, error } = await sb()
        .from(TABLE)
        .update({
          status: 'canceled',
          canceled_at: new Date().toISOString(),
          canceled_by: 'system'
        })
        .eq('status', 'pending')
        .lt('created_at', cutoff.toISOString())
        .select();

      if (error) throw error;

      const count = (data || []).length;
      logger.info(`${count} convites expirados cancelados`, { service: SERVICE, function: 'cancelExpiredInvites' });
      return count;
    } catch (error) {
      logger.error('Erro ao cancelar convites expirados', { service: SERVICE, function: 'cancelExpiredInvites', error: error.message });
      throw error;
    }
  }

  /** Estatísticas de convites (Supabase apenas). */
  static async getStatistics() {
    logger.info('Obtendo estatísticas de convites', { service: SERVICE, function: 'getStatistics' });

    try {
      const { data, error } = await sb()
        .from(TABLE)
        .select('status');

      if (error) throw error;

      const counts = { pending: 0, validated: 0, used: 0, canceled: 0 };
      (data || []).forEach(r => {
        if (counts[r.status] !== undefined) counts[r.status]++;
      });
      const total = Object.values(counts).reduce((a, b) => a + b, 0);

      return {
        ...counts,
        total,
        conversionRate: total > 0 ? `${(counts.used / total * 100).toFixed(2)}%` : '0%'
      };
    } catch (error) {
      logger.error('Erro ao obter estatísticas', { service: SERVICE, function: 'getStatistics', error: error.message });
      throw error;
    }
  }

  // ── Compat ─────────────────────────────────────────
  // Mantidos por compatibilidade com código que ainda usa Invite.update(id, data)

  static async update(id, data) {
    // id aqui é o inviteId (UUID)
    return this.updateByInviteId(id, data);
  }

  static async delete(inviteId) {
    logger.info(`Excluindo convite ${inviteId}`, { service: SERVICE, function: 'delete' });
    try {
      const { error } = await sb()
        .from(TABLE)
        .delete()
        .eq('invite_id', inviteId);
      if (error) throw error;
    } catch (error) {
      logger.error(`Erro ao excluir convite ${inviteId}`, { service: SERVICE, function: 'delete', error: error.message });
      throw error;
    }
  }
}

module.exports = Invite;
