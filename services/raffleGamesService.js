'use strict';

/**
 * @fileoverview raffleGamesService — ElosCloud Rifa (JOGOS-BACK-003)
 *
 * Gerencia o ciclo completo de bilhetes de rifa com pagamento PIX via Asaas:
 *   owner inicializa bilhetes → participante reserva + PIX → webhook confirma →
 *   owner sorteia → ganhador notificado → jogo fechado
 *
 * Padrão de pagamento: PIX Asaas (mesmo padrão de marketplaceService.initiateOrderPayment)
 *   - asaasService.createCustomer  → cria/localiza customer por externalReference = userId
 *   - asaasService.createPixCharge → gera QR code + copia-e-cola
 *   - externalReference da cobrança: `raffle_{gameId}_ticket_{ticketNumber}`
 *   - Webhook roteia por prefixo `raffle_` → confirmPayment()
 *
 * Algoritmo de sorteio (ordem de prioridade):
 *   1. sorteioService.obterNumeroAleatorioRandomOrg  — primário (Random.org)
 *   2. sorteioService.obterNumeroAleatorioNIST       — fallback (NIST Beacon)
 *   3. Math.random()                                 — último recurso (logado como warning)
 *
 * Integração Webhook:
 *   webhookController._processAsaasEvent → prefixo `raffle_` → raffleGamesService.confirmPayment
 *
 * Lei do Time (gamification triggers):
 *   - raffle_ticket_bought  → owner_id do bilhete (confirmPayment)
 *   - raffle_drawn          → owner_id do jogo após sorteio (drawRaffle)
 *   - raffle_won            → userId do vencedor (drawRaffle)
 */

const crypto              = require('crypto');
const { getSupabaseClient } = require('../config/supabase');
const { createClient }    = require('@supabase/supabase-js');
const { logger }          = require('../logger');
const asaasService        = require('./asaasService');
const sorteioService      = require('./sorteioService');
const gamificationService = require('./gamificationService');

const SERVICE = 'raffleGamesService';

// ──────────────────────────────────────────────────────
// Helpers internos
// ──────────────────────────────────────────────────────

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

/** Supabase com service_role para bypass de RLS em operações de pagamento */
function sbService() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados.');
  return createClient(url, key, { auth: { persistSession: false } });
}

function log(fn, msg, extra = {}) {
  logger.info(msg, { service: SERVICE, function: fn, ...extra });
}

function logWarn(fn, msg, extra = {}) {
  logger.warn(msg, { service: SERVICE, function: fn, ...extra });
}

function logError(fn, err, extra = {}) {
  logger.error(`Erro em ${fn}: ${err.message}`, {
    service: SERVICE, function: fn, error: err.message, stack: err.stack, ...extra,
  });
}

/**
 * Dispara evento de gamificação de forma fire-and-forget.
 * Nunca lança exceção — falha silenciosa com log.
 */
function triggerGameEvent(event, userId) {
  setImmediate(async () => {
    try {
      await gamificationService.triggerEvent(event, userId);
    } catch (err) {
      logWarn('triggerGameEvent', `Falha no trigger ${event}`, { event, userId, error: err.message });
    }
  });
}

/**
 * Busca dados do jogo e valida que userId é owner com game_type=RAFFLE.
 * @param {object} supabase - client Supabase
 * @param {string} gameId
 * @param {string} userId
 * @returns {object} game row completo
 */
async function _requireRaffleOwner(supabase, gameId, userId) {
  const { data: game, error } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .maybeSingle();

  if (error) throw error;
  if (!game) throw new Error('Jogo não encontrado');
  if (game.game_type !== 'RAFFLE') throw new Error('Este jogo não é uma rifa (game_type ≠ RAFFLE)');
  if (game.owner_id !== userId) throw new Error('Você não tem permissão para gerenciar esta rifa');
  return game;
}

// ──────────────────────────────────────────────────────
// 1. Inicializar bilhetes
// ──────────────────────────────────────────────────────

/**
 * Gera bilhetes numerados (1 até ticket_count) para a rifa em lote.
 * Idempotente: se bilhetes já existirem, retorna a contagem sem reinserir.
 *
 * @param {string} gameId
 * @param {string} userId - deve ser o owner da rifa
 * @returns {{ created: number, alreadyInitialized: boolean }}
 */
