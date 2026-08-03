'use strict';

// controllers/gamesController.js
// JOGOS-BACK-006 — Controller do módulo de Jogos
// Prefixo de rotas: /api/games

const Joi                   = require('joi');
const { logger }            = require('../logger');
const gamesService          = require('../services/gamesService');
const selectionListService  = require('../services/selectionListService');
const secretFriendService   = require('../services/secretFriendService');
const raffleGamesService    = require('../services/raffleGamesService');

const SERVICE = 'gamesController';

function logError(fn, err, extra = {}) {
  logger.error(`[${SERVICE}] ${fn}: ${err.message}`, {
    service: SERVICE, function: fn, error: err.message, ...extra,
  });
}

// ──────────────────────────────────────────────────────
// Schemas de validação
// ──────────────────────────────────────────────────────

const createGameSchema = Joi.object({
  game_type:            Joi.string().valid('SELECTION_LIST','RAFFLE','SECRET_FRIEND','BOLAO','QUIZ','CHALLENGE').required(),
  title:                Joi.string().min(3).max(120).required(),
  description:          Joi.string().max(500).optional().allow('', null),
  config:               Joi.object().optional().default({}),
  // Rifa
  ticket_price:         Joi.number().positive().precision(2).optional().allow(null),
  ticket_count:         Joi.number().integer().positive().optional().allow(null),
  prize_description:    Joi.string().max(300).optional().allow('', null),
  // Amigo Oculto
  suggested_gift_value: Joi.number().positive().precision(2).optional().allow(null),
  gift_value_mode:      Joi.string().valid('fixed','suggested','free').optional().default('suggested'),
  // Bolão — custo por palpite (ElosCoins)
  entry_cost:           Joi.number().integer().min(10).max(50).optional().allow(null),
  // Datas
  registration_deadline: Joi.string().isoDate().optional().allow(null),
  draw_at:              Joi.string().isoDate().optional().allow(null),
  // Participação do criador
  owner_participates:   Joi.boolean().optional().default(false),
  // Vinculação a caixinha (opcional, requer admin)
  caixinha_id:          Joi.string().optional().allow(null),
});

const updateGameSchema = Joi.object({
  title:                Joi.string().min(3).max(120).optional(),
  description:          Joi.string().max(500).optional().allow('', null),
  config:               Joi.object().optional(),
  ticket_price:         Joi.number().positive().precision(2).optional().allow(null),
  ticket_count:         Joi.number().integer().positive().optional().allow(null),
  prize_description:    Joi.string().max(300).optional().allow('', null),
  suggested_gift_value: Joi.number().positive().precision(2).optional().allow(null),
  gift_value_mode:      Joi.string().valid('fixed','suggested','free').optional(),
  registration_deadline: Joi.string().isoDate().optional().allow(null),
  draw_at:              Joi.string().isoDate().optional().allow(null),
}).min(1);

const associateSchema = Joi.object({
  caixinha_id: Joi.string().min(1).required(),
});

const addItemSchema = Joi.object({
  label:         Joi.string().min(1).max(200).required(),
  description:   Joi.string().max(500).optional().allow('', null),
  display_order: Joi.number().integer().min(0).optional().default(0),
});

const VALID_CATEGORY_SLUGS = [
  'alimentacao', 'servicos', 'produtos', 'obra', 'evento', 'outros'
];

const addItemsBatchSchema = Joi.object({
  items: Joi.array().items(Joi.object({
    label:               Joi.string().min(1).max(200).required(),
    description:         Joi.string().max(500).optional().allow('', null),
    display_order:       Joi.number().integer().min(0).optional(),
    // Campos de intenção (opcionais)
    item_category_slug:  Joi.string().valid(...VALID_CATEGORY_SLUGS).optional().allow(null),
    item_category_label: Joi.string().max(200).optional().allow('', null),
    price_range_min:     Joi.number().precision(2).min(0).optional().allow(null),
    price_range_max:     Joi.number().precision(2).min(0).optional().allow(null),
    delivery_range_km:   Joi.number().integer().min(1).max(200).optional().allow(null),
  })).min(1).required(),
});

