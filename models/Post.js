// models/Post.js — Supabase-only
const { getSupabaseClient } = require('../config/supabase');
const { randomUUID } = require('crypto');
const { calculateTrendingScore } = require('../utils/trendingScore');
const { getOptedOutUserIds } = require('../services/userPreferencesService');

const TABLE   = 'posts';
const SERVICE = 'postModel';

// Multiplicadores de relevância geográfica aprovados (ClaudIA 2026-06-09)
const GEO_MULTIPLIER = { 0: 3.0, 1: 1.8, 2: 1.2, 3: 0.6 };

/**
 * Calcula o nível de proximidade geográfica hierárquica em JS
 * (espelha a RPC get_location_level do banco sem round-trip adicional).
 * @returns {0|1|2|3|null} null = sem localização disponível
 */
function calcGeoLevel(uBairro, uCidade, uEstado, tBairro, tCidade, tEstado) {
  if (!uBairro || !tBairro) return null;
  const n = s => (s || '').toLowerCase().trim();
  if (n(uBairro) === n(tBairro) && n(uCidade) === n(tCidade)) return 0;
  if (n(uCidade) === n(tCidade) && n(uEstado) === n(tEstado)) return 1;
  if (n(uEstado) === n(tEstado)) return 2;
  return 3;
}

function mapPost(row) {
  if (!row) return null;

  // Normaliza dados do usuário (se vierem do join)
  // row.users pode conter full_name, avatar_url e user_gamification (1:1)
  const userData = row.users ? {
    nome:     row.users.full_name,
    username: row.users.username || null,
    photoURL: row.users.avatar_url,
    level:    row.users.user_gamification?.current_level || 1,
  } : {};

  return {
    id:             row.id,
    usuarioId:      row.usuario_id,
    conteudo:       row.conteudo       || null,
    mediaUrl:       row.media_url      || null,
    tipoMedia:      row.tipo_media     || 'none',
    visibilidade:   row.visibilidade   || 'public',
    trendingScore:  row.trending_score || 0,
    reportsCount:   row.reports_count  || 0,
    reactionsCount: row.reactions_count || 0,
    commentsCount:  row.comments_count  || 0,
    giftsCount:     row.gifts_count     || 0,
    createdAt:      row.created_at,
    postBairro:     row.post_bairro    || null,
    postCidade:     row.post_cidade    || null,
    postEstado:     row.post_estado    || null,
    geoLevel:       null,  // preenchido por getFeed quando viewerLocation disponível
    timestamp:      row.created_at     ? new Date(row.created_at) : new Date(),
    comentarios:    [],
    reacoes:        [],
    gifts:          [],
    userData,
  };
}

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

class Post {
  constructor(data) {
    this.id             = data.id;
    this.conteudo       = data.conteudo;
    this.mediaUrl       = data.mediaUrl;
    this.visibilidade   = data.visibilidade;
    this.usuarioId      = data.usuarioId;
    this.tipoMedia      = data.tipoMedia;
    this.reactionsCount = data.reactionsCount || 0;
    this.commentsCount  = data.commentsCount  || 0;
    this.giftsCount     = data.giftsCount     || 0;
    this.createdAt      = data.createdAt;
    this.userData       = data.userData       || {};
    this.timestamp      = data.timestamp instanceof Date
      ? data.timestamp
      : data.timestamp?.seconds
        ? new Date(data.timestamp.seconds * 1000)
        : data.timestamp ? new Date(data.timestamp) : new Date();
    this.comentarios    = data.comentarios || [];
    this.reacoes        = data.reacoes     || [];
    this.gifts          = data.gifts       || [];
  }