async function initializeTickets(gameId, userId) {
  const fn = 'initializeTickets';
  log(fn, 'Inicializando bilhetes da rifa', { gameId, userId });

  const supabase = sb();
  const game = await _requireRaffleOwner(supabase, gameId, userId);

  if (!game.ticket_count || game.ticket_count < 1) {
    throw new Error('ticket_count deve ser maior que 0 para inicializar bilhetes');
  }
  if (!game.ticket_price || Number(game.ticket_price) <= 0) {
    throw new Error('ticket_price deve ser maior que 0 para inicializar bilhetes');
  }

  // Verificar idempotência: bilhetes já existem?
  const { count, error: countError } = await supabase
    .from('raffle_tickets')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', gameId);

  if (countError) throw new Error(`Erro ao verificar bilhetes: ${countError.message}`);

  if (count > 0) {
    log(fn, 'Bilhetes já inicializados — operação idempotente', { gameId, existingCount: count });
    return { created: 0, alreadyInitialized: true, totalTickets: count };
  }

  // Gerar array de bilhetes
  const tickets = [];
  for (let i = 1; i <= game.ticket_count; i++) {
    tickets.push({
      game_id:        gameId,
      ticket_number:  i,
      payment_status: 'available',
    });
  }

  // Inserir em lote (lotes de 500 para evitar payload excessivo)
  const BATCH_SIZE = 500;
  let totalCreated = 0;

  for (let start = 0; start < tickets.length; start += BATCH_SIZE) {
    const batch = tickets.slice(start, start + BATCH_SIZE);
    const { error: insertError } = await supabase
      .from('raffle_tickets')
      .insert(batch);

    if (insertError) {
      logError(fn, insertError, { gameId, batchStart: start });
      throw new Error(`Erro ao inserir bilhetes (lote ${start / BATCH_SIZE + 1}): ${insertError.message}`);
    }
    totalCreated += batch.length;
  }

  log(fn, 'Bilhetes criados com sucesso', { gameId, totalCreated });
  return { created: totalCreated, alreadyInitialized: false, totalTickets: totalCreated };
}

// ──────────────────────────────────────────────────────
// 2. Comprar bilhete (reserva + PIX)
// ──────────────────────────────────────────────────────

/**
 * Reserva um bilhete disponível e gera cobrança PIX via Asaas.
 * Usa lock otimista via UPDATE WHERE payment_status='available'.
 *
 * @param {string} gameId
 * @param {string} userId - deve ser participante confirmado do jogo
 * @param {number} ticketNumber
 * @returns {{ ticket: object, pixQrCode: string, pixCopiaECola: string, expiresAt: string }}
 */
async function buyTicket(gameId, userId, ticketNumber) {
  const fn = 'buyTicket';
  log(fn, 'Iniciando compra de bilhete', { gameId, userId, ticketNumber });

  const supabase = sb();

  // 1. Verificar que userId é participante confirmado
  const { data: participant, error: partError } = await supabase
    .from('game_participants')
    .select('status')
    .eq('game_id', gameId)
    .eq('user_id', userId)
    .maybeSingle();

  if (partError) throw new Error(`Erro ao verificar participação: ${partError.message}`);
  if (!participant || participant.status !== 'confirmed') {
    throw new Error('Você não é um participante confirmado desta rifa');
  }

  // 2. Verificar que jogo está 'open' e dentro do registration_deadline
  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('id, game_type, title, status, ticket_price, registration_deadline')
    .eq('id', gameId)
    .maybeSingle();

  if (gameError) throw new Error(`Erro ao buscar jogo: ${gameError.message}`);
  if (!game) throw new Error('Jogo não encontrado');
  if (game.game_type !== 'RAFFLE') throw new Error('Este jogo não é uma rifa');
  if (game.status !== 'open') throw new Error(`Rifa não está aberta para compra (status: ${game.status})`);

  if (game.registration_deadline) {
    const deadline = new Date(game.registration_deadline);
    if (new Date() > deadline) {
      throw new Error('O prazo de compra de bilhetes desta rifa já encerrou');
    }
  }

  // 3. Reserva com lock otimista — atualiza apenas se payment_status = 'available'
  const { data: reservedRows, error: reserveError } = await sbService()
    .from('raffle_tickets')
    .update({
      owner_id:       userId,
      payment_status: 'reserved',
      reserved_at:    new Date().toISOString(),
    })
    .eq('game_id', gameId)
    .eq('ticket_number', ticketNumber)
    .eq('payment_status', 'available')
    .select();

  if (reserveError) {
    logError(fn, reserveError, { gameId, userId, ticketNumber });
    throw new Error(`Erro ao reservar bilhete: ${reserveError.message}`);
  }

  if (!reservedRows || reservedRows.length === 0) {
    throw new Error('Bilhete já reservado ou indisponível');
  }

  const ticket = reservedRows[0];

  // 4. Criar cobrança PIX via Asaas
  // Buscar dados do comprador para criar/localizar customer no Asaas
  const { data: userRow } = await supabase
    .from('users')
    .select('display_name, email')
    .eq('id', userId)
    .single();

  // Calcular dueDate: agora + 30 minutos (reserva expira)
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  const dueDateStr = expiresAt.toISOString().split('T')[0]; // 'YYYY-MM-DD'

  let pixResult;
  try {
    // Criar/localizar customer no Asaas (idempotente por externalReference = userId)
    const customer = await asaasService.createCustomer({
      name:              userRow?.display_name || userRow?.email || userId,
      email:             userRow?.email || `${userId}@eloscloud.com`,
      externalReference: userId,
    });

    // Gerar cobrança PIX com dueDate customizado de 30 minutos
    // Nota: asaasService.createPixCharge usa _getDatePlusDays(7) internamente,
    // mas passamos a lógica de expiração via externalReference + cancelExpiredReservations job.
    // Para compatibilidade com a interface atual do asaasService, usamos o padrão do projeto.
    pixResult = await asaasService.createPixCharge({
      customerId:        customer.customerId || customer.id,
      value:             Number(game.ticket_price),
      description:       `Bilhete #${ticketNumber} — ${game.title}`,
      externalReference: `raffle_${gameId}_ticket_${ticketNumber}`,
    });
  } catch (pixErr) {
    // PIX falhou — liberar o bilhete reservado para não bloquear indefinidamente
    logError(fn, pixErr, { gameId, userId, ticketNumber, context: 'PIX creation failed' });
    await sbService()
      .from('raffle_tickets')
      .update({
        owner_id:       null,
        payment_status: 'available',
        reserved_at:    null,
      })
      .eq('id', ticket.id);

    throw new Error(`Erro ao gerar cobrança PIX: ${pixErr.message}`);
  }

  // 5. Salvar payment_id no bilhete
  const { data: updatedTicket, error: updateError } = await sbService()
    .from('raffle_tickets')
    .update({ payment_id: pixResult.id || pixResult.txid })
    .eq('id', ticket.id)
    .select()
    .single();

  if (updateError) {
    logWarn(fn, 'Falha ao salvar payment_id no bilhete (não-crítico)', {
      ticketId: ticket.id, error: updateError.message,
    });
  }

  log(fn, 'Bilhete reservado e PIX gerado', {
    gameId, userId, ticketNumber, paymentId: pixResult.id, expiresAt: expiresAt.toISOString(),
  });

  return {
    ticket:        updatedTicket || ticket,
    pixQrCode:     pixResult.encodedImage  || null,
    pixCopiaECola: pixResult.pixCopiaECola || null,
    expiresAt:     expiresAt.toISOString(),
  };
}

