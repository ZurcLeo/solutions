/**
 * @fileoverview recallService — Motor de Recall ElosCloud
 * [RECALL-003 / RECALL-004]
 *
 * Seller configura regras de retorno (recall rules) e o sistema
 * dispara lembretes automaticos para clientes que nao interagem
 * ha N dias (orders ou bookings).
 *
 * Funcoes:
 *   CRUD  — getActiveRules, getRuleById, createRule, updateRule, deleteRule
 *   Core  — findEligibleClients, renderMessage, dispatchRecall, processSellerRules, processAllSellers
 *   LGPD  — optOut, isOptedOut
 *   Stats — getRecallStats
 */

'use strict';

const crypto = require('crypto');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const SERVICE = 'recallService';
const MAX_RULES_PER_SELLER = 10;
const DAILY_CAP_PER_RULE = 50;
const DEDUP_WINDOW_DAYS = 7;

// ──────────────────────────────────────────────────────
// Helpers internos
// ──────────────────────────────────────────────────────

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponivel');
  return client;
}

function log(fn, msg, extra = {}) {
  logger.info(msg, { service: SERVICE, function: fn, ...extra });
}

function logWarn(fn, msg, extra = {}) {
  logger.warn(msg, { service: SERVICE, function: fn, ...extra });
}

function logError(fn, err, extra = {}) {
  logger.error(`Erro em ${fn}: ${err.message}`, {
    service: SERVICE, function: fn, error: err.message, ...extra,
  });
}

// ──────────────────────────────────────────────────────
// Default templates por subtipo do seller
// ──────────────────────────────────────────────────────

const DEFAULT_TEMPLATES = {
  // Salao / Barbearia
  salao: {
    rule_name: 'Retorno periodico',
    interval_days: 30,
    trigger_type: 'days_since_last_booking',
    message_template: 'Faz {days_ago} dias desde seu ultimo atendimento em {seller_name}. Que tal agendar o proximo?',
  },
  barbearia: {
    rule_name: 'Retorno periodico',
    interval_days: 30,
    trigger_type: 'days_since_last_booking',
    message_template: 'Faz {days_ago} dias desde seu ultimo corte em {seller_name}. Hora de dar um trato no visual!',
  },
  // Clinica / Saude
  clinica: {
    rule_name: 'Retorno consulta',
    interval_days: 90,
    trigger_type: 'days_since_completed_booking',
    message_template: 'Seu retorno em {seller_name} esta proximo. Agende sua consulta!',
  },
  fisioterapia: {
    rule_name: 'Retorno sessao',
    interval_days: 90,
    trigger_type: 'days_since_completed_booking',
    message_template: 'Seu retorno em {seller_name} esta proximo. Agende sua sessao!',
  },
  odontologia: {
    rule_name: 'Check-up periodico',
    interval_days: 180,
    trigger_type: 'days_since_completed_booking',
    message_template: 'Hora do check-up! Sua ultima consulta em {seller_name} foi ha {days_ago} dias.',
  },
  veterinaria: {
    rule_name: 'Retorno veterinario',
    interval_days: 90,
    trigger_type: 'days_since_completed_booking',
    message_template: 'Hora de levar o pet ao veterinario! Sua ultima visita a {seller_name} foi ha {days_ago} dias.',
  },
  // Mecanica / Auto
  mecanica: {
    rule_name: 'Revisao periodica',
    interval_days: 180,
    trigger_type: 'days_since_last_order',
    message_template: 'Hora da revisao! Sua ultima visita em {seller_name} foi ha {days_ago} dias.',
  },
  oficina: {
    rule_name: 'Revisao periodica',
    interval_days: 180,
    trigger_type: 'days_since_last_order',
    message_template: 'Hora da revisao! Sua ultima visita em {seller_name} foi ha {days_ago} dias.',
  },
  // Pet
  petshop: {
    rule_name: 'Reabastecimento',
    interval_days: 45,
    trigger_type: 'days_since_last_order',
    message_template: 'A racao do pet esta acabando? Visite {seller_name}!',
  },
  // Academia / Escola
  academia: {
    rule_name: 'Retorno aulas',
    interval_days: 30,
    trigger_type: 'days_since_last_booking',
    message_template: 'Sentimos sua falta nas aulas! Volte para {seller_name}.',
  },
  escola: {
    rule_name: 'Retorno aulas',
    interval_days: 30,
    trigger_type: 'days_since_last_booking',
    message_template: 'Sentimos sua falta nas aulas! Volte para {seller_name}.',
  },
  // Generico (fallback)
  _default: {
    rule_name: 'Retorno geral',
    interval_days: 60,
    trigger_type: 'days_since_last_order',
    message_template: '{client_name}, faz tempo que nao nos visita. Esperamos voce de volta em {seller_name}!',
  },
};

