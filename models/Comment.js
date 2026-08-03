// models/Comment.js — Supabase-only
const { getSupabaseClient } = require('../config/supabase');
const { randomUUID } = require('crypto');

const TABLE   = 'comments';
const SERVICE = 'commentModel';

function mapComment(row) {
  if (!row) return null;
  const user = row.users || {};
  return {
    id:              row.id,
    postId:          row.post_id,
    usuarioId:       row.usuario_id,
    texto:           row.texto,
    timestamp:       row.created_at ? new Date(row.created_at) : new Date(),
    usuarioNome:     user.full_name || null,
    usuarioFoto:     user.avatar_url || null,
    likesCount:      row.likes_count || 0,
    parentCommentId: row.parent_comment_id || null,
  };
}

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

class Comment {
  constructor(data) {
    this.id              = data.id;
    this.texto           = data.texto;
    this.usuarioNome     = data.usuarioNome;
    this.usuarioId       = data.usuarioId;
    this.usuarioFoto     = data.usuarioFoto;
    this.likesCount      = data.likesCount || 0;
    this.parentCommentId = data.parentCommentId || null;
    this.timestamp       = data.timestamp instanceof Date
      ? data.timestamp
      : data.timestamp?.seconds
        ? new Date(data.timestamp.seconds * 1000)
        : data.timestamp ? new Date(data.timestamp) : new Date();
  }

  static async getByPostId(postId) {
    const { data, error } = await sb()
      .from(TABLE)
      .select('*, users!comments_usuario_id_fkey(full_name, avatar_url)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data || []).map(row => new Comment(mapComment(row)));
  }

  static async create(postId, data) {
    const commentId = data.id || randomUUID();

    const row = {
      id:         commentId,
      post_id:    postId,
      usuario_id: data.usuarioId,
      texto:      data.texto,
    };
    if (data.parentCommentId) {
      row.parent_comment_id = data.parentCommentId;
    }

    const { data: created, error } = await sb()
      .from(TABLE)
      .insert(row)
      .select()
      .single();

    if (error) throw error;
    return new Comment(mapComment(created));
  }

  static async delete(postId, commentId) {
    const { error } = await sb().from(TABLE).delete().eq('id', commentId);
    if (error) throw error;
  }

  /**
   * Toggle like on a comment (insert or delete from comment_reactions).
   * likes_count is updated automatically via DB trigger.
   * @returns {{ liked: boolean, likesCount: number }}
   */
  static async toggleLike(commentId, userId) {
    const supabase = sb();

    // Check if already liked
    const { data: existing } = await supabase
      .from('comment_reactions')
      .select('comment_id')
      .eq('comment_id', commentId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      // Unlike
      await supabase
        .from('comment_reactions')
        .delete()
        .eq('comment_id', commentId)
        .eq('user_id', userId);
    } else {
      // Like
      await supabase
        .from('comment_reactions')
        .insert({ comment_id: commentId, user_id: userId });
    }

    // Fetch updated count
    const { data: comment } = await supabase
      .from(TABLE)
      .select('likes_count')
      .eq('id', commentId)
      .single();

    return {
      liked: !existing,
      likesCount: comment?.likes_count || 0,
    };
  }

  /**
   * Get comment IDs liked by a specific user for a given post.
   * Used to hydrate "userHasLiked" state on the frontend.
   */
  static async getUserLikedCommentIds(postId, userId) {
    const { data, error } = await sb()
      .from('comment_reactions')
      .select('comment_id, comments!inner(post_id)')
      .eq('user_id', userId)
      .eq('comments.post_id', postId);

    if (error) return [];
    return (data || []).map(r => r.comment_id);
  }
}

module.exports = Comment;
