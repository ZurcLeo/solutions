// models/KnowledgeArticle.js — Base de Conhecimento (SUPP-ARTICLE-001)
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const TABLE = 'knowledge_articles';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

function mapArticle(row) {
  if (!row) return null;
  return {
    id:         row.id,
    title:      row.title,
    body:       row.body,
    category:   row.category,
    tags:       row.tags || [],
    authorId:   row.author_id,
    published:  row.published,
    viewCount:  row.view_count,
    createdAt:  row.created_at,
    updatedAt:  row.updated_at,
  };
}

class KnowledgeArticle {
  // ── Escrita ─────────────────────────────────────────────────────────────────

  static async create(data) {
    const { data: row, error } = await sb()
      .from(TABLE)
      .insert({
        title:     data.title,
        body:      data.body,
        category:  data.category || 'general',
        tags:      data.tags || [],
        author_id: data.authorId,
        published: data.published ?? false,
      })
      .select()
      .single();
    if (error) throw error;
    logger.info('KnowledgeArticle criado', { id: row.id, category: row.category });
    return mapArticle(row);
  }

  static async update(articleId, data) {
    const updates = {};
    if (data.title     !== undefined) updates.title     = data.title;
    if (data.body      !== undefined) updates.body      = data.body;
    if (data.category  !== undefined) updates.category  = data.category;
    if (data.tags      !== undefined) updates.tags      = data.tags;
    if (data.published !== undefined) updates.published = data.published;

    const { data: row, error } = await sb()
      .from(TABLE)
      .update(updates)
      .eq('id', articleId)
      .select()
      .single();
    if (error) throw error;
    return mapArticle(row);
  }

  static async delete(articleId) {
    const { error } = await sb().from(TABLE).delete().eq('id', articleId);
    if (error) throw error;
  }

  static async incrementViewCount(articleId) {
    const { error } = await sb().rpc('increment_article_views', { article_id: articleId });
    // Fallback silencioso se RPC não existir ainda
    if (error) {
      await sb().from(TABLE).update({ view_count: sb().rpc }).eq('id', articleId).catch(() => {});
    }
  }

  // ── Leitura ─────────────────────────────────────────────────────────────────

  static async getById(articleId) {
    const { data, error } = await sb()
      .from(TABLE)
      .select('*')
      .eq('id', articleId)
      .maybeSingle();
    if (error) throw error;
    return mapArticle(data);
  }

  static async findByCategory(category, publishedOnly = true, limit = 5) {
    let query = sb().from(TABLE).select('*').eq('category', category);
    if (publishedOnly) query = query.eq('published', true);
    const { data, error } = await query
      .order('view_count', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).map(mapArticle);
  }

  static async getAll(publishedOnly = false, limit = 50) {
    let query = sb().from(TABLE).select('*');
    if (publishedOnly) query = query.eq('published', true);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data || []).map(mapArticle);
  }
}

module.exports = KnowledgeArticle;