// ──────────────────────────────────────────────────────
// CRUD — Regras de recall
// ──────────────────────────────────────────────────────

/**
 * Lista regras ativas de um seller.
 */
async function getActiveRules(sellerId) {
  const fn = 'getActiveRules';
  const { data, error } = await sb()
    .from('seller_recall_rules')
    .select('*')
    .eq('seller_id', sellerId)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) {
    logError(fn, error, { sellerId });
    throw new Error(`Erro ao buscar regras: ${error.message}`);
  }

  return data || [];
}

/**
 * Busca regra por ID com verificacao de ownership.
 */
async function getRuleById(ruleId, sellerId) {
  const fn = 'getRuleById';
  const { data, error } = await sb()
    .from('seller_recall_rules')
    .select('*')
    .eq('id', ruleId)
    .eq('seller_id', sellerId)
    .single();

  if (error || !data) {
    throw new Error('Regra nao encontrada');
  }

  return data;
}

/**
 * Cria regra (max 10 por seller).
 */
async function createRule(sellerId, ruleData) {
  const fn = 'createRule';

  // Verificar limite de regras
  const { count, error: countErr } = await sb()
    .from('seller_recall_rules')
    .select('id', { count: 'exact', head: true })
    .eq('seller_id', sellerId)
    .eq('is_active', true);

  if (countErr) {
    logError(fn, countErr, { sellerId });
    throw new Error(`Erro ao verificar limite: ${countErr.message}`);
  }

  if ((count || 0) >= MAX_RULES_PER_SELLER) {
    throw new Error(`Limite de ${MAX_RULES_PER_SELLER} regras ativas por negocio atingido`);
  }

  const { data, error } = await sb()
    .from('seller_recall_rules')
    .insert({
      seller_id: sellerId,
      rule_name: ruleData.rule_name,
      trigger_type: ruleData.trigger_type,
      interval_days: ruleData.interval_days,
      product_category: ruleData.product_category || null,
      message_template: ruleData.message_template,
      channel_preference: ruleData.channel_preference || ['in_app', 'email', 'push'],
      max_sends: ruleData.max_sends ?? 3,
    })
    .select()
    .single();

  if (error) {
    logError(fn, error, { sellerId });
    throw new Error(`Erro ao criar regra: ${error.message}`);
  }

  log(fn, 'Regra de recall criada', { sellerId, ruleId: data.id });
  return data;
}

/**
 * Atualiza regra com verificacao de ownership.
 */
async function updateRule(ruleId, sellerId, updates) {
  const fn = 'updateRule';

  const ALLOWED = [
    'rule_name', 'trigger_type', 'interval_days', 'product_category',
    'message_template', 'channel_preference', 'is_active', 'max_sends',
  ];

  const clean = {};
  for (const key of ALLOWED) {
    if (updates[key] !== undefined) clean[key] = updates[key];
  }

  if (Object.keys(clean).length === 0) {
    throw new Error('Nenhum campo valido para atualizar');
  }

  const { data, error } = await sb()
    .from('seller_recall_rules')
    .update(clean)
    .eq('id', ruleId)
    .eq('seller_id', sellerId)
    .select()
    .single();

  if (error || !data) {
    logError(fn, error || new Error('Regra nao encontrada'), { ruleId, sellerId });
    throw new Error('Regra nao encontrada ou erro ao atualizar');
  }

  log(fn, 'Regra de recall atualizada', { ruleId, sellerId });
  return data;
}

/**
 * Soft-delete: desativa regra.
 */
async function deleteRule(ruleId, sellerId) {
  const fn = 'deleteRule';

  const { data, error } = await sb()
    .from('seller_recall_rules')
    .update({ is_active: false })
    .eq('id', ruleId)
    .eq('seller_id', sellerId)
    .select('id')
    .single();

  if (error || !data) {
    throw new Error('Regra nao encontrada');
  }

  log(fn, 'Regra de recall desativada (soft-delete)', { ruleId, sellerId });
  return { success: true };
}

/**
 * Retorna template default baseado no subtipo do seller.
 */
function getDefaultTemplates(sellerSubtype) {
  const key = (sellerSubtype || '').toLowerCase().trim();
  const template = DEFAULT_TEMPLATES[key] || DEFAULT_TEMPLATES._default;
  return { ...template };
}

// ──────────────────────────────────────────────────────
// Core — Logica de recall
// ──────────────────────────────────────────────────────

