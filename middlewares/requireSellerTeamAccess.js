/**
 * @fileoverview requireSellerTeamAccess — Middleware de acesso a equipe de loja
 * Verifica se o usuário autenticado é membro ativo da equipe com role mínima.
 * Popula req.sellerContext = { sellerId, role, permissions, roleLevel }
 *
 * [BIZ-002] Suporta header X-Seller-Context para multi-business context switching.
 * Se presente: verifica que o user é member ativo desse seller → popula req.sellerContext.
 * Se ausente: fallback ao comportamento atual (owner priority, depois team member).
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const ROLE_LEVEL = { owner: 3, manager: 2, employee: 1, removed: 0 };

const OWNER_PERMISSIONS = {
  can_manage_clients: true, can_manage_pendencias: true,
  can_view_financials: true, can_manage_team: true,
  can_manage_catalog: true, can_manage_orders: true, can_manage_settings: true, can_manage_billing: true,
};

/**
 * @param {string} [minRole='employee'] - Role mínima: 'employee' | 'manager' | 'owner'
 */
const requireSellerTeamAccess = (minRole = 'employee') => async (req, res, next) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ code: 'AUTH_REQUIRED', message: 'Autenticação necessária.' });
    }

    const supabase = getSupabaseClient();
    const requestedSellerId = req.headers['x-seller-context'];

    let sellerId, role, permissions, roleLevel;

    if (requestedSellerId) {
      // ─── Explicit seller context via header ─────────────────────
      const resolved = await _resolveSellerAccess(supabase, userId, requestedSellerId);
      if (!resolved) {
        return res.status(403).json({
          code: 'SELLER_ACCESS_REQUIRED',
          message: 'Você não tem acesso a este negócio.',
        });
      }
      ({ sellerId, role, roleLevel, permissions } = resolved);
    } else {
      // ─── Legacy: auto-detect (owner priority) ──────────────────
      const resolved = await _resolveDefaultSeller(supabase, userId);
      if (!resolved) {
        return res.status(403).json({
          code: 'SELLER_ACCESS_REQUIRED',
          message: 'Você não faz parte de nenhuma equipe de loja.',
        });
      }
      ({ sellerId, role, roleLevel, permissions } = resolved);
    }

    // Verificar role mínima
    const minLevel = ROLE_LEVEL[minRole] || 0;
    if (roleLevel < minLevel) {
      return res.status(403).json({
        code: 'INSUFFICIENT_ROLE',
        message: `Requer role '${minRole}' ou superior. Sua role: '${role}'.`,
      });
    }

    // Popula contexto para uso downstream
    req.sellerContext = { sellerId, role, permissions, roleLevel };

    next();
  } catch (err) {
    logger.error('requireSellerTeamAccess: erro inesperado', { error: err.message });
    next(err);
  }
};

/**
 * Resolve acesso a um seller_id específico (via X-Seller-Context header).
 * Verifica se user é owner OU team member ativo com loja ativa.
 */
async function _resolveSellerAccess(supabase, userId, targetSellerId) {
  // Check if owner
  const { data: ownedSeller } = await supabase
    .from('seller_profiles')
    .select('id, status')
    .eq('id', targetSellerId)
    .eq('user_id', userId)
    .maybeSingle();

  if (ownedSeller) {
    // [EQP-027-FIX] Owner acessa dashboard mesmo com loja pausada (para reativar). Só bloqueia deleted.
    if (ownedSeller.status === 'deleted') return null;
    return {
      sellerId: ownedSeller.id,
      role: 'owner',
      roleLevel: ROLE_LEVEL.owner,
      permissions: { ...OWNER_PERMISSIONS },
    };
  }

  // Check if team member
  const { data: member } = await supabase
    .from('seller_team_members')
    .select('seller_id, role, permissions')
    .eq('seller_id', targetSellerId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('active', true)
    .maybeSingle();

  if (!member) return null;

  // Verify seller is active
  const { data: sellerProfile } = await supabase
    .from('seller_profiles')
    .select('status')
    .eq('id', member.seller_id)
    .maybeSingle();

  if (!sellerProfile || sellerProfile.status !== 'active') return null;

  return {
    sellerId: member.seller_id,
    role: member.role,
    roleLevel: ROLE_LEVEL[member.role] || 0,
    permissions: member.permissions || {},
  };
}

/**
 * Resolve seller por padrão (sem header). Owner tem prioridade, depois team member.
 */
async function _resolveDefaultSeller(supabase, userId) {
  // 1. Owner direto
  const { data: ownedSeller } = await supabase
    .from('seller_profiles')
    .select('id, status')
    .eq('user_id', userId)
    .maybeSingle();

  if (ownedSeller) {
    // [EQP-027-FIX] Owner acessa dashboard mesmo com loja pausada (para reativar). Só bloqueia deleted.
    if (ownedSeller.status === 'deleted') return null;
    return {
      sellerId: ownedSeller.id,
      role: 'owner',
      roleLevel: ROLE_LEVEL.owner,
      permissions: { ...OWNER_PERMISSIONS },
    };
  }

  // 2. Team member
  const { data: member, error: memErr } = await supabase
    .from('seller_team_members')
    .select('seller_id, role, permissions')
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('active', true)
    .maybeSingle();

  if (memErr || !member) return null;

  // Verify seller is active
  const { data: sellerProfile } = await supabase
    .from('seller_profiles')
    .select('status')
    .eq('id', member.seller_id)
    .maybeSingle();

  if (!sellerProfile || sellerProfile.status !== 'active') return null;

  return {
    sellerId: member.seller_id,
    role: member.role,
    roleLevel: ROLE_LEVEL[member.role] || 0,
    permissions: member.permissions || {},
  };
}

module.exports = { requireSellerTeamAccess };
