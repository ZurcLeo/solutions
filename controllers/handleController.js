'use strict';

const handleService = require('../services/handleService');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

/**
 * GET /api/public/handle/:handle?type=user|seller
 * Resolves a handle to owner info. Public endpoint (no auth).
 * Returns: { found, id, type, handle, redirect?, currentHandle? }
 */
exports.resolveHandle = async (req, res) => {
  try {
    const { handle } = req.params;
    const { type } = req.query; // 'user' or 'seller'

    if (!handle || !type || !['user', 'seller'].includes(type)) {
      return res.status(400).json({ success: false, message: 'handle and type (user|seller) required' });
    }

    const result = await handleService.resolveHandle(handle, type);

    if (!result) {
      return res.status(404).json({ success: false, message: 'Handle not found' });
    }

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    logger.error('Error resolving handle', { service: 'handleController', handle: req.params.handle, error: error.message });
    return res.status(500).json({ success: false, message: 'Internal error' });
  }
};

/**
 * GET /api/public/handle/user/:handle/profile
 * Returns minimal public profile for a user handle. Public endpoint.
 */
exports.getPublicUserProfile = async (req, res) => {
  try {
    const { handle } = req.params;
    const sb = getSupabaseClient();

    // 1. Try resolving as user handle (users.username)
    const result = await handleService.resolveHandle(handle, 'user');

    if (result?.redirect) {
      return res.status(301).json({ success: true, redirect: true, currentHandle: result.currentHandle });
    }

    let userId = result?.found ? result.id : null;

    // 2. Fallback: try seller_profiles.username → resolve to owner user_id
    //    Handles are unified namespace, but /u/ should also resolve seller owners
    if (!userId) {
      const { data: seller } = await sb
        .from('seller_profiles')
        .select('user_id, username')
        .eq('username', handle.toLowerCase())
        .maybeSingle();

      if (seller?.user_id) {
        userId = seller.user_id;
      }
    }

    // 3. Check handle_history redirect (already done by resolveHandle, but handle seller redirects too)
    if (!userId) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Fetch minimal public data
    const { data: user } = await sb
      .from('users')
      .select('id, username, full_name, avatar_url, descricao, created_at')
      .eq('id', userId)
      .maybeSingle();

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    return res.status(200).json({ success: true, data: user });
  } catch (error) {
    logger.error('Error fetching public profile', { service: 'handleController', handle: req.params.handle, error: error.message });
    return res.status(500).json({ success: false, message: 'Internal error' });
  }
};
