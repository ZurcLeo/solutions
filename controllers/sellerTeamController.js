/**
 * @fileoverview sellerTeamController — Thin controllers para equipe de loja
 * Joi validation + delegação para sellerTeamService
 */

'use strict';

const Joi = require('joi');
const sellerTeamService = require('../services/sellerTeamService');
const { logger } = require('../logger');

const CTRL = 'sellerTeamController';

// ──────────────────────────────────────────────────────
// Schemas de validação
// ──────────────────────────────────────────────────────

const inviteSchema = Joi.object({
  email:       Joi.string().email().required(),
  name:        Joi.string().trim().max(100).optional(),
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

const updateRoleSchema = Joi.object({
  role:        Joi.string().valid('manager', 'employee'),
  permissions: Joi.object({
    can_manage_clients:    Joi.boolean(),
    can_manage_pendencias: Joi.boolean(),
    can_view_financials:   Joi.boolean(),
    can_manage_team:       Joi.boolean(),
    can_manage_catalog:    Joi.boolean(),
    can_manage_orders:     Joi.boolean(),
    can_manage_settings:   Joi.boolean(),
    can_manage_billing:    Joi.boolean(),
  }),
}).or('role', 'permissions');

// ──────────────────────────────────────────────────────
// Handlers
// ──────────────────────────────────────────────────────

async function listTeamMembers(req, res) {
  try {
    const sellerId = req.sellerContext?.sellerId;
    if (!sellerId) return res.status(403).json({ success: false, message: 'Seller context não encontrado' });

    const members = await sellerTeamService.listTeamMembers(sellerId);
    res.json({ success: true, data: members });
  } catch (err) {
    logger.error(`[${CTRL}] listTeamMembers: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function inviteTeamMember(req, res) {
  try {
    const sellerId = req.sellerContext?.sellerId;
    if (!sellerId) return res.status(403).json({ success: false, message: 'Seller context não encontrado' });

    const { error: valErr, value } = inviteSchema.validate(req.body);
    if (valErr) return res.status(400).json({ success: false, message: valErr.details[0].message });

    const member = await sellerTeamService.inviteMember(
      sellerId, req.user.uid, value.email, value.role, value.permissions, value.name,
    );
    res.status(201).json({ success: true, data: member });
  } catch (err) {
    logger.error(`[${CTRL}] inviteTeamMember: ${err.message}`);
    const status = err.message.includes('Permissão') || err.message.includes('possível') ? 403
                 : err.message.includes('não encontrado') || err.message.includes('já é membro') ? 400
                 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
}

async function acceptInvite(req, res) {
  try {
    const { sellerId } = req.params;
    if (!sellerId) return res.status(400).json({ success: false, message: 'sellerId é obrigatório' });

    const member = await sellerTeamService.acceptInvite(sellerId, req.user.uid);
    res.json({ success: true, data: member });
  } catch (err) {
    logger.error(`[${CTRL}] acceptInvite: ${err.message}`);
    const status = err.message.includes('não encontrado') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
}

async function removeTeamMember(req, res) {
  try {
    const sellerId = req.sellerContext?.sellerId;
    if (!sellerId) return res.status(403).json({ success: false, message: 'Seller context não encontrado' });

    const { userId } = req.params;
    if (!userId) return res.status(400).json({ success: false, message: 'userId é obrigatório' });

    const result = await sellerTeamService.removeMember(sellerId, req.user.uid, userId);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error(`[${CTRL}] removeTeamMember: ${err.message}`);
    const status = err.message.includes('possível') ? 403 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
}

async function updateTeamMemberRole(req, res) {
  try {
    const sellerId = req.sellerContext?.sellerId;
    if (!sellerId) return res.status(403).json({ success: false, message: 'Seller context não encontrado' });

    const { userId } = req.params;
    if (!userId) return res.status(400).json({ success: false, message: 'userId é obrigatório' });

    const { error: valErr, value } = updateRoleSchema.validate(req.body);
    if (valErr) return res.status(400).json({ success: false, message: valErr.details[0].message });

    const result = await sellerTeamService.updateMemberRole(
      sellerId, req.user.uid, userId, value.role, value.permissions,
    );
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error(`[${CTRL}] updateTeamMemberRole: ${err.message}`);
    const status = err.message.includes('possível') ? 403 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
}

async function getMyPendingInvites(req, res) {
  try {
    const invites = await sellerTeamService.getMyPendingInvites(req.user.uid);
    res.json({ success: true, data: invites });
  } catch (err) {
    logger.error(`[${CTRL}] getMyPendingInvites: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function declineInvite(req, res) {
  try {
    const { sellerId } = req.params;
    if (!sellerId) return res.status(400).json({ success: false, message: 'sellerId é obrigatório' });

    const result = await sellerTeamService.declineInvite(sellerId, req.user.uid);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error(`[${CTRL}] declineInvite: ${err.message}`);
    const status = err.message.includes('não encontrado') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
}

async function leaveTeam(req, res) {
  try {
    const sellerId = req.sellerContext?.sellerId;
    if (!sellerId) return res.status(403).json({ success: false, message: 'Seller context não encontrado' });

    const result = await sellerTeamService.leaveTeam(sellerId, req.user.uid);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error(`[${CTRL}] leaveTeam: ${err.message}`);
    const status = err.message.includes('Owner') ? 403
                 : err.message.includes('não é membro') ? 404
                 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
}

module.exports = {
  listTeamMembers,
  inviteTeamMember,
  acceptInvite,
  declineInvite,
  removeTeamMember,
  leaveTeam,
  updateTeamMemberRole,
  getMyPendingInvites,
};