/**
 * Encontra clientes elegiveis para recall baseado em uma regra.
 *
 * Pipeline:
 *  1. Query ultima interacao por trigger_type
 *  2. Filtrar por intervalo minimo
 *  3. Excluir clientes com pedido/booking ativo
 *  4. Excluir opt-outs
 *  5. Excluir clientes ja notificados nos ultimos 7 dias (dedup)
 *  6. Excluir clientes que atingiram max_sends
 *  7. Filtrar por product_category (se definido)
 *  8. LIMIT 50 (cap diario por regra)
 */
async function findEligibleClients(rule, sellerId) {
  const fn = 'findEligibleClients';
  const supabase = sb();

  try {
    let clients = [];

    if (rule.trigger_type === 'days_since_last_order') {
      clients = await _findOrderClients(supabase, sellerId, rule);
    } else if (rule.trigger_type === 'days_since_last_booking') {
      clients = await _findBookingClients(supabase, sellerId, rule, ['confirmed', 'completed']);
    } else if (rule.trigger_type === 'days_since_completed_booking') {
      clients = await _findBookingClients(supabase, sellerId, rule, ['completed']);
    } else {
      logWarn(fn, `trigger_type desconhecido: ${rule.trigger_type}`, { ruleId: rule.id });
      return [];
    }

    if (clients.length === 0) return [];

    // Excluir opt-outs
    clients = await _excludeOptedOut(supabase, clients, sellerId);

    // Excluir clientes ja notificados recentemente (dedup 7 dias)
    clients = await _excludeRecentlyNotified(supabase, clients, rule.id);

    // Excluir clientes que atingiram max_sends
    clients = await _excludeMaxSends(supabase, clients, rule.id, rule.max_sends);

    // Cap diario
    clients = clients.slice(0, DAILY_CAP_PER_RULE);

    log(fn, `${clients.length} clientes elegiveis`, { ruleId: rule.id, sellerId });
    return clients;
  } catch (err) {
    logError(fn, err, { ruleId: rule.id, sellerId });
    return [];
  }
}

/**
 * Busca clientes por ultima order (completed/delivered).
 */
async function _findOrderClients(supabase, sellerId, rule) {
  // Buscar pedidos finalizados deste seller com buyer_id
  let query = supabase
    .from('marketplace_orders')
    .select('buyer_id, updated_at, items')
    .eq('seller_id', sellerId)
    .in('status', ['completed', 'delivered'])
    .not('buyer_id', 'is', null);

  const { data: orders, error } = await query;

  if (error) {
    logError('_findOrderClients', error, { sellerId });
    return [];
  }

  if (!orders || orders.length === 0) return [];

  // Filtrar por product_category se definido
  let filteredOrders = orders;
  if (rule.product_category) {
    filteredOrders = await _filterOrdersByCategory(supabase, orders, rule.product_category);
  }

  // Agrupar por buyer_id e pegar a ultima interacao
  const clientMap = {};
  for (const order of filteredOrders) {
    const existing = clientMap[order.buyer_id];
    const orderDate = new Date(order.updated_at);
    if (!existing || orderDate > new Date(existing.lastInteraction)) {
      clientMap[order.buyer_id] = {
        userId: order.buyer_id,
        lastInteraction: order.updated_at,
        lastServiceName: _extractProductName(order.items),
      };
    }
  }

  // Calcular dias desde ultima interacao e filtrar por interval_days
  const now = new Date();
  const eligible = [];

  for (const client of Object.values(clientMap)) {
    const daysSince = Math.floor((now - new Date(client.lastInteraction)) / (1000 * 60 * 60 * 24));
    if (daysSince >= rule.interval_days) {
      eligible.push({ ...client, daysSince });
    }
  }

  // Excluir clientes com pedido ativo
  if (eligible.length > 0) {
    const userIds = eligible.map(c => c.userId);
    const { data: activeOrders } = await supabase
      .from('marketplace_orders')
      .select('buyer_id')
      .eq('seller_id', sellerId)
      .in('buyer_id', userIds)
      .in('status', ['pending', 'paid', 'preparing', 'awaiting_payment', 'ready']);

    if (activeOrders && activeOrders.length > 0) {
      const activeSet = new Set(activeOrders.map(o => o.buyer_id));
      return eligible.filter(c => !activeSet.has(c.userId));
    }
  }

  return eligible;
}

/**
 * Busca clientes por ultimo booking (confirmed/completed ou completed-only).
 *
 * service_bookings referencia marketplace_products via service_id.
 * marketplace_products.seller_id = sellerId.
 */
