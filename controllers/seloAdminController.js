const Joi = require('joi');
const { logger } = require('../logger');
const gamificationService = require('../services/gamificationService');

// ─── Schemas de Validação ───────────────────────────────────────────────────

const createSchema = Joi.object({
  slug: Joi.string().pattern(/^[a-z0-9_]+$/).min(2).max(60).required(),
  name: Joi.string().min(2).max(80).required(),
  description: Joi.string().max(255).optional(),
  category: Joi.string().valid(
    'conquista', 'plataforma', 'especial', 'caixinha', 'social', 'financeiro', 'comunidade'
  ).required(),
  tier: Joi.string().valid('bronze', 'prata', 'ouro', 'diamante').default('bronze'),
  icon_url: Joi.string().uri().optional(),
  color_hex: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).optional(),
  is_active: Joi.boolean().default(true),
  is_platform_grant: Joi.boolean().default(false),
  grant_criteria: Joi.object().default({}),
  xp_bonus: Joi.number().integer().min(0).default(0),
  coin_bonus: Joi.number().integer().min(0).default(0),
  is_unique: Joi.boolean().default(true),
  sort_order: Joi.number().integer().min(0).default(0),
});

const updateSchema = Joi.object({
  name: Joi.string().min(2).max(80),
  description: Joi.string().max(255).allow(null),
  category: Joi.string().valid(
    'conquista', 'plataforma', 'especial', 'caixinha', 'social', 'financeiro', 'comunidade'
  ),
  tier: Joi.string().valid('bronze', 'prata', 'ouro', 'diamante'),
  icon_url: Joi.string().uri().allow(null),
  color_hex: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/),
  is_active: Joi.boolean(),
  is_platform_grant: Joi.boolean(),
  grant_criteria: Joi.object(),
  xp_bonus: Joi.number().integer().min(0),
  coin_bonus: Joi.number().integer().min(0),
  is_unique: Joi.boolean(),
  sort_order: Joi.number().integer().min(0),
}).min(1);

const grantSchema = Joi.object({
  seloSlug: Joi.string().required(),
  reason: Joi.string().max(255).optional(),
});

// ─── Handlers ───────────────────────────────────────────────────────────────

/**
 * GET /api/admin/selos
 * Lista catálogo completo, incluindo selos inativos.
 */
exports.getAllSelos = async (req, res) => {
  try {
    const result = await gamificationService.getAllSelosAdmin();
    res.status(200).json(result);
  } catch (err) {
    logger.error('seloAdminController.getAllSelos', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/admin/selos
 * Cria novo selo no catálogo.
 */
exports.createSelo = async (req, res) => {
  const { error: valErr, value } = createSchema.validate(req.body);
  if (valErr) return res.status(400).json({ success: false, error: valErr.details[0].message });

  try {
    const result = await gamificationService.createSelo(value);
    res.status(201).json(result);
  } catch (err) {
    logger.error('seloAdminController.createSelo', { error: err.message });
    const status = err.code === '23505' ? 409 : 500; // 23505 = unique violation (slug duplicado)
    res.status(status).json({ success: false, error: err.message });
  }
};

/**
 * PATCH /api/admin/selos/:id
 * Edita campos de um selo existente.
 */
exports.updateSelo = async (req, res) => {
  const { id } = req.params;
  const { error: valErr, value } = updateSchema.validate(req.body);
  if (valErr) return res.status(400).json({ success: false, error: valErr.details[0].message });

  try {
    const result = await gamificationService.updateSelo(id, value);
    res.status(200).json(result);
  } catch (err) {
    logger.error('seloAdminController.updateSelo', { id, error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * PATCH /api/admin/selos/:id/toggle
 * Ativa ou desativa um selo.
 */
exports.toggleSelo = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await gamificationService.toggleSelo(id);
    res.status(200).json(result);
  } catch (err) {
    logger.error('seloAdminController.toggleSelo', { id, error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/admin/selos/:id/image
 * Faz upload do ícone de um selo (multipart/form-data, campo "image").
 */
exports.uploadImage = async (req, res) => {
  const { id } = req.params;
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Nenhuma imagem fornecida.' });
  }

  try {
    const result = await gamificationService.uploadSeloImage(
      id,
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname,
    );
    res.status(200).json(result);
  } catch (err) {
    logger.error('seloAdminController.uploadImage', { id, error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/admin/selos/:id/holders
 * Lista usuários que possuem um determinado selo (paginado).
 * Query params: page (default 1), limit (default 20, max 100).
 */
exports.getSeloHolders = async (req, res) => {
  const { id } = req.params;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

  try {
    const result = await gamificationService.getSeloHolders(id, page, limit);
    res.status(200).json(result);
  } catch (err) {
    logger.error('seloAdminController.getSeloHolders', { id, error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/admin/users/:userId/selos
 * Concede um selo manualmente a um usuário.
 * Body: { seloSlug, reason? }
 */
exports.grantSeloToUser = async (req, res) => {
  const { userId } = req.params;
  const adminId = req.user.uid;

  const { error: valErr, value } = grantSchema.validate(req.body);
  if (valErr) return res.status(400).json({ success: false, error: valErr.details[0].message });

  try {
    const result = await gamificationService.grantSelo(
      userId,
      value.seloSlug,
      adminId,
      value.reason || `Concedido manualmente pelo admin ${adminId}`,
    );
    res.status(200).json(result);
  } catch (err) {
    logger.error('seloAdminController.grantSeloToUser', { userId, error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * DELETE /api/admin/users/:userId/selos/:seloId
 * Revoga um selo de um usuário.
 * :seloId = user_selos.id (não o catalog id).
 */
exports.revokeSeloFromUser = async (req, res) => {
  const { userId, seloId } = req.params;

  try {
    const result = await gamificationService.revokeSelo(userId, seloId);
    res.status(200).json(result);
  } catch (err) {
    logger.error('seloAdminController.revokeSeloFromUser', { userId, seloId, error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
};
