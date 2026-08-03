'use strict';

// services/selectionListService.js
// JOGOS-BACK-002 — Lista de Seleção (SELECTION_LIST)
// Tabela: selection_list_items

const { logger }            = require('../logger');
const { getSupabaseClient } = require('../config/supabase');
const { _requireOwner, _requireAccess } = require('./gamesService');
const {
  emitItemClaimed,
  emitItemReleased,
} = require('../config/socket/handlers/gameHandlers');

const SERVICE = 'selectionListService';

function log(method, msg, extra = {}) {
  logger.info(`[${SERVICE}] ${method}: ${msg}`, { service: SERVICE, method, ...extra });
}

function logErr(method, err, extra = {}) {
  logger.error(`[${SERVICE}] ${method}: ${err.message}`, {
    service: SERVICE, method, error: err.message, stack: err.stack, ...extra,
  });
}

/**
 * Verifica que o jogo existe, que userId é owner e que o tipo é SELECTION_LIST.
 * Retorna o jogo.
 */
async function _requireSelectionListOwner(sb, gameId, userId) {
  const game = await _requireOwner(sb, gameId, userId);
  if (game.game_type !== 'SELECTION_LIST') {
    throw new Error('Esta operação é exclusiva para jogos do tipo SELECTION_LIST');
  }
  return game;
}

// ── Funções públicas ──────────────────────────────────────────────────────

/**
 * Adiciona um item à lista de seleção.
 * Requer: userId é owner, game_type = SELECTION_LIST
 */
const addItem = async (gameId, userId, itemData) => {
  try {
    log('addItem', 'Adicionando item', { gameId, userId });

    const sb = getSupabaseClient();
    await _requireSelectionListOwner(sb, gameId, userId);

    const { data, error } = await sb
      .from('selection_list_items')
      .insert({
        game_id:       gameId,
        label:         itemData.label,
        description:   itemData.description || null,
        display_order: itemData.display_order ?? 0,
      })
      .select()
      .single();

    if (error) throw error;

    log('addItem', 'Item adicionado', { gameId, itemId: data.id });
    return data;
  } catch (err) {
    logErr('addItem', err, { gameId, userId });
    throw err;
  }
};

/**
 * Adiciona múltiplos itens em lote.
 * Requer: userId é owner, game_type = SELECTION_LIST
 */
const addItemsBatch = async (gameId, userId, items) => {
  try {
    log('addItemsBatch', 'Adicionando itens em lote', { gameId, userId, count: items?.length });

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('A lista de itens não pode estar vazia');
    }

    const sb = getSupabaseClient();
    await _requireSelectionListOwner(sb, gameId, userId);

    const rows = items.map((item, idx) => ({
      game_id:             gameId,
      label:               item.label,
      description:         item.description || null,
      display_order:       item.display_order ?? idx,
      item_category_slug:  item.item_category_slug || null,
      item_category_label: item.item_category_label || null,
      price_range_min:     item.price_range_min ?? null,
      price_range_max:     item.price_range_max ?? null,
      delivery_range_km:   item.delivery_range_km ?? null,
    }));

    const { data, error } = await sb
      .from('selection_list_items')
      .insert(rows)
      .select();

    if (error) throw error;

    log('addItemsBatch', 'Itens adicionados em lote', { gameId, count: data?.length });
    return data || [];
  } catch (err) {
    logErr('addItemsBatch', err, { gameId, userId });
    throw err;
  }
};

/**
 * Lista itens da lista de seleção.
 * Requer: userId é owner ou participante confirmado.
 * Inclui nome do claimed_by via join com users.display_name.
 */
const listItems = async (gameId, userId) => {
  try {
    log('listItems', 'Listando itens', { gameId, userId });

    const sb = getSupabaseClient();
    await _requireAccess(sb, gameId, userId);

    const { data: items, error } = await sb
      .from('selection_list_items')
      .select('*')
      .eq('game_id', gameId)
      .order('display_order', { ascending: true });

    if (error) throw error;

    // Enriquecer com display_name de quem fez claim
    const claimedByIds = [...new Set(
      (items || []).filter(i => i.claimed_by).map(i => i.claimed_by)
    )];

    let userMap = {};
    if (claimedByIds.length > 0) {
      const { data: users, error: usersErr } = await sb
        .from('users')
        .select('id, full_name, username, avatar_url')
        .in('id', claimedByIds);

      if (!usersErr && users) {
        for (const u of users) {
          userMap[u.id] = {
            name: u.full_name || u.username || null,
            avatar_url: u.avatar_url || null,
          };
        }
      }
    }

    const enriched = (items || []).map(item => ({
      ...item,
      claimed_by_id:     item.claimed_by ?? null,
      claimed_by_name:   item.claimed_by ? (userMap[item.claimed_by]?.name || null) : null,
      claimed_by_avatar: item.claimed_by ? (userMap[item.claimed_by]?.avatar_url || null) : null,
    }));

    return enriched;
  } catch (err) {
    logErr('listItems', err, { gameId, userId });
    throw err;
  }
};

/**
 * Faz claim de um item da lista (lock otimista).
 * Requer: userId é participante confirmado.
 * Lança erro se o item já foi escolhido.
 */
