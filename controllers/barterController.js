const barterService = require('../services/barterService');
const { logger } = require('../logger');

const barterController = {
  /**
   * POST /api/marketplace/products/:id/trade-request
   * Solicitar troca de um produto barter (50 EloCoins debitados).
   */
  async createTradeRequest(req, res) {
    try {
      const { id: productId } = req.params;
      const { offer_description, offer_product_id } = req.body;

      if (!offer_description || offer_description.trim().length < 10) {
        return res.status(400).json({
          code: 'INVALID_OFFER',
          message: 'Descreva sua oferta com pelo menos 10 caracteres'
        });
      }

      const tradeRequest = await barterService.createTradeRequest(
        req.user.uid,
        productId,
        offer_description.trim(),
        offer_product_id || null
      );

      res.status(201).json({ tradeRequest });
    } catch (err) {
      if (err.code === 'INSUFFICIENT_COINS') {
        return res.status(402).json({ code: err.code, required: err.required, message: err.message });
      }
      if (['PRODUCT_NOT_FOUND', 'NOT_BARTER_PRODUCT', 'PRODUCT_INACTIVE'].includes(err.code)) {
        return res.status(404).json({ code: err.code, message: err.message });
      }
      if (['SELF_TRADE_NOT_ALLOWED', 'DUPLICATE_TRADE_REQUEST'].includes(err.code)) {
        return res.status(409).json({ code: err.code, message: err.message });
      }
      logger.error('barterController.createTradeRequest error', { error: err.message });
      res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
    }
  },

  /**
   * GET /api/marketplace/trade-requests
   * Lista solicitações de troca do usuário.
   * Query: ?role=requester|owner|both (default: both)
   */
  async listTradeRequests(req, res) {
    try {
      const role = ['requester', 'owner', 'both'].includes(req.query.role)
        ? req.query.role
        : 'both';

      const tradeRequests = await barterService.listTradeRequests(req.user.uid, role);
      res.json({ tradeRequests });
    } catch (err) {
      logger.error('barterController.listTradeRequests error', { error: err.message });
      res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
    }
  },

  /**
   * PATCH /api/marketplace/trade-requests/:id/accept
   */
  async acceptTradeRequest(req, res) {
    try {
      const tradeRequest = await barterService.acceptTradeRequest(req.user.uid, req.params.id);
      res.json({ tradeRequest, message: 'Troca aceita com sucesso!' });
    } catch (err) {
      if (err.code === 'FORBIDDEN') return res.status(403).json({ code: err.code, message: err.message });
      if (err.code === 'NOT_FOUND') return res.status(404).json({ code: err.code, message: err.message });
      if (err.code === 'INVALID_STATUS') return res.status(409).json({ code: err.code, message: err.message });
      logger.error('barterController.acceptTradeRequest error', { error: err.message });
      res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
    }
  },

  /**
   * PATCH /api/marketplace/trade-requests/:id/reject
   */
  async rejectTradeRequest(req, res) {
    try {
      const tradeRequest = await barterService.rejectTradeRequest(
        req.user.uid, req.params.id, req.body.reason || null
      );
      res.json({ tradeRequest });
    } catch (err) {
      if (err.code === 'FORBIDDEN') return res.status(403).json({ code: err.code, message: err.message });
      if (err.code === 'INVALID_STATUS') return res.status(409).json({ code: err.code, message: err.message });
      logger.error('barterController.rejectTradeRequest error', { error: err.message });
      res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
    }
  },

  /**
   * PATCH /api/marketplace/trade-requests/:id/cancel
   */
  async cancelTradeRequest(req, res) {
    try {
      const tradeRequest = await barterService.cancelTradeRequest(req.user.uid, req.params.id);
      res.json({ tradeRequest, message: 'Solicitação cancelada. Os 50 EloCoins do pedágio não são reembolsados.' });
    } catch (err) {
      if (err.code === 'FORBIDDEN') return res.status(403).json({ code: err.code, message: err.message });
      if (err.code === 'NOT_FOUND') return res.status(404).json({ code: err.code, message: err.message });
      if (err.code === 'INVALID_STATUS') return res.status(409).json({ code: err.code, message: err.message });
      logger.error('barterController.cancelTradeRequest error', { error: err.message });
      res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
    }
  }
};

module.exports = barterController;
