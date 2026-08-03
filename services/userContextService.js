/**
 * @fileoverview User Context Service — Composição para IconChat E1
 *
 * Agrega contexto global do usuário (identidade, trust passport, gamificação,
 * selos, papel buyer/seller) para o system prompt da IA no IconChat.
 *
 * REGRA: NÃO duplica queries. Reutiliza trustPassportService e gamificationService.
 * Usa Promise.allSettled para degradação parcial — módulo falho vem null, não 500.
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');
const trustPassportService = require('./trustPassportService');
const gamificationService = require('./gamificationService');

const TAG = 'userContextService';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

// ---------------------------------------------------------------------------
// Funções internas (apenas queries que NÃO existem em services)
// ---------------------------------------------------------------------------

async function _fetchUser(userId) {
  const { data, error } = await sb()
    .from('users')
    .select('id, full_name, avatar_url, created_at')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data; // null se não encontrado
}

async function _fetchBuyerSummary(userId) {
  // Count de pedidos ativos
  const { count: activeCount, error: countErr } = await sb()
    .from('marketplace_orders')
    .select('id', { count: 'exact', head: true })
    .eq('buyer_id', userId)
    .in('status', ['pending', 'paid', 'in_progress']);

  if (countErr) throw countErr;

  // Último pedido (qualquer status)
  const { data: lastOrders, error: lastErr } = await sb()
    .from('marketplace_orders')
    .select('id, status, total_brl, created_at, seller:seller_id(business_name)')
    .eq('buyer_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (lastErr) throw lastErr;

  const last = lastOrders?.[0] || null;

  return {
    activeOrdersCount: activeCount || 0,
    lastOrder: last ? {
      orderId: last.id,
      storeName: last.seller?.business_name || null,
      status: last.status,
      createdAt: last.created_at,
    } : null,
  };
}

async function _fetchSellerSummary(userId) {
  // 1. Negócio próprio
  const { data: ownSeller, error: ownErr } = await sb()
    .from('seller_profiles')
    .select('id, business_name, category')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();

  if (ownErr) throw ownErr;

  // 2. Negócios onde é membro da equipe (manager/employee)
  const { data: teamRows, error: teamErr } = await sb()
    .from('seller_team_members')
    .select('role, seller:seller_id(id, business_name, category)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('active', true);

  if (teamErr) throw teamErr;

  // Filtra memberships que não são do negócio próprio (evita duplicar owner)
  const ownId = ownSeller?.id || null;
  const teamMemberships = (teamRows || [])
    .filter(r => r.seller && r.role !== 'owner' && r.seller.id !== ownId)
    .map(r => ({
      sellerId: r.seller.id,
      storeName: r.seller.business_name,
      category: r.seller.category,
      role: r.role,
    }));

  if (!ownSeller && teamMemberships.length === 0) {
    return { isSeller: false, businesses: [] };
  }

  // 3. Pedidos pendentes do negócio próprio (se existir)
  let pendingCount = 0;
  if (ownSeller) {
    const { count, error: countErr } = await sb()
      .from('marketplace_orders')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', ownSeller.id)
      .in('status', ['pending', 'paid', 'in_progress']);

    if (countErr) throw countErr;
    pendingCount = count || 0;
  }

  // 4. Montar lista unificada de negócios
  const businesses = [];

  if (ownSeller) {
    businesses.push({
      sellerId: ownSeller.id,
      storeName: ownSeller.business_name,
      category: ownSeller.category,
      role: 'owner',
      pendingOrdersCount: pendingCount,
    });
  }

  for (const tm of teamMemberships) {
    businesses.push({
      ...tm,
      pendingOrdersCount: null, // contagem sob demanda — evita N+1
    });
  }

  return {
    isSeller: true,
    // Backward compat: seller principal = negócio próprio OU primeiro da equipe
    sellerId: ownSeller?.id || teamMemberships[0]?.sellerId,
    storeName: ownSeller?.business_name || teamMemberships[0]?.storeName,
    category: ownSeller?.category || teamMemberships[0]?.category,
    pendingOrdersCount: pendingCount,
    businesses,
  };
}

// ---------------------------------------------------------------------------
// Capability → module mapping (WA-1.5)
// ---------------------------------------------------------------------------

/**
 * Capabilities válidas que podem ser solicitadas via ?capabilities=
 * Mapping: capability_name → módulo(s) que precisa ser fetched
 *
 * - user_basic: sempre incluído (identidade mínima)
 * - trust_passport: trustPassport (requer passportService)
 * - gamification: gamification stats (requer gamificationService)
 * - seals: selos pinned (requer gamificationService — mesmo fetch que gamification)
 * - buyer_orders: resumo de pedidos como comprador
 * - seller_orders: resumo como vendedor (negócio próprio + pendentes)
 * - multi_business: lista de negócios (subconjunto de seller fetch)
 * - employee_stores: lojas onde é funcionário (subconjunto de seller fetch)
 */
