'use strict';
/**
 * @fileoverview Admin controller for managing endorsements via Claude Suporte.
 *
 * Endpoints:
 *   GET  /api/admin/endorsements          — list active endorsements
 *   POST /api/admin/endorsements          — endorse user (as Claude Suporte)
 *   POST /api/admin/endorsements/:id/revoke — revoke endorsement
 *   GET  /api/admin/endorsements/search   — search users for endorsement
 */

const { getSupabaseClient } = require('../config/supabase');
const trustPassportService = require('../services/trustPassportService');
const { logger } = require('../logger');

const CTRL = 'endorsementAdminController';
const CLAUDE_SUPORTE_ID = 'sS855lp9DwhZodxMqG7bf5cYeQ92';

/**
 * GET /api/admin/endorsements
 * Lists all endorsements made by Claude Suporte.
 */
exports.listEndorsements = async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return res.status(500).json({ success: false, message: 'DB indisponível' });

    const { data: endorsements, error } = await supabase
      .from('kyc_social_validations')
      .select('id, validator_id, validated_user_id, endorser_level_at_time, endorsement_status, validated_at')
      .eq('validator_id', CLAUDE_SUPORTE_ID)
      .order('validated_at', { ascending: false });

    if (error) {
      logger.error('Erro ao listar endorsements', { service: CTRL, error: error.message });
      return res.status(500).json({ success: false, message: error.message });
    }

    // Enrich with user data
    const userIds = (endorsements || []).map(e => e.validated_user_id);
    let usersMap = {};

    if (userIds.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('id, full_name, username, email, avatar_url, kyc_status')
        .in('id', userIds);

      if (users) {
        usersMap = Object.fromEntries(users.map(u => [u.id, u]));
      }
    }

    const enriched = (endorsements || []).map(e => {
      const user = usersMap[e.validated_user_id] || {};
      return {
        id: e.id,
        userId: e.validated_user_id,
        status: e.endorsement_status,
        endorserLevel: e.endorser_level_at_time,
        endorsedAt: e.validated_at,
        userName: user.full_name || user.username || null,
        userUsername: user.username || null,
        userEmail: user.email || null,
        userAvatar: user.avatar_url || null,
        userKyc: user.kyc_status || null,
      };
    });

    return res.status(200).json({ success: true, data: enriched, total: enriched.length });
  } catch (err) {
    logger.error('listEndorsements falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/admin/endorsements
 * Admin endorses a user via Claude Suporte.
 * Body: { userId: string }
 */
exports.endorseUser = async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, message: 'userId é obrigatório' });
  }

  if (userId === CLAUDE_SUPORTE_ID) {
    return res.status(400).json({ success: false, message: 'Claude Suporte não pode endorsar a si mesmo' });
  }

  try {
    // Verify user exists
    const supabase = getSupabaseClient();
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, full_name, username')
      .eq('id', userId)
      .maybeSingle();

    if (userErr || !user) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    }

    // Use the existing createEndorsement with Claude Suporte as endorser
    const result = await trustPassportService.createEndorsement(CLAUDE_SUPORTE_ID, userId);

    logger.info('Admin endorsement criado', {
      service: CTRL,
      endorsedUserId: userId,
      endorsedUserName: user.full_name || user.username,
      adminUserId: req.user.uid,
    });

    return res.status(201).json({
      success: true,
      message: `Endorso concedido a ${user.full_name || user.username || userId}`,
      data: result,
    });
  } catch (err) {
    logger.error('endorseUser falhou', { service: CTRL, userId, error: err.message });

    // Pass through domain-specific errors
    if (err.message.includes('já endorsou') || err.message.includes('Limite mensal')) {
      return res.status(409).json({ success: false, message: err.message });
    }

    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/admin/endorsements/:id/revoke
 * Revokes an endorsement (sets status to 'invalidated').
 */
exports.revokeEndorsement = async (req, res) => {
  const { id } = req.params;

  try {
    const supabase = getSupabaseClient();

    // Find the endorsement
    const { data: endorsement, error: findErr } = await supabase
      .from('kyc_social_validations')
      .select('id, validator_id, validated_user_id, endorsement_status')
      .eq('id', id)
      .eq('validator_id', CLAUDE_SUPORTE_ID)
      .maybeSingle();

    if (findErr || !endorsement) {
      return res.status(404).json({ success: false, message: 'Endorso não encontrado' });
    }

    if (endorsement.endorsement_status === 'invalidated') {
      return res.status(409).json({ success: false, message: 'Endorso já revogado' });
    }

    // Update status
    const { error: updateErr } = await supabase
      .from('kyc_social_validations')
      .update({ endorsement_status: 'invalidated' })
      .eq('id', id);

    if (updateErr) {
      logger.error('Erro ao revogar endorsement', { service: CTRL, id, error: updateErr.message });
      return res.status(500).json({ success: false, message: updateErr.message });
    }

    // Recalculate the endorsed user's passport
    trustPassportService.calculatePassport(endorsement.validated_user_id).catch(err =>
      logger.error('Recalc pós-revogação falhou', { service: CTRL, userId: endorsement.validated_user_id, error: err.message })
    );

    logger.info('Endorsement revogado', {
      service: CTRL,
      endorsementId: id,
      endorsedUserId: endorsement.validated_user_id,
      adminUserId: req.user.uid,
    });

    return res.status(200).json({ success: true, message: 'Endorso revogado com sucesso' });
  } catch (err) {
    logger.error('revokeEndorsement falhou', { service: CTRL, id, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/admin/endorsements/search?q=searchTerm
 * Searches users eligible for endorsement.
 */
exports.searchUsers = async (req, res) => {
  const { q } = req.query;

  if (!q || q.length < 2) {
    return res.status(400).json({ success: false, message: 'Busca requer ao menos 2 caracteres' });
  }

  try {
    const supabase = getSupabaseClient();

    const { data: users, error } = await supabase
      .from('users')
      .select('id, full_name, username, email, avatar_url, kyc_status')
      .not('email', 'like', 'pending_sync_%')
      .neq('id', CLAUDE_SUPORTE_ID)
      .or(`full_name.ilike.%${q}%,username.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(20);

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    // Check which ones already have active endorsements from Claude Suporte
    const userIds = (users || []).map(u => u.id);
    let endorsedSet = new Set();

    if (userIds.length > 0) {
      const { data: existing } = await supabase
        .from('kyc_social_validations')
        .select('validated_user_id')
        .eq('validator_id', CLAUDE_SUPORTE_ID)
        .eq('endorsement_status', 'active')
        .in('validated_user_id', userIds);

      if (existing) {
        endorsedSet = new Set(existing.map(e => e.validated_user_id));
      }
    }

    const results = (users || []).map(u => ({
      id: u.id,
      name: u.full_name || u.username || (u.email ? u.email.split('@')[0] : u.id),
      username: u.username || null,
      email: u.email || null,
      avatar: u.avatar_url || null,
      kyc: u.kyc_status || null,
      alreadyEndorsed: endorsedSet.has(u.id),
    }));

    return res.status(200).json({ success: true, data: results });
  } catch (err) {
    logger.error('searchUsers falhou', { service: CTRL, q, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};
