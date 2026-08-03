'use strict';

const { logger } = require('../logger');
const iconChatProvisioningService = require('../services/iconChatProvisioningService');
const { getSupabaseClient } = require('../config/supabase');

const CTRL = 'iconChatProvisioningCtrl';

// ──────────────────────────────────────────────────────
// Helper: resolve seller do usuário logado
// ──────────────────────────────────────────────────────

async function _requireSeller(req) {
  const userId = req.user.uid;
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('seller_profiles')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .single();

  if (error || !data) {
    const err = new Error('Perfil de vendedor não encontrado.');
    err.statusCode = 404;
    throw err;
  }

  return data.id;
}

// ──────────────────────────────────────────────────────
// GET /seller/iconchat — status atual
// ──────────────────────────────────────────────────────

exports.getStatus = async (req, res) => {
  try {
    const userId = req.user.uid;
    const sellerId = await _requireSeller(req);
    const result = await iconChatProvisioningService.getIconChatStatus(userId, sellerId);
    return res.json({ success: true, data: result });
  } catch (err) {
    logger.warn(`[${CTRL}] getStatus: ${err.message}`, { userId: req.user?.uid });
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// POST /seller/iconchat/provision — provisionar integração
// ──────────────────────────────────────────────────────

exports.provision = async (req, res) => {
  try {
    const userId = req.user.uid;
    const sellerId = await _requireSeller(req);
    const result = await iconChatProvisioningService.provisionIconChat(userId, sellerId);
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    logger.warn(`[${CTRL}] provision: ${err.message}`, { userId: req.user?.uid });

    if (err.message === 'PREREQUISITES_NOT_MET') {
      return res.status(422).json({ success: false, error: 'PREREQUISITES_NOT_MET', checks: err.checks });
    }
    if (err.message === 'ALREADY_PROVISIONED') {
      return res.status(409).json({ success: false, error: 'ALREADY_PROVISIONED' });
    }

    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// PATCH /seller/iconchat/toggle — ativar/desativar
// ──────────────────────────────────────────────────────

exports.toggle = async (req, res) => {
  try {
    const sellerId = await _requireSeller(req);
    const result = await iconChatProvisioningService.toggleIconChat(sellerId);
    return res.json({ success: true, data: result });
  } catch (err) {
    logger.warn(`[${CTRL}] toggle: ${err.message}`, { userId: req.user?.uid });
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────
// POST /seller/iconchat/rotate-secret — rotacionar HMAC secret
// ──────────────────────────────────────────────────────

exports.rotateSecret = async (req, res) => {
  try {
    const userId = req.user.uid;
    const sellerId = await _requireSeller(req);
    const result = await iconChatProvisioningService.rotateSecret(userId, sellerId);
    return res.json({ success: true, data: result });
  } catch (err) {
    logger.warn(`[${CTRL}] rotateSecret: ${err.message}`, { userId: req.user?.uid });

    if (err.message === 'PREREQUISITES_NOT_MET') {
      return res.status(422).json({ success: false, error: 'PREREQUISITES_NOT_MET', checks: err.checks });
    }

    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};