// ──────────────────────────────────────────────────────
// 2b. Comprar múltiplos bilhetes com um único PIX
// ──────────────────────────────────────────────────────

/**
 * Reserva múltiplos bilhetes e gera UMA cobrança PIX pelo total.
 * Aceita owner ou participante confirmado.
 * Se qualquer bilhete não estiver disponível, faz rollback de todos.
 *
 * @param {string}   gameId
 * @param {string}   userId
 * @param {number[]} ticketNumbers
 * @returns {{ tickets, ticket_numbers, pixQrCode, pixCopiaECola, expiresAt, totalValue }}
 */
async function buyTicketsBatch(gameId, userId, ticketNumbers) {
  const fn = 'buyTicketsBatch';
  log(fn, 'Iniciando compra em lote', { gameId, userId, count: ticketNumbers.length });

  const supabase = sb();

  // 1. Validar jogo
  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('id, game_type, title, status, ticket_price, registration_deadline, owner_id')
    .eq('id', gameId)
    .maybeSingle();

  if (gameError) throw new Error(`Erro ao buscar jogo: ${gameError.message}`);
  if (!game)     throw new Error('Jogo não encontrado');
  if (game.game_type !== 'RAFFLE') throw new Error('Este jogo não é uma rifa');
  if (game.status !== 'open')
    throw new Error(`Rifa não está aberta para compra (status: ${game.status})`);

  if (game.registration_deadline && new Date() > new Date(game.registration_deadline)) {
    throw new Error('O prazo de compra de bilhetes desta rifa já encerrou');
  }

  // 2. Owner OU participante confirmado
  const isOwner = game.owner_id === userId;
  if (!isOwner) {
    const { data: participant } = await supabase
      .from('game_participants')
      .select('status')
      .eq('game_id', gameId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!participant || participant.status !== 'confirmed') {
      throw new Error('Você não é um participante confirmado desta rifa');
    }
  }

  // 3. Reserva otimista em lote
  const { data: reservedRows, error: reserveError } = await sbService()
    .from('raffle_tickets')
    .update({
      owner_id:       userId,
      payment_status: 'reserved',
      reserved_at:    new Date().toISOString(),
    })
    .eq('game_id', gameId)
    .in('ticket_number', ticketNumbers)
    .eq('payment_status', 'available')
    .select();

  if (reserveError) throw new Error(`Erro ao reservar bilhetes: ${reserveError.message}`);

  const reserved = reservedRows || [];

  if (reserved.length === 0) {
    throw new Error('Nenhum dos bilhetes selecionados está disponível');
  }

  // Rollback parcial se nem todos estavam disponíveis
  if (reserved.length < ticketNumbers.length) {
    await sbService()
      .from('raffle_tickets')
      .update({ owner_id: null, payment_status: 'available', reserved_at: null })
      .in('id', reserved.map(t => t.id));

    const unavailable = ticketNumbers.filter(
      n => !reserved.find(t => t.ticket_number === n)
    );
    throw new Error(`Bilhete(s) já reservado(s): #${unavailable.join(', #')}`);
  }

  // 4. PIX único pelo total
  const expiresAt  = new Date(Date.now() + 30 * 60 * 1000);
  const totalValue = Number(game.ticket_price) * reserved.length;
  const ticketNums = reserved.map(t => t.ticket_number).sort((a, b) => a - b);

  const { data: userRow } = await supabase
    .from('users')
    .select('display_name, email')
    .eq('id', userId)
    .single();

  let pixResult;
  try {
    const customer = await asaasService.createCustomer({
      name:              userRow?.display_name || userRow?.email || userId,
      email:             userRow?.email || `${userId}@eloscloud.com`,
      externalReference: userId,
    });

    pixResult = await asaasService.createPixCharge({
      customerId:        customer.customerId || customer.id,
      value:             totalValue,
      description:       `Bilhete(s) #${ticketNums.join(', #')} — ${game.title}`,
      externalReference: `raffle_${gameId}_batch_${Date.now()}`,
    });
  } catch (pixErr) {
    // PIX falhou — libera todos os bilhetes reservados
    await sbService()
      .from('raffle_tickets')
      .update({ owner_id: null, payment_status: 'available', reserved_at: null })
      .in('id', reserved.map(t => t.id));

    logError(fn, pixErr, { gameId, userId, ticketNums, context: 'PIX creation failed' });
    throw new Error(`Erro ao gerar cobrança PIX: ${pixErr.message}`);
  }

  // 5. Salvar o mesmo payment_id em todos os bilhetes
  const paymentId = pixResult.id || pixResult.txid;
  await sbService()
    .from('raffle_tickets')
    .update({ payment_id: paymentId })
    .in('id', reserved.map(t => t.id));

  log(fn, 'Bilhetes reservados e PIX gerado', {
    gameId, userId, ticketNums, paymentId, totalValue,
  });

  return {
    tickets:       reserved,
    ticket_numbers: ticketNums,
    pixQrCode:     pixResult.encodedImage  || null,
    pixCopiaECola: pixResult.pixCopiaECola || null,
    expiresAt:     expiresAt.toISOString(),
    totalValue,
  };
}

