/**
 * @fileoverview visionController — ElosCloud Vision Extraction API
 *
 * POST   /api/vision/extract    — extrair dados estruturados de imagem (multipart ou JSON URL)
 * GET    /api/vision/templates   — listar templates de extracao disponíveis
 */

const Joi = require('joi');
const { logger } = require('../logger');
const visionService = require('../services/visionExtractionService');
const gamificationService = require('../services/gamificationService');

const CTRL = 'visionController';

function uid(req) {
  return req.user?.uid || req.user?.id;
}

// ── Schemas ─────────────────────────────────────────────────────────────────

const extractUrlSchema = Joi.object({
  imageUrl: Joi.string().uri().required(),
  templateType: Joi.string().valid(
    'receipt', 'document_id', 'product_label', 'business_card', 'invoice', 'custom'
  ).required(),
  schema: Joi.object().when('templateType', {
    is: 'custom',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
});

const extractUploadSchema = Joi.object({
  templateType: Joi.string().valid(
    'receipt', 'document_id', 'product_label', 'business_card', 'invoice', 'custom'
  ).required(),
  schema: Joi.string().optional(), // JSON string when sent via multipart
});

// ── POST /api/vision/extract ────────────────────────────────────────────────

exports.extract = async (req, res) => {
  try {
    const userId = uid(req);

    // Determine if this is a file upload or URL-based extraction
    if (req.file) {
      // ── File upload mode (multipart/form-data) ──
      const { error, value } = extractUploadSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: error.details[0].message,
        });
      }

      let options = { userId };

      // Parse schema if custom template
      if (value.templateType === 'custom' && value.schema) {
        try {
          options.schema = typeof value.schema === 'string'
            ? JSON.parse(value.schema)
            : value.schema;
        } catch {
          return res.status(400).json({
            success: false,
            error: 'Campo "schema" deve ser um JSON valido.',
          });
        }
      }

      const result = await visionService.extractFromImage(
        req.file.buffer,
        value.templateType,
        options
      );

      // Fire gamification event on success
      if (result.success) {
        _fireGamification(userId);
      }

      return res.status(result.success ? 200 : 422).json(result);
    }

    // ── URL mode (JSON body) ──
    const { error, value } = extractUrlSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message,
      });
    }

    const options = { userId };
    if (value.templateType === 'custom') {
      options.schema = value.schema;
    }

    const result = await visionService.extractFromUrl(
      value.imageUrl,
      value.templateType,
      options
    );

    // Fire gamification event on success
    if (result.success) {
      _fireGamification(userId);
    }

    return res.status(result.success ? 200 : 422).json(result);
  } catch (err) {
    logger.error('Vision extract failed', { service: CTRL, error: err.message, stack: err.stack });
    return res.status(500).json({ success: false, error: 'Erro interno ao processar extracao.' });
  }
};

// ── GET /api/vision/templates ───────────────────────────────────────────────

exports.getTemplates = async (_req, res) => {
  try {
    const templates = visionService.getAvailableTemplates();
    return res.status(200).json({ success: true, data: templates });
  } catch (err) {
    logger.error('Get templates failed', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, error: 'Erro interno.' });
  }
};

// ── Gamification helper ─────────────────────────────────────────────────────

function _fireGamification(userId) {
  if (!userId) return;
  try {
    const { triggerEvent } = gamificationService;
    if (typeof triggerEvent === 'function') {
      triggerEvent('vision_extraction_used', userId).catch(err => {
        logger.warn('Gamification event failed for vision_extraction_used', {
          service: CTRL,
          error: err.message,
        });
      });
    }
  } catch (err) {
    logger.warn('Gamification trigger error', { service: CTRL, error: err.message });
  }
}
