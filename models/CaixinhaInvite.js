// models/CaixinhaInvite.js — Supabase-only (migrado de Firestore em 2026-05-19)
// Simplificação: 3 coleções Firestore espelhadas → 1 tabela caixinha_invites
const { getSupabaseClient } = require('../config/supabase');
const { getFirestore } = require('../firebaseAdmin');
const { logger } = require('../logger');
const { randomUUID } = require('crypto');

const TABLE   = 'caixinha_invites';
const SERVICE = 'caixinhaInviteModel';

function mapInvite(row) {
  if (!row) return null;
  return {
    id:             row.id,
    caixinhaId:     row.caixinha_id,
    type:           row.type           || 'caixinha_invite',
    status:         row.status         || 'pending',
    senderId:       row.sender_id,
    senderName:     row.sender_name    || null,
    targetId:       row.target_id      || null,
    targetName:     row.target_name    || null,
    email:          row.email          || null,
    message:        row.message        || '',
    createdAt:      row.created_at     ? new Date(row.created_at)    : new Date(),
    expiresAt:      row.expires_at     ? new Date(row.expires_at)    : null,
    respondedAt:    row.responded_at   ? new Date(row.responded_at)  : null,
    responseReason: row.response_reason || null,
  };
}

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

function normalizeDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v.toDate === 'function') return v.toDate();
  return new Date(v);
}

class CaixinhaInvite {
  constructor(data) {
    this.id             = data.id;
    this.caixinhaId     = data.caixinhaId;
    this.type           = data.type           || 'caixinha_invite';
    this.status         = data.status         || 'pending';
    this.senderId       = data.senderId;
    this.senderName     = data.senderName;
    this.targetName     = data.targetName;
    this.targetId       = data.targetId       || null;
    this.email          = data.email          || null;
    this.message        = data.message        || '';
    this.createdAt      = normalizeDate(data.createdAt) || new Date();
    this.expiresAt      = normalizeDate(data.expiresAt) || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    this.respondedAt    = normalizeDate(data.respondedAt) || null;
    this.responseReason = data.responseReason || null;
  }

  // ── Leitura ──────────────────────────────────────────────────────────────

