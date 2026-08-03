// services/postService.js
const Post     = require('../models/Post');
const Comment  = require('../models/Comment');
const Reaction = require('../models/Reaction');
const Gift     = require('../models/Gift');
const gamificationService    = require('./gamificationService');
const notificationDispatcher = require('./NotificationDispatcher');
const socketManager          = require('../config/socket/socketManager');
const { POST_EVENTS, GAMIFICATION_EVENTS } = require('../config/socket/socketEvents');

class PostService {
  static async getFeed({ limit = 20, page = 1, mode = 'recent', userId = null } = {}) {
    // Busca localização do visualizador para aplicar geo_score
    let viewerLocation = null;
    if (userId) {
      viewerLocation = await Post._getUserLocation(userId).catch(() => null);
    }
    return Post.getFeed({ limit, page, mode, userId, viewerLocation });
  }

  static async getPostById(postId, userId = null) {
    const post = await Post.getById(postId);
    post.comentarios = await Comment.getByPostId(postId);
    post.reacoes     = await Reaction.getByPostId(postId);
    post.gifts       = await Gift.getByPostId(postId);
    // Inclui IDs dos comentários curtidos pelo usuário atual
    if (userId) {
      post.userLikedCommentIds = await Comment.getUserLikedCommentIds(postId, userId).catch(() => []);
    }
    return post;
  }

  static async createPost(userId, data) {
    // Snapshot de localização do autor ao criar o post
    let locationSnapshot = {};
    try {
      const loc = await Post._getUserLocation(userId);
      if (loc) {
        locationSnapshot = { postBairro: loc.bairro, postCidade: loc.cidade, postEstado: loc.estado };
      }
    } catch { /* sem localização ativa — post sem snapshot geográfico */ }

    const post = await Post.create({ ...data, usuarioId: userId, ...locationSnapshot });

    // Fire-and-forget: gamificação por nova postagem
    gamificationService.triggerEvent('first_post_created', userId, { postId: post.id }).catch(() => {});

    // Broadcast para todos no feed público
    socketManager.emitToRoom('feed:public', POST_EVENTS.POST_CREATED, { post });

    return post;
  }

  static async updatePost(postId, data) {
    return Post.update(postId, data);
  }

  static async deletePost(postId) {
    await Post.delete(postId);
    socketManager.emitToRoom('feed:public', POST_EVENTS.POST_DELETED, { postId });
  }

  static async addComment(postId, userId, data) {
    const comment = await Comment.create(postId, { ...data, usuarioId: userId });

    // Fire-and-forget: atualiza trending score após novo comentário
    Post.incrementCommentsAndUpdateScore(postId);

    // Busca dados do autor para enriquecer o broadcast (fire-and-forget se falhar)
    const { getSupabaseClient } = require('../config/supabase');
    let authorName = null;
    let authorPhoto = null;
    try {
      const sb = getSupabaseClient();
      if (sb) {
        const { data: user } = await sb
          .from('users')
          .select('full_name, avatar_url')
          .eq('id', userId)
          .single();
        if (user) {
          authorName = user.full_name;
          authorPhoto = user.avatar_url;
        }
      }
    } catch { /* broadcast sem dados do autor — frontend faz fallback */ }

    // Broadcast para todos no feed público (via room — mais eficiente que broadcastToAll)
    socketManager.emitToRoom('feed:public', POST_EVENTS.COMMENT_ADDED, {
      postId,
      comment: {
        id:        comment.id,
        postId,
        usuarioId: userId,
        texto:     comment.texto,
        timestamp: comment.timestamp,
        usuarioNome: authorName,
        usuarioFoto: authorPhoto,
      },
    });

    // Fire-and-forget: notificação para o dono do post (não notifica a si mesmo)
    Post.getById(postId).then(post => {
      if (post.usuarioId && post.usuarioId !== userId) {
        notificationDispatcher.dispatch({
          userId:     post.usuarioId,
          type:       'comment_received',
          importance: 'low',
          data:       { senderId: userId, senderName: authorName, postId, texto: comment.texto },
          metadata:   { triggeredBy: 'system' },
          dedupKey:   `comment_received_${comment.id}`,
        }).catch(() => {});
      }
    }).catch(() => {});

    // Fire-and-forget: gamificação por comentário (isolado — não contamina notificações).
    // Busca o dono do post para aplicar guard de auto-comentário.
    setImmediate(() => {
      Post.getById(postId).then(post => {
        if (post.usuarioId !== userId) {
          gamificationService.triggerEvent('comment_posted', userId, {
            postId,
            commentId: comment.id,
          }).catch(() => {});
        }
      }).catch(() => {});
    });

    return comment;
  }