// ──────────────────────────────────────────────────────
// 3. Confirmar pagamento (chamado pelo webhook Asaas)
// ──────────────────────────────────────────────────────

/**
 * Confirma o pagamento de UM ou MAIS bilhetes compartilhando o mesmo payment_id.
 * Suporta compra individual (buyTicket) e lote (buyTicketsBatch).
 *
 * @param {string} paymentId - ID do pagamento no Asaas
 * @returns {object} primeiro bilhete atualizado
 */
async function confirmPayment(paymentId) {
  const fn = 'confirmPayment';
  log(fn, 'Confirmando pagamento', { paymentId });

  // Busca TODOS os bilhetes com este payment_id (suporte a batch)
  const { data: tickets, error: fetchError } = await sbService()
    .from('raffle_tickets')
    .select('*')
    .eq('payment_id', paymentId);

  if (fetchError) {
    logError(fn, fetchError, { paymentId });
    throw new Error(`Erro ao buscar bilhetes: ${fetchError.message}`);
  }

  if (!tickets || tickets.length === 0) {
    logWarn(fn, 'Nenhum bilhete encontrado para o paymentId', { paymentId });
    return null;
  }

  // Idempotência: se todos já estão pagos, ignorar
  if (tickets.every(t => t.payment_status === 'paid')) {
    log(fn, 'Pagamento já confirmado anteriormente (idempotente)', { paymentId });
    return tickets[0];
  }

  // Atualiza todos os bilhetes pendentes para 'paid'
  const { data: updatedTickets, error: updateError } = await sbService()
    .from('raffle_tickets')
    .update({
      payment_status: 'paid',
      purchased_at:   new Date().toISOString(),
    })
    .eq('payment_id', paymentId)
    .neq('payment_status', 'paid')
    .select();

  if (updateError) {
    logError(fn, updateError, { paymentId });
    throw new Error(`Erro ao confirmar bilhetes: ${updateError.message}`);
  }

  const confirmed = updatedTickets || [];
  log(fn, `${confirmed.length} bilhete(s) confirmado(s) como pago(s)`, {
    paymentId, count: confirmed.length,
  });

  // Lei do Time: trigger por bilhete confirmado
  for (const t of confirmed) {
    triggerGameEvent('raffle_ticket_bought', t.owner_id);
  }

  // ── Unified Ledger (W5): record raffle ticket revenue ─
  // Fire-and-forget — ledger never blocks the payment flow
  const firstTicket = confirmed[0] || tickets[0];
  setImmediate(() => {
    _recordLedgerForRaffle({
      gameId:    firstTicket.game_id,
      paymentId,
      tickets:   confirmed.length > 0 ? confirmed : tickets,
    });
  });

  return firstTicket;
}

// ──────────────────────────────────────────────────────
// 4. Cancelar reservas expiradas (job periódico)
// ──────────────────────────────────────────────────────

/**
 * Libera bilhetes reservados há mais de 30 minutos sem pagamento confirmado.
 * Deve ser chamado periodicamente (ex: a cada 5-10 minutos).
 *
 * @returns {{ released: number }}
 */
