/**
 * @fileoverview deliveryRatingController — Sistema de Avaliação Tripartite de Delivery
 *
 * Camada fina: extrai e valida parâmetros, delega ao deliveryRatingService.
 *
 * Rotas registradas em routes/delivery.js:
 *   POST /api/delivery/:requestId/ratings          — submeter avaliação
 *   GET  /api/delivery/:requestId/ratings          — listar avaliações do pedido
 *   GET  /api/delivery/ratings/pending             — avaliações pendentes do usuário autenticado
 *   GET  /api/delivery/ratings/summary/:userId     — resumo de avaliações recebidas
 *
 * [DELIVERY-RATING-001] Agente: marketplace-agent
 * Data: 2026-06-10
 */

'use strict';

const deliveryRatingService = require('../services/deliveryRatingService');
const { logger }            = require('../logger');

const CTRL       = 'deliveryRatingController';
const VALID_ROLES = ['deliverer', 'seller', 'buyer'];

// ──────────────────────────────────────────────────────
// POST /api/delivery/:requestId/ratings
// ──────────────────────────────────────────────────────

/**
 * Submete uma avaliação tripartite.
 *
 * Body:
 *   rated_id   {string}     — ID do usuário avaliado
 *   rated_role {string}     — 'deliverer' | 'seller' | 'buyer'
 *   score      {number}     — 1 a 5
 *   comment    {string?}    — texto livre, máx 500 chars
 *   tags       {string[]?}  — tags qualitativas
 *   anonymous  {boolean?}   — avaliação anônima (LGPD)
 */
exports.submitRating = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { rated_id, rated_role, score, comment, tags, anonymous } = req.body;

    if (!requestId)
      return res.status(400).json({ success: false, message: 'requestId é obrigatório.' });

    if (!rated_id || typeof rated_id !== 'string')
      return res.status(400).json({ success: false, message: 'rated_id é obrigatório.' });

    if (!rated_role || !VALID_ROLES.includes(rated_role))
      return res.status(400).json({
        success: false,
        message: `rated_role inválido. Opções: ${VALID_ROLES.join(', ')}.`,
      });

    const scoreNum = Number(score);
    if (!score || isNaN(scoreNum) || scoreNum < 1 || scoreNum > 5)
      return res.status(400).json({ success: false, message: 'score deve ser um número entre 1 e 5.' });

    if (comment !== undefined && comment !== null) {
      if (typeof comment !== 'string')
        return res.status(400).json({ success: false, message: 'comment deve ser uma string.' });
      if (comment.length > 500)
        return res.status(400).json({ success: false, message: 'comment deve ter no máximo 500 caracteres.' });
    }

    if (tags !== undefined && tags !== null && !Array.isArray(tags))
      return res.status(400).json({ success: false, message: 'tags deve ser um array.' });

    const result = await deliveryRatingService.submitRating(
      req.user.uid,
      requestId,
      rated_id.trim(),
      rated_role,
      scoreNum,
      comment?.trim() ?? null,
      tags ?? null,
      Boolean(anonymous),
    );

    return res.status(201).json({ success: true, data: result });

  } catch (err) {
    logger.warn(`[${CTRL}] submitRating: ${err.message}`, { userId: req.user?.uid });

    const msg    = err.message;
    const status =
      msg.includes('não é parte')        ? 403
      : msg.includes('expirou')          ? 410
      : msg.includes('já avaliou')       ? 409
      : msg.includes('não encontrado')   ? 404
      : msg.includes('entregues ou')     ? 422
      : msg.includes('mesmo papel')      ? 422
      : 400;

    return res.status(status).json({ success: false, message: msg });
  }
};

// ──────────────────────────────────────────────────────
// GET /api/delivery/:requestId/ratings
// ──────────────────────────────────────────────────────

/**
 * Lista todas as avaliações de um pedido.
 * Acesso restrito às partes do pedido.
 */
exports.getRatingsForRequest = async (req, res) => {
  try {
    const { requestId } = req.params;

    if (!requestId)
      return res.status(400).json({ success: false, message: 'requestId é obrigatório.' });

    const ratings = await deliveryRatingService.getRatingsForRequest(req.user.uid, requestId);
    return res.status(200).json({ success: true, data: ratings });

  } catch (err) {
    logger.warn(`[${CTRL}] getRatingsForRequest: ${err.message}`, { userId: req.user?.uid });
    const status = err.message.includes('não é parte') ? 403 : 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// GET /api/delivery/ratings/pending
// ──────────────────────────────────────────────────────

/**
 * Avaliações pendentes do usuário autenticado (últimos 7 dias).
 */
exports.getPendingRatings = async (req, res) => {
  try {
    const pending = await deliveryRatingService.getPendingRatingsForUser(req.user.uid);
    return res.status(200).json({ success: true, data: pending });
  } catch (err) {
    logger.warn(`[${CTRL}] getPendingRatings: ${err.message}`, { userId: req.user?.uid });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// GET /api/delivery/ratings/history
// ──────────────────────────────────────────────────────

/**
 * Histórico de avaliações do usuário autenticado (últimos 90 dias).
 * Query params: limit (default 50), offset (default 0).
 */
exports.getRatingHistory = async (req, res) => {
  try {
    const limit  = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const history = await deliveryRatingService.getUserRatingHistory(req.user.uid, { limit, offset });
    return res.status(200).json({ success: true, data: history });
  } catch (err) {
    logger.warn(`[${CTRL}] getRatingHistory: ${err.message}`, { userId: req.user?.uid });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// GET /api/delivery/ratings/summary/:userId
// ──────────────────────────────────────────────────────

/**
 * Resumo público de avaliações recebidas por um usuário.
 * Retorna média por papel (deliverer, seller, buyer).
 */
exports.getUserRatingSummary = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId)
      return res.status(400).json({ success: false, message: 'userId é obrigatório.' });

    const summary = await deliveryRatingService.getUserRatingSummary(userId);
    return res.status(200).json({ success: true, data: summary });
  } catch (err) {
    logger.warn(`[${CTRL}] getUserRatingSummary: ${err.message}`, { userId: req.user?.uid });
    return res.status(500).json({ success: false, message: err.message });
  }
};