  static async getById(caixinhaId, caixinhaInviteId) {
    const { data, error } = await sb()
      .from(TABLE)
      .select('*')
      .eq('id', caixinhaInviteId)
      .eq('caixinha_id', caixinhaId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Convite não encontrado.');
    return new CaixinhaInvite(mapInvite(data));
  }

  static async getReceivedInvites(userId, options = {}) {
    const { status = 'pending', type = null } = options;

    try {
      let query = sb().from(TABLE).select('*').eq('target_id', userId);
      if (status !== 'all') query = query.eq('status', status);
      if (type && type !== 'all') query = query.eq('type', type);
      query = query.order('created_at', { ascending: false });

      const { data, error } = await query;
      if (error) throw error;

      const invites = (data || []).map(row => new CaixinhaInvite(mapInvite(row)));
      logger.info(`${invites.length} convites recebidos para o usuário ${userId}`, { service: SERVICE });
      return invites;
    } catch (error) {
      logger.error('Erro ao buscar convites recebidos', { service: SERVICE, userId, error: error.message });
      return [];
    }
  }

  static async getSentInvites(userId, options = {}) {
    const { status = 'pending', type = null } = options;

    try {
      let query = sb().from(TABLE).select('*').eq('sender_id', userId);
      if (status !== 'all') query = query.eq('status', status);
      if (type && type !== 'all') query = query.eq('type', type);
      query = query.order('created_at', { ascending: false });

      const { data, error } = await query;
      if (error) throw error;

      const invites = (data || []).map(row => new CaixinhaInvite(mapInvite(row)));
      logger.info(`${invites.length} convites enviados pelo usuário ${userId}`, { service: SERVICE });
      return invites;
    } catch (error) {
      logger.error('Erro ao buscar convites enviados', { service: SERVICE, userId, error: error.message });
      return [];
    }
  }

  static async getByCaixinhaId(caixinhaId, options = {}) {
    const { status = 'pending' } = options;

    try {
      let query = sb().from(TABLE).select('*').eq('caixinha_id', caixinhaId);
      if (status !== 'all') query = query.eq('status', status);
      query = query.order('created_at', { ascending: false });

      const { data, error } = await query;
      if (error) throw error;

      const invites = (data || []).map(row => new CaixinhaInvite(mapInvite(row)));
      logger.info(`${invites.length} convites para a caixinha ${caixinhaId}`, { service: SERVICE });
      return invites;
    } catch (error) {
      logger.error('Erro ao buscar convites da caixinha', { service: SERVICE, caixinhaId, error: error.message });
      return [];
    }
  }

  // ── Escrita ──────────────────────────────────────────────────────────────

  static async create(data) {
    if (!data.caixinhaId) throw new Error('ID da caixinha é obrigatório.');
    if (!data.senderId)   throw new Error('ID do remetente é obrigatório.');
    if (!data.targetId && !data.email) throw new Error('É necessário fornecer ID do destinatário ou email.');

    const inviteId = randomUUID();
    const expiresAt = data.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    logger.info('Criando convite para caixinha', { service: SERVICE, inviteId, caixinhaId: data.caixinhaId });

    const { data: created, error } = await sb()
      .from(TABLE)
      .insert({
        id:          inviteId,
        caixinha_id: data.caixinhaId,
        sender_id:   data.senderId,
        sender_name: data.senderName || null,
        target_id:   data.targetId   || null,
        target_name: data.targetName || null,
        email:       data.email      || null,
        type:        data.type       || 'caixinha_invite',
        status:      'pending',
        message:     data.message    || null,
        expires_at:  expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt,
      })
      .select()
      .single();

    if (error) throw error;

    // Backup Firestore fire-and-forget
    try {
      const db = getFirestore();
      const inviteData = { ...data, id: inviteId, status: 'pending', expiresAt };
      db.collection('caixinhas').doc(data.caixinhaId)
        .collection('pendingRequests').doc(inviteId).set(inviteData).catch(() => {});
    } catch (_) {}

    logger.info(`Convite ${inviteId} criado`, { service: SERVICE });
    return new CaixinhaInvite(mapInvite(created));
  }

  static async updateStatus(caixinhaId, caixinhaInviteId, data) {
    const row = {};
    if (data.status !== undefined)         row.status = data.status;
    if (data.respondedAt !== undefined)    row.responded_at = data.respondedAt ? new Date(data.respondedAt).toISOString() : null;
    if (data.responseReason !== undefined) row.response_reason = data.responseReason;
    if (data.expiresAt !== undefined)      row.expires_at = data.expiresAt ? new Date(data.expiresAt).toISOString() : null;
    if (data.message !== undefined)        row.message = data.message;

    // Terminais: marcar respondedAt automaticamente
    if (['accepted', 'rejected'].includes(data.status) && !row.responded_at) {
      row.responded_at = new Date().toISOString();
    }

    const { data: updated, error } = await sb()
      .from(TABLE)
      .update(row)
      .eq('id', caixinhaInviteId)
      .eq('caixinha_id', caixinhaId)
      .select()
      .single();

    if (error) throw error;

    // Backup Firestore fire-and-forget
    try {
      getFirestore()
        .collection('caixinhas').doc(caixinhaId)
        .collection('pendingRequests').doc(caixinhaInviteId)
        .update(data).catch(() => {});
    } catch (_) {}

    logger.info(`Convite ${caixinhaInviteId} atualizado → ${data.status}`, { service: SERVICE });
    return new CaixinhaInvite(mapInvite(updated));
  }

  static async delete(caixinhaId, caixinhaInviteId) {
    const { error } = await sb()
      .from(TABLE)
      .delete()
      .eq('id', caixinhaInviteId)
      .eq('caixinha_id', caixinhaId);

    if (error) throw error;

    // Backup Firestore fire-and-forget
    try {
      getFirestore()
        .collection('caixinhas').doc(caixinhaId)
        .collection('pendingRequests').doc(caixinhaInviteId)
        .delete().catch(() => {});
    } catch (_) {}

    logger.info(`Convite ${caixinhaInviteId} excluído`, { service: SERVICE });
  }

  static async resendInvite(caixinhaId, caixinhaInviteId, options = {}) {
    const updateData = {
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    };
    if (options.message) updateData.message = options.message;

    // Reativa se expirado
    const invite = await this.getById(caixinhaId, caixinhaInviteId);
    if (invite.status === 'expired') updateData.status = 'pending';

    const updated = await this.updateStatus(caixinhaId, caixinhaInviteId, updateData);
    logger.info(`Convite ${caixinhaInviteId} reenviado`, { service: SERVICE });
    return updated;
  }

  /** Marca como expirados todos os convites pending com expiresAt no passado */
  static async checkExpiredInvites() {
    try {
      const { data, error } = await sb()
        .from(TABLE)
        .update({ status: 'expired' })
        .eq('status', 'pending')
        .lt('expires_at', new Date().toISOString())
        .select('id');

      if (error) throw error;

      const count = (data || []).length;
      logger.info(`${count} convites marcados como expirados`, { service: SERVICE });
      return count;
    } catch (error) {
      logger.error('Erro ao verificar convites expirados', { service: SERVICE, error: error.message });
      throw error;
    }
  }
}

module.exports = CaixinhaInvite;