async function cancelExpiredReservations() {
  const fn = 'cancelExpiredReservations';
  log(fn, 'Cancelando reservas expiradas');

  const { data, error } = await sbService()
    .from('raffle_tickets')
    .update({
      payment_status: 'available',
      owner_id:       null,
      payment_id:     null,
      reserved_at:    null,
    })
    .eq('payment_status', 'reserved')
    .lt('reserved_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .select('id');

  if (error) {
    logError(fn, error);
    throw new Error(`Erro ao cancelar reservas expiradas: ${error.message}`);
  }

  const released = data?.length ?? 0;
  if (released > 0) {
    log(fn, `Reservas expiradas liberadas`, { released });
  }

  return { released };
}

// ──────────────────────────────────────────────────────
// 5. Listar todos os bilhetes do jogo
// ──────────────────────────────────────────────────────

/**
 * Retorna todos os bilhetes do jogo com status visual.
 * owner_id é mascarado para outros usuários que não sejam o dono do bilhete
 * ou o owner do jogo.
 *
 * @param {string} gameId
 * @param {string} userId - usuário autenticado fazendo a consulta
 * @returns {Array<object>} bilhetes com owner_id mascarado conforme regras
 */
async function getTickets(gameId, userId) {
  const fn = 'getTickets';
  log(fn, 'Buscando bilhetes do jogo', { gameId, userId });

  const supabase = sb();

  // Verificar se userId é owner do jogo
  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('id, game_type, owner_id')
    .eq('id', gameId)
    .maybeSingle();

  if (gameError) throw new Error(`Erro ao buscar jogo: ${gameError.message}`);
  if (!game) throw new Error('Jogo não encontrado');
  if (game.game_type !== 'RAFFLE') throw new Error('Este jogo não é uma rifa');

  const isOwner = game.owner_id === userId;

  // Buscar todos os bilhetes
  const { data: tickets, error: ticketsError } = await supabase
    .from('raffle_tickets')
    .select('id, ticket_number, owner_id, payment_status, reserved_at, purchased_at')
    .eq('game_id', gameId)
    .order('ticket_number', { ascending: true });

  if (ticketsError) {
    logError(fn, ticketsError, { gameId });
    throw new Error(`Erro ao buscar bilhetes: ${ticketsError.message}`);
  }

  // Mascarar owner_id conforme regras de visibilidade
  const maskedTickets = (tickets || []).map(ticket => {
    const isMine = ticket.owner_id === userId;

    // owner_id visível apenas para: próprio dono do bilhete OU owner do jogo
    const visibleOwnerId = (isMine || isOwner) ? ticket.owner_id : null;

    return {
      id:             ticket.id,
      ticket_number:  ticket.ticket_number,
      payment_status: ticket.payment_status,
      owner_id:       visibleOwnerId,
      is_mine:        isMine,
      reserved_at:    ticket.reserved_at,
      purchased_at:   ticket.purchased_at,
    };
  });

  return maskedTickets;
}

// ──────────────────────────────────────────────────────
// 6. Meus bilhetes
// ──────────────────────────────────────────────────────

/**
 * Retorna apenas os bilhetes cujo owner_id = userId para o jogo especificado.
 *
 * @param {string} gameId
 * @param {string} userId
 * @returns {Array<object>}
 */
async function getMyTickets(gameId, userId) {
  const fn = 'getMyTickets';
  log(fn, 'Buscando bilhetes do usuário', { gameId, userId });

  const supabase = sb();

  const { data: tickets, error } = await supabase
    .from('raffle_tickets')
    .select('id, ticket_number, owner_id, payment_status, reserved_at, purchased_at, payment_id')
    .eq('game_id', gameId)
    .eq('owner_id', userId)
    .order('ticket_number', { ascending: true });

  if (error) {
    logError(fn, error, { gameId, userId });
    throw new Error(`Erro ao buscar bilhetes: ${error.message}`);
  }

  return tickets || [];
}

// ──────────────────────────────────────────────────────
// 7. Realizar sorteio
// ──────────────────────────────────────────────────────

/**
 * Executa o sorteio da rifa usando entropia externa verificável.
 *
 * Algoritmo:
 *   1. Random.org (obterNumeroAleatorioRandomOrg) — primário
 *   2. NIST Beacon (obterNumeroAleatorioNIST)     — fallback
 *   3. Math.random()                              — último recurso (warning logado)
 *
 * Se o número sorteado não corresponder a um bilhete pago (ex: número
 * sorteado entre min-max mas esse número específico não foi vendido),
 * tenta re-sorteio até 3 vezes antes de selecionar diretamente da lista.
 *
 * @param {string} gameId
 * @param {string} userId - deve ser owner da rifa
 * @returns {{ ticketSorteado: number, winner: { userId: string, ticketNumber: number }, resultHash: string }}
 */
async function drawRaffle(gameId, userId) {
  const fn = 'drawRaffle';
  log(fn, 'Iniciando sorteio da rifa', { gameId, userId });

  const supabase = sb();

  // 1. Validar: owner, game_type=RAFFLE, status=open
  const game = await _requireRaffleOwner(supabase, gameId, userId);

  if (game.status !== 'open') {
    throw new Error(`Rifa deve estar com status 'open' para sortear (atual: ${game.status})`);
  }

  // 2. Verificar data do sorteio (draw_at <= NOW() ou owner força manualmente)
  // Owner pode forçar o sorteio independentemente da data — a verificação é apenas informativa
  if (game.draw_at) {
    const drawAt = new Date(game.draw_at);
    if (new Date() < drawAt) {
      logWarn(fn, 'Sorteio realizado antes da data programada (forçado pelo owner)', {
        gameId, draw_at: game.draw_at,
      });
    }
  }

  // 3. Buscar bilhetes pagos
  const { data: paidTickets, error: ticketsError } = await supabase
    .from('raffle_tickets')
    .select('id, ticket_number, owner_id')
    .eq('game_id', gameId)
    .eq('payment_status', 'paid')
    .order('ticket_number', { ascending: true });

  if (ticketsError) {
    logError(fn, ticketsError, { gameId });
    throw new Error(`Erro ao buscar bilhetes pagos: ${ticketsError.message}`);
  }

  if (!paidTickets || paidTickets.length === 0) {
    throw new Error('Nenhum bilhete pago para sortear');
  }

  // 4. Sortear usando entropia externa
  const ticketNumbers = paidTickets.map(t => t.ticket_number);
  const minTicket = Math.min(...ticketNumbers);
  const maxTicket = Math.max(...ticketNumbers);

  // Mapas para lookup rápido
  const paidTicketMap = {};
  for (const t of paidTickets) {
    paidTicketMap[t.ticket_number] = t;
  }

  let drawnNumber = null;
  let algorithmUsed = null;
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let candidateNumber;

    // Estratégia 1: Random.org (primário)
    if (!algorithmUsed || algorithmUsed === 'random_org') {
      try {
        candidateNumber = await sorteioService.obterNumeroAleatorioRandomOrg(minTicket, maxTicket);
        algorithmUsed = 'random_org';
        log(fn, `Random.org sorteou ${candidateNumber} (tentativa ${attempt})`, { gameId });
      } catch (randomOrgErr) {
        logWarn(fn, 'Random.org falhou — tentando NIST Beacon', { error: randomOrgErr.message });
        algorithmUsed = 'nist';
      }
    }

    // Estratégia 2: NIST Beacon (fallback)
    if (algorithmUsed === 'nist' && candidateNumber === undefined) {
      try {
        // obterNumeroAleatorioNIST aceita max (não range min-max), então ajustamos
        // O retorno é (decimalValue % max) + 1, ou seja resultado entre 1 e max
        // Para intervalos que não começam em 1, usamos: min + (nistResult % (max - min + 1))
        const range = maxTicket - minTicket + 1;
        const nistRaw = await sorteioService.obterNumeroAleatorioNIST(range);
        candidateNumber = minTicket + ((nistRaw - 1) % range);
        algorithmUsed = 'nist';
        log(fn, `NIST Beacon sorteou ${candidateNumber} (tentativa ${attempt})`, { gameId });
      } catch (nistErr) {
        logWarn(fn, 'NIST Beacon falhou — usando Math.random() como último recurso', { error: nistErr.message });
        algorithmUsed = 'math_random';
      }
    }

    // Estratégia 3: Math.random() — último recurso
    if (algorithmUsed === 'math_random' && candidateNumber === undefined) {
      logger.warn(`[${SERVICE}] drawRaffle: usando Math.random() como ÚLTIMO RECURSO para gameId=${gameId}`, {
        service: SERVICE, function: fn, gameId, severity: 'HIGH',
        message: 'Ambas Random.org e NIST Beacon falharam. Sorteio com Math.random() possui menor auditabilidade.',
      });
      candidateNumber = minTicket + Math.floor(Math.random() * (maxTicket - minTicket + 1));
    }

    // Verificar se o número sorteado corresponde a um bilhete pago
    if (candidateNumber !== undefined && paidTicketMap[candidateNumber]) {
      drawnNumber = candidateNumber;
      break;
    }

    logWarn(fn, `Número ${candidateNumber} não corresponde a bilhete pago — re-sorteando (tentativa ${attempt}/${MAX_RETRIES})`, {
      gameId, candidateNumber,
    });

    // Reset para re-sorteio (mantém o mesmo algoritmo)
    candidateNumber = undefined;
  }

  // Se ainda não encontrou após MAX_RETRIES, selecionar aleatoriamente da lista de bilhetes pagos
  if (drawnNumber === null) {
    logWarn(fn, 'Não encontrou bilhete pago após re-sorteios — selecionando diretamente da lista', {
      gameId, paidCount: paidTickets.length,
    });
    const fallbackIndex = Math.floor(Math.random() * paidTickets.length);
    drawnNumber = paidTickets[fallbackIndex].ticket_number;
    algorithmUsed = algorithmUsed + '_direct_pick';
  }

  const winnerTicket = paidTicketMap[drawnNumber];
  const winnerUserId = winnerTicket.owner_id;
  const timestamp    = new Date().toISOString();

  // 5. Gerar result_hash SHA-256 para auditabilidade
  const hashPayload = JSON.stringify({
    gameId,
    ticketSorteado: drawnNumber,
    ownerId:        winnerUserId,
    timestamp,
    algorithm:      algorithmUsed,
  });
  const resultHash = crypto.createHash('sha256').update(hashPayload).digest('hex');

  // 6. Inserir em game_results
  const { data: gameResult, error: resultError } = await supabase
    .from('game_results')
    .insert({
      game_id:     gameId,
      result_data: {
        ticket_number:  drawnNumber,
        winner_user_id: winnerUserId,
        winner_ticket:  winnerTicket,
        total_paid_tickets: paidTickets.length,
        min_ticket:     minTicket,
        max_ticket:     maxTicket,
      },
      result_hash: resultHash,
      algorithm:   algorithmUsed,
      drawn_at:    timestamp,
    })
    .select()
    .single();

  if (resultError) {
    logError(fn, resultError, { gameId });
    throw new Error(`Erro ao registrar resultado do sorteio: ${resultError.message}`);
  }

  log(fn, 'Resultado do sorteio registrado', {
    gameId, resultId: gameResult.id, drawnNumber, winnerUserId, algorithm: algorithmUsed,
  });

  // 7. Fechar o jogo
  try {
    const gamesService = require('./gamesService');
    await gamesService.closeGame(gameId, userId);
    log(fn, 'Jogo fechado após sorteio', { gameId });
  } catch (closeErr) {
    logWarn(fn, 'Falha ao fechar jogo após sorteio (não-crítico — jogo permanece open)', {
      gameId, error: closeErr.message,
    });
  }

  // 8. Notificar todos os compradores via NotificationDispatcher
  setImmediate(async () => {
    try {
      const NotificationDispatcher = require('./NotificationDispatcher');

      // Notificar cada comprador sobre o resultado
      const buyers = [...new Set(paidTickets.map(t => t.owner_id))];
      for (const buyerId of buyers) {
        const isWinner = buyerId === winnerUserId;
        try {
          await NotificationDispatcher.dispatch({
            userId:     buyerId,
            type:       isWinner ? 'raffle_won' : 'raffle_result',
            importance: isWinner ? 'high' : 'low',
            data: {
              gameId,
              gameTitle:     game.title,
              ticketNumber:  drawnNumber,
              winnerUserId,
              isWinner,
              resultHash,
              algorithm:     algorithmUsed,
              prizeDescription: game.prize_description || null,
            },
            metadata: { triggeredBy: 'system', correlationId: gameResult.id },
          });
        } catch (notifErr) {
          logWarn(fn, `Falha ao notificar comprador ${buyerId} (não-crítico)`, { error: notifErr.message });
        }
      }
    } catch (err) {
      logWarn(fn, 'Falha ao despachar notificações do sorteio (não-crítico)', { error: err.message });
    }
  });

  // ── Unified Ledger (W5): promote raffle entries to available ─
  // Sorteio concluído = dinheiro liberado para o criador da rifa
  setImmediate(() => _promoteLedgerForRaffle(gameId));

  // 9. Gamification (Lei do Time) — fire-and-forget
  triggerGameEvent('raffle_drawn', userId);         // owner realizou sorteio
  triggerGameEvent('raffle_won', winnerUserId);     // ganhador

  log(fn, 'Sorteio concluído com sucesso', {
    gameId, ticketSorteado: drawnNumber, winnerUserId, algorithm: algorithmUsed, resultHash,
  });

  return {
    ticketSorteado: drawnNumber,
    winner: {
      userId:       winnerUserId,
      ticketNumber: drawnNumber,
    },
    resultHash,
    algorithm:    algorithmUsed,
    drawnAt:      timestamp,
    gameResultId: gameResult.id,
  };
}