const claimItem = async (gameId, itemId, userId) => {
  try {
    log('claimItem', 'Fazendo claim de item', { gameId, itemId, userId });

    const sb = getSupabaseClient();

    // Verifica que userId é participante confirmado
    const { data: part, error: partErr } = await sb
      .from('game_participants')
      .select('id')
      .eq('game_id', gameId)
      .eq('user_id', userId)
      .eq('status', 'confirmed')
      .maybeSingle();

    if (partErr) throw partErr;
    if (!part) throw new Error('Você precisa ser participante confirmado para escolher um item');

    // Lock otimista: UPDATE apenas se claimed_by IS NULL
    const { data, error, count } = await sb
      .from('selection_list_items')
      .update({ claimed_by: userId, claimed_at: new Date().toISOString() })
      .eq('id', itemId)
      .eq('game_id', gameId)
      .is('claimed_by', null)
      .select();

    if (error) throw error;

    // Se nenhuma linha foi afetada, o item já foi escolhido
    if (!data || data.length === 0) {
      throw new Error('Item já foi escolhido por outro participante');
    }

    // Gamification: fire-and-forget
    setImmediate(async () => {
      try {
        const gamificationService = require('./gamificationService');
        await gamificationService.triggerEvent('selection_item_claimed', userId);
      } catch (err) {
        logger.warn(`[${SERVICE}] Falha no trigger selection_item_claimed`, { error: err.message });
      }
    });

    // Realtime: notifica todos na room do jogo sobre o item escolhido
    // Busca display_name do claimante para enriquecer o payload
    setImmediate(async () => {
      try {
        const sb2 = getSupabaseClient();
        const { data: user } = await sb2
          .from('users')
          .select('full_name, username, avatar_url')
          .eq('id', userId)
          .maybeSingle();

        emitItemClaimed(gameId, {
          itemId,
          label: data[0].label,
          claimedBy: {
            userId,
            displayName: user?.full_name || user?.username || null,
            avatarUrl: user?.avatar_url || null,
          },
        });
      } catch (err) {
        logger.warn(`[${SERVICE}] Falha ao emitir game:item_claimed`, { error: err.message });
      }
    });

    log('claimItem', 'Claim realizado com sucesso', { gameId, itemId, userId });
    return data[0];
  } catch (err) {
    logErr('claimItem', err, { gameId, itemId, userId });
    throw err;
  }
};

/**
 * Remove o claim de um item.
 * Requer: userId é o claimed_by do item OU owner do jogo.
 */
const unclaimItem = async (gameId, itemId, userId) => {
  try {
    log('unclaimItem', 'Removendo claim de item', { gameId, itemId, userId });

    const sb = getSupabaseClient();

    // Verifica se é owner do jogo
    const { data: game, error: gameErr } = await sb
      .from('games')
      .select('owner_id')
      .eq('id', gameId)
      .maybeSingle();

    if (gameErr) throw gameErr;
    if (!game) throw new Error('Jogo não encontrado');

    const isOwner = game.owner_id === userId;

    let query = sb
      .from('selection_list_items')
      .update({ claimed_by: null, claimed_at: null })
      .eq('id', itemId)
      .eq('game_id', gameId);

    // Owner pode liberar qualquer item; participante só pode liberar o seu
    if (!isOwner) {
      query = query.eq('claimed_by', userId);
    }

    const { data, error } = await query.select();

    if (error) throw error;

    if (!data || data.length === 0) {
      throw new Error('Item não encontrado ou você não tem permissão para removê-lo');
    }

    // Realtime: notifica todos na room do jogo que o item foi liberado
    setImmediate(() => {
      try {
        emitItemReleased(gameId, itemId, data[0].label);
      } catch (err) {
        logger.warn(`[${SERVICE}] Falha ao emitir game:item_released`, { error: err.message });
      }
    });

    log('unclaimItem', 'Claim removido', { gameId, itemId, userId });
    return data[0];
  } catch (err) {
    logErr('unclaimItem', err, { gameId, itemId, userId });
    throw err;
  }
};

/**
 * Substitui TODOS os itens da lista (delete + insert atômico).
 * Só funciona em jogos com status 'draft' (sem claims possíveis).
 * Requer: userId é owner e game_type = SELECTION_LIST.
 */
const replaceItems = async (gameId, userId, items) => {
  try {
    log('replaceItems', 'Substituindo itens', { gameId, userId, count: items?.length });

    const sb = getSupabaseClient();
    const game = await _requireSelectionListOwner(sb, gameId, userId);

    if (game.status !== 'draft') {
      throw new Error("Substituição de itens só é permitida em jogos com status 'rascunho'");
    }

    // Remove todos os itens existentes
    const { error: deleteErr } = await sb
      .from('selection_list_items')
      .delete()
      .eq('game_id', gameId);

    if (deleteErr) throw deleteErr;

    // Insere novos itens (array pode ser vazio para limpar a lista)
    if (!Array.isArray(items) || items.length === 0) {
      log('replaceItems', 'Lista esvaziada', { gameId });
      return [];
    }

    const rows = items.map((item, idx) => ({
      game_id:             gameId,
      label:               item.label,
      description:         item.description || null,
      display_order:       item.display_order ?? idx,
      item_category_slug:  item.item_category_slug || null,
      item_category_label: item.item_category_label || null,
      price_range_min:     item.price_range_min ?? null,
      price_range_max:     item.price_range_max ?? null,
      delivery_range_km:   item.delivery_range_km ?? null,
    }));

    const { data, error } = await sb
      .from('selection_list_items')
      .insert(rows)
      .select();

    if (error) throw error;

    log('replaceItems', 'Itens substituídos', { gameId, count: data?.length });
    return data || [];
  } catch (err) {
    logErr('replaceItems', err, { gameId, userId });
    throw err;
  }
};

module.exports = {
  addItem,
  addItemsBatch,
  replaceItems,
  listItems,
  claimItem,
  unclaimItem,
};
