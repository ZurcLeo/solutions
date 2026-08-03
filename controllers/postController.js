/**
 * @fileoverview Controller de posts — delega toda a lógica ao postService
 * @module controllers/postController
 */

const postService = require('../services/postService');
const Post        = require('../models/Post');
const { logger }  = require('../logger');

exports.getFeed = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const page  = Math.max(parseInt(req.query.page)  || 1, 1);
    const mode  = req.query.mode === 'trending' ? 'trending' : 'recent';
    const result = await postService.getFeed({ limit, page, mode, userId: req.user?.uid });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getPostById = async (req, res) => {
  try {
    const post = await postService.getPostById(req.params.id, req.user?.uid);
    res.status(200).json(post);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

exports.createPost = async (req, res) => {
  try {
    const post = await postService.createPost(req.user.uid, req.body);
    res.status(201).json(post);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.updatePost = async (req, res) => {
  try {
    const post = await postService.updatePost(req.params.id, req.body);
    res.status(200).json(post);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.deletePost = async (req, res) => {
  try {
    await postService.deletePost(req.params.id);
    res.status(200).json({ message: 'Post deletado com sucesso.' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.addComment = async (req, res) => {
  try {
    const comment = await postService.addComment(req.params.postId, req.user.uid, req.body);
    res.status(201).json(comment);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.addReaction = async (req, res) => {
  if (req.body.tipoDeReacao && req.body.tipoDeReacao !== 'heart') {
    return res.status(400).json({ message: 'Apenas reações do tipo "heart" são permitidas.' });
  }
  req.body.tipoDeReacao = 'heart';

  try {
    const reaction = await postService.addReaction(req.params.postId, req.user.uid, req.body);
    res.status(201).json(reaction);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.getGenerosityRanking = async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 5, 20);
    const ranking = await Post.getGenerosityRanking(limit);
    res.status(200).json({ ranking });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getTrendingHashtags = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 30);
    const days  = Math.min(parseInt(req.query.days)  || 7,  30);
    const hashtags = await Post.getTrendingHashtags(limit, days);
    res.status(200).json({ hashtags });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.toggleCommentLike = async (req, res) => {
  try {
    const result = await postService.toggleCommentLike(
      req.params.postId,
      req.params.commentId,
      req.user.uid
    );
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.replyToComment = async (req, res) => {
  try {
    const reply = await postService.replyToComment(
      req.params.postId,
      req.params.commentId,
      req.user.uid,
      req.body
    );
    res.status(201).json(reply);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.addGift = async (req, res) => {
  const { stickerId, receiverId, message } = req.body;
  if (!stickerId)  return res.status(400).json({ message: 'stickerId é obrigatório.' });
  if (!receiverId) return res.status(400).json({ message: 'receiverId é obrigatório.' });
  if (message && message.length > 100) {
    return res.status(400).json({ message: 'A mensagem deve ter no máximo 100 caracteres.' });
  }

  const { randomUUID } = require('crypto');

  try {
    const result = await postService.addGift(req.params.postId, req.user.uid, {
      stickerId,
      receiverId,
      idempotencyKey: randomUUID(),
      message: message || null,
    });
    res.status(201).json(result);
  } catch (error) {
    const msg = error.message || '';
    logger.error('[GIFT] Erro ao enviar gift', {
      postId: req.params.postId,
      senderId: req.user?.uid,
      receiverId,
      stickerId,
      errorMessage: msg,
      errorCode: error.code || error.statusCode || null,
      errorDetails: error.details || null,
    });
    const status = msg.includes('insuficiente')       ? 402
      : msg.includes('esgotado')                      ? 409
      : msg.includes('limite')                        ? 409
      : msg.includes('fora do período')                ? 409
      : msg.includes('não encontrado')                 ? 404
      : msg.includes('does not exist')                 ? 404
      : msg.includes('maior que zero')                 ? 422
      : msg.includes('schema cache')                   ? 502
      : 400;
    res.status(status).json({ message: msg });
  }
};