// ──────────────────────────────────────────────────────
// Unified Ledger helpers (W5) — fire-and-forget
// ──────────────────────────────────────────────────────

/**
 * Records ledger entries when raffle ticket payment is confirmed.
 * D2: Rifa credita criador da rifa (owner do game).
 * Per-ticket entries: owner receives ticket_price, platform debits.
 * Uses paymentId as source_id for idempotency (one PIX = one ledger txn).
 *
 * @param {object} params
 * @param {string} params.gameId
 * @param {string} params.paymentId - Asaas payment ID (source_id)
 * @param {Array}  params.tickets   - confirmed tickets (need game_id)
 */
async function _recordLedgerForRaffle({ gameId, paymentId, tickets }) {
  try {
    const ledger = require('./unifiedLedgerService');

    // Idempotency: check if entries already exist for this paymentId
    const { data: existing } = await sb()
      .from('ledger_entries')
      .select('id')
      .eq('source_type', 'rifa')
      .eq('source_id', paymentId)
      .limit(1);

    if (existing && existing.length > 0) {
      log('_recordLedgerForRaffle', 'Ledger entries already exist — skipping', {
        action: 'LEDGER_IDEMPOTENT_SKIP', gameId, paymentId,
      });
      return;
    }

    // Fetch game to get owner_id (raffle creator) and ticket_price
    const { data: game, error: gameErr } = await sb()
      .from('games')
      .select('owner_id, ticket_price')
      .eq('id', gameId)
      .maybeSingle();

    if (gameErr || !game) {
      logWarn('_recordLedgerForRaffle', 'Game not found for ledger', {
        gameId, error: gameErr?.message,
      });
      return;
    }

    const totalBrl = Number(game.ticket_price) * tickets.length;
    if (totalBrl <= 0) return;

    const creatorAccountId = await ledger.ensureAccount('user', game.owner_id);
    const platformAccountId = ledger.PLATFORM_ACCOUNT_ID;

    await ledger.recordTransaction([
      {
        accountId:   creatorAccountId,
        amountBrl:   totalBrl,
        status:      'pending',
        sourceType:  'rifa',
        sourceId:    paymentId,
        description: `Venda de ${tickets.length} bilhete(s) — rifa ${gameId.substring(0, 8)}`,
        asaasRef:    paymentId,
      },
      {
        accountId:   platformAccountId,
        amountBrl:   -totalBrl,
        status:      'pending',
        sourceType:  'rifa',
        sourceId:    paymentId,
        description: `Repasse rifa criador — rifa ${gameId.substring(0, 8)}`,
        asaasRef:    paymentId,
      },
    ]);

    log('_recordLedgerForRaffle', 'Ledger recorded for raffle tickets', {
      action: 'LEDGER_RECORD_OK', gameId, paymentId, totalBrl, ticketCount: tickets.length,
    });
  } catch (ledgerErr) {
    logger.error('Ledger recording failed (non-blocking)', {
      service: SERVICE,
      action: 'LEDGER_RECORD_FAILED',
      severity: 'CRITICAL',
      gameId, paymentId,
      error: ledgerErr.message,
    });
  }
}

