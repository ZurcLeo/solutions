// controllers/KnowledgeController.js — Base de Conhecimento (SUPP-ARTICLE-001)
const KnowledgeArticle = require('../models/KnowledgeArticle');
const { logger } = require('../logger');

class KnowledgeController {
  // ── Público ──────────────────────────────────────────────────────────────────

  // GET /api/support/articles?category=financial&limit=5
  async listArticles(req, res) {
    const { category, limit } = req.query;
    try {
      const articles = category
        ? await KnowledgeArticle.findByCategory(category, true, parseInt(limit) || 5)
        : await KnowledgeArticle.getAll(true, parseInt(limit) || 20);
      return res.json({ success: true, data: articles });
    } catch (error) {
      logger.error('KnowledgeController.listArticles', { error: error.message });
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  // GET /api/support/articles/:articleId
  async getArticle(req, res) {
    const { articleId } = req.params;
    try {
      const article = await KnowledgeArticle.getById(articleId);
      if (!article || (!article.published && !req.user?.roles?.includes('admin') && !req.user?.roles?.includes('support'))) {
        return res.status(404).json({ success: false, message: 'Artigo não encontrado.' });
      }
      // Incrementa views de forma fire-and-forget
      KnowledgeArticle.incrementViewCount(articleId).catch(() => {});
      return res.json({ success: true, data: article });
    } catch (error) {
      logger.error('KnowledgeController.getArticle', { error: error.message, articleId });
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  // ── Admin ────────────────────────────────────────────────────────────────────

  // POST /api/support/articles
  async createArticle(req, res) {
    const { title, body, category, tags, published } = req.body;
    const authorId = req.user.uid;
    try {
      if (!title || !body) {
        return res.status(400).json({ success: false, message: 'title e body são obrigatórios.' });
      }
      const article = await KnowledgeArticle.create({ title, body, category, tags, authorId, published });
      return res.status(201).json({ success: true, data: article });
    } catch (error) {
      logger.error('KnowledgeController.createArticle', { error: error.message });
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  // PUT /api/support/articles/:articleId
  async updateArticle(req, res) {
    const { articleId } = req.params;
    const { title, body, category, tags, published } = req.body;
    try {
      const article = await KnowledgeArticle.update(articleId, { title, body, category, tags, published });
      return res.json({ success: true, data: article });
    } catch (error) {
      logger.error('KnowledgeController.updateArticle', { error: error.message, articleId });
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  // DELETE /api/support/articles/:articleId
  async deleteArticle(req, res) {
    const { articleId } = req.params;
    try {
      await KnowledgeArticle.delete(articleId);
      return res.json({ success: true, message: 'Artigo removido.' });
    } catch (error) {
      logger.error('KnowledgeController.deleteArticle', { error: error.message, articleId });
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  // GET /api/support/articles/stats — contagem de artigos publicados por categoria (público)
  async getArticleStats(req, res) {
    try {
      const articles = await KnowledgeArticle.getAll(true, 1000);
      const counts = {};
      for (const a of articles) {
        const cat = a.category || 'general';
        counts[cat] = (counts[cat] || 0) + 1;
      }
      return res.json({ success: true, data: counts });
    } catch (error) {
      logger.error('KnowledgeController.getArticleStats', { error: error.message });
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  // GET /api/support/articles/admin — lista todos (incluindo não publicados) para admin
  async listAllArticles(req, res) {
    const { limit } = req.query;
    try {
      const articles = await KnowledgeArticle.getAll(false, parseInt(limit) || 100);
      return res.json({ success: true, data: articles });
    } catch (error) {
      logger.error('KnowledgeController.listAllArticles', { error: error.message });
      return res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new KnowledgeController();