  static async addReaction(postId, userId, data) {
    const result = await Reaction.toggle(postId, { ...data, usuarioId: userId });

    if (result.liked) {
      // Fire-and-forget: incrementa score, gamificação e notificação para o dono do post
      Post.incrementReactionsAndUpdateScore(postId);

      // Busca nome do autor da reação para notificação personalizada
      const { getSupabaseClient } = require('../config/supabase');
      let reactorName = null;
      try {
        const sb = getSupabaseClient();
        if (sb) {
          const { data: reactor } = await sb
            .from('users')
            .select('full_name')
            .eq('id', userId)
            .single();
          if (reactor) reactorName = reactor.full_name;
        }
      } catch { /* fallback sem nome */ }

      Post.getById(postId).then(post => {
        if (post.usuarioId && post.usuarioId !== userId) {
          gamificationService.triggerEvent('reaction_received', post.usuarioId, {
            amount: 1,
            postId,
            senderId: userId,
          }).catch(() => {});
          notificationDispatcher.dispatch({
            userId:     post.usuarioId,
            type:       'reaction_received',
            importance: 'low',
            data:       { senderId: userId, senderName: reactorName, postId },
            metadata:   { triggeredBy: 'system' },
            dedupKey:   `reaction_received_${postId}_${userId}`,
          }).catch(() => {});
        }
      }).catch(() => {});
    }

    // Broadcast para todos no feed público (like/unlike em tempo real)
    // TODO: adicionar debounce por postId se houver volume alto de reações
    socketManager.emitToRoom('feed:public', POST_EVENTS.REACTION_TOGGLED, {
      postId,
      reaction: { ...result, usuarioId: userId },
    });

    return result;
  }

  static async toggleCommentLike(postId, commentId, userId) {
    const result = await Comment.toggleLike(commentId, userId);

    socketManager.emitToRoom('feed:public', POST_EVENTS.COMMENT_LIKED, {
      postId,
      commentId,
      userId,
      liked: result.liked,
      likesCount: result.likesCount,
    });

    // Fire-and-forget: notificação para o autor do comentário quando recebe like
    if (result.liked) {
      const { getSupabaseClient } = require('../config/supabase');
      setImmediate(async () => {
        try {
          const sb = getSupabaseClient();
          if (!sb) return;
          const { data: comment } = await sb
            .from('comments')
            .select('usuario_id')
            .eq('id', commentId)
            .single();
          if (!comment || comment.usuario_id === userId) return;

          const { data: liker } = await sb
            .from('users')
            .select('full_name')
            .eq('id', userId)
            .single();

          notificationDispatcher.dispatch({
            userId:     comment.usuario_id,
            type:       'comment_liked',
            importance: 'low',
            data:       { senderId: userId, senderName: liker?.full_name || null, postId, commentId },
            metadata:   { triggeredBy: 'system' },
            dedupKey:   `comment_liked_${commentId}_${userId}`,
          }).catch(() => {});
        } catch { /* silêncio */ }
      });
    }

    return result;
  }

  static async replyToComment(postId, parentCommentId, userId, data) {
    const reply = await Comment.create(postId, {
      ...data,
      usuarioId: userId,
      parentCommentId,
    });

    // Broadcast reply
    socketManager.emitToRoom('feed:public', POST_EVENTS.COMMENT_ADDED, {
      postId,
      comment: {
        id:              reply.id,
        postId,
        usuarioId:       userId,
        texto:           reply.texto,
        timestamp:       reply.timestamp,
        usuarioNome:     reply.usuarioNome,
        usuarioFoto:     reply.usuarioFoto,
        parentCommentId,
      },
    });

    // Fire-and-forget: incrementa score
    Post.incrementCommentsAndUpdateScore(postId);

    // Fire-and-forget: notificação para o autor do comentário-pai
    const { getSupabaseClient } = require('../config/supabase');
    setImmediate(async () => {
      try {
        const sb = getSupabaseClient();
        if (!sb) return;
        const { data: parentComment } = await sb
          .from('comments')
          .select('usuario_id')
          .eq('id', parentCommentId)
          .single();
        if (!parentComment || parentComment.usuario_id === userId) return;

        notificationDispatcher.dispatch({
          userId:     parentComment.usuario_id,
          type:       'comment_reply_received',
          importance: 'low',
          data:       { senderId: userId, senderName: reply.usuarioNome, postId, commentId: reply.id, texto: reply.texto },
          metadata:   { triggeredBy: 'system' },
          dedupKey:   `comment_reply_${reply.id}`,
        }).catch(() => {});
      } catch { /* silêncio */ }
    });

    return reply;
  }

  static async addGift(postId, userId, data) {
    const result = await Gift.sendSticker({
      senderId:       userId,
      receiverId:     data.receiverId,
      stickerId:      data.stickerId,
      postId,
      idempotencyKey: data.idempotencyKey,
      message:        data.message || null,
    });

    // Fire-and-forget: gamificação por gift enviado
    gamificationService.triggerEvent('gift_sent', userId, {
      stickerId: data.stickerId,
      receiverId: data.receiverId,
      postId,
    }).catch(() => {});

    // Fire-and-forget: notificação para o receptor do presente
    notificationDispatcher.dispatch({
      userId:     data.receiverId,
      type:       'gift_received',
      importance: 'low',
      data: {
        stickerName:      result.sticker_name,
        eloCoinsReceived: result.amount_spent,
        postId,
        senderId: userId,
      },
      metadata:  { triggeredBy: 'system' },
      dedupKey:  result.gift_id ? `gift_received_${result.gift_id}` : undefined,
    }).catch(() => {});

    // Evento realtime direto ao receptor do presente
    socketManager.emitToUser(data.receiverId, GAMIFICATION_EVENTS.GIFT_RECEIVED, {
      giftId:           result.gift_id,
      stickerId:        data.stickerId,
      stickerName:      result.sticker_name,
      eloCoinsReceived: result.amount_spent,
      postId,
      senderId:         userId,
    });

    return result;
  }
}

module.exports = PostService;
