/**
 * @fileoverview Controller de posts - gerencia publicações, comentários, reações e presentes
 * @module controllers/postController
 */

const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Reaction = require('../models/Reaction');
const Gift = require('../models/Gift');

/**
 * Busca um post específico com seus comentários, reações e presentes
 * @async
 * @function getPostById
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.id - ID do post
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Post completo com comentários, reações e presentes
 */
exports.getPostById = async (req, res) => {
  try {
    const post = await Post.getById(req.params.id);
    post.comentarios = await Comment.getByPostId(req.params.id);
    post.reacoes = await Reaction.getByPostId(req.params.id);
    post.gifts = await Gift.getByPostId(req.params.id);
    res.status(200).json(post);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

/**
 * Cria uma nova publicação
 * @async
 * @function createPost
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} req.body - Dados do post a ser criado
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Post criado
 */
exports.createPost = async (req, res) => {
  try {
    const post = await Post.create(req.body);
    res.status(201).json(post);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

/**
 * Atualiza dados de um post existente
 * @async
 * @function updatePost
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.id - ID do post
 * @param {Object} req.body - Dados atualizados do post
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Post atualizado
 */
exports.updatePost = async (req, res) => {
  try {
    const post = await Post.update(req.params.id, req.body);
    res.status(200).json(post);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

/**
 * Remove um post do sistema
 * @async
 * @function deletePost
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.id - ID do post a ser deletado
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Confirmação da remoção
 */
exports.deletePost = async (req, res) => {
  try {
    await Post.delete(req.params.id);
    res.status(200).json({ message: 'Post deletado com sucesso.' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

/**
 * Adiciona um comentário a um post
 * @async
 * @function addComment
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.postId - ID do post
 * @param {Object} req.body - Dados do comentário
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Comentário criado
 */
exports.addComment = async (req, res) => {
  try {
    const comment = await Comment.create(req.params.postId, req.body);
    res.status(201).json(comment);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

/**
 * Adiciona uma reação (like, love, etc.) a um post
 * @async
 * @function addReaction
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.postId - ID do post
 * @param {Object} req.body - Dados da reação
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Reação criada
 */
exports.addReaction = async (req, res) => {
  try {
    const reaction = await Reaction.create(req.params.postId, req.body);
    res.status(201).json(reaction);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

/**
 * Adiciona um presente virtual a um post
 * @async
 * @function addGift
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.postId - ID do post
 * @param {Object} req.body - Dados do presente
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Presente criado
 */
exports.addGift = async (req, res) => {
  try {
    const gift = await Gift.create(req.params.postId, req.body);
    res.status(201).json(gift);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};