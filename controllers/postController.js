// controllers/postController.js
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Reaction = require('../models/Reaction');
const Gift = require('../models/Gift');

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

exports.createPost = async (req, res) => {
  try {
    const post = await Post.create(req.body);
    res.status(201).json(post);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.updatePost = async (req, res) => {
  try {
    const post = await Post.update(req.params.id, req.body);
    res.status(200).json(post);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.deletePost = async (req, res) => {
  try {
    await Post.delete(req.params.id);
    res.status(200).json({ message: 'Post deletado com sucesso.' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.addComment = async (req, res) => {
  try {
    const comment = await Comment.create(req.params.postId, req.body);
    res.status(201).json(comment);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.addReaction = async (req, res) => {
  try {
    const reaction = await Reaction.create(req.params.postId, req.body);
    res.status(201).json(reaction);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.addGift = async (req, res) => {
  try {
    const gift = await Gift.create(req.params.postId, req.body);
    res.status(201).json(gift);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};