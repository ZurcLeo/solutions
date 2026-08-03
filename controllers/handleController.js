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
    const result = await handleService.resolveHandle(handle, 'user');

    if (!result || !result.found) {
      // Check for redirect (old handle)
      if (result?.redirect) {
        return res.status(301).json({ success: true, redirect: true, currentHandle: result.currentHandle });
      }
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // If it's a redirect result, return redirect info
    if (result.redirect) {
      return res.status(301).json({ success: true, redirect: true, currentHandle: result.currentHandle });
    }

    // Fetch minimal public data
    const sb = getSupabaseClient();
    const { data: user } = await sb
      .from('users')
      .select('id, username, full_name, avatar_url, bio, nivel, created_at')
      .eq('id', result.id)
      .maybeSingle();

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    return res.status(200).json({ success: true, data: user });
  } catch (error) {
    logger.error('Error fetching public profile', { service: 'handleController', handle: req.params.handle, error: error.message });
    return res.status(500).json({ success: false, message: 'Internal error' });
  }
};
