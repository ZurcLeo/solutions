/**
 * @fileoverview businessInviteController — BIZ-004
 * Thin controllers para convites de negócio (Business Invites).
 * Joi validation + delegação para businessInviteService.
 */

'use strict';

const Joi = require('joi');
const businessInviteService = require('../services/businessInviteService');
const { logger } = require('../logger');

const CTRL = 'businessInviteController';

// ──────────────────────────────────────────────────────
// Schemas
// ──────────────────────────────────────────────────────

const createInviteSchema = Joi.object({
  email:       Joi.string().email().required(),
  role:        Joi.string().valid('manager', 'employee').default('employee'),
  permissions: Joi.object({
    can_manage_clients:    Joi.boolean(),
    can_manage_pendencias: Joi.boolean(),
    can_view_financials:   Joi.boolean(),
    can_manage_team:       Joi.boolean(),
    can_manage_catalog:    Joi.boolean(),
    can_manage_orders:     Joi.boolean(),
    can_manage_settings:   Joi.boolean(),
    can_manage_billing:    Joi.boolean(),
  }).optional(),
});

// ──────────────────────────────────────────────────────
// Handlers
// ──────────────────────────────────────────────────────

// POST /api/marketplace/seller/:sellerId/invite
async function createInvite(req, res) {
  try {
    const { sellerId } = req.params;
    if (!sellerId) return res.status(400).json({ success: false, message: 'sellerId é obrigatório' });

    const { error: valErr, value } = createInviteSchema.validate(req.body);
    if (valErr) return res.status(400).json({ success: false, message: valErr.details[0].message });

    const invite = await businessInviteService.createBusinessInvite(
      sellerId, req.user.uid, value.email, value.role, value.permissions,
    );
    res.status(201).json({ success: true, data: invite });
  } catch (err) {
    logger.error(`[${CTRL}] createInvite: ${err.message}`);
    const status = err.message.includes('Trust Passport') ? 403
                 : err.message.includes('já existe') || err.message.includes('já é membro') ? 400
                 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
}

// GET /api/marketplace/seller/:sellerId/invites
async function listInvites(req, res) {
  try {
    const { sellerId } = req.params;
    if (!sellerId) return res.status(400).json({ success: false, message: 'sellerId é obrigatório' });

    const invites = await businessInviteService.listBusinessInvites(sellerId);
    res.json({ success: true, data: invites });
  } catch (err) {
    logger.error(`[${CTRL}] listInvites: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

// POST /api/marketplace/business-invite/:token/accept
async function acceptInvite(req, res) {
  try {
    const { token } = req.params;
    if (!token) return res.status(400).json({ success: false, message: 'Token é obrigatório' });

    const member = await businessInviteService.acceptBusinessInvite(token, req.user.uid);
    res.json({ success: true, data: member });
  } catch (err) {
    logger.error(`[${CTRL}] acceptInvite: ${err.message}`);
    const status = err.message.includes('não encontrado') || err.message.includes('expirou') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
}

// GET /api/marketplace/business-invite/:token — info pública do convite (landing page)
async function getInviteInfo(req, res) {
  try {
    const { token } = req.params;
    if (!token) return res.status(400).json({ success: false, message: 'Token é obrigatório' });

    const invite = await businessInviteService.getInviteByToken(token);
    if (!invite) {
      return res.status(404).json({ success: false, message: 'Convite não encontrado ou expirado.' });
    }
    res.json({ success: true, data: invite });
  } catch (err) {
    logger.error(`[${CTRL}] getInviteInfo: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

// DELETE /api/marketplace/seller/:sellerId/invites/:inviteId — cancelar convite
async function cancelInvite(req, res) {
  try {
    const { inviteId } = req.params;
    if (!inviteId) return res.status(400).json({ success: false, message: 'inviteId é obrigatório' });

    const result = await businessInviteService.cancelBusinessInvite(inviteId, req.user.uid);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error(`[${CTRL}] cancelInvite: ${err.message}`);
    const status = err.message.includes('não encontrado') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
}

module.exports = {
  createInvite,
  listInvites,
  acceptInvite,
  getInviteInfo,
  cancelInvite,
};