const proposeGiftValueSchema = Joi.object({
  proposed_value: Joi.number().positive().precision(2).required(),
});

const respondGiftProposalSchema = Joi.object({
  accepted: Joi.boolean().required(),
});

// ──────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function fail(res, message, status = 500) {
  return res.status(status).json({ success: false, message });
}

function resolveErrorStatus(err) {
  const msg = err.message || '';
  if (msg.includes('não encontrado') || msg.includes('não encontrada')) return 404;
  if (msg.includes('permissão') || msg.includes('autorizado') || msg.includes('Acesso negado')) return 403;
  if (msg.includes('incompleto') || msg.includes('Perfil') || msg.includes('Gate')) return 422;
  if (msg.includes('já foi') || msg.includes('já foram') || msg.includes('já votou')) return 409;
  if (msg.includes('requer') || msg.includes('necessário') || msg.includes('deve estar')) return 422;
  return 500;
}

// ──────────────────────────────────────────────────────
// Games — CRUD + status
// ──────────────────────────────────────────────────────

/**
 * POST /api/games
 * Cria um novo jogo.
 */
async function createGame(req, res) {
  try {
    const { error, value } = createGameSchema.validate(req.body, { abortEarly: false });
    if (error) return fail(res, error.details[0].message, 400);

    const userId = req.user.uid;
    const game = await gamesService.createGame(userId, value);
    return ok(res, game, 201);
  } catch (err) {
    logError('createGame', err, { userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * GET /api/games
 * Lista jogos do usuário autenticado.
 */
async function listMyGames(req, res) {
  try {
    const userId = req.user.uid;
    const games = await gamesService.listMyGames(userId);
    return ok(res, games);
  } catch (err) {
    logError('listMyGames', err, { userId: req.user?.uid });
    return fail(res, err.message, 500);
  }
}

/**
 * GET /api/games/:gameId
 * Retorna jogo por ID (owner ou participante).
 */
async function getGame(req, res) {
  try {
    const userId = req.user.uid;
    const { gameId } = req.params;
    const game = await gamesService.getGame(gameId, userId);
    return ok(res, game);
  } catch (err) {
    logError('getGame', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * PATCH /api/games/:gameId
 * Atualiza campos editáveis do jogo.
 */
async function updateGame(req, res) {
  try {
    const { error, value } = updateGameSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) return fail(res, error.details[0].message, 400);

    const userId = req.user.uid;
    const { gameId } = req.params;
    const updated = await gamesService.updateGame(gameId, userId, value);
    return ok(res, updated);
  } catch (err) {
    logError('updateGame', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * PATCH /api/games/:gameId/cancel
 * Cancela o jogo (soft delete — muda status para cancelled).
 */
async function cancelGame(req, res) {
  try {
    const userId = req.user.uid;
    const { gameId } = req.params;
    const game = await gamesService.cancelGame(gameId, userId);
    return ok(res, game);
  } catch (err) {
    logError('cancelGame', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * DELETE /api/games/:gameId
 * Deleta permanentemente o jogo (apenas se sem movimentação financeira).
 */
async function deleteGame(req, res) {
  try {
    const userId = req.user.uid;
    const { gameId } = req.params;
    const result = await gamesService.deleteGame(gameId, userId);
    return ok(res, result);
  } catch (err) {
    logError('deleteGame', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * PATCH /api/games/:gameId/open
 * Abre o jogo (draft → open).
 */
async function openGame(req, res) {
  try {
    const userId = req.user.uid;
    const { gameId } = req.params;
    const game = await gamesService.openGame(gameId, userId);
    return ok(res, game);
  } catch (err) {
    logError('openGame', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * PATCH /api/games/:gameId/close
 * Fecha o jogo (open → closed).
 */
async function closeGame(req, res) {
  try {
    const userId = req.user.uid;
    const { gameId } = req.params;
    const game = await gamesService.closeGame(gameId, userId);
    return ok(res, game);
  } catch (err) {
    logError('closeGame', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * PATCH /api/games/:gameId/associate
 * Associa uma caixinha ao jogo.
 */
async function associateCaixinha(req, res) {
  try {
    const { error, value } = associateSchema.validate(req.body, { abortEarly: false });
    if (error) return fail(res, error.details[0].message, 400);

    const userId = req.user.uid;
    const { gameId } = req.params;
    const game = await gamesService.associateCaixinha(gameId, userId, value.caixinha_id);
    return ok(res, game);
  } catch (err) {
    logError('associateCaixinha', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

// ──────────────────────────────────────────────────────
// Selection List
// ──────────────────────────────────────────────────────

/**
 * GET /api/games/:gameId/items
 * Lista itens da lista de seleção.
 */
async function listItems(req, res) {
  try {
    const userId = req.user.uid;
    const { gameId } = req.params;
    const items = await selectionListService.listItems(gameId, userId);
    return ok(res, items);
  } catch (err) {
    logError('listItems', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * POST /api/games/:gameId/items
 * Adiciona um item à lista.
 */
async function addItem(req, res) {
  try {
    const { error, value } = addItemSchema.validate(req.body, { abortEarly: false });
    if (error) return fail(res, error.details[0].message, 400);

    const userId = req.user.uid;
    const { gameId } = req.params;
    const item = await selectionListService.addItem(gameId, userId, value);
    return ok(res, item, 201);
  } catch (err) {
    logError('addItem', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * POST /api/games/:gameId/items/batch
 * Adiciona múltiplos itens em lote.
 */
async function addItemsBatch(req, res) {
  try {
    const { error, value } = addItemsBatchSchema.validate(req.body, { abortEarly: false });
    if (error) return fail(res, error.details[0].message, 400);

    const userId = req.user.uid;
    const { gameId } = req.params;
    const items = await selectionListService.addItemsBatch(gameId, userId, value.items);
    return ok(res, items, 201);
  } catch (err) {
    logError('addItemsBatch', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * PUT /api/games/:gameId/items
 * Substitui todos os itens da lista (delete + insert). Só em draft.
 */
async function replaceItems(req, res) {
  try {
    const { error, value } = addItemsBatchSchema.validate(req.body, { abortEarly: false });
    if (error) return fail(res, error.details[0].message, 400);

    const userId = req.user.uid;
    const { gameId } = req.params;
    const items = await selectionListService.replaceItems(gameId, userId, value.items);
    return ok(res, items);
  } catch (err) {
    logError('replaceItems', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * POST /api/games/:gameId/items/:itemId/claim
 * Participante faz claim de um item.
 */
async function claimItem(req, res) {
  try {
    const userId = req.user.uid;
    const { gameId, itemId } = req.params;
    const item = await selectionListService.claimItem(gameId, itemId, userId);
    return ok(res, item);
  } catch (err) {
    logError('claimItem', err, { gameId: req.params.gameId, itemId: req.params.itemId, userId: req.user?.uid });
    const status = err.message.includes('já foi escolhido') ? 409 : resolveErrorStatus(err);
    return fail(res, err.message, status);
  }
}

/**
 * DELETE /api/games/:gameId/items/:itemId/claim
 * Remove o claim de um item.
 */
async function unclaimItem(req, res) {
  try {
    const userId = req.user.uid;
    const { gameId, itemId } = req.params;
    const item = await selectionListService.unclaimItem(gameId, itemId, userId);
    return ok(res, item);
  } catch (err) {
    logError('unclaimItem', err, { gameId: req.params.gameId, itemId: req.params.itemId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

// ──────────────────────────────────────────────────────
// Secret Friend / Draw
// ──────────────────────────────────────────────────────

/**
 * POST /api/games/:gameId/draw
 * Realiza o sorteio. Roteado por game_type:
 *   SECRET_FRIEND → secretFriendService.drawPairs
 *   Outros tipos → 422 (JOGOS-BACK-003 para RAFFLE com PIX)
 */
async function drawGame(req, res) {
  try {
    const userId = req.user.uid;
    const { gameId } = req.params;

    // Determina o tipo do jogo para rotear corretamente
    const { getSupabaseClient } = require('../config/supabase');
    const sb = getSupabaseClient();
    const { data: game, error: gameErr } = await sb
      .from('games')
      .select('game_type')
      .eq('id', gameId)
      .maybeSingle();

    if (gameErr) throw gameErr;
    if (!game) return fail(res, 'Jogo não encontrado', 404);

    let result;
    switch (game.game_type) {
      case 'SECRET_FRIEND':
        result = await secretFriendService.drawPairs(gameId, userId);
        break;
      case 'RAFFLE':
        // JOGOS-BACK-003: sorteio de rifa com PIX Asaas
        result = await raffleGamesService.drawRaffle(gameId, userId);
        break;
      default:
        return fail(res, `Sorteio para game_type '${game.game_type}' ainda não implementado.`, 422);
    }

    return ok(res, result);
  } catch (err) {
    logError('drawGame', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * GET /api/games/:gameId/pair
 * Revela o par do usuário (Amigo Oculto).
 */
async function revealMyPair(req, res) {
  try {
    const userId = req.user.uid;
    const { gameId } = req.params;
    const pair = await secretFriendService.revealMyPair(gameId, userId);
    return ok(res, pair);
  } catch (err) {
    logError('revealMyPair', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * POST /api/games/:gameId/gift-proposal
 * Participante propõe valor de presente.
 */
async function proposeGiftValue(req, res) {
  try {
    const { error, value } = proposeGiftValueSchema.validate(req.body, { abortEarly: false });
    if (error) return fail(res, error.details[0].message, 400);

    const userId = req.user.uid;
    const { gameId } = req.params;
    const participant = await secretFriendService.proposeGiftValue(gameId, userId, value.proposed_value);
    return ok(res, participant);
  } catch (err) {
    logError('proposeGiftValue', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * PATCH /api/games/:gameId/gift-proposal/:targetUserId
 * Owner responde à proposta de valor de presente de um participante.
 */
async function respondGiftProposal(req, res) {
  try {
    const { error, value } = respondGiftProposalSchema.validate(req.body, { abortEarly: false });
    if (error) return fail(res, error.details[0].message, 400);

    const ownerUserId = req.user.uid;
    const { gameId, targetUserId } = req.params;
    const participant = await secretFriendService.respondGiftProposal(gameId, targetUserId, ownerUserId, value.accepted);
    return ok(res, participant);
  } catch (err) {
    logError('respondGiftProposal', err, { gameId: req.params.gameId, targetUserId: req.params.targetUserId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

// ──────────────────────────────────────────────────────
// Participantes — convites
// ──────────────────────────────────────────────────────

const inviteSchema = Joi.object({
  targetUserId: Joi.string().optional(),
  email:        Joi.string().email().optional(),
}).or('targetUserId', 'email');

/**
 * POST /api/games/:gameId/invites
 * Owner convida um amigo registrado (targetUserId) ou pessoa por e-mail.
 */
async function inviteParticipant(req, res) {
  try {
    const { error, value } = inviteSchema.validate(req.body, { abortEarly: false });
    if (error) return fail(res, error.details[0].message, 400);

    const inviterId  = req.user.uid;
    const { gameId } = req.params;
    const result     = await gamesService.inviteParticipant(gameId, inviterId, value);
    return ok(res, result, 201);
  } catch (err) {
    logError('inviteParticipant', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * POST /api/games/:gameId/leave
 * Participante sai voluntariamente do jogo.
 */
async function leaveGame(req, res) {
  try {
    const userId = req.user.uid;
    const { gameId } = req.params;
    const result = await gamesService.leaveGame(gameId, userId);
    return ok(res, result);
  } catch (err) {
    logError('leaveGame', err, { gameId: req.params.gameId, userId: req.user?.uid });
    const status = err.message.includes('selecionou o item') ? 422 : resolveErrorStatus(err);
    return fail(res, err.message, status);
  }
}

/**
 * DELETE /api/games/:gameId/participants/:targetUserId
 * Owner remove um participante do jogo.
 */
async function removeParticipant(req, res) {
  try {
    const ownerId = req.user.uid;
    const { gameId, targetUserId } = req.params;
    const result = await gamesService.removeParticipant(gameId, ownerId, targetUserId);
    return ok(res, result);
  } catch (err) {
    logError('removeParticipant', err, { gameId: req.params.gameId, targetUserId: req.params.targetUserId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

// ──────────────────────────────────────────────────────
// Rifa — bilhetes
// ──────────────────────────────────────────────────────

const buyTicketsSchema = Joi.object({
  ticket_numbers: Joi.array()
    .items(Joi.number().integer().positive())
    .min(1)
    .max(10)
    .required(),
});

/**
 * POST /api/games/:gameId/raffle/initialize
 * Owner inicializa bilhetes da rifa (idempotente).
 */
async function initializeRaffleTickets(req, res) {
  try {
    const userId  = req.user.uid;
    const { gameId } = req.params;
    const result  = await raffleGamesService.initializeTickets(gameId, userId);
    return ok(res, result, 201);
  } catch (err) {
    logError('initializeRaffleTickets', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * POST /api/games/:gameId/raffle/tickets/buy
 * Participante reserva bilhete e recebe QR Code PIX.
 */
async function buyRaffleTicket(req, res) {
  try {
    const { error, value } = buyTicketsSchema.validate(req.body, { abortEarly: false });
    if (error) return fail(res, error.details[0].message, 400);

    const userId  = req.user.uid;
    const { gameId } = req.params;
    const result  = await raffleGamesService.buyTicketsBatch(gameId, userId, value.ticket_numbers);
    return ok(res, result, 201);
  } catch (err) {
    logError('buyRaffleTicket', err, { gameId: req.params.gameId, userId: req.user?.uid });
    const status = err.message.includes('já reservado') ? 409 : resolveErrorStatus(err);
    return fail(res, err.message, status);
  }
}

/**
 * GET /api/games/:gameId/raffle/tickets
 * Lista todos os bilhetes do jogo com visibilidade mascarada.
 */
async function getRaffleTickets(req, res) {
  try {
    const userId  = req.user.uid;
    const { gameId } = req.params;
    const tickets = await raffleGamesService.getTickets(gameId, userId);
    return ok(res, tickets);
  } catch (err) {
    logError('getRaffleTickets', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * GET /api/games/:gameId/raffle/tickets/mine
 * Lista apenas os bilhetes do usuário autenticado nesta rifa.
 */
async function getMyRaffleTickets(req, res) {
  try {
    const userId  = req.user.uid;
    const { gameId } = req.params;
    const tickets = await raffleGamesService.getMyTickets(gameId, userId);
    return ok(res, tickets);
  } catch (err) {
    logError('getMyRaffleTickets', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * GET /api/games/:gameId/items/:itemId/suggestions
 * Retorna sugestões de produtos do marketplace baseado nos campos de intenção do item.
 */
async function getItemSuggestions(req, res) {
  try {
    const userId = req.user.uid;
    const { gameId, itemId } = req.params;
    const { lat, lng } = req.query;

    const { getSupabaseClient } = require('../config/supabase');
    const sb = getSupabaseClient();

    // Verifica acesso ao jogo
    const { _requireAccess } = require('../services/gamesService');
    await _requireAccess(sb, gameId, userId);

    // Busca o item
    const { data: item, error: itemErr } = await sb
      .from('selection_list_items')
      .select('*')
      .eq('id', itemId)
      .eq('game_id', gameId)
      .maybeSingle();

    if (itemErr) throw itemErr;
    if (!item) return fail(res, 'Item não encontrado', 404);

    // Verifica se tem campos de intenção
    const hasIntent = !!(
      item.item_category_slug ||
      item.item_category_label ||
      item.price_range_min != null ||
      item.price_range_max != null
    );

    if (!hasIntent) {
      return ok(res, { suggestions: [], has_intent: false, item });
    }

    // Busca produtos via marketplace (excluindo imóveis)
    const marketplaceService = require('../services/marketplaceService');
    const { products } = await marketplaceService.listProductsNear(
      {
        lat:            lat || null,
        lng:            lng || null,
        max_browse_km:  item.delivery_range_km || 10,
      },
      { limit: 50, page: 1 }
    );

    // Post-filtrar por faixa de preço
    let suggestions = products.filter(p => {
      if (item.price_range_min != null && p.price_brl < item.price_range_min) return false;
      if (item.price_range_max != null && p.price_brl > item.price_range_max) return false;
      return true;
    });

    // Filtro textual: se tem label de categoria, filtra por nome do produto
    if (item.item_category_label) {
      const label = item.item_category_label.toLowerCase();
      suggestions = suggestions.filter(p =>
        (p.name || '').toLowerCase().includes(label) ||
        (p.description || '').toLowerCase().includes(label)
      );
    }

    // Ordena por geo_score DESC
    suggestions.sort((a, b) => (b.geo_score || 0) - (a.geo_score || 0));

    // Limita a 10 sugestões
    suggestions = suggestions.slice(0, 10);

    return ok(res, { suggestions, has_intent: true, item });
  } catch (err) {
    logError('getItemSuggestions', err, { gameId: req.params.gameId, itemId: req.params.itemId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * GET /api/games/:gameId/participants
 * Lista participantes do jogo.
 */
async function getParticipants(req, res) {
  try {
    const userId = req.user.uid;
    const { gameId } = req.params;
    const participants = await gamesService.getParticipants(gameId, userId);
    return ok(res, participants);
  } catch (err) {
    logError('getParticipants', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * POST /api/games/:gameId/invite-caixinha
 * Convida todos os membros ativos da caixinha vinculada ao jogo.
 */
async function inviteCaixinhaMembers(req, res) {
  try {
    const userId = req.user.uid;
    const { gameId } = req.params;
    const result = await gamesService.inviteCaixinhaMembers(gameId, userId);
    return ok(res, result);
  } catch (err) {
    logError('inviteCaixinhaMembers', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * GET /api/games/my-invites
 * Lista convites de jogos pendentes recebidos pelo usuário autenticado.
 */
async function getMyGameInvites(req, res) {
  try {
    const userId = req.user.uid;
    const invites = await gamesService.getMyPendingGameInvites(userId);
    return ok(res, invites);
  } catch (err) {
    logError('getMyGameInvites', err, { userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

/**
 * POST /api/games/:gameId/respond-invite
 * Aceita ou recusa um convite de jogo.
 */
async function respondToGameInvite(req, res) {
  try {
    const { gameId } = req.params;
    const { accept }  = req.body;
    if (typeof accept !== 'boolean') {
      return fail(res, 'Campo "accept" (boolean) é obrigatório', 400);
    }
    const userId = req.user.uid;
    const result = await gamesService.respondToParticipation(gameId, userId, accept);
    return ok(res, result);
  } catch (err) {
    logError('respondToGameInvite', err, { gameId: req.params.gameId, userId: req.user?.uid });
    return fail(res, err.message, resolveErrorStatus(err));
  }
}

module.exports = {
  createGame,
  listMyGames,
  getGame,
  updateGame,
  cancelGame,
  deleteGame,
  openGame,
  closeGame,
  associateCaixinha,
  inviteCaixinhaMembers,
  // Selection List
  listItems,
  replaceItems,
  addItem,
  addItemsBatch,
  claimItem,
  unclaimItem,
  getItemSuggestions,
  // Secret Friend / Draw
  drawGame,
  revealMyPair,
  proposeGiftValue,
  respondGiftProposal,
  // Rifa (RAFFLE)
  initializeRaffleTickets,
  buyRaffleTicket,
  getRaffleTickets,
  getMyRaffleTickets,
  // Participantes & Convites
  inviteParticipant,
  getParticipants,
  leaveGame,
  removeParticipant,
  getMyGameInvites,
  respondToGameInvite,
};
