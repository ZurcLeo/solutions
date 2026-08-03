/**
 * @fileoverview eloCoinPackageService — ElosCloud
 * Extrato de ElosCoins via Supabase xp_events.
 *
 * NOTA (2026-07-09): Toda infraestrutura de venda de ElosCoins por PIX/Asaas
 * foi removida. ElosCoins é exclusivamente moeda de engajamento — não se compra.
 */

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const SERVICE = 'eloCoinPackageService';

// ──────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

// ──────────────────────────────────────────────────────
// Extrato do usuário — xp_events paginado
// ──────────────────────────────────────────────────────

const SOURCE_TYPE_MAP = {
  spend:           'gasto',
  boost_purchase:  'gasto',
  tip:             'gasto',
  burn:            'gasto',
  task:            'tarefa',
  daily_challenge: 'tarefa',
  selo:            'selo',
  streak_bonus:    'bonus',
  level_up_bonus:  'bonus',
  platform_grant:  'bonus',
  admin:           'admin',
  penalty:         'admin',
};

/**
 * Retorna o extrato paginado de ElosCoins do usuário.
 * @param {string} userId
 * @param {number} page   — 1-indexed
 * @param {number} limit
 */
async function getStatement(userId, page = 1, limit = 20) {
  const offset = (page - 1) * limit;

  const client = sb();

  const [eventsRes, balanceRes, countRes, totalsRes] = await Promise.all([
    client
      .from('xp_events')
      .select('id, xp_delta, coin_delta, source, source_id, description, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1),

    client
      .from('user_gamification')
      .select('elo_coins')
      .eq('user_id', userId)
      .maybeSingle(),

    client
      .from('xp_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),

    client
      .rpc('get_user_coin_totals', { p_user_id: userId })
      .single(),
  ]);

  if (eventsRes.error) throw eventsRes.error;

  const rawEvents = eventsRes.data || [];

  // Coleta source_ids de eventos que envolvem transferência entre usuários
  const giftSourceIds = rawEvents
    .filter((e) => ['gift', 'tip', 'spend'].includes(e.source) && e.source_id)
    .map((e) => e.source_id);

  // Busca gifts + dados dos dois usuários envolvidos (batch)
  let giftMap = new Map(); // source_id → { fromUser, toUser }
  if (giftSourceIds.length > 0) {
    const { data: gifts } = await client
      .from('gifts')
      .select(`
        id,
        from_user_id,
        to_user_id,
        sender:users!gifts_from_user_id_fkey(full_name, username, avatar_url),
        receiver:users!gifts_to_user_id_fkey(full_name, username, avatar_url)
      `)
      .in('id', giftSourceIds);

    for (const g of gifts || []) {
      giftMap.set(g.id, {
        fromUserId: g.from_user_id,
        toUserId:   g.to_user_id,
        sender: {
          nome:      g.sender?.full_name  || null,
          username:  g.sender?.username   || null,
          photoURL:  g.sender?.avatar_url || null,
        },
        receiver: {
          nome:      g.receiver?.full_name  || null,
          username:  g.receiver?.username   || null,
          photoURL:  g.receiver?.avatar_url || null,
        },
      });
    }
  }

  const events = rawEvents.map((e) => {
    const gift = e.source_id ? giftMap.get(e.source_id) : null;

    // Quem é o outro lado da transação?
    // coin_delta > 0 → usuário recebeu → counterpart = quem enviou (sender)
    // coin_delta < 0 → usuário enviou → counterpart = quem recebeu (receiver)
    let counterpart = null;
    if (gift) {
      counterpart = e.coin_delta > 0 ? gift.sender : gift.receiver;
    }

    return {
      id:          e.id,
      type:        SOURCE_TYPE_MAP[e.source] || 'bonus',
      label:       e.description || e.source,
      coinDelta:   e.coin_delta,
      xpDelta:     e.xp_delta,
      source:      e.source,
      date:        e.created_at,
      counterpart, // { nome, username, photoURL } | null
    };
  });

  const total          = countRes.count ?? 0;
  const currentBalance = balanceRes.data?.elo_coins ?? 0;
  const totalIn        = Number(totalsRes.data?.total_in  ?? 0);
  const totalOut       = Number(totalsRes.data?.total_out ?? 0);

  return {
    currentBalance,
    total,
    totalIn,
    totalOut,
    page,
    hasMore: offset + events.length < total,
    events,
  };
}

module.exports = {
  getStatement,
};
