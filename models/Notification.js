// models/Notification.js — Supabase-only (migrado de Firestore em 2026-05-19)
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const TABLE = 'notifications';
const SERVICE = 'notificationModel';

class Notification {
  constructor(userId, type, content, url, createdAt = new Date(), read = false) {
    this.userId = userId;
    this.type = type;
    this.content = content;
    this.url = url;
    this.createdAt = createdAt;
    this.read = read;
  }

  static async create(userId, type, content, url) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client indisponível');

    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        user_id:     userId,
        type,
        content,
        entity_id:   url || null,
        read:        false,
        created_at:  new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      logger.error('Erro ao criar notificação', { service: SERVICE, error: error.message });
      throw error;
    }

    logger.info('Notificação criada', { service: SERVICE, userId, type });
    return new Notification(userId, type, content, url, new Date(data.created_at), false);
  }

  static async getByUserId(userId, { limit = 50, offset = 0 } = {}) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client indisponível');

    const { data, error, count } = await supabase
      .from(TABLE)
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('Erro ao buscar notificações', { service: SERVICE, error: error.message });
      throw error;
    }

    const notifications = (data || []).map(row => ({
      id:        row.id,
      userId:    row.user_id,
      type:      row.type,
      content:   row.content,
      url:       row.entity_id,
      read:      row.read,
      readAt:    row.read_at,
      createdAt: row.created_at,
    }));

    return { notifications, total: count || 0 };
  }

  static async getUnreadCount(userId) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client indisponível');

    const { count, error } = await supabase
      .from(TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('read', false);

    if (error) {
      logger.error('Erro ao contar notificações não lidas', { service: SERVICE, error: error.message });
      throw error;
    }

    return count || 0;
  }

  static async markAsRead(userId, notificationId) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client indisponível');

    const { error } = await supabase
      .from(TABLE)
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('id', notificationId);

    if (error) {
      logger.error('Erro ao marcar notificação como lida', { service: SERVICE, error: error.message });
      throw error;
    }

    return { success: true, message: 'Notification marked as read' };
  }

  static async markAllAsRead(userId) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client indisponível');

    const { error } = await supabase
      .from(TABLE)
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('read', false);

    if (error) {
      logger.error('Erro ao marcar todas notificações como lidas', { service: SERVICE, error: error.message });
      throw error;
    }

    return { success: true };
  }
}

module.exports = Notification;