  /**
   * Busca os 3 gifts mais recentes de cada post (com imagem do sticker)
   * em uma única query batch para todos os postIds fornecidos.
   * Fire-and-forget: retorna Map vazio se falhar.
   *
   * @param {string[]} postIds
   * @returns {Promise<Map<string, object[]>>} mapa postId → array de até 3 gifts
   */
  static async _loadRecentGifts(postIds) {
    if (!postIds.length) return new Map();

    try {
      const { data, error } = await sb()
        .from('gifts')
        .select('id, post_id, from_user_id, tipo, valor, message, created_at, sticker_catalog(image_url, name)')
        .in('post_id', postIds)
        .order('created_at', { ascending: false });

      if (error) return new Map();

      // Agrupa por post_id, max 3 por post
      const byPost = new Map();
      for (const g of data || []) {
        if (!byPost.has(g.post_id)) byPost.set(g.post_id, []);
        const arr = byPost.get(g.post_id);
        if (arr.length < 3) {
          arr.push({
            id:              g.id,
            tipo:            g.tipo,
            valor:           Number(g.valor),
            message:         g.message         || null,
            stickerImageUrl: g.sticker_catalog?.image_url || null,
            stickerName:     g.sticker_catalog?.name      || null,
            createdAt:       g.created_at,
          });
        }
      }
      return byPost;
    } catch (_) {
      return new Map();
    }
  }

  static async getFeed({ limit = 20, page = 1, mode = 'recent', userId = null, viewerLocation = null } = {}) {
    const from = (page - 1) * limit;
    const to   = from + limit - 1;

    // PREFS-003: buscar IDs de usuários com public_profile desativado
    const hiddenUserIds = await getOptedOutUserIds('public_profile');

    // Query base com join para usuários e gamificação
    let query = sb()
      .from(TABLE)
      .select('*, users(full_name, username, avatar_url, visibility_multiplier, user_gamification(current_level))');

    // PREFS-003: excluir posts de usuários com public_profile=false (exceto o próprio viewer)
    if (hiddenUserIds.length > 0) {
      const excludeIds = userId ? hiddenUserIds.filter(id => id !== userId) : hiddenUserIds;
      if (excludeIds.length > 0) {
        query = query.not('usuario_id', 'in', `(${excludeIds.join(',')})`);
      }
    }

    let posts;

    if (mode === 'trending') {
      // Busca posts com maior trending_score e aplica visibility_multiplier do autor
      const { data: rows, error } = await query
        .order('trending_score', { ascending: false })
        .range(from, to);

      if (error) throw error;

      const sorted = (rows || [])
        .map(row => {
          // Supabase join returns array for user_gamification even if 1:1, unless configured otherwise
          if (row.users && Array.isArray(row.users.user_gamification)) {
            row.users.user_gamification = row.users.user_gamification[0];
          }
          const post = new Post(mapPost(row));
          post.effectiveScore = (row.trending_score || 0) * (row.users?.visibility_multiplier ?? 1.0);
          // Geo multiplier: amplifica conteúdo próximo ao visualizador
          if (viewerLocation?.bairro) {
            const level = calcGeoLevel(
              viewerLocation.bairro, viewerLocation.cidade, viewerLocation.estado,
              post.postBairro, post.postCidade, post.postEstado
            );
            post.geoLevel = level;
            post.effectiveScore *= (GEO_MULTIPLIER[level] ?? 1.0);
          }
          return post;
        })
        .sort((a, b) => b.effectiveScore - a.effectiveScore);

      posts = sorted;

      // Marca userHasLiked para o usuário autenticado
      if (userId && posts.length > 0) {
        const postIds = posts.map(p => p.id);
        const { data: myReactions } = await sb()
          .from('reactions')
          .select('post_id')
          .eq('usuario_id', userId)
          .in('post_id', postIds);
        const likedSet = new Set((myReactions || []).map(r => r.post_id));
        posts.forEach(p => { p.userHasLiked = likedSet.has(p.id); });
      }

      // Carrega gifts recentes (max 3 por post) com imagem do sticker
      if (posts.length > 0) {
        const giftsByPost = await Post._loadRecentGifts(posts.map(p => p.id));
        posts.forEach(p => { p.gifts = giftsByPost.get(p.id) || []; });
      }

      return { posts, total: posts.length, page, limit, mode };
    }

    // mode === 'recent' (default)
    let recentQuery = sb()
      .from(TABLE)
      .select('*, users(full_name, username, avatar_url, user_gamification(current_level))', { count: 'exact' });

    // PREFS-003: excluir posts de usuários com public_profile=false (exceto o próprio viewer)
    if (hiddenUserIds.length > 0) {
      const excludeIds = userId ? hiddenUserIds.filter(id => id !== userId) : hiddenUserIds;
      if (excludeIds.length > 0) {
        recentQuery = recentQuery.not('usuario_id', 'in', `(${excludeIds.join(',')})`);
      }
    }

    const { data, error, count } = await recentQuery
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    const mapped = (data || []).map(row => {
      if (row.users && Array.isArray(row.users.user_gamification)) {
        row.users.user_gamification = row.users.user_gamification[0];
      }
      const post = new Post(mapPost(row));
      // Geo level (sem re-ordenação — mantém ordem cronológica do recent)
      if (viewerLocation?.bairro) {
        post.geoLevel = calcGeoLevel(
          viewerLocation.bairro, viewerLocation.cidade, viewerLocation.estado,
          post.postBairro, post.postCidade, post.postEstado
        );
      }
      return post;
    });

    // Marca userHasLiked para o usuário autenticado
    if (userId && mapped.length > 0) {
      const postIds = mapped.map(p => p.id);
      const { data: myReactions } = await sb()
        .from('reactions')
        .select('post_id')
        .eq('usuario_id', userId)
        .in('post_id', postIds);
      const likedSet = new Set((myReactions || []).map(r => r.post_id));
      mapped.forEach(p => { p.userHasLiked = likedSet.has(p.id); });
    }

    // Carrega gifts recentes (max 3 por post) com imagem do sticker
    if (mapped.length > 0) {
      const giftsByPost = await Post._loadRecentGifts(mapped.map(p => p.id));
      mapped.forEach(p => { p.gifts = giftsByPost.get(p.id) || []; });
    }

    return {
      posts: mapped,
      total: count,
      page,
      limit,
      mode,
    };
  }