async function _findBookingClients(supabase, sellerId, rule, statuses) {
  // Primeiro, buscar todos service_ids (marketplace_products) deste seller
  let productQuery = supabase
    .from('marketplace_products')
    .select('id, name')
    .eq('seller_id', sellerId)
    .eq('active', true);

  if (rule.product_category) {
    productQuery = productQuery.eq('category', rule.product_category);
  }

  const { data: products, error: prodErr } = await productQuery;

  if (prodErr || !products || products.length === 0) {
    return [];
  }

  const serviceIds = products.map(p => p.id);
  const productMap = {};
  for (const p of products) productMap[p.id] = p.name;

  // Buscar bookings desses servicos
  const { data: bookings, error: bookErr } = await supabase
    .from('service_bookings')
    .select('client_id, service_id, scheduled_at, updated_at, status')
    .in('service_id', serviceIds)
    .in('status', statuses)
    .not('client_id', 'is', null);

  if (bookErr || !bookings || bookings.length === 0) {
    return [];
  }

  // Agrupar por client_id e pegar a ultima interacao.
  // Para 'days_since_completed_booking', usar updated_at (data da conclusao),
  // nao scheduled_at (data do agendamento original). M1 fix.
  const useCompletedDate = statuses.length === 1 && statuses[0] === 'completed';
  const clientMap = {};
  for (const booking of bookings) {
    const existing = clientMap[booking.client_id];
    const referenceDate = useCompletedDate
      ? (booking.updated_at || booking.scheduled_at)
      : booking.scheduled_at;
    const bookingDate = new Date(referenceDate);
    if (!existing || bookingDate > new Date(existing.lastInteraction)) {
      clientMap[booking.client_id] = {
        userId: booking.client_id,
        lastInteraction: referenceDate,
        lastServiceName: productMap[booking.service_id] || '',
      };
    }
  }

  // Filtrar por interval_days
  const now = new Date();
  const eligible = [];

  for (const client of Object.values(clientMap)) {
    const daysSince = Math.floor((now - new Date(client.lastInteraction)) / (1000 * 60 * 60 * 24));
    if (daysSince >= rule.interval_days) {
      eligible.push({ ...client, daysSince });
    }
  }

  // Excluir clientes com booking ativo
  if (eligible.length > 0) {
    const userIds = eligible.map(c => c.userId);
    const { data: activeBookings } = await supabase
      .from('service_bookings')
      .select('client_id')
      .in('service_id', serviceIds)
      .in('client_id', userIds)
      .in('status', ['pending', 'confirmed']);

    if (activeBookings && activeBookings.length > 0) {
      const activeSet = new Set(activeBookings.map(b => b.client_id));
      return eligible.filter(c => !activeSet.has(c.userId));
    }
  }

  return eligible;
}

/**
 * Filtra orders que contem produtos de uma categoria especifica.
 */
async function _filterOrdersByCategory(supabase, orders, category) {
  // Extrair todos product_ids dos items
  const allProductIds = new Set();
  for (const order of orders) {
    const items = order.items || [];
    for (const item of items) {
      if (item.product_id) allProductIds.add(item.product_id);
    }
  }

  if (allProductIds.size === 0) return orders;

  // Buscar quais desses produtos tem a categoria alvo
  const { data: matchingProducts } = await supabase
    .from('marketplace_products')
    .select('id')
    .in('id', [...allProductIds])
    .eq('category', category);

  if (!matchingProducts || matchingProducts.length === 0) return [];

  const matchingIds = new Set(matchingProducts.map(p => p.id));

  // Filtrar orders que contem pelo menos 1 produto da categoria
  return orders.filter(order => {
    const items = order.items || [];
    return items.some(item => matchingIds.has(item.product_id));
  });
}

/**
 * Extrai nome do primeiro produto de um array de items.
 */
function _extractProductName(items) {
  if (!items || !Array.isArray(items) || items.length === 0) return '';
  return items[0].name || '';
}

/**
 * Exclui clientes que fizeram opt-out.
 */
async function _excludeOptedOut(supabase, clients, sellerId) {
  if (clients.length === 0) return clients;

  const userIds = clients.map(c => c.userId);

  // Buscar opt-outs: especificos do seller OU globais (seller_id IS NULL)
  const { data: optouts } = await supabase
    .from('recall_optouts')
    .select('client_identifier')
    .in('client_identifier', userIds)
    .or(`seller_id.eq.${sellerId},seller_id.is.null`);

  if (!optouts || optouts.length === 0) return clients;

  const optoutSet = new Set(optouts.map(o => o.client_identifier));
  return clients.filter(c => !optoutSet.has(c.userId));
}

