/**
 * @fileoverview IconChat E1 — User Context Controller
 *
 * GET /api/icon/users/:userId/context[?capabilities=cap1,cap2,...]
 * Autenticação: HMAC de canal (verifyIconChannelHmac), sem seller-scope.
 *
 * Retorna contexto global do usuário para o system prompt da IA:
 * identidade, trust passport, gamificação, selos, papel buyer/seller.
 *
 * WA-1.5: Query param `capabilities` (comma-separated) filtra módulos retornados
 * para minimizar dados pessoais no prompt (LGPD). Se omitido, retorna tudo.
 */

'use strict';

const Joi = require('joi');
const { logger } = require('../logger');
const userContextService = require('../services/userContextService');
const { VALID_CAPABILITIES } = userContextService;

const CTRL = 'iconUserContextController';

const paramsSchema = Joi.object({
  userId: Joi.string().trim().min(1).max(128).required(),
});

const querySchema = Joi.object({
  capabilities: Joi.string()
    .trim()
    .max(500)
    .optional()
    .custom((value) => {
      if (!value) return null;
      const caps = value.split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
      const invalid = caps.filter(c => !VALID_CAPABILITIES.has(c));
      if (invalid.length > 0) {
        throw new Error(`Capabilities inválidas: ${invalid.join(', ')}`);
      }
      return caps;
    }),
}).unknown(true); // allow other query params to pass through

// ---------------------------------------------------------------------------
// E2: GET /api/icon/users/:userId/buyer-context
// ---------------------------------------------------------------------------

exports.getBuyerContext = async (req, res) => {
  try {
    const { error: validationError, value } = paramsSchema.validate(req.params);
    if (validationError) {
      return res.status(400).json({
        success: false,
        error: 'invalid_params',
        details: validationError.message,
      });
    }

    const { userId } = value;

    const context = await userContextService.getBuyerContext(userId);

    if (!context) {
      return res.status(404).json({
        success: false,
        error: 'user_not_found',
      });
    }

    res.set('Cache-Control', 'private, max-age=30');
    return res.json({
      success: true,
      data: context,
    });
  } catch (err) {
    logger.error(`[${CTRL}] getBuyerContext error`, {
      error: err.message,
      userId: req.params.userId,
    });
    return res.status(500).json({
      success: false,
      error: 'internal_error',
    });
  }
};

// ---------------------------------------------------------------------------
// E1: GET /api/icon/users/:userId/context[?capabilities=cap1,cap2]
// ---------------------------------------------------------------------------

exports.getUserContext = async (req, res) => {
  try {
    const { error: validationError, value } = paramsSchema.validate(req.params);
    if (validationError) {
      return res.status(400).json({
        success: false,
        error: 'invalid_params',
        details: validationError.message,
      });
    }

    // WA-1.5: Parse capabilities query param
    const { error: queryError, value: queryValue } = querySchema.validate(req.query);
    if (queryError) {
      return res.status(400).json({
        success: false,
        error: 'invalid_query',
        details: queryError.message,
      });
    }

    const { userId } = value;
    const requestedCapabilities = queryValue.capabilities || null;

    const context = await userContextService.getUserContext(userId, requestedCapabilities);

    if (!context) {
      return res.status(404).json({
        success: false,
        error: 'user_not_found',
      });
    }

    // Cache shorter when filtered (context may change if different caps requested)
    const maxAge = requestedCapabilities ? 60 : 300;
    res.set('Cache-Control', `private, max-age=${maxAge}`);
    return res.json({
      success: true,
      data: context,
    });
  } catch (err) {
    logger.error(`[${CTRL}] getUserContext error`, {
      error: err.message,
      userId: req.params.userId,
      capabilities: req.query.capabilities,
    });
    return res.status(500).json({
      success: false,
      error: 'internal_error',
    });
  }
};