  /**
   * Incrementa o contador de reações e recalcula o trending_score.
   * Fire-and-forget: não lança exceção se falhar.
   */
  static async incrementReactionsAndUpdateScore(postId) {
    try {
      const supabase = sb();

      const { data: post, error } = await supabase
        .from(TABLE)
        .select('reactions_count, comments_count, created_at')
        .eq('id', postId)
        .single();

      if (error || !post) return;

      const newReactionsCount = (post.reactions_count || 0) + 1;
      const newScore = calculateTrendingScore(newReactionsCount, post.comments_count || 0, post.created_at);

      await supabase
        .from(TABLE)
        .update({ reactions_count: newReactionsCount, trending_score: newScore })
        .eq('id', postId);
    } catch (_) {
      // fire-and-forget: falha silenciosa
    }
  }

  /**
   * Incrementa o contador de comentários e recalcula o trending_score.
   * Fire-and-forget: não lança exceção se falhar.
   */
  static async incrementCommentsAndUpdateScore(postId) {
    try {
      const supabase = sb();

      const { data: post, error } = await supabase
        .from(TABLE)
        .select('reactions_count, comments_count, created_at')
        .eq('id', postId)
        .single();

      if (error || !post) return;

      const newCommentsCount = (post.comments_count || 0) + 1;
      const newScore = calculateTrendingScore(post.reactions_count || 0, newCommentsCount, post.created_at);

      await supabase
        .from(TABLE)
        .update({ comments_count: newCommentsCount, trending_score: newScore })
        .eq('id', postId);
    } catch (_) {
      // fire-and-forget: falha silenciosa
    }
  }

  static async getById(id) {
    const { data, error } = await sb()
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Post não encontrado.');
    return new Post(mapPost(data));
  }

  static async create(data) {
    const postId = data.id || randomUUID();

    // Payload base — sempre presente
    const insertPayload = {
      id:           postId,
      usuario_id:   data.usuarioId,
      conteudo:     data.conteudo    || null,
      media_url:    data.mediaUrl    || null,
      tipo_media:   data.tipoMedia   || 'none',
      visibilidade: data.visibilidade || 'public',
    };

    // Snapshot de localização — incluído apenas quando disponível.
    // Colunas podem não existir se a migration ainda não foi aplicada;
    // omitir quando null/undefined evita 400 do PostgREST.
    if (data.postBairro) insertPayload.post_bairro = data.postBairro;
    if (data.postCidade) insertPayload.post_cidade = data.postCidade;
    if (data.postEstado) insertPayload.post_estado = data.postEstado;

    const { data: created, error } = await sb()
      .from(TABLE)
      .insert(insertPayload)
      .select()
      .single();

    if (error) throw error;

    // Extrai e persiste hashtags — fire-and-forget
    Post._saveHashtags(postId, data.conteudo || '');

    return new Post(mapPost(created));
  }