/**
 * Exclui clientes que ja receberam recall nos ultimos DEDUP_WINDOW_DAYS dias.
 */
async function _excludeRecentlyNotified(supabase, clients, ruleId) {
  if (clients.length === 0) return clients;

  const userIds = clients.map(c => c.userId);
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: recentLogs } = await supabase
    .from('recall_log')
    .select('client_user_id')
    .eq('rule_id', ruleId)
    .in('client_user_id', userIds)
    .gte('sent_at', cutoff);

  if (!recentLogs || recentLogs.length === 0) return clients;

  const recentSet = new Set(recentLogs.map(l => l.client_user_id));
  return clients.filter(c => !recentSet.has(c.userId));
}

/**
 * Exclui clientes que atingiram max_sends para esta regra.
 */
async function _excludeMaxSends(supabase, clients, ruleId, maxSends) {
  if (clients.length === 0 || !maxSends) return clients;

  const userIds = clients.map(c => c.userId);

  // Contar envios por cliente para esta regra
  const { data: logCounts } = await supabase
    .from('recall_log')
    .select('client_user_id')
    .eq('rule_id', ruleId)
    .in('client_user_id', userIds);

  if (!logCounts || logCounts.length === 0) return clients;

  // Contar por usuario
  const counts = {};
  for (const row of logCounts) {
    counts[row.client_user_id] = (counts[row.client_user_id] || 0) + 1;
  }

  return clients.filter(c => (counts[c.userId] || 0) < maxSends);
}

// ──────────────────────────────────────────────────────
// Render + Dispatch
// ──────────────────────────────────────────────────────

/**
 * Substitui placeholders no template.
 * Placeholders: {client_name}, {seller_name}, {product_name}, {days_ago}, {store_url}
 */
function renderMessage(template, vars) {
  let msg = template || '';
  msg = msg.replace(/\{client_name\}/g, vars.clientName || 'Cliente');
  msg = msg.replace(/\{seller_name\}/g, vars.sellerName || '');
  msg = msg.replace(/\{product_name\}/g, vars.productName || '');
  msg = msg.replace(/\{days_ago\}/g, String(vars.daysAgo || ''));
  msg = msg.replace(/\{store_url\}/g, vars.storeUrl || '');
  return msg;
}

/**
 * Despacha recall para um cliente via NotificationDispatcher.
 *
 * Ordem (RECALL-008):
 *  1. Gerar optout token + dedup key
 *  2. Insert recall_log PRIMEIRO (catch 23505 = ja enviado, return false)
 *  3. Lookup telefone/nome do cliente (users table)
 *  4. Dispatch notificacao (com clientPhone, clientName, recallLogId)
 *  5. Return true
 */
async function dispatchRecall(rule, client, sellerInfo) {
  const fn = 'dispatchRecall';
  const supabase = sb();

  // 1. Gerar optout token + dedup key
  const optoutToken = generateOptoutToken(client.userId, rule.seller_id);
  const optoutUrl = `${process.env.FRONTEND_URL || 'https://eloscloud.com'}/recall/optout?token=${optoutToken}`;
  const weekNum = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const dedupKey = `recall_${rule.id}_${client.userId}_w${weekNum}`;

  // 2. Insert recall_log PRIMEIRO — catch 23505 (dedup)
  let logEntry = null;
  try {
    const { data: inserted, error: insertErr } = await supabase
      .from('recall_log')
      .insert({
        rule_id: rule.id,
        seller_id: rule.seller_id,
        client_user_id: client.userId,
        channel: 'in_app',
        dedup_key: dedupKey,
      })
      .select('id')
      .single();

    if (insertErr) {
      if (insertErr.code === '23505') {
        logWarn(fn, 'Recall duplicado ignorado', { ruleId: rule.id, clientId: client.userId });
        return false;
      }
      throw insertErr;
    }
    logEntry = inserted;
  } catch (err) {
    if (err.code === '23505') {
      logWarn(fn, 'Recall duplicado ignorado', { ruleId: rule.id, clientId: client.userId });
      return false;
    }
    logError(fn, err, { ruleId: rule.id, clientId: client.userId });
    return false;
  }

  try {
    // 3. Lookup telefone/nome do cliente
    let clientName = 'Cliente';
    let clientPhone = null;
    if (client.userId) {
      const { data: clientUser } = await supabase
        .from('users')
        .select('name, full_name, phone')
        .eq('id', client.userId)
        .single();
      if (clientUser) {
        const fullName = clientUser.full_name || clientUser.name || '';
        clientName = fullName.split(' ')[0] || 'Cliente';
        clientPhone = clientUser.phone || null;
      }
    }

    const storeUrl = `/s/${sellerInfo.handle || sellerInfo.sellerId}`;

    const renderedMessage = renderMessage(rule.message_template, {
      clientName,
      sellerName: sellerInfo.name,
      productName: client.lastServiceName || '',
      daysAgo: client.daysSince,
      storeUrl,
    });

    // Determinar tipo de notificacao
    const notificationType = rule.trigger_type.includes('booking')
      ? 'recall_return'
      : 'recall_reorder';

    // 4. Dispatch notificacao com clientPhone, clientName, recallLogId
    const notificationDispatcher = require('./NotificationDispatcher');

    await notificationDispatcher.dispatch({
      userId: client.userId,
      type: notificationType,
      importance: 'high',
      data: {
        serviceName: client.lastServiceName || '',
        sellerName: sellerInfo.name,
        sellerId: rule.seller_id,
        daysSince: client.daysSince,
        message: renderedMessage,
        storeUrl,
        optoutUrl,
        clientPhone,
        clientName,
        recallLogId: logEntry?.id || null,
      },
      metadata: { triggeredBy: 'system', source: 'recallEngine' },
      dedupKey,
    });

    log(fn, 'Recall despachado', {
      ruleId: rule.id, clientId: client.userId, daysSince: client.daysSince,
    });

    return true;
  } catch (err) {
    logError(fn, err, { ruleId: rule.id, clientId: client.userId });
    return false;
  }
}

