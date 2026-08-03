// backend/eloscloudapp/controllers/userReadinessController.js
// GATE-A — Progressive Feature Unlocking

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const CTRL = 'userReadinessController';

// Mapa de gates requeridos por funcionalidade
const FEATURE_GATES = {
  marketplace:  ['PROFILE_COMPLETE', 'ADDRESS_COMPLETE'],
  caixinha:     ['KYC_VERIFIED', 'PAYMENT_READY'],
  seller:       ['PROFILE_COMPLETE', 'ADDRESS_COMPLETE', 'KYC_VERIFIED', 'PAYMENT_READY'],
  delivery:     ['KYC_VERIFIED', 'PAYMENT_READY'],
  juridico:     ['JURIDICO_ELIGIBLE'],
  games_create: ['PROFILE_COMPLETE', 'ADDRESS_COMPLETE', 'KYC_VERIFIED'],
  games_join:   ['PROFILE_COMPLETE', 'KYC_VERIFIED'],
};

/**
 * GET /api/user/readiness
 * Retorna os 5 gates de prontidão do usuário autenticado.
 * Não requer KYC — é justamente esse endpoint que informa o que falta.
 */
const getReadiness = async (req, res) => {
  try {
    const userId = req.user.uid;
    const sb = getSupabaseClient();

    const { data, error } = await sb.rpc('get_user_readiness', { p_user_id: userId });

    if (error) {
      logger.error('Erro ao chamar RPC get_user_readiness', { service: CTRL, userId, error: error.message });
      return res.status(500).json({ success: false, error: 'Erro ao calcular prontidão do perfil' });
    }

    logger.info('Readiness calculado', { service: CTRL, userId, gates: data });
    res.json({ success: true, data });
  } catch (err) {
    logger.error('Erro inesperado em getReadiness', { service: CTRL, error: err.message });
    res.status(500).json({ success: false, error: 'Erro interno ao calcular prontidão' });
  }
};

/**
 * GET /api/user/pending-actions
 * Retorna ações pendentes do usuário (convites de caixinha, etc.)
 * cruzadas com os gates que ainda faltam para executá-las.
 */
const getPendingActions = async (req, res) => {
  try {
    const userId = req.user.uid;
    const sb = getSupabaseClient();

    // 1. Buscar readiness atual do usuário
    const { data: readiness, error: readinessError } = await sb.rpc('get_user_readiness', {
      p_user_id: userId,
    });

    if (readinessError) {
      logger.error('Erro ao buscar readiness em getPendingActions', {
        service: CTRL, userId, error: readinessError.message,
      });
      return res.status(500).json({ success: false, error: 'Erro ao verificar prontidão do perfil' });
    }

    // 2. Buscar convites de caixinha pendentes onde o usuário é o target
    const { data: caixinhaInvites, error: invitesError } = await sb
      .from('caixinha_invites')
      .select('id, caixinha_id, sender_id, message, created_at, expires_at')
      .eq('target_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (invitesError) {
      logger.error('Erro ao buscar convites de caixinha', {
        service: CTRL, userId, error: invitesError.message,
      });
      return res.status(500).json({ success: false, error: 'Erro ao buscar convites pendentes' });
    }

    // 3. Para cada convite, calcular quais gates estão faltando
    const requiredForCaixinha = FEATURE_GATES.caixinha;
    const pendingActions = (caixinhaInvites || []).map((invite) => {
      const missingGates = requiredForCaixinha.filter((gate) => !readiness[gate]);
      const missingItems = (readiness.missingItems || []).filter((item) =>
        missingGates.includes(item.gate)
      );

      return {
        type:          'caixinha_invite',
        id:            invite.id,
        caixinhaId:    invite.caixinha_id,
        senderId:      invite.sender_id,
        message:       invite.message,
        createdAt:     invite.created_at,
        expiresAt:     invite.expires_at,
        requiredGates: requiredForCaixinha,
        missingGates,
        missingItems,
        isReady:       missingGates.length === 0,
      };
    });

    logger.info('Pending actions calculadas', {
      service: CTRL, userId, count: pendingActions.length,
    });

    res.json({
      success: true,
      data: {
        readiness,
        pendingActions,
        hasPendingActions: pendingActions.length > 0,
      },
    });
  } catch (err) {
    logger.error('Erro inesperado em getPendingActions', { service: CTRL, error: err.message });
    res.status(500).json({ success: false, error: 'Erro interno ao buscar ações pendentes' });
  }
};

module.exports = { getReadiness, getPendingActions, FEATURE_GATES };