const VALID_CAPABILITIES = new Set([
  'trust_passport',
  'gamification',
  'seals',
  'buyer_orders',
  'seller_orders',
  'multi_business',
  'employee_stores',
  'user_basic', // always included, but accepted for explicitness
]);

/**
 * Determina quais módulos de dados precisam ser buscados com base nas capabilities.
 * @param {string[]|null} requestedCapabilities - null = tudo
 * @returns {{ needPassport: boolean, needGamification: boolean, needBuyer: boolean, needSeller: boolean }}
 */
function _resolveModules(requestedCapabilities) {
  // Null/undefined = backwards compat, busca tudo
  if (!requestedCapabilities || requestedCapabilities.length === 0) {
    return { needPassport: true, needGamification: true, needBuyer: true, needSeller: true };
  }

  const caps = new Set(requestedCapabilities);

  return {
    needPassport: caps.has('trust_passport'),
    // gamification e seals compartilham o mesmo fetch
    needGamification: caps.has('gamification') || caps.has('seals'),
    needBuyer: caps.has('buyer_orders'),
    // seller_orders, multi_business e employee_stores todos dependem do fetch de seller
    needSeller: caps.has('seller_orders') || caps.has('multi_business') || caps.has('employee_stores'),
  };
}

// ---------------------------------------------------------------------------
// Função principal
// ---------------------------------------------------------------------------

/**
 * Retorna contexto global do usuário para o system prompt do IconChat.
 *
 * WA-1.5: Aceita requestedCapabilities para minimizar dados retornados (LGPD).
 * Se omitido, retorna tudo (backwards compatible).
 *
 * @param {string} userId - Firebase UID
 * @param {string[]|null} [requestedCapabilities=null] - Lista de capabilities solicitadas
 * @returns {object|null} null se userId não existe (controller retorna 404)
 */
async function getUserContext(userId, requestedCapabilities = null) {
  // 1. User básico PRIMEIRO — se não existe, abort (404)
  const user = await _fetchUser(userId);
  if (!user) return null;

  // 2. Resolver quais módulos buscar com base nas capabilities
  const { needPassport, needGamification, needBuyer, needSeller } = _resolveModules(requestedCapabilities);

  // 3. Promise.allSettled apenas para módulos necessários (skip = resolve(null))
  const [passportResult, gamResult, buyerResult, sellerResult] = await Promise.allSettled([
    needPassport ? trustPassportService.getPublicPassport(userId) : Promise.resolve(null),
    needGamification ? gamificationService.getUserGamification(userId) : Promise.resolve(null),
    needBuyer ? _fetchBuyerSummary(userId) : Promise.resolve(null),
    needSeller ? _fetchSellerSummary(userId) : Promise.resolve(null),
  ]);

  // 4. Extrair resultados com fallback null
  const passport = _unwrap(passportResult, 'trustPassport');
  const gamData = _unwrap(gamResult, 'gamification');
  const buyer = _unwrap(buyerResult, 'buyer');
  const seller = _unwrap(sellerResult, 'seller');

  // 5. Montar trustPassport
  const trustPassport = passport ? {
    trustLevel: passport.trust_level,
    levelName: passport.level_name,
    activeDomains: passport.active_domains || [],
    validators: (passport.validators || []).map(v => ({
      key: v.key,
      label: v.label,
      domain: v.domain,
    })),
  } : null;

  // 6. Montar gamification (subset leve — sem tasks inteiro)
  const gam = gamData?.gamification;
  const gamification = gam ? {
    level: gam.current_level,
    levelName: gam.level_name,
    totalXp: gam.total_xp,
    xpNextLevel: gam.xp_next_level,
    eloCoins: gam.elo_coins,
    streakDays: gam.streak_days,
    tasksCompleted: gam.tasks_completed,
    selosEarned: gam.selos_earned,
  } : null;

  // 7. Montar seals (pinned first, max 5)
  const allSelos = gamData?.selos || [];
  const pinnedSelos = allSelos
    .filter(s => s.is_pinned)
    .slice(0, 5)
    .map(s => ({
      slug: s.slug,
      name: s.name,
      tier: s.tier,
      iconUrl: s.icon_url,
    }));

  const seals = gamData ? {
    total: allSelos.length,
    pinned: pinnedSelos,
  } : null;

  // 8. employeeStores — lojas onde o usuário é funcionário (não owner)
  const employeeStores = (seller?.businesses || [])
    .filter(b => b.role !== 'owner')
    .map(b => ({ storeId: b.sellerId, storeName: b.storeName }));

  // 9. Capabilities — lista módulos com dados válidos (sempre presente na resposta)
  const capabilities = [];
  if (trustPassport) capabilities.push('trust_passport');
  if (gamification) capabilities.push('gamification');
  if (seals) capabilities.push('seals');
  if (buyer) capabilities.push('buyer_orders');
  if (seller?.isSeller) capabilities.push('seller_orders');
  if (seller?.businesses?.length > 1) capabilities.push('multi_business');
  if (employeeStores.length > 0) capabilities.push('employee_stores');

  // 10. Montar resposta — incluir apenas módulos solicitados
  const isFiltered = requestedCapabilities && requestedCapabilities.length > 0;
  const requestedSet = isFiltered ? new Set(requestedCapabilities) : null;

  const response = {
    // user_basic: SEMPRE incluído
    user: {
      userId: user.id,
      displayName: user.full_name,
      avatarUrl: user.avatar_url,
      memberSince: user.created_at,
    },
    // capabilities: SEMPRE incluído (lista real do que o user TEM, não o que foi pedido)
    capabilities,
  };

  // Módulos condicionais — incluídos se não filtrado OU se foi solicitado
  if (!isFiltered || requestedSet.has('trust_passport')) {
    response.trustPassport = trustPassport;
  }
  if (!isFiltered || requestedSet.has('gamification')) {
    response.gamification = gamification;
  }
  if (!isFiltered || requestedSet.has('seals')) {
    response.seals = seals;
  }
  if (!isFiltered || requestedSet.has('buyer_orders')) {
    response.buyer = buyer || { activeOrdersCount: 0, lastOrder: null };
  }
  if (!isFiltered || requestedSet.has('seller_orders') || requestedSet.has('multi_business')) {
    response.seller = seller || { isSeller: false };
  }
  if (!isFiltered || requestedSet.has('employee_stores')) {
    response.employeeStores = employeeStores;
  }

  return response;
}