// ──────────────────────────────────────────────────────
// Orquestradores
// ──────────────────────────────────────────────────────

/**
 * Processa todas as regras de um seller.
 * @returns {number} Total de recalls enviados
 */
async function processSellerRules(sellerId) {
  const fn = 'processSellerRules';
  let totalSent = 0;

  try {
    const rules = await getActiveRules(sellerId);
    if (rules.length === 0) return 0;

    // Buscar info do seller para renderizacao
    const supabase = sb();
    const { data: seller } = await supabase
      .from('seller_profiles')
      .select('id, trading_name, business_name, username, seller_subtype')
      .eq('id', sellerId)
      .single();

    if (!seller) {
      logWarn(fn, 'Seller nao encontrado', { sellerId });
      return 0;
    }

    const sellerInfo = {
      sellerId: seller.id,
      name: seller.trading_name || seller.business_name || 'Negocio',
      handle: seller.username || null,
    };

    for (const rule of rules) {
      try {
        const clients = await findEligibleClients(rule, sellerId);

        for (const client of clients) {
          const sent = await dispatchRecall(rule, client, sellerInfo);
          if (sent) totalSent++;
        }

        log(fn, `Regra processada`, {
          ruleId: rule.id, sellerId, eligible: clients.length, sent: totalSent,
        });
      } catch (ruleErr) {
        logError(fn, ruleErr, { ruleId: rule.id, sellerId });
      }
    }
  } catch (err) {
    logError(fn, err, { sellerId });
  }

  return totalSent;
}

/**
 * Processa recall para TODOS os sellers que tem regras ativas.
 * Chamado pelo cron job diario.
 *
 * @returns {{ sellersProcessed: number, totalRecalls: number }}
 */
async function processAllSellers() {
  const fn = 'processAllSellers';
  log(fn, 'Iniciando processamento de recall para todos os sellers');

  const supabase = sb();

  // Buscar sellers com pelo menos 1 regra ativa
  const { data: sellers, error } = await supabase
    .from('seller_recall_rules')
    .select('seller_id')
    .eq('is_active', true);

  if (error) {
    logError(fn, error);
    throw error;
  }

  // Deduplica seller_ids
  const uniqueSellerIds = [...new Set((sellers || []).map(s => s.seller_id))];

  if (uniqueSellerIds.length === 0) {
    log(fn, 'Nenhum seller com regras ativas');
    return { sellersProcessed: 0, totalRecalls: 0 };
  }

  let sellersProcessed = 0;
  let totalRecalls = 0;

  for (const sellerId of uniqueSellerIds) {
    try {
      const sent = await processSellerRules(sellerId);
      totalRecalls += sent;
      sellersProcessed++;
    } catch (err) {
      logError(fn, err, { sellerId });
    }
  }

  log(fn, 'Processamento de recall concluido', {
    sellersProcessed, totalRecalls,
  });

  return { sellersProcessed, totalRecalls };
}

// ──────────────────────────────────────────────────────
// LGPD — Opt-out
// ──────────────────────────────────────────────────────

/**
 * Cliente faz opt-out de recalls de um seller (ou global se sellerId null).
 */
