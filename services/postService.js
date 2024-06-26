// services/postService.js
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Reaction = require('../models/Reaction');
const Gift = require('../models/Gift');

class PostService {
  static async getPostById(postId) {
    const post = await Post.getById(postId);
    post.comentarios = await Comment.getByPostId(postId);
    post.reacoes = await Reaction.getByPostId(postId);
    post.gifts = await Gift.getByPostId(postId);
    return post;
  }

  static async createPost(postData) {
    return await Post.create(postData);
  }

  static async updatePost(postId, postData) {
    return await Post.update(postId, postData);
  }

  static async deletePost(postId) {
    await Post.delete(postId);
  }

  static async addComment(postId, commentData) {
    return await Comment.create(postId, commentData);
  }

  static async addReaction(postId, reactionData) {
    return await Reaction.create(postId, reactionData);
  }

  static async addGift(postId, giftData) {
    return await Gift.create(postId, giftData);
  }
}

module.exports = PostService;