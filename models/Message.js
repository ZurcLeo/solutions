// models/Message.js — Supabase-only (migrado do Firestore em 2026-05-18)
const { v4: uuidv4 } = require('uuid');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const AI_AGENT_USER_ID = process.env.AI_AGENT_USER_ID || 'AI_AGENT_USER_ID';

/**
 * Mapeia uma linha do Supabase (snake_case) para o formato camelCase do sistema.
 */
function mapMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sender: row.sender_id,
    content: row.content,
    type: row.type,
    timestamp: row.timestamp,
    read: row.read,
    readAt: row.read_at,
    delivered: row.delivered,
    deleted: row.deleted,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    replyTo: row.reply_to || null,
    attachments: row.attachments || [],
    status: {
      sent: true,
      delivered: row.delivered,
      read: row.read,
      readAt: row.read_at
    }
  };
}

class Message {
  /**
   * Retorna todas as conversas de um usuário, ordenadas pela mais recente.
   */
  static async getUserConversations(userId) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client unavailable');

    const { data, error } = await supabase
      .from('conversation_participants')
      .select(`
        unread_count,
        last_access,
        conversation:conversations(
          id, type, last_message_text, last_message_timestamp,
          last_message_sender_id, created_at, updated_at
        )
      `)
      .eq('user_id', userId);

    if (error) {
      logger.error('getUserConversations: erro Supabase', { userId, error: error.message });
      throw error;
    }

    const rows = (data || []).filter(row => row.conversation);
    if (rows.length === 0) return [];

    // Buscar o outro participante de cada conversa
    const convIds = rows.map(row => row.conversation.id);

    const { data: participants, error: partError } = await supabase
      .from('conversation_participants')
      .select('conversation_id, user_id')
      .in('conversation_id', convIds)
      .neq('user_id', userId);

    if (partError) {
      logger.warn('getUserConversations: erro ao buscar participantes', { error: partError.message });
    }

    const otherUserByConv = {};
    (participants || []).forEach(p => {
      otherUserByConv[p.conversation_id] = p.user_id;
    });

    // Buscar perfis dos outros participantes
    const otherUserIds = [...new Set(Object.values(otherUserByConv))];
    let userProfiles = {};

    if (otherUserIds.length > 0) {
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, full_name, avatar_url, username')
        .in('id', otherUserIds);

      if (usersError) {
        logger.warn('getUserConversations: erro ao buscar perfis', { error: usersError.message });
      }

      (users || []).forEach(u => {
        userProfiles[u.id] = u;
      });
    }

    return rows
      .map(row => {
        const otherUserId = otherUserByConv[row.conversation.id] || null;
        const otherUser = otherUserId ? userProfiles[otherUserId] : null;

        return {
          id: row.conversation.id,
          type: row.conversation.type,
          with: otherUserId,
          withName: otherUser?.full_name || null,
          withPhoto: otherUser?.avatar_url || null,
          withUsername: otherUser?.username || null,
          lastMessageText: row.conversation.last_message_text,
          lastMessageTimestamp: row.conversation.last_message_timestamp,
          lastMessageSenderId: row.conversation.last_message_sender_id,
          createdAt: row.conversation.created_at,
          updatedAt: row.conversation.updated_at,
          unreadCount: row.unread_count,
          lastAccess: row.last_access,
          lastMessage: {
            text: row.conversation.last_message_text,
            timestamp: row.conversation.last_message_timestamp,
            sender: row.conversation.last_message_sender_id
          }
        };
      })
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  /**
   * Garante que existe uma conversa entre dois usuários e retorna o conversationId.
   * ID determinístico: [uid1, uid2].sort().join('_')
   */
  static async getOrCreateConversationId(userId1, userId2) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client unavailable');

    const conversationId = [userId1, userId2].sort().join('_');

    // INSERT OR IGNORE na conversa
    const { error: convError } = await supabase
      .from('conversations')
      .upsert(
        { id: conversationId, type: 'private' },
        { onConflict: 'id', ignoreDuplicates: true }
      );

    if (convError) {
      logger.warn('getOrCreateConversationId: upsert conversations', { error: convError.message, conversationId });
    }

    // INSERT OR IGNORE nos participantes
    const { error: partError } = await supabase
      .from('conversation_participants')
      .upsert(
        [
          { conversation_id: conversationId, user_id: userId1, unread_count: 0 },
          { conversation_id: conversationId, user_id: userId2, unread_count: 0 }
        ],
        { onConflict: 'conversation_id,user_id', ignoreDuplicates: true }
      );

    if (partError) {
      logger.warn('getOrCreateConversationId: upsert participants', { error: partError.message, conversationId });
    }

    return conversationId;
  }

  /**
   * Retorna as mensagens de uma conversa, paginadas pelo timestamp.
   */
  static async getConversationMessages(conversationId, limit = 50, before = null) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client unavailable');

    let query = supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('deleted', false)
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (before) {
      const ts = before instanceof Date ? before.toISOString() : before;
      query = query.lt('timestamp', ts);
    }

    const { data, error } = await query;
    if (error) {
      logger.error('getConversationMessages: erro Supabase', { conversationId, error: error.message });
      throw error;
    }

    return (data || []).map(mapMessage);
  }

  /**
   * Cria uma nova mensagem. Se o destinatário for o AI Agent, dispara o fluxo de IA.
   */
  static async createMessage(messageData) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client unavailable');

    const { sender, recipient, content, type = 'text', replyTo = null, attachments = [] } = messageData;

    if (!sender || !recipient || !content) {
      throw new Error('Dados incompletos para criar mensagem');
    }

    const conversationId = await this.getOrCreateConversationId(sender, recipient);
    const id = uuidv4();
    const timestamp = new Date().toISOString();

    // Montar row de inserção
    const insertRow = { id, conversation_id: conversationId, sender_id: sender, content, type, timestamp };
    if (replyTo) insertRow.reply_to = replyTo;
    if (attachments.length > 0) insertRow.attachments = JSON.stringify(attachments);

    // Inserir mensagem
    const { error: msgError } = await supabase
      .from('messages')
      .insert(insertRow);

    if (msgError) {
      logger.error('createMessage: erro ao inserir mensagem', { error: msgError.message });
      throw msgError;
    }

    // Atualizar metadados da conversa
    await supabase
      .from('conversations')
      .update({
        last_message_text: content.substring(0, 200),
        last_message_timestamp: timestamp,
        last_message_sender_id: sender,
        updated_at: timestamp
      })
      .eq('id', conversationId);

    // Incrementar unread_count do destinatário (somente se não for o AI agent)
    if (recipient !== AI_AGENT_USER_ID) {
      await this._incrementUnread(conversationId, recipient);
    }

    const newMessage = {
      id,
      conversationId,
      sender,
      content,
      type,
      timestamp,
      replyTo: replyTo || null,
      attachments: attachments || [],
      status: { sent: true, delivered: false, read: false, readAt: null }
    };

    // Fluxo do AI Agent
    if (recipient === AI_AGENT_USER_ID) {
      this._handleAIResponse(conversationId, sender, content).catch(err =>
        logger.error('createMessage: erro no fluxo AI', { error: err.message, conversationId })
      );
    }

    return newMessage;
  }

  /**
   * Marca todas as mensagens não lidas de uma conversa como lidas para o userId.
   */
  static async markMessagesAsRead(conversationId, userId) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client unavailable');

    const now = new Date().toISOString();

    // Contar mensagens não lidas para retornar o total
    const { data: unread } = await supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .neq('sender_id', userId)
      .eq('read', false);

    const count = (unread || []).length;

    if (count > 0) {
      await supabase
        .from('messages')
        .update({ read: true, read_at: now })
        .eq('conversation_id', conversationId)
        .neq('sender_id', userId)
        .eq('read', false);
    }

    await supabase
      .from('conversation_participants')
      .update({ unread_count: 0, last_access: now })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);

    return { count, updatedAt: now };
  }

  /**
   * Verifica se um usuário é participante de uma conversa.
   */
  static async isUserParticipantOfConversation(conversationId, userId) {
    const supabase = getSupabaseClient();
    if (!supabase) return false;

    const { data, error } = await supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .limit(1);

    if (error) {
      logger.warn('isUserParticipantOfConversation: erro', { error: error.message });
      return false;
    }

    return (data || []).length > 0;
  }

  /**
   * Atualiza o status de entrega/leitura de uma mensagem.
   * statusUpdate: { read: true } ou { delivered: true }
   */
  static async updateMessageStatus(conversationId, messageId, statusUpdate) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client unavailable');

    const updateFields = {};
    if (statusUpdate.read) {
      updateFields.read = true;
      updateFields.read_at = new Date().toISOString();
    }
    if (statusUpdate.delivered) {
      updateFields.delivered = true;
    }

    const { data, error } = await supabase
      .from('messages')
      .update(updateFields)
      .eq('id', messageId)
      .eq('conversation_id', conversationId)
      .select()
      .single();

    if (error) {
      logger.error('updateMessageStatus: erro', { error: error.message, messageId });
      throw error;
    }

    return mapMessage(data);
  }

  /**
   * Soft-delete de uma mensagem (apenas o remetente pode apagar).
   */
  static async deleteMessage(conversationId, messageId, userId) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client unavailable');

    const { data: msg, error: fetchError } = await supabase
      .from('messages')
      .select('sender_id')
      .eq('id', messageId)
      .eq('conversation_id', conversationId)
      .single();

    if (fetchError || !msg) throw new Error('Mensagem não encontrada');
    if (msg.sender_id !== userId) throw new Error('Você não tem permissão para excluir esta mensagem');

    const { error } = await supabase
      .from('messages')
      .update({
        deleted: true,
        deleted_at: new Date().toISOString(),
        content: 'Esta mensagem foi apagada'
      })
      .eq('id', messageId);

    if (error) throw error;

    return { id: messageId, deleted: true };
  }

  /**
   * Retorna estatísticas de mensagens de um usuário.
   */
  static async getUserMessageStats(userId) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client unavailable');

    const { data, error } = await supabase
      .from('conversation_participants')
      .select('conversation_id, unread_count')
      .eq('user_id', userId);

    if (error) {
      logger.error('getUserMessageStats: erro', { error: error.message, userId });
      throw error;
    }

    const rows = data || [];
    return {
      totalConversations: rows.length,
      totalUnread: rows.reduce((sum, r) => sum + (r.unread_count || 0), 0),
      lastActive: null
    };
  }

  // ─── Reactions ──────────────────────────────────────────────────────────────

  /**
   * Toggle reaction (adiciona ou remove) via RPC atômica.
   * @returns {{ action: 'added'|'removed', reactionId: string }}
   */
  static async toggleReaction(messageId, userId, emoji) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client unavailable');

    const { data, error } = await supabase
      .rpc('toggle_message_reaction', {
        p_message_id: messageId,
        p_user_id: userId,
        p_emoji: emoji
      })
      .single();

    if (error) {
      logger.error('toggleReaction: erro RPC', { messageId, userId, emoji, error: error.message });
      throw error;
    }

    return { action: data.action, reactionId: data.reaction_id };
  }

  /**
   * Retorna o resumo de reações para uma lista de mensagens.
   * @returns {Object} Map { messageId: [{ emoji, count, userIds }] }
   */
  static async getReactionsSummary(messageIds) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client unavailable');

    if (!messageIds || messageIds.length === 0) return {};

    const { data, error } = await supabase
      .rpc('get_message_reactions_summary', { p_message_ids: messageIds });

    if (error) {
      logger.warn('getReactionsSummary: erro RPC', { error: error.message });
      return {};
    }

    const result = {};
    (data || []).forEach(row => {
      if (!result[row.message_id]) result[row.message_id] = [];
      result[row.message_id].push({
        emoji: row.emoji,
        count: row.count,
        userIds: row.user_ids
      });
    });
    return result;
  }

  /**
   * Busca o conversationId de uma mensagem (para broadcast de reações).
   */
  static async getMessageConversationId(messageId) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client unavailable');

    const { data, error } = await supabase
      .from('messages')
      .select('conversation_id')
      .eq('id', messageId)
      .single();

    if (error || !data) {
      logger.error('getMessageConversationId: mensagem não encontrada', { messageId });
      throw new Error('Mensagem não encontrada');
    }

    return data.conversation_id;
  }

  // ─── Attachments ───────────────────────────────────────────────────────────

  /**
   * Upload de arquivos para Supabase Storage e retorna metadados.
   * @param {string} senderId - ID do remetente
   * @param {string} conversationId - ID da conversa
   * @param {Array<{buffer: Buffer, originalname: string, mimetype: string, size: number}>} files - Arquivos do multer
   * @returns {Array<{url: string, name: string, type: string, size: number}>}
   */
  static async uploadAttachments(senderId, conversationId, files) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client unavailable');

    const results = [];

    for (const file of files) {
      const ext = file.originalname.split('.').pop();
      const fileName = `${uuidv4()}.${ext}`;
      const storagePath = `${senderId}/${conversationId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('message-attachments')
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });

      if (uploadError) {
        logger.error('uploadAttachments: erro no upload', { storagePath, error: uploadError.message });
        throw uploadError;
      }

      // Gerar signed URL (válida por 7 dias)
      const { data: signedData, error: signError } = await supabase.storage
        .from('message-attachments')
        .createSignedUrl(storagePath, 60 * 60 * 24 * 7);

      if (signError) {
        logger.warn('uploadAttachments: erro ao gerar signed URL', { storagePath, error: signError.message });
      }

      results.push({
        url: signedData?.signedUrl || storagePath,
        path: storagePath,
        name: file.originalname,
        type: file.mimetype,
        size: file.size
      });
    }

    return results;
  }

  // ─── Métodos privados ────────────────────────────────────────────────────────

  static async _incrementUnread(conversationId, userId) {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const { data: cp } = await supabase
      .from('conversation_participants')
      .select('unread_count')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .single();

    await supabase
      .from('conversation_participants')
      .update({ unread_count: (cp?.unread_count || 0) + 1 })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);
  }

  static async _handleAIResponse(conversationId, sender, userContent) {
    const supabase = getSupabaseClient();
    const AIService = require('../services/AIService');

    logger.info('_handleAIResponse: iniciando', { conversationId, sender });

    const recentMessages = await this.getConversationMessages(conversationId, 5);

    let userContext = null;
    try {
      const { data: userData } = await supabase
        .from('users')
        .select('full_name, username')
        .eq('id', sender)
        .single();

      if (userData) {
        userContext = {
          firstName: userData.full_name || userData.username,
          roles: [],
          caixinhas: []
        };
      }
    } catch (err) {
      logger.warn('_handleAIResponse: erro ao buscar contexto do usuário', { userId: sender, error: err.message });
    }

    const aiContent = await AIService.processMessage(sender, conversationId, userContent, recentMessages, userContext);
    const aiTimestamp = new Date().toISOString();
    const aiId = uuidv4();

    await supabase.from('messages').insert({
      id: aiId,
      conversation_id: conversationId,
      sender_id: AI_AGENT_USER_ID,
      content: aiContent,
      type: 'text',
      timestamp: aiTimestamp,
      delivered: true
    });

    await supabase
      .from('conversations')
      .update({
        last_message_text: aiContent.substring(0, 200),
        last_message_timestamp: aiTimestamp,
        last_message_sender_id: AI_AGENT_USER_ID,
        updated_at: aiTimestamp
      })
      .eq('id', conversationId);

    // Incrementar unread do usuário que vai receber a resposta da IA
    await this._incrementUnread(conversationId, sender);

    logger.info('_handleAIResponse: resposta salva', { aiId, conversationId });
  }

  // ─── Aliases de compatibilidade ──────────────────────────────────────────────

  /**
   * Busca mensagens enviadas por um usuário (usado pelo healthService).
   */
  static async getByUserId(userId, limit = 50) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client unavailable');

    const safeLimit = Number.isInteger(limit) ? limit : 50;

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('sender_id', userId)
      .eq('deleted', false)
      .order('timestamp', { ascending: false })
      .limit(safeLimit);

    if (error) {
      logger.error('getByUserId: erro Supabase', { userId, error: error.message });
      throw error;
    }

    return (data || []).map(mapMessage);
  }

  static async create(data) {
    return this.createMessage(data);
  }

  static async delete(id1, id2, messageId) {
    const conversationId = [id1, id2].sort().join('_');
    return this.deleteMessage(conversationId, messageId, id1);
  }

  static async getMessagesByConversationId(conversationId, limit, before) {
    return this.getConversationMessages(conversationId, limit, before);
  }
}

module.exports = Message;
