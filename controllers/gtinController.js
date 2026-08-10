'use strict';

/**
 * @fileoverview gtinController — GTIN / EAN / UPC lookup
 * Camada fina: valida params via Joi, delega ao gtinService,
 * retorna resposta padronizada { success, found, product }.
 */

const Joi = require('joi');
const gtinService = require('../services/gtinService');
const { logger } = require('../logger');

const CTRL = 'gtinController';

// Joi schema: código deve ser 8-14 dígitos
const gtinParamSchema = Joi.object({
  code: Joi.string()
    .pattern(/^\d{8,14}$/)
    .required()
    .messages({
      'string.pattern.base': 'Código de barras deve conter 8 a 14 dígitos numéricos.',
      'any.required': 'Código de barras é obrigatório.',
    }),
});

/**
 * GET /api/marketplace/gtin/:code
 *
 * Busca produto por código de barras (EAN-8, EAN-13, UPC-A, GTIN-14).
 * Cascata: validação local → catálogo interno → OSCBR API.
 *
 * Resposta:
 *   { success: true, found: true,  product: {...} }
 *   { success: true, found: false, error?: 'invalid_gtin' }
 */
exports.lookupGtin = async (req, res) => {
  try {
    // Validação Joi
    const { error: joiError, value } = gtinParamSchema.validate(req.params);
    if (joiError) {
      return res.status(400).json({
        success: false,
        message: joiError.details[0].message,
      });
    }

    const result = await gtinService.lookupCascade(value.code);

    if (result.found) {
      return res.status(200).json({
        success: true,
        found: true,
        product: result.product,
      });
    }

    return res.status(200).json({
      success: true,
      found: false,
      ...(result.error ? { error: result.error } : {}),
    });
  } catch (err) {
    logger.error(`[${CTRL}] lookupGtin error`, {
      code: req.params?.code,
      userId: req.user?.uid,
      error: err.message,
    });
    res.status(500).json({ success: false, message: 'Erro ao consultar código de barras.' });
  }
};