/**
 * Promotes raffle ledger entries from pending → available.
 * Called when the draw is completed (game closed).
 * Promotes ALL entries for this gameId (multiple payments/tickets).
 *
 * @param {string} gameId
 */
async function _promoteLedgerForRaffle(gameId) {
  try {
    const ledger = require('./unifiedLedgerService');

    // Raffle entries use paymentId as source_id, not gameId.
    // We need to find all raffle entries for this game by querying tickets first.
    const { data: tickets } = await sb()
      .from('raffle_tickets')
      .select('payment_id')
      .eq('game_id', gameId)
      .eq('payment_status', 'paid')
      .not('payment_id', 'is', null);

    if (!tickets || tickets.length === 0) return;

    const paymentIds = [...new Set(tickets.map(t => t.payment_id))];
    let totalPromoted = 0;

    for (const pid of paymentIds) {
      const promoted = await ledger.promoteToAvailable('rifa', pid);
      totalPromoted += promoted;
    }

    if (totalPromoted > 0) {
      log('_promoteLedgerForRaffle', 'Ledger entries promoted to available', {
        action: 'LEDGER_PROMOTE_OK', gameId, promoted: totalPromoted,
      });
    }
  } catch (ledgerErr) {
    logger.error('Ledger promotion failed (non-blocking)', {
      service: SERVICE,
      action: 'LEDGER_PROMOTE_FAILED',
      severity: 'CRITICAL',
      gameId,
      error: ledgerErr.message,
    });
  }
}