/**
 * Extrai valor de Promise.allSettled, logando erros sem propagar.
 */
function _unwrap(result, moduleName) {
  if (result.status === 'fulfilled') return result.value;
  logger.error(`[${TAG}] Módulo ${moduleName} falhou (degradação parcial)`, {
    error: result.reason?.message || String(result.reason),
  });
  return null;
}

// ---------------------------------------------------------------------------
// Buyer Context — endpoint E2 (GET /api/icon/users/:userId/buyer-context)
// ---------------------------------------------------------------------------

function _shortId(id) {
  if (!id) return null;
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}

function _maskPhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return phone;
  const ddi = digits.startsWith('55') ? '+55' : '+';
  const rest = digits.startsWith('55') ? digits.slice(2) : digits;
  const ddd = rest.slice(0, 2);
  const first = rest.slice(2, 3);
  const last4 = rest.slice(-4);
  return `${ddi}${ddd}${first}****${last4}`;
}

function _buildItemsSummary(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items.map(i => `${i.qty || 1}x ${i.name}`).join(' + ');
}

/**
 * Retorna contexto de comprador para o operador IconChat.
 * Seller omitido por privacidade — operador vê pedidos sem saber a loja.
 * @param {string} userId - Firebase UID
 * @returns {object|null} null se userId não existe (controller retorna 404)
 */
async function getBuyerContext(userId) {
  const { data: user, error: userErr } = await sb()
    .from('users')
    .select('id, full_name, telefone')
    .eq('id', userId)
    .maybeSingle();

  if (userErr) throw userErr;
  if (!user) return null;

  const [ordersResult, pendenciasResult] = await Promise.allSettled([
    sb()
      .from('marketplace_orders')
      .select('id, status, total_brl, created_at, fulfillment_type, scheduled_at, items')
      .eq('buyer_id', userId)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data, error }) => { if (error) throw error; return data || []; }),
    Promise.resolve([]), // pendencias — stub para expansão futura
  ]);

  const allOrders = _unwrap(ordersResult, 'buyerContext.orders') || [];
  const pendencias = _unwrap(pendenciasResult, 'buyerContext.pendencias') || [];

  // Pedidos com scheduled_at futuro = agendamentos
  const now = new Date().toISOString();
  const orders = [];
  const agendamentos = [];

  for (const o of allOrders) {
    const mapped = {
      id: o.id,
      shortId: _shortId(o.id),
      status: o.status,
      total: Number(o.total_brl),
      createdAt: o.created_at,
      deliveryType: o.fulfillment_type || 'pickup',
      itemsSummary: _buildItemsSummary(o.items),
    };

    if (o.scheduled_at && o.scheduled_at > now && o.status !== 'cancelled' && o.status !== 'delivered') {
      agendamentos.push({ ...mapped, scheduledAt: o.scheduled_at });
    } else {
      orders.push(mapped);
    }
  }

  return {
    customer: {
      name: user.full_name || null,
      phoneMasked: _maskPhone(user.telefone),
    },
    orders,
    agendamentos,
    pendencias,
  };
}

module.exports = {
  getUserContext,
  getBuyerContext,
  VALID_CAPABILITIES,
};