async function optOut(clientIdentifier, sellerId = null) {
  const fn = 'optOut';
  const supabase = sb();

  // Partial indexes impedem upsert com onConflict generico.
  // Checamos existencia antes de inserir.
  let existsQuery = supabase
    .from('recall_optouts')
    .select('id')
    .eq('client_identifier', clientIdentifier);

  if (sellerId) {
    existsQuery = existsQuery.eq('seller_id', sellerId);
  } else {
    existsQuery = existsQuery.is('seller_id', null);
  }

  const { data: existing } = await existsQuery.limit(1);

  if (existing && existing.length > 0) {
    log(fn, 'Opt-out ja registrado', { clientIdentifier, sellerId });
    return { success: true };
  }

  const { error } = await supabase
    .from('recall_optouts')
    .insert({ client_identifier: clientIdentifier, seller_id: sellerId });

  if (error) {
    // Corrida — duplicate pode chegar entre select e insert
    if (error.code === '23505') {
      log(fn, 'Opt-out ja registrado (race)', { clientIdentifier, sellerId });
      return { success: true };
    }
    logError(fn, error, { clientIdentifier, sellerId });
    throw new Error(`Erro ao registrar opt-out: ${error.message}`);
  }

  log(fn, 'Opt-out registrado', { clientIdentifier, sellerId });
  return { success: true };
}

/**
 * Verifica se cliente esta em opt-out.
 */
async function isOptedOut(clientIdentifier, sellerId) {
  const { data } = await sb()
    .from('recall_optouts')
    .select('id')
    .eq('client_identifier', clientIdentifier)
    .or(`seller_id.eq.${sellerId},seller_id.is.null`)
    .limit(1);

  return data && data.length > 0;
}

// ──────────────────────────────────────────────────────
// Stats — Analytics de recall
// ──────────────────────────────────────────────────────

/**
 * Retorna estatisticas de recall para um seller.
 */
async function getRecallStats(sellerId, { from, to } = {}) {
  const fn = 'getRecallStats';
  const supabase = sb();

  let query = supabase
    .from('recall_log')
    .select('id, rule_id, status, sent_at')
    .eq('seller_id', sellerId);

  if (from) query = query.gte('sent_at', from);
  if (to) query = query.lte('sent_at', to);

  const { data: logs, error } = await query;

  if (error) {
    logError(fn, error, { sellerId });
    throw new Error(`Erro ao buscar estatisticas: ${error.message}`);
  }

  const records = logs || [];

  const totalSent = records.length;
  const totalConverted = records.filter(l => l.status === 'converted').length;
  const conversionRate = totalSent > 0 ? Math.round((totalConverted / totalSent) * 10000) / 100 : 0;

  // Agrupar por regra
  const byRule = {};
  for (const record of records) {
    if (!byRule[record.rule_id]) {
      byRule[record.rule_id] = { sent: 0, converted: 0 };
    }
    byRule[record.rule_id].sent++;
    if (record.status === 'converted') byRule[record.rule_id].converted++;
  }

  return {
    totalSent,
    totalConverted,
    conversionRate,
    byRule,
  };
}

/**
 * Retorna log de recalls paginado para um seller.
 */
async function getRecallLog(sellerId, { page = 1, limit = 20 } = {}) {
  const fn = 'getRecallLog';
  const supabase = sb();
  const offset = (page - 1) * limit;

  const { data, error, count } = await supabase
    .from('recall_log')
    .select('*, rule:rule_id ( rule_name, trigger_type )', { count: 'exact' })
    .eq('seller_id', sellerId)
    .order('sent_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logError(fn, error, { sellerId });
    throw new Error(`Erro ao buscar log: ${error.message}`);
  }

  return {
    data: data || [],
    total: count || 0,
    page,
    limit,
  };
}

// ──────────────────────────────────────────────────────
// Stats — Detailed analytics (RECALL-009)
// ──────────────────────────────────────────────────────

/**
 * Retorna estatisticas detalhadas de recall para um seller.
 * Inclui: metricas basicas, receita recuperada, melhor regra,
 * serie temporal (por dia), top 10 clientes responsivos.
 */