// ──────────────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────────────

module.exports = {
  initializeTickets,
  buyTicket,
  buyTicketsBatch,
  confirmPayment,
  cancelExpiredReservations,
  getTickets,
  getMyTickets,
  drawRaffle,
};

/*
 * ── INTEGRAÇÃO WEBHOOK ASAAS ──────────────────────────────────────────────────
 *
 * Em webhookController._processAsaasEvent, adicionar ANTES do bloco
 * de caixinha (split por ':'), o seguinte handler para o prefixo `raffle_`:
 *
 *   // Bilhete de rifa: externalReference = "raffle_{gameId}_ticket_{ticketNumber}"
 *   if (payment.externalReference.startsWith('raffle_')) {
 *     const raffleGamesService = require('../services/raffleGamesService');
 *     await raffleGamesService.confirmPayment(payment.id);
 *     return;
 *   }
 *
 * ── JOB PERIÓDICO — cancelExpiredReservations ─────────────────────────────────
 *
 * Adicionar chamada periódica (a cada 5-10 minutos) em um job/cron:
 *
 *   const raffleGamesService = require('./services/raffleGamesService');
 *   await raffleGamesService.cancelExpiredReservations();
 *
 * ── SECRETS NECESSÁRIOS (Fly.io) ─────────────────────────────────────────────
 *
 *   ASAAS_API_KEY          — chave de API do Asaas
 *   ASAAS_API_URL          — URL da API (sandbox ou produção)
 *   ASAAS_WEBHOOK_TOKEN    — token de validação do webhook Asaas
 *   SUPABASE_URL           — URL do Supabase
 *   SUPABASE_SERVICE_ROLE_KEY — chave service_role (bypassa RLS)
 * ──────────────────────────────────────────────────────────────────────────────
 */