  /**
   * Extrai hashtags do conteúdo e insere na tabela post_hashtags.
   * Fire-and-forget: falha silenciosa para não bloquear criação do post.
   */
  static async _saveHashtags(postId, conteudo) {
    try {
      const matches = conteudo.match(/#([\w\u00C0-\u024F]{2,})/g);
      if (!matches || matches.length === 0) return;

      // Normaliza: minúsculas, sem '#', sem duplicatas
      const unique = [...new Set(matches.map(m => m.slice(1).toLowerCase()))];

      const rows = unique.map(tag => ({ post_id: postId, hashtag: tag }));
      // onConflict ignore: não falha se já existir
      await sb().from('post_hashtags').upsert(rows, { onConflict: 'post_id,hashtag', ignoreDuplicates: true });
    } catch (_) {
      // fire-and-forget
    }
  }

  /**
   * Busca localização hiperlocal do usuário (home_bairro/cidade/estado) no Supabase.
   * Retorna null se não tiver localização ativa ou em caso de erro.
   * [HYPER-LOCAL] Usado por getFeed e createPost para snapshot/ranking geográfico.
   */
  static async _getUserLocation(userId) {
    try {
      const { data } = await sb()
        .from('users')
        .select('home_bairro, home_cidade, home_estado')
        .eq('id', userId)
        .maybeSingle();
      if (!data?.home_bairro) return null;
      return { bairro: data.home_bairro, cidade: data.home_cidade, estado: data.home_estado };
    } catch {
      return null;
    }
  }

  /**
   * Retorna o top 5 de usuários que mais gastaram EloCoins em gifts.
   * Usado no widget "Mestres da Generosidade".
   */
  static async getGenerosityRanking(limit = 5) {
    // PREFS-003: buscar IDs de usuários que desativaram appear_in_searches
    const hiddenUserIds = await getOptedOutUserIds('appear_in_searches');
    const hiddenSet = new Set(hiddenUserIds);

    const { data, error } = await sb()
      .from('gifts')
      .select('from_user_id, valor, users!gifts_from_user_id_fkey(full_name, username, avatar_url)')
      .eq('status', 'completed');

    if (error) throw error;

    // Agrega por from_user_id
    const map = new Map();
    for (const row of data || []) {
      const uid = row.from_user_id;
      // PREFS-003: excluir usuários que desativaram appear_in_searches
      if (hiddenSet.has(uid)) continue;
      if (!map.has(uid)) {
        map.set(uid, {
          userId:    uid,
          username:  row.users?.username  || null,
          nome:      row.users?.full_name || null,
          photoURL:  row.users?.avatar_url || null,
          totalGasto: 0,
        });
      }
      map.get(uid).totalGasto += Number(row.valor) || 0;
    }

    return [...map.values()]
      .sort((a, b) => b.totalGasto - a.totalGasto)
      .slice(0, limit);
  }

  /**
   * Retorna as hashtags mais usadas nos últimos `days` dias.
   * Usado no widget "Em Alta na Comunidade".
   */
  static async getTrendingHashtags(limit = 10, days = 7) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await sb()
      .from('post_hashtags')
      .select('hashtag')
      .gte('created_at', since);

    if (error) throw error;

    const counts = new Map();
    for (const row of data || []) {
      counts.set(row.hashtag, (counts.get(row.hashtag) || 0) + 1);
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([hashtag, count]) => ({ hashtag, count }));
  }

  static async update(id, data) {
    const row = {};
    if (data.conteudo !== undefined)     row.conteudo = data.conteudo;
    if (data.mediaUrl !== undefined)     row.media_url = data.mediaUrl;
    if (data.tipoMedia !== undefined)    row.tipo_media = data.tipoMedia;
    if (data.visibilidade !== undefined) row.visibilidade = data.visibilidade;

    const { data: updated, error } = await sb()
      .from(TABLE)
      .update(row)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return new Post(mapPost(updated));
  }

  static async delete(id) {
    const { error } = await sb().from(TABLE).delete().eq('id', id);
    if (error) throw error;
  }
}

module.exports = Post;