async function getDetailedStats(sellerId, { from, to } = {}) {
  const fn = 'getDetailedStats';
  const supabase = sb();

  // 1. Buscar todos os logs do periodo
  let query = supabase
    .from('recall_log')
    .select('id, rule_id, status, sent_at, converted_order_id, client_user_id')
    .eq('seller_id', sellerId);
  if (from) query = query.gte('sent_at', from);
  if (to) query = query.lte('sent_at', to);
  const { data: logs, error } = await query;

  if (error) {
    logError(fn, error, { sellerId });
    throw new Error(`Erro ao buscar estatisticas detalhadas: ${error.message}`);
  }

  const records = logs || [];

  // 2. Metricas basicas
  const totalSent = records.length;
  const totalConverted = records.filter(l => l.status === 'converted').length;
  const conversionRate = totalSent > 0 ? Math.round((totalConverted / totalSent) * 10000) / 100 : 0;

  // 3. Receita recuperada — soma dos pedidos convertidos
  const convertedOrderIds = records
    .filter(l => l.converted_order_id)
    .map(l => l.converted_order_id);

  let estimatedRevenue = 0;
  if (convertedOrderIds.length > 0) {
    const { data: orders } = await supabase
      .from('marketplace_orders')
      .select('total_amount')
      .in('id', convertedOrderIds);
    estimatedRevenue = (orders || []).reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
  }

  // 4. Melhor regra (maior conversao, minimo 3 envios)
  const byRule = {};
  for (const r of records) {
    if (!byRule[r.rule_id]) byRule[r.rule_id] = { sent: 0, converted: 0 };
    byRule[r.rule_id].sent++;
    if (r.status === 'converted') byRule[r.rule_id].converted++;
  }

  const ruleIds = Object.keys(byRule);
  let bestRule = null;
  if (ruleIds.length > 0) {
    const { data: rules } = await supabase
      .from('seller_recall_rules')
      .select('id, rule_name')
      .in('id', ruleIds);
    const ruleNameMap = {};
    for (const r of (rules || [])) ruleNameMap[r.id] = r.rule_name;

    let bestRate = -1;
    for (const [ruleId, stats] of Object.entries(byRule)) {
      if (stats.sent >= 3) {
        const rate = stats.converted / stats.sent;
        if (rate > bestRate) {
          bestRate = rate;
          bestRule = {
            id: ruleId,
            name: ruleNameMap[ruleId] || 'Regra',
            rate: Math.round(rate * 10000) / 100,
            sent: stats.sent,
            converted: stats.converted,
          };
        }
      }
    }
  }

  // 5. Serie temporal (agrupar por dia)
  const dailyMap = {};
  for (const r of records) {
    const day = r.sent_at.substring(0, 10);
    if (!dailyMap[day]) dailyMap[day] = { date: day, sent: 0, converted: 0 };
    dailyMap[day].sent++;
    if (r.status === 'converted') dailyMap[day].converted++;
  }
  const timeSeries = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

  // 6. Top 10 clientes mais responsivos
  const clientConversions = {};
  for (const r of records) {
    if (r.status === 'converted' && r.client_user_id) {
      clientConversions[r.client_user_id] = (clientConversions[r.client_user_id] || 0) + 1;
    }
  }
  const topClientIds = Object.entries(clientConversions)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([id, count]) => ({ userId: id, conversions: count }));

  // Enriquecer com nomes
  if (topClientIds.length > 0) {
    const ids = topClientIds.map(c => c.userId);
    const { data: users } = await supabase
      .from('users')
      .select('id, name')
      .in('id', ids);
    const userMap = {};
    for (const u of (users || [])) userMap[u.id] = u.name;
    for (const c of topClientIds) c.name = userMap[c.userId] || 'Cliente';
  }

  return {
    totalSent,
    totalConverted,
    conversionRate,
    estimatedRevenue,
    bestRule,
    timeSeries,
    topClients: topClientIds,
    byRule,
  };
}

// ──────────────────────────────────────────────────────
// LGPD — Opt-out token (RECALL-007)
// ──────────────────────────────────────────────────────

const OPTOUT_SECRET = process.env.RECALL_OPTOUT_SECRET || 'recall-optout-fallback';
const OPTOUT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function generateOptoutToken(userId, sellerId) {
  const payload = JSON.stringify({
    u: userId,
    s: sellerId || null,
    e: Date.now() + OPTOUT_EXPIRY_MS,
  });
  const payloadB64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', OPTOUT_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function verifyOptoutToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', OPTOUT_SECRET).update(payloadB64).digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!payload.u || !payload.e) return null;
    if (Date.now() > payload.e) return null; // expirado
    return { userId: payload.u, sellerId: payload.s || null };
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────────────

module.exports = {
  // CRUD
  getActiveRules,
  getRuleById,
  createRule,
  updateRule,
  deleteRule,
  getDefaultTemplates,
  // Core
  findEligibleClients,
  renderMessage,
  dispatchRecall,
  processSellerRules,
  processAllSellers,
  // LGPD
  optOut,
  isOptedOut,
  generateOptoutToken,
  verifyOptoutToken,
  // Stats
  getRecallStats,
  getDetailedStats,
  getRecallLog,
};
