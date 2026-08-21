/**
 * @fileoverview marketplaceService — ElosCloud Mercado Local
 * Orquestra catálogo, pedidos, resgate de ElosCoins e metas comunitárias.
 * Todas as operações financeiras (coins + pagamento) são atômicas ou compensadas.
 *
 * Delegações externas:
 *   - payment-agent  → paymentService / asaasService (PIX/Stripe)
 *   - game-agent     → gamificationService.triggerEvent / spendCoins
 *   - disputa-agent  → disputeService.createDispute (pedidos contestados)
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger }            = require('../logger');
const gamificationService   = require('./gamificationService');
const asaasService          = require('./asaasService');
const supportService        = require('./SupportService');
const subscriptionService   = require('./subscriptionService');
const ProductValidator      = require('./validators/ProductValidator');
const notificationDispatcher = require('./NotificationDispatcher');
const { getOptedOutUserIds } = require('./userPreferencesService');
const handleService           = require('./handleService');
const { geocodeAddress }      = require('../utils/geocoding');
const gtinService             = require('./gtinService');
const variantService          = require('./variantService');

const SERVICE = 'marketplaceService';

// ──────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function _resolveSellerUuid(sellerIdOrHandle) {
  if (UUID_RE.test(sellerIdOrHandle)) return sellerIdOrHandle;
  const { data } = await sb()
    .from('seller_profiles')
    .select('id')
    .eq('username', sellerIdOrHandle)
    .neq('status', 'deleted')
    .single();
  if (!data) throw new Error('Vendedor não encontrado');
  return data.id;
}

function log(fn, msg, extra = {}) {
  logger.info(msg, { service: SERVICE, function: fn, ...extra });
}

function logError(fn, err, extra = {}) {
  logger.error(`Erro em ${fn}: ${err.message}`, {
    service: SERVICE, function: fn, error: err.message, ...extra
  });
}

// ──────────────────────────────────────────────────────
// [007] Status Flows — transições legais por vertical
// ──────────────────────────────────────────────────────

/**
 * Cada flow define a sequência de status que o SELLER pode avançar.
 * Transições automáticas (pending→paid via webhook) e laterais (→cancelled, →disputed) são tratadas à parte.
 * O timestamp_col indica qual coluna setar quando a transição acontece.
 */
const STATUS_FLOWS = {
  food: {
    label: 'Alimentação',
    seller_transitions: {
      paid:        { next: 'in_progress', label: 'Iniciar preparo',    timestamp_col: 'preparing_at' },
      in_progress: { next: 'completed',   label: 'Marcar como pronto', timestamp_col: 'completed_at' },
    },
    display_sequence: ['pending', 'paid', 'in_progress', 'completed'],
  },
  product_shipping: {
    label: 'Produto com envio',
    seller_transitions: {
      paid:       { next: 'separating', label: 'Iniciar separação',     timestamp_col: 'separating_at' },
      separating: { next: 'posted',     label: 'Marcar como postado',   timestamp_col: 'posted_at' },
      // posted → in_transit e in_transit → delivered são via webhook de rastreio (Melhor Envio/Correios)
      delivered:  { next: 'completed',  label: 'Concluir pedido',       timestamp_col: 'completed_at' },
    },
    // Transições automáticas (webhook de rastreio → não precisam de ação do seller)
    auto_transitions: {
      posted:    { next: 'in_transit', timestamp_col: 'in_transit_at' },
      in_transit:{ next: 'delivered',  timestamp_col: 'delivered_at' },
    },
    display_sequence: ['pending', 'paid', 'separating', 'posted', 'in_transit', 'delivered', 'completed'],
  },
  product_pickup: {
    label: 'Produto com retirada',
    seller_transitions: {
      paid:       { next: 'separating', label: 'Iniciar separação',    timestamp_col: 'separating_at' },
      separating: { next: 'completed',  label: 'Pronto para retirada', timestamp_col: 'completed_at' },
    },
    display_sequence: ['pending', 'paid', 'separating', 'completed'],
  },
  service: {
    label: 'Serviço',
    seller_transitions: {
      paid:        { next: 'in_progress', label: 'Iniciar serviço',     timestamp_col: 'preparing_at' },
      in_progress: { next: 'completed',   label: 'Serviço concluído',   timestamp_col: 'completed_at' },
    },
    display_sequence: ['pending', 'paid', 'in_progress', 'completed'],
  },
  // Fallback para pedidos antigos sem flow definido
  default: {
    label: 'Padrão',
    seller_transitions: {
      paid:        { next: 'in_progress', label: 'Iniciar preparo',    timestamp_col: 'preparing_at' },
      in_progress: { next: 'completed',   label: 'Concluir',           timestamp_col: 'completed_at' },
    },
    display_sequence: ['pending', 'paid', 'in_progress', 'completed'],
  },
};

/**
 * Determina o status_flow baseado na categoria do seller + fulfillment_type.
 */
function resolveStatusFlow(sellerCategory, fulfillmentType) {
  if (sellerCategory === 'alimentacao') return 'food';
  if (sellerCategory === 'servicos')    return 'service';
  if (sellerCategory === 'produtos') {
    return fulfillmentType === 'shipping' ? 'product_shipping' : 'product_pickup';
  }
  return 'default';
}

// ──────────────────────────────────────────────────────
// Unified Ledger — fire-and-forget integration (W3)
// ──────────────────────────────────────────────────────

/**
 * Records ledger entries when a marketplace order payment is confirmed.
 *
 * Double-entry model (SUM = 0):
 *   - Seller   +sellerAmount  (total - commission)
 *   - Platform -sellerAmount
 *   - Platform +commission
 *   - Seller   -commission   ... BUT this would be 4 entries.
 *
 * Simplified (2 entries per txn):
 *   Txn 1 (seller revenue):
 *     seller   +(total - commission)  pending
 *     platform -(total - commission)  pending
 *   Txn 2 (platform commission):
 *     platform +commission            pending
 *     seller   -commission            pending
 *
 * Actually, we can do it all in ONE transaction with 2 entries:
 *   seller   +(total - commission)   pending
 *   platform -(total - commission)   pending
 *
 * Commission is recorded separately to keep the audit trail clear:
 *   platform +commission             pending
 *   seller   -commission             pending
 *
 * @param {Object} params
 * @param {string} params.orderId
 * @param {string} params.sellerUserId    - Firebase UID of the seller (ledger account owner)
 * @param {number} params.totalBrl        - Order total (what the buyer paid)
 * @param {number} params.commissionBrl   - Platform commission
 * @param {string} [params.paymentId]     - Asaas payment ID (asaas_ref)
 * @param {string} [params.paymentMethod] - 'pix' | 'credit_card' | 'offline_confirmed'
 */
async function _recordLedgerForOrder({
  orderId, sellerUserId, totalBrl, commissionBrl, paymentId, paymentMethod,
}) {
  try {
    const ledger = require('./unifiedLedgerService');

    // Idempotency check: see if entries already exist for this order
    const existingCheck = await getSupabaseClient()
      .from('ledger_entries')
      .select('id')
      .eq('source_type', 'marketplace_order')
      .eq('source_id', orderId)
      .limit(1);

    if (existingCheck.data && existingCheck.data.length > 0) {
      logger.info(`[${SERVICE}] Ledger entries already exist for order ${orderId} — skipping`, {
        service: SERVICE, action: 'LEDGER_IDEMPOTENT_SKIP', orderId,
      });
      return;
    }

    // Ensure accounts exist
    const sellerAccountId = await ledger.ensureAccount('user', sellerUserId);
    const platformAccountId = ledger.PLATFORM_ACCOUNT_ID;

    const sellerAmount = +(totalBrl - commissionBrl).toFixed(2);

    // --- Transaction 1: Seller revenue (what the seller receives) ---
    if (sellerAmount > 0) {
      await ledger.recordTransaction([
        {
          accountId:   sellerAccountId,
          amountBrl:   sellerAmount,
          status:      'pending',
          sourceType:  'marketplace_order',
          sourceId:    orderId,
          description: `Venda marketplace — pedido ${orderId.substring(0, 8)}`,
          asaasRef:    paymentId || null,
        },
        {
          accountId:   platformAccountId,
          amountBrl:   -sellerAmount,
          status:      'pending',
          sourceType:  'marketplace_order',
          sourceId:    orderId,
          description: `Repasse seller — pedido ${orderId.substring(0, 8)}`,
          asaasRef:    paymentId || null,
        },
      ]);
    }

    // --- Transaction 2: Platform commission ---
    if (commissionBrl > 0) {
      await ledger.recordTransaction([
        {
          accountId:   platformAccountId,
          amountBrl:   commissionBrl,
          status:      'pending',
          sourceType:  'marketplace_order',
          sourceId:    orderId,
          description: `Comissao plataforma — pedido ${orderId.substring(0, 8)}`,
          asaasRef:    paymentId || null,
        },
        {
          accountId:   sellerAccountId,
          amountBrl:   -commissionBrl,
          status:      'pending',
          sourceType:  'marketplace_order',
          sourceId:    orderId,
          description: `Taxa comissao — pedido ${orderId.substring(0, 8)}`,
          asaasRef:    paymentId || null,
        },
      ]);
    }

    logger.info(`[${SERVICE}] Ledger recorded for marketplace order`, {
      service: SERVICE, action: 'LEDGER_RECORD_OK',
      orderId, sellerUserId, totalBrl, commissionBrl, sellerAmount,
      paymentMethod: paymentMethod || 'unknown',
    });
  } catch (ledgerErr) {
    logger.error('Ledger recording failed (non-blocking)', {
      service: SERVICE,
      action: 'LEDGER_RECORD_FAILED',
      severity: 'CRITICAL',
      orderId,
      sellerUserId,
      totalBrl,
      commissionBrl,
      error: ledgerErr.message,
    });
    // NÃO re-throw — fluxo principal continua
  }
}

/**
 * Promotes ledger entries from pending → available when an order is completed.
 * Fire-and-forget — errors are logged but never block the caller.
 *
 * @param {string} orderId
 */
async function _promoteLedgerForOrder(orderId) {
  try {
    const ledger = require('./unifiedLedgerService');
    const promoted = await ledger.promoteToAvailable('marketplace_order', orderId);
    if (promoted > 0) {
      logger.info(`[${SERVICE}] Ledger entries promoted to available`, {
        service: SERVICE, action: 'LEDGER_PROMOTE_OK', orderId, promoted,
      });
    }
  } catch (ledgerErr) {
    logger.error('Ledger promotion failed (non-blocking)', {
      service: SERVICE,
      action: 'LEDGER_PROMOTE_FAILED',
      severity: 'CRITICAL',
      orderId,
      error: ledgerErr.message,
    });
  }
}

/**
 * Reverses ledger entries when an order is cancelled/refunded.
 * Fire-and-forget — errors are logged but never block the caller.
 *
 * Finds the transaction_ids associated with this order and reverses them.
 *
 * @param {string} orderId
 * @param {string} reason
 */
async function _reverseLedgerForOrder(orderId, reason) {
  try {
    const ledger = require('./unifiedLedgerService');
    const supabase = getSupabaseClient();

    // Find all distinct transaction_ids for this order
    const { data: entries, error } = await supabase
      .from('ledger_entries')
      .select('transaction_id')
      .eq('source_type', 'marketplace_order')
      .eq('source_id', orderId)
      .is('reversed_by', null);

    if (error) throw error;
    if (!entries || entries.length === 0) {
      logger.info(`[${SERVICE}] No ledger entries to reverse for order ${orderId}`, {
        service: SERVICE, action: 'LEDGER_REVERSE_SKIP', orderId,
      });
      return;
    }

    // Deduplicate transaction_ids
    const txnIds = [...new Set(entries.map(e => e.transaction_id))];

    for (const txnId of txnIds) {
      await ledger.reverseTransaction(txnId, reason);
    }

    logger.info(`[${SERVICE}] Ledger entries reversed for order`, {
      service: SERVICE, action: 'LEDGER_REVERSE_OK',
      orderId, transactionsReversed: txnIds.length, reason,
    });
  } catch (ledgerErr) {
    logger.error('Ledger reversal failed (non-blocking)', {
      service: SERVICE,
      action: 'LEDGER_REVERSE_FAILED',
      severity: 'CRITICAL',
      orderId,
      reason,
      error: ledgerErr.message,
    });
  }
}

/**
 * Restaura estoque de variantes de um pedido cancelado/expirado (ELOS-BE-014).
 * Fire-and-forget — errors are logged but never block the caller.
 *
 * Extrai variant_id + qty de cada item do pedido e chama restore_variant_stock RPC.
 * Produtos SEM variantes: comportamento atual inalterado (sem decremento automático).
 */
function _restoreVariantStockForOrder(order) {
  const variantItems = (order.items || [])
    .filter(i => i.variant_id)
    .map(i => ({ variant_id: i.variant_id, qty: i.qty }));

  if (variantItems.length === 0) return;

  setImmediate(async () => {
    try {
      await variantService.restoreStock(variantItems);
      logger.info(`[${SERVICE}] Variant stock restored for order ${order.id}`, {
        service: SERVICE, action: 'VARIANT_STOCK_RESTORED',
        orderId: order.id, items: variantItems.length,
      });
    } catch (err) {
      logger.error(`[${SERVICE}] Variant stock restore FAILED for order ${order.id}`, {
        service: SERVICE, action: 'VARIANT_STOCK_RESTORE_FAILED',
        severity: 'HIGH', orderId: order.id, error: err.message,
      });
    }
  });
}

// ──────────────────────────────────────────────────────
// Fulfillment helpers
// ──────────────────────────────────────────────────────

const VALID_FULFILLMENT_TYPES = [
  'pickup', 'local_delivery', 'shipping',
  'in_person_service', 'remote_service', 'barter_meeting'
];

async function defaultFulfillmentTypes(category, isBarterOnly = false) {
  if (isBarterOnly) return ['barter_meeting'];
  try {
    const { data } = await sb()
      .from('marketplace_categories')
      .select('fulfillment_defaults')
      .eq('slug', category)
      .single();
    if (data && data.fulfillment_defaults) {
      return data.fulfillment_defaults;
    }
  } catch (err) {
    logger.warn(`Erro ao buscar defaults de fulfillment para categoria ${category}: ${err.message}`);
  }
  return ['pickup'];
}

function validateFulfillmentTypes(types) {
  if (!Array.isArray(types) || types.length === 0) {
    throw new Error('fulfillment_types deve ser um array não-vazio');
  }
  const invalid = types.filter(t => !VALID_FULFILLMENT_TYPES.includes(t));
  if (invalid.length) {
    throw new Error(`Tipo(s) de fulfillment inválido(s): ${invalid.join(', ')}. Válidos: ${VALID_FULFILLMENT_TYPES.join(', ')}`);
  }
}

// Geocodifica um CEP via BrasilAPI v2 — retorna { lat, lng } ou null (fire-and-forget safe)
async function geocodeCep(cep) {
  if (!cep) return null;
  const raw = String(cep).replace(/\D/g, '');
  if (raw.length !== 8) return null;
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${raw}`);
    if (!res.ok) return null;
    const data = await res.json();
    const coords = data?.location?.coordinates;
    if (!coords?.latitude || !coords?.longitude) return null;
    return { lat: Number(coords.latitude), lng: Number(coords.longitude) };
  } catch {
    return null;
  }
}

// geocodeAddress importado de ../utils/geocoding.js (shared)

// Cadeia completa: BrasilAPI (CEP) → Google Geocoding (endereço completo)
async function resolveCoords({ cep, logradouro, numero, bairro, cidade, estado }) {
  // 1. Tentar BrasilAPI pelo CEP
  const cepCoords = await geocodeCep(cep);
  if (cepCoords) return cepCoords;

  // 2. Fallback: Google Geocoding com endereço textual
  const parts = [logradouro, numero, bairro, cidade, estado, 'Brasil'].filter(Boolean);
  if (parts.length < 2) return null; // precisa de pelo menos bairro + cidade
  return geocodeAddress(parts.join(', '));
}

// Gamificação fire-and-forget — nunca bloqueia o fluxo principal
async function fireEvent(event, userId, metadata = {}) {
  try {
    await gamificationService.triggerEvent(event, userId, metadata);
  } catch (err) {
    logger.warn(`[${SERVICE}] triggerEvent ignorado: ${err.message}`, { event, userId });
  }
}

// ──────────────────────────────────────────────────────
// Taxonomia / Categories
// ──────────────────────────────────────────────────────

async function getCategories() {
  const { data, error } = await sb()
    .from('marketplace_categories')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw new Error(`Erro ao buscar categorias: ${error.message}`);
  return data;
}

// ──────────────────────────────────────────────────────
// 1. Seller Profiles
// ──────────────────────────────────────────────────────

/**
 * Cria o perfil de vendedor do usuário.
 * Um usuário pode ter apenas um seller_profile (constraint UNIQUE user_id).
 */
async function createSellerProfile(userId, data) {
  log('createSellerProfile', 'Criando perfil de vendedor', { userId });

  const {
    business_name, trading_name, category = 'outros', description,
    address_cep, address_logradouro, address_numero, address_complemento,
    address_neighborhood, address_city, address_state, service_radius_km = 5,
    accepts_eloscoins = false, coins_discount_rate = 0.01,
    max_coins_per_order = 1000, document, document_type,
    is_barter_only = false, creci,
    registro_profissional_tipo, registro_profissional_numero, registro_profissional_uf,
    // Coordenadas explícitas do mapa — prioridade sobre geocoding de CEP
    address_lat: explicitLat, address_lng: explicitLng,
    // [BUG-001] Campos do wizard que eram silenciosamente descartados
    seller_subtype,
    seller_subtype_custom,
    delivery_modes,
    service_mode,
    service_area_bairros,
    avg_prep_time_min,
    fulfillment_types,
    // [HANDLE-004] Handle público do negócio (opcional)
    username,
  } = data;

  if (!business_name) throw new Error('business_name é obrigatório');

  // ── Validação de subtipo customizado ──────────────────────────────────────
  const OUTROS_SLUGS = ['outros_alimentacao', 'outros_servicos', 'outros_imoveis', 'outros_produtos'];
  let resolvedSubtypeCustom = null;
  if (OUTROS_SLUGS.includes(seller_subtype)) {
    const trimmed = (seller_subtype_custom || '').trim();
    if (trimmed.length < 3 || trimmed.length > 60) {
      throw new Error('Para o subtipo "Outro", informe uma descrição entre 3 e 60 caracteres');
    }
    resolvedSubtypeCustom = trimmed;
  }

  // ── Validação de documento / KYC ─────────────────────────────────────────
  if (document_type === 'cnpj') {
    // CNPJ: valida formato básico (14 dígitos, aceita pontuação)
    if (document) {
      const cnpjDigits = String(document).replace(/\D/g, '');
      if (cnpjDigits.length !== 14) {
        throw new Error('CNPJ inválido — informe os 14 dígitos');
      }
    }
  } else if (document_type === 'cpf') {
    // CPF: requer KYC nível mínimo verificado
    const { data: userRow, error: userErr } = await sb()
      .from('users')
      .select('kyc_level, kyc_status')
      .eq('id', userId)
      .single();

    if (userErr || !userRow) throw new Error('Usuário não encontrado');

    const validKycLevels = ['cpf', 'document', 'full'];
    if (
      userRow.kyc_status !== 'verified' ||
      !validKycLevels.includes(userRow.kyc_level)
    ) {
      throw new Error(
        'Para abrir sua loja com CPF é necessário ter o CPF validado. ' +
        'Acesse Configurações > Verificação de identidade.'
      );
    }
  }
  // document_type null/undefined: sem restrição adicional (perfis legados e barter)

  // Canal de Troca não aceita ElosCoins como desconto — opera apenas por escambo
  const resolvedAcceptsEloscoins = is_barter_only ? false : accepts_eloscoins;

  // Normaliza CNPJ: armazena apenas dígitos
  const normalizedDocument = document_type === 'cnpj' && document
    ? String(document).replace(/\D/g, '')
    : (document || null);

  // Coordenadas: prioriza mapa explícito (com consentimento); fallback = BrasilAPI → Google
  const hasExplicitCoords = explicitLat != null && explicitLng != null;
  const geoCoords = hasExplicitCoords ? null : await resolveCoords({
    cep: address_cep,
    logradouro: address_logradouro,
    numero: address_numero,
    bairro: address_neighborhood,
    cidade: address_city,
    estado: address_state,
  });
  const resolvedLat = hasExplicitCoords ? Number(explicitLat) : (geoCoords?.lat ?? null);
  const resolvedLng = hasExplicitCoords ? Number(explicitLng) : (geoCoords?.lng ?? null);

  const { data: profile, error } = await sb()
    .from('seller_profiles')
    .insert({
      user_id: userId,
      business_name,
      trading_name,
      category,
      description,
      address_cep:                address_cep ? String(address_cep).replace(/\D/g, '') : null,
      address_logradouro:         address_logradouro || null,
      address_numero:             address_numero || null,
      address_complemento:        address_complemento || null,
      address_neighborhood,
      address_city,
      address_state:              address_state || null,
      address_lat:                resolvedLat,
      address_lng:                resolvedLng,
      address_lat_consented_at:   hasExplicitCoords ? new Date().toISOString() : null,
      service_radius_km,
      accepts_eloscoins: resolvedAcceptsEloscoins,
      coins_discount_rate,
      max_coins_per_order,
      document:      normalizedDocument,
      document_type: document_type || null,
      is_barter_only,
      creci:         creci || null,
      registro_profissional_tipo:   registro_profissional_tipo || null,
      registro_profissional_numero: registro_profissional_numero || null,
      registro_profissional_uf:     registro_profissional_uf || null,
      // [BUG-001] Campos do wizard que eram silenciosamente descartados
      seller_subtype:        seller_subtype || null,
      seller_subtype_custom: resolvedSubtypeCustom,
      delivery_modes:        Array.isArray(delivery_modes) ? delivery_modes : [],
      service_mode:          Array.isArray(service_mode) ? service_mode : [],
      service_area_bairros:  Array.isArray(service_area_bairros) ? service_area_bairros : [],
      avg_prep_time_min:     avg_prep_time_min != null ? Number(avg_prep_time_min) : null,
      fulfillment_types:     Array.isArray(fulfillment_types) && fulfillment_types.length > 0
                               ? fulfillment_types
                               : await defaultFulfillmentTypes(category, is_barter_only),
      // [HANDLE-004] Handle público do negócio (opcional)
      username:                  username || null,
      username_last_changed_at:  username ? new Date().toISOString() : null,
      status: 'pending',
    })
    .select(SELLER_SAFE_COLS)
    .single();

  if (error) throw new Error(`Erro ao criar seller_profile: ${error.message}`);

  log('createSellerProfile', 'Perfil criado', { userId, sellerId: profile.id });

  // [HANDLE-SYNC] Sync seller handle to users.username if user doesn't have one yet
  if (username) {
    try {
      const { data: existingUser } = await sb()
        .from('users')
        .select('username')
        .eq('id', userId)
        .maybeSingle();
      if (existingUser && !existingUser.username) {
        await sb().from('users')
          .update({ username: username.toLowerCase(), username_last_changed_at: new Date().toISOString() })
          .eq('id', userId);
        log('createSellerProfile', 'Synced seller handle to users.username', { userId, username });
      }
    } catch (syncErr) {
      logger.warn(`[${SERVICE}] Failed to sync handle to users table (non-blocking): ${syncErr.message}`, { userId, username });
    }
  }

  // [TEAM-001][EQP-BUG-001] Seed owner como team member — atômico via RPC.
  // Se falhar, o erro PROPAGA (não é mais silencioso). O perfil já foi criado,
  // mas o backfill (migration 20260809000001) e o endpoint admin sintetizam
  // o owner como fallback. O erro será logado e investigado.
  const { error: seedErr } = await sb().rpc('seed_owner_team_member', {
    p_seller_id: profile.id,
    p_user_id:   userId,
  });
  if (seedErr) {
    logger.error(`[${SERVICE}] Falha ao seed owner team member via RPC: ${seedErr.message}`, { userId, sellerId: profile.id });
    // Não lança — o perfil já está criado. O admin endpoint sintetiza o owner como fallback,
    // e o backfill pode ser rodado para corrigir. Mas logamos como ERROR para investigação.
  }

  await fireEvent('seller_registered', userId, { seller_id: profile.id });

  // Cria ticket de suporte para aprovação manual pela equipe
  try {
    await supportService.createTicket({
      userId,
      category: 'account',
      module:   'marketplace',
      issueType: 'seller_approval',
      title: `Solicitação de abertura de ${is_barter_only ? 'canal de troca' : 'loja'}: ${business_name}`,
      description: [
        `Usuário solicitou abertura de ${is_barter_only ? 'Canal de Troca (escambo)' : 'Loja'} no Mercado Local.`,
        `Nome da empresa: ${business_name}`,
        trading_name ? `Nome fantasia: ${trading_name}` : null,
        `Categoria: ${category}`,
        description ? `Descrição: ${description}` : null,
        is_barter_only
          ? `Tipo: Canal de Troca — solicitações custam 50 EloCoins ao solicitante`
          : `Aceita ElosCoins: ${resolvedAcceptsEloscoins ? 'Sim' : 'Não'}`,
      ].filter(Boolean).join('\n'),
      context: {
        sellerProfileId: profile.id,
        businessName:    business_name,
        tradingName:     trading_name || null,
        category,
        acceptsEloscoins: accepts_eloscoins,
        actionRequired: 'approve_or_reject',
        approveEndpoint: `PATCH /api/marketplace/sellers/${profile.id}/approve`,
      },
    });
  } catch (ticketErr) {
    logger.warn(`[${SERVICE}] Falha ao criar ticket de aprovação (não bloqueante): ${ticketErr.message}`, { userId, sellerId: profile.id });
  }

  return profile;
}

/**
 * Retorna o perfil público de um vendedor (active).
 * Lança erro se não encontrado ou inativo (para rotas públicas).
 */
async function getSellerProfile(sellerIdOrHandle) {
  const sellerId = await _resolveSellerUuid(sellerIdOrHandle);
  const { data, error } = await sb()
    .from('seller_profiles')
    .select(`
      id, username, business_name, trading_name, category, description,
      address_neighborhood, address_city, service_radius_km,
      accepts_eloscoins, coins_discount_rate, max_coins_per_order,
      commission_rate, status, creci, business_hours,
      fulfillment_types, freight_mode, document_validated, created_at,
      avg_rating, total_reviews, cover_image_url,
      owner:user_id ( full_name, avatar_url, username )
    `)
    .eq('id', sellerId)
    .neq('status', 'deleted')
    .single();

  if (error || !data) throw new Error('Vendedor não encontrado');
  return { ...data, creci_verified: !!data.creci };
}

// Colunas seguras de seller_profiles — exclui `location` (GEOGRAPHY) para nunca expor coords brutas
const SELLER_SAFE_COLS = [
  'id', 'user_id', 'business_name', 'trading_name', 'category', 'description',
  'address_cep', 'address_logradouro', 'address_numero', 'address_complemento',
  'address_neighborhood', 'address_city', 'address_state',
  'address_lat', 'address_lng', 'address_lat_consented_at',
  'service_radius_km',
  'document', 'document_type', 'document_validated', 'commission_rate', 'status', 'status_note',
  'location_public', 'location_consented_at', 'is_barter_only',
  'fulfillment_types',
  'freight_mode', 'freight_split_ratio',
  'creci',
  'registro_profissional_tipo', 'registro_profissional_numero', 'registro_profissional_uf',
  'registro_profissional_verificado', 'registro_profissional_verificado_em',
  'seller_subtype', 'seller_subtype_custom',
  'delivery_modes', 'service_mode', 'service_area_bairros', 'avg_prep_time_min',
  'business_hours',
  'avg_rating', 'total_reviews',
  'billing_mode', 'subscription_status', 'subscription_grace_until', 'plan_slug',
  'google_place_id', 'google_rating', 'google_reviews_count', 'google_business_name',
  'google_url', 'google_business_status', 'google_photo_reference',
  'google_places_synced_at', 'google_place_linked_at', 'google_place_linked_by',
  'guarantee_fund_mode',
  'business_type',
  'accepts_guest_orders',
  'username', 'username_last_changed_at',
  'whatsapp',
  'cover_image_url',
  'accepts_eloscoins', 'coins_discount_rate', 'max_coins_per_order',
  'created_at', 'updated_at',
].join(', ');

/**
 * Retorna o próprio perfil (incluindo status pending/suspended).
 * [HYPER-005][LGPD] select explícito — nunca retorna `location` (GEOGRAPHY).
 * [BIZ-002] Aceita sellerId opcional para multi-business context.
 */
async function getMySellerProfile(userId, sellerId = null) {
  let query = sb()
    .from('seller_profiles')
    .select(SELLER_SAFE_COLS)
    .neq('status', 'deleted');

  if (sellerId) {
    // Multi-business: busca seller específico onde user é owner ou team member
    query = query.eq('id', sellerId);
  } else {
    // Legacy: busca por user_id (owner direto)
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query.single();

  if (error || !data) throw new Error('Perfil de vendedor não encontrado para este usuário');
  return data;
}

/**
 * [BIZ-002] Retorna todos os negócios onde o user é owner OU team member ativo.
 * @returns {Array<{seller_id, business_name, trading_name, category, status, role, permissions, business_type}>}
 */
async function getMyBusinesses(userId) {
  // 1. Negócios próprios (owner)
  const { data: ownedSellers } = await sb()
    .from('seller_profiles')
    .select('id, business_name, trading_name, category, status, business_type, username')
    .eq('user_id', userId)
    .neq('status', 'deleted');

  const owned = (ownedSellers || []).map(s => ({
    seller_id:     s.id,
    business_name: s.business_name,
    trading_name:  s.trading_name,
    category:      s.category,
    status:        s.status,
    business_type: s.business_type,
    username:      s.username || null,
    role:          'owner',
    permissions:   {
      can_manage_clients: true, can_manage_pendencias: true,
      can_view_financials: true, can_manage_team: true,
      can_manage_catalog: true, can_manage_orders: true, can_manage_settings: true, can_manage_billing: true,
    },
  }));

  // 2. Negócios onde é team member ativo
  const { data: teamMemberships } = await sb()
    .from('seller_team_members')
    .select(`
      seller_id, role, permissions,
      seller_profiles (id, business_name, trading_name, category, status, business_type, username)
    `)
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('active', true);

  const team = (teamMemberships || [])
    .filter(m => m.seller_profiles && m.seller_profiles.status !== 'deleted')
    .map(m => ({
      seller_id:     m.seller_id,
      business_name: m.seller_profiles.business_name,
      trading_name:  m.seller_profiles.trading_name,
      category:      m.seller_profiles.category,
      status:        m.seller_profiles.status,
      business_type: m.seller_profiles.business_type,
      username:      m.seller_profiles.username || null,
      role:          m.role,
      permissions:   m.permissions || {},
    }));

  // 3. Merge, dedup (owner takes priority over team membership for same seller)
  const ownedIds = new Set(owned.map(o => o.seller_id));
  const teamFiltered = team.filter(t => !ownedIds.has(t.seller_id));

  return [...owned, ...teamFiltered];
}

/**
 * Lista vendedores ativos com filtros opcionais.
 * @param {object} filters - { category, address_city, address_neighborhood }
 * @param {object} pagination - { limit = 20, page = 1 }
 */
async function listSellers({ category, address_city, address_neighborhood } = {}, { limit = 20, page = 1 } = {}) {
  const safeLimit = Math.min(parseInt(limit) || 20, 100);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * safeLimit;

  // PREFS-003: buscar sellers que desativaram appear_in_searches
  const hiddenSellerUserIds = await getOptedOutUserIds('appear_in_searches');

  let query = sb()
    .from('seller_profiles')
    .select('id, user_id, business_name, trading_name, category, description, address_neighborhood, address_city, address_lat, address_lng, service_radius_km, accepts_eloscoins, coins_discount_rate, max_coins_per_order, avg_rating, total_reviews, google_place_id, google_rating, google_reviews_count, google_business_name, google_business_status, status, cover_image_url, username, created_at', { count: 'exact' })
    .eq('status', 'active')
    .range(offset, offset + safeLimit - 1);

  // PREFS-003: excluir sellers que desativaram appear_in_searches
  if (hiddenSellerUserIds.length > 0) {
    query = query.not('user_id', 'in', `(${hiddenSellerUserIds.join(',')})`);
  }

  if (category)              query = query.eq('category', category);
  if (address_city)          query = query.ilike('address_city', `%${address_city}%`);
  if (address_neighborhood)  query = query.ilike('address_neighborhood', `%${address_neighborhood}%`);

  const { data, error, count } = await query;
  if (error) throw new Error(`Erro ao listar vendedores: ${error.message}`);

  return { sellers: data || [], total: count || 0, page, limit: safeLimit };
}

/**
 * Atualiza o perfil do próprio vendedor.
 * Campos imutáveis: user_id, commission_rate, status (gerenciado por admin).
 * [HYPER-005][LGPD] location só pode ser definida junto com location_consented_at.
 */
async function updateSellerProfile(userId, updates) {
  const IMMUTABLE = [
    'user_id', 'commission_rate', 'status', 'created_at', 'id',
    // Google Places — gerenciados exclusivamente pelo googlePlacesService
    'google_place_id', 'google_rating', 'google_reviews_count', 'google_business_name',
    'google_url', 'google_business_status', 'google_photo_reference',
    'google_places_synced_at', 'google_place_linked_at', 'google_place_linked_by',
  ];
  IMMUTABLE.forEach(f => delete updates[f]);

  // Guarda LGPD Art. 7: coords apenas com consentimento explícito e simultâneo
  if (updates.location !== undefined && !updates.location_consented_at) {
    throw new Error('location_consented_at é obrigatório ao definir location (LGPD Art. 7)');
  }
  if (updates.location_consented_at !== undefined && updates.location === undefined) {
    throw new Error('location_consented_at só pode ser definido junto com location');
  }

  // [STORE-TYPE-001] Validação de category
  const VALID_CATEGORIES = ['alimentacao', 'servicos', 'produtos', 'imoveis', 'outros'];
  if (updates.category && !VALID_CATEGORIES.includes(updates.category)) {
    throw new Error(`Categoria inválida: "${updates.category}". Valores aceitos: ${VALID_CATEGORIES.join(', ')}`);
  }

  // [STORE-TYPE-001] Normaliza business_hours: camelCase → snake_case (frontend pode enviar businessHours)
  if (updates.businessHours !== undefined) {
    updates.business_hours = updates.businessHours;
    delete updates.businessHours;
  }

  // Coordenadas explícitas do mapa (prioridade sobre geocoding de CEP)
  const hasExplicitCoords = updates.address_lat != null && updates.address_lng != null;
  if (hasExplicitCoords) {
    updates.address_lat              = Number(updates.address_lat);
    updates.address_lng              = Number(updates.address_lng);
    updates.address_lat_consented_at = new Date().toISOString();
  } else if (updates.address_cep || updates.address_logradouro || updates.address_neighborhood || updates.address_city) {
    // Geocodifica se endereço foi atualizado e não há coords explícitas
    if (updates.address_cep) {
      updates.address_cep = String(updates.address_cep).replace(/\D/g, '');
    }
    const geoCoords = await resolveCoords({
      cep: updates.address_cep,
      logradouro: updates.address_logradouro,
      numero: updates.address_numero,
      bairro: updates.address_neighborhood,
      cidade: updates.address_city,
      estado: updates.address_state,
    });
    if (geoCoords) {
      updates.address_lat = geoCoords.lat;
      updates.address_lng = geoCoords.lng;
    }
    // Sem consentimento explícito ao geocodificar automaticamente
    if (updates.address_lat_consented_at === undefined) {
      delete updates.address_lat_consented_at;
    }
  }

  // Auto-sync whatsapp: copia users.telefone se não vier explicitamente no payload
  if (updates.whatsapp === undefined) {
    try {
      const { data: user } = await sb().from('users').select('telefone').eq('id', userId).maybeSingle();
      if (user?.telefone) updates.whatsapp = user.telefone;
    } catch { /* silently skip — telefone sync is best-effort */ }
  }

  // ── Validação cruzada de subtipo customizado ───────────────────────────────
  const OUTROS_SLUGS_UPD = ['outros_alimentacao', 'outros_servicos', 'outros_imoveis', 'outros_produtos'];
  if (updates.seller_subtype !== undefined) {
    if (OUTROS_SLUGS_UPD.includes(updates.seller_subtype)) {
      const trimmed = (updates.seller_subtype_custom || '').trim();
      if (trimmed.length < 3 || trimmed.length > 60) {
        throw new Error('Para o subtipo "Outro", informe uma descrição entre 3 e 60 caracteres');
      }
      updates.seller_subtype_custom = trimmed;
    } else {
      updates.seller_subtype_custom = null;
    }
  }

  // [HANDLE-004] Auto-set username_last_changed_at quando username muda
  // [HANDLE-005] Record old handle in history before changing
  if (updates.username !== undefined) {
    updates.username_last_changed_at = new Date().toISOString();
    try {
      const { data: currentSeller } = await sb().from('seller_profiles').select('id, username').eq('user_id', userId).maybeSingle();
      if (currentSeller?.username && currentSeller.username !== updates.username) {
        await handleService.recordHandleRelease(currentSeller.username, 'seller', currentSeller.id);
      }
    } catch (err) {
      logger.warn('Failed to record seller handle release', { userId, error: err.message });
    }
  }

  updates.updated_at = new Date().toISOString();

  const { data, error } = await sb()
    .from('seller_profiles')
    .update(updates)
    .eq('user_id', userId)
    .select(SELLER_SAFE_COLS)
    .single();

  if (error) throw new Error(`Erro ao atualizar perfil: ${error.message}`);

  // [HANDLE-SYNC] Keep users.username in sync with seller handle
  if (updates.username !== undefined) {
    try {
      const newUsername = updates.username?.toLowerCase() || null;
      await sb().from('users')
        .update({ username: newUsername, username_last_changed_at: new Date().toISOString() })
        .eq('id', userId);
      log('updateSellerProfile', 'Synced seller handle to users.username', { userId, username: newUsername });
    } catch (syncErr) {
      logger.warn(`[${SERVICE}] Failed to sync handle to users table (non-blocking): ${syncErr.message}`, { userId });
    }
  }

  return data;
}

/**
 * Remove as coordenadas geográficas do vendedor.
 * [HYPER-005][LGPD Art. 18] Direito ao esquecimento — não remove location_public (texto).
 */
async function removeSellerLocation(userId) {
  log('removeSellerLocation', 'Removendo localização do vendedor (LGPD Art. 18)', { userId });

  const { data, error } = await sb()
    .from('seller_profiles')
    .update({
      location:                    null,
      location_consented_at:       null,
      address_lat:                 null,
      address_lng:                 null,
      address_lat_consented_at:    null,
      updated_at:                  new Date().toISOString(),
    })
    .eq('user_id', userId)
    .select('id, location_public, location_consented_at, address_lat_consented_at')
    .single();

  if (error) throw new Error(`Erro ao remover localização: ${error.message}`);
  log('removeSellerLocation', 'Localização removida', { userId });
  return data;
}

// ──────────────────────────────────────────────────────
// 2. Produtos
// ──────────────────────────────────────────────────────

/**
 * Cria um produto no catálogo do vendedor.
 * Requer que o userId tenha um seller_profile ativo.
 */
async function createProduct(userId, data, sellerId = null) {
  log('createProduct', 'Criando produto', { userId, sellerId });

  const seller = await getMySellerProfile(userId, sellerId);
  if (seller.status !== 'active') {
    throw new Error('Perfil de vendedor não está ativo. Aguarde aprovação.');
  }

  // ProductValidator: valida campos por tipo de seller e sanitiza payload
  const { validated } = ProductValidator.validate(data, seller.category);

  const {
    name, description, category, price_brl, max_coins_discount,
    stock, images, fulfillment_types, property_details, property_status,
    listing_type,
    product_type, menu_category_id, prep_time_min, serves, allergens,
    is_available_now, weight_kg, dimensions_cm, sku, unit_of_measure,
    duration_minutes, cancellation_policy, service_mode,
    min_capacity, booking_deadline_hours,
    gtin,
    variant_attributes,
  } = validated;

  // Validar variant_attributes se fornecido (ELOS-BE-014)
  if (variant_attributes != null) {
    if (!Array.isArray(variant_attributes) || variant_attributes.length === 0) {
      throw new Error('variant_attributes deve ser um array não-vazio de strings (eixos de variação).');
    }
    if (!variant_attributes.every(a => typeof a === 'string' && a.trim().length > 0)) {
      throw new Error('Cada eixo de variant_attributes deve ser uma string não-vazia.');
    }
  }

  // Validar que menu_category_id pertence ao seller (se fornecido)
  if (menu_category_id) {
    const { data: catRow, error: catErr } = await sb()
      .from('menu_categories')
      .select('id')
      .eq('id', menu_category_id)
      .eq('seller_id', seller.id)
      .single();
    if (catErr || !catRow) {
      throw new Error('Categoria informada não pertence a este vendedor.');
    }
  }

  // Resolve fulfillment_types: usa o fornecido, ou aplica default da categoria do seller
  const resolvedFulfillment = fulfillment_types != null
    ? fulfillment_types
    : await defaultFulfillmentTypes(seller.category, seller.is_barter_only);

  validateFulfillmentTypes(resolvedFulfillment);

  const { data: product, error } = await sb()
    .from('marketplace_products')
    .insert({
      seller_id: seller.id,
      name,
      description,
      // Fallback para categoria do seller — evita category=NULL se o frontend omitir o campo
      category: category ?? seller.category,
      product_type,
      price_brl: Number(price_brl),
      max_coins_discount: max_coins_discount != null ? Number(max_coins_discount) : null,
      stock: stock != null ? Number(stock) : null,
      images: images || [],
      fulfillment_types: resolvedFulfillment,
      // Alimentação
      menu_category_id:  menu_category_id  ?? null,
      prep_time_min:     prep_time_min     ?? null,
      serves:            serves            ?? null,
      allergens:         allergens         ?? null,
      is_available_now:  is_available_now  ?? true,
      // Serviços
      duration_minutes:        duration_minutes        ?? null,
      cancellation_policy:     cancellation_policy     ?? null,
      service_mode:            service_mode            ?? 'individual',
      min_capacity:            min_capacity            ?? 1,
      booking_deadline_hours:  booking_deadline_hours  ?? 24,
      // Produtos físicos
      weight_kg:         weight_kg         ?? null,
      dimensions_cm:     dimensions_cm     ?? null,
      sku:               sku               ?? null,
      unit_of_measure:   unit_of_measure   ?? null,
      // Imóveis
      property_details:  property_details  ?? null,
      listing_type:      listing_type      ?? null,
      ...(product_type === 'property' ? { property_status: property_status || 'disponivel' } : {}),
      // GTIN (código de barras — ELOS-BE-004)
      gtin:              gtin              ?? null,
      // Variantes (ELOS-BE-014) — eixos de variação
      variant_attributes: variant_attributes ?? null,
      active: true,
    })
    .select()
    .single();

  if (error) throw new Error(`Erro ao criar produto: ${error.message}`);
  log('createProduct', 'Produto criado', { productId: product.id, product_type });

  // Fire-and-forget: enriquece catálogo canônico com dados do merchant (ELOS-BE-004)
  if (gtin) {
    gtinService.upsertCatalogOnSave(gtin, { name, brand: null, weight_kg, dimensions_cm }).catch(err => {
      logger.warn('[marketplaceService] upsertCatalogOnSave fire-and-forget error', { gtin, error: err.message });
    });
  }

  return product;
}

/**
 * Busca geoespacial de produtos via RPC products_near.
 * Filtro por tipo de fulfillment + distância PostGIS (quando coords fornecidas).
 * Fallback textual por neighborhood/city quando sem coords.
 *
 * Privacidade:
 *   - Coords do comprador: usadas na query, NUNCA armazenadas
 *   - Resposta inclui distance_band (faixa textual), nunca coords brutas
 *
 * @param {object} filters - { lat, lng, fulfillment, neighborhood, city, max_browse_km }
 * @param {object} pagination - { limit, page }
 */
/**
 * Busca localização hiperlocal do usuário (home_bairro/cidade/estado).
 * [HYPER-LOCAL] Usada pelo controller para injetar filtros automaticamente.
 * Fire-and-forget: retorna null se falhar.
 */
async function getUserLocation(userId) {
  try {
    const { data, error } = await sb()
      .from('users')
      .select('home_bairro, home_cidade, home_estado')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data?.home_bairro) return null;
    return { bairro: data.home_bairro, cidade: data.home_cidade, estado: data.home_estado };
  } catch {
    return null;
  }
}

async function listProductsNear(
  { lat, lng, fulfillment, neighborhood, city, state, category, listing_type, max_browse_km = 10 } = {},
  { limit = 20, page = 1 } = {}
) {
  const safeLimit  = Math.min(parseInt(limit)       || 20, 100);
  const offset     = (Math.max(parseInt(page) || 1, 1) - 1) * safeLimit;
  const browsekm   = parseFloat(max_browse_km)      || 10;

  // Coordenadas — parse e validação
  const parsedLat = lat != null && lat !== '' ? parseFloat(lat) : null;
  const parsedLng = lng != null && lng !== '' ? parseFloat(lng) : null;

  if ((parsedLat !== null) !== (parsedLng !== null)) {
    throw new Error('lat e lng devem ser fornecidos juntos');
  }
  if (parsedLat !== null && (parsedLat < -90  || parsedLat > 90))  throw new Error('lat inválido (esperado: -90 a 90)');
  if (parsedLng !== null && (parsedLng < -180 || parsedLng > 180)) throw new Error('lng inválido (esperado: -180 a 180)');

  // Tipos de fulfillment — aceita string CSV ou array
  let fulfillmentArray = null;
  if (fulfillment) {
    fulfillmentArray = Array.isArray(fulfillment)
      ? fulfillment
      : String(fulfillment).split(',').map(f => f.trim()).filter(Boolean);

    const VALID_TYPES = ['pickup','local_delivery','shipping','in_person_service','remote_service','barter_meeting'];
    const invalid = fulfillmentArray.filter(f => !VALID_TYPES.includes(f));
    if (invalid.length) throw new Error(`Tipo(s) de fulfillment inválido(s): ${invalid.join(', ')}`);
  }

  // Params para products_near v2 (9 params — p_state sempre presente para desambiguar overloads)
  const rpcParams = {
    p_lat:           parsedLat,
    p_lng:           parsedLng,
    p_fulfillment:   fulfillmentArray,
    p_max_browse_km: browsekm,
    p_neighborhood:  neighborhood || null,
    p_city:          city         || null,
    p_state:         state        || null,
    p_limit:         safeLimit,
    p_offset:        offset,
  };

  const { data, error } = await sb().rpc('products_near', rpcParams);

  if (error) {
    logError('listProductsNear', error, { lat: parsedLat, lng: parsedLng });
    throw new Error(`Erro na busca geoespacial: ${error.message}`);
  }

  const results   = data || [];
  const totalCount = results[0]?.total_count ?? results.length;

  // Remove o campo interno total_count de cada linha
  let products = results.map(({ total_count: _tc, ...p }) => p);

  // Imóveis: isolamento bidirecional — só aparecem na aba dedicada, e a aba só mostra imóveis
  if (category === 'imoveis') {
    products = products.filter(p => p.product_type === 'property');
    // Aplica filtro de status no JS (o RPC não filtra por property_status)
    products = products.filter(p => !p.property_status || p.property_status === 'disponivel');
    // Filtro por tipo de anúncio (aluguel_fixo | temporada | venda)
    if (listing_type) products = products.filter(p => p.listing_type === listing_type);
  } else {
    products = products.filter(p => p.product_type !== 'property');
  }

  return {
    products,
    total:       Number(totalCount),
    page,
    limit:       safeLimit,
    geo_enabled: parsedLat !== null,
  };
}

/**
 * [ICON-SEARCH-002] Busca cross-seller para IconChat marketplace discovery.
 * Usa products_near v5 com full-text search, filtros de preço, categoria e relevance score.
 *
 * @param {object} filters - { q, category, city, state, neighborhood, lat, lng, min_price, max_price, fulfillment, listing_type }
 * @param {object} pagination - { limit, page }
 * @returns {{ products, total, page, limit }}
 */
async function searchMarketplace(
  { q, category, city, state, neighborhood, lat, lng, min_price, max_price, fulfillment, listing_type } = {},
  { limit = 10, page = 1 } = {}
) {
  const safeLimit = Math.min(parseInt(limit) || 10, 20);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * safeLimit;

  // Coordenadas
  const parsedLat = lat != null && lat !== '' ? parseFloat(lat) : null;
  const parsedLng = lng != null && lng !== '' ? parseFloat(lng) : null;
  if ((parsedLat !== null) !== (parsedLng !== null)) {
    throw new Error('lat e lng devem ser fornecidos juntos');
  }

  // Fulfillment — CSV string para array
  let fulfillmentArray = null;
  if (fulfillment) {
    fulfillmentArray = String(fulfillment).split(',').map(f => f.trim()).filter(Boolean);
    const VALID_TYPES = ['pickup', 'local_delivery', 'shipping', 'in_person_service', 'remote_service', 'barter_meeting'];
    const invalid = fulfillmentArray.filter(f => !VALID_TYPES.includes(f));
    if (invalid.length) throw new Error(`Tipo(s) de fulfillment inválido(s): ${invalid.join(', ')}`);
  }

  // RPC products_near v5 (novos params: p_query, p_min_price, p_max_price, p_category)
  const rpcParams = {
    p_lat:           parsedLat,
    p_lng:           parsedLng,
    p_fulfillment:   fulfillmentArray,
    p_max_browse_km: 10,
    p_neighborhood:  neighborhood || null,
    p_city:          city         || null,
    p_state:         state        || null,
    p_limit:         safeLimit,
    p_offset:        offset,
    p_query:         q            || null,
    p_min_price:     min_price    ?? null,
    p_max_price:     max_price    ?? null,
    p_category:      category === 'imoveis' ? null : (category || null),
  };

  const { data, error } = await sb().rpc('products_near', rpcParams);

  if (error) {
    logError('searchMarketplace', error, { q, category, city });
    throw new Error(`Erro na busca marketplace: ${error.message}`);
  }

  const results = data || [];
  const totalCount = results[0]?.total_count ?? results.length;

  let products = results.map(({ total_count: _tc, ...p }) => {
    // Format para contrato IconChat E1
    return {
      product_id:       p.id,
      name:             p.name,
      description:      p.description,
      price_brl:        p.price_brl,
      category:         p.category,
      product_type:     p.product_type,
      listing_type:     p.listing_type,
      images:           p.images || [],
      fulfillment_types: p.fulfillment_types,
      seller: {
        id:             p.seller_id,
        business_name:  p.seller_business_name,
        trading_name:   p.seller_trading_name,
        location:       p.seller_location_public || null,
      },
      distance_band:    p.distance_band,
      relevance:        p.relevance != null ? Number(p.relevance) : null,
      is_boosted:       p.is_boosted || false,
      deep_link:        `/s/${p.seller_id}/produto/${p.id}`,
    };
  });

  // Isolamento bidirecional de imóveis
  if (category === 'imoveis') {
    products = products.filter(p => p.product_type === 'property');
    products = products.filter(p => {
      const raw = results.find(r => r.id === p.product_id);
      return !raw?.property_status || raw.property_status === 'disponivel';
    });
    if (listing_type) {
      products = products.filter(p => p.listing_type === listing_type);
    }
  } else {
    products = products.filter(p => p.product_type !== 'property');
  }

  return {
    products,
    total: Number(totalCount),
    page,
    limit: safeLimit,
  };
}

/**
 * Lista produtos com filtros opcionais.
 * Retorna apenas active=true para usuários comuns.
 */
async function listProducts({ seller_id, category, listing_type, min_price, max_price, quartos_min, area_min, property_status, price_max } = {}, { limit = 20, page = 1 } = {}) {
  const safeLimit = Math.min(parseInt(limit) || 20, 100);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * safeLimit;

  // PREFS-003: buscar sellers que desativaram appear_in_searches
  const hiddenSellerUserIds = await getOptedOutUserIds('appear_in_searches');

  let query = sb()
    .from('marketplace_products')
    .select('*, seller_profiles!inner(id, user_id, business_name, trading_name, address_neighborhood, address_city, accepts_eloscoins, coins_discount_rate, max_coins_per_order, seller_subtype, status, username)', { count: 'exact' })
    .eq('active', true)
    .neq('seller_profiles.status', 'deleted')
    .range(offset, offset + safeLimit - 1);

  // PREFS-003: excluir produtos de sellers que desativaram appear_in_searches
  if (hiddenSellerUserIds.length > 0) {
    query = query.not('seller_profiles.user_id', 'in', `(${hiddenSellerUserIds.join(',')})`);
  }

  if (seller_id)    query = query.eq('seller_id', seller_id);
  if (listing_type) query = query.eq('listing_type', listing_type);
  // Imóveis: usar product_type como âncora (robusto mesmo se category vier NULL)
  if (category === 'imoveis') {
    query = query.eq('product_type', 'property');
  } else if (seller_id) {
    // Visualizando loja de um seller específico: mostrar TODOS os produtos dele (incluindo imóveis)
    if (category) query = query.eq('category', category);
  } else {
    if (category) query = query.eq('category', category);
    query = query.neq('product_type', 'property');
  }
  if (min_price)  query = query.gte('price_brl', Number(min_price));
  // price_max aceita tanto max_price quanto price_max como alias
  const effectivePriceMax = price_max ?? max_price;
  if (effectivePriceMax) query = query.lte('price_brl', Number(effectivePriceMax));

  // Filtros específicos para categoria imoveis
  if (category === 'imoveis') {
    if (quartos_min) {
      query = query.filter('property_details->>quartos', 'gte', String(quartos_min));
    }
    if (area_min) {
      query = query.filter('property_details->>area_m2', 'gte', String(area_min));
    }
    if (property_status) {
      query = query.eq('property_status', property_status);
    } else {
      // Default: exibe apenas disponíveis ao navegar em imóveis
      query = query.eq('property_status', 'disponivel');
    }
  }

  const { data, error, count } = await query;
  if (error) throw new Error(`Erro ao listar produtos: ${error.message}`);

  return { products: data || [], total: count || 0, page, limit: safeLimit };
}

/**
 * Retorna um produto pelo ID, com join do perfil do vendedor.
 * Somente produtos active=true são retornados.
 */
async function getProduct(id) {
  const { data, error } = await sb()
    .from('marketplace_products')
    .select(`
      *,
      seller_profiles!inner (
        id, business_name, trading_name, category, description,
        address_neighborhood, address_city, service_radius_km,
        accepts_eloscoins, coins_discount_rate, max_coins_per_order, status, username
      )
    `)
    .eq('id', id)
    .eq('active', true)
    .single();

  if (error) {
    if (error.code === 'PGRST116') throw Object.assign(new Error('Produto não encontrado.'), { status: 404 });
    throw new Error(`Erro ao buscar produto: ${error.message}`);
  }
  return data;
}

/**
 * Lista todos os produtos do próprio vendedor (active e inactive).
 * Usado pelo SellerDashboard — nunca expõe produtos de outros vendedores.
 */
async function listMyProducts(userId, { limit = 50, page = 1 } = {}, sellerId = null) {
  const seller = await getMySellerProfile(userId, sellerId);
  const safeLimit = Math.min(parseInt(limit) || 50, 100);
  const offset    = (Math.max(parseInt(page) || 1, 1) - 1) * safeLimit;

  const { data, error, count } = await sb()
    .from('marketplace_products')
    .select('*', { count: 'exact' })
    .eq('seller_id', seller.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + safeLimit - 1);

  if (error) throw new Error(`Erro ao listar produtos do vendedor: ${error.message}`);
  return { products: data || [], total: count || 0, page, limit: safeLimit };
}

/**
 * Atualiza um produto. Somente o dono (via seller_profile) pode editar.
 */
async function updateProduct(userId, productId, updates, sellerId = null) {
  const seller = await getMySellerProfile(userId, sellerId);

  const IMMUTABLE = ['id', 'seller_id', 'created_at'];
  IMMUTABLE.forEach(f => delete updates[f]);

  // Valida fulfillment_types se fornecido
  if (updates.fulfillment_types != null) {
    validateFulfillmentTypes(updates.fulfillment_types);
  }

  // Valida variant_attributes se fornecido (ELOS-BE-014)
  if (updates.variant_attributes !== undefined) {
    if (updates.variant_attributes != null) {
      if (!Array.isArray(updates.variant_attributes) || updates.variant_attributes.length === 0) {
        throw new Error('variant_attributes deve ser um array não-vazio de strings (eixos de variação).');
      }
      if (!updates.variant_attributes.every(a => typeof a === 'string' && a.trim().length > 0)) {
        throw new Error('Cada eixo de variant_attributes deve ser uma string não-vazia.');
      }
    }
    // NULL é permitido (remove eixos — mas cuidado: variantes existentes ficarão órfãs do trigger)
  }

  // Valida menu_category_id pertence ao seller (se fornecido)
  if (updates.menu_category_id) {
    const { data: catRow, error: catErr } = await sb()
      .from('menu_categories')
      .select('id')
      .eq('id', updates.menu_category_id)
      .eq('seller_id', seller.id)
      .single();
    if (catErr || !catRow) {
      throw new Error('Categoria informada não pertence a este vendedor.');
    }
  }

  // Valida property_status se fornecido
  if (updates.property_status != null) {
    const validStatuses = ['disponivel', 'reservado', 'alugado', 'vendido', 'inativo'];
    if (!validStatuses.includes(updates.property_status)) {
      throw new Error(`property_status inválido: ${updates.property_status}`);
    }
  }

  updates.updated_at = new Date().toISOString();

  const { data, error } = await sb()
    .from('marketplace_products')
    .update(updates)
    .eq('id', productId)
    .eq('seller_id', seller.id) // garante ownership
    .select()
    .single();

  if (error || !data) throw new Error('Produto não encontrado ou sem permissão');

  // Fire-and-forget: enriquece catálogo canônico com dados do merchant (ELOS-BE-004)
  if (data.gtin) {
    gtinService.upsertCatalogOnSave(data.gtin, {
      name: data.name,
      brand: null,
      weight_kg: data.weight_kg,
      dimensions_cm: data.dimensions_cm,
    }).catch(err => {
      logger.warn('[marketplaceService] upsertCatalogOnSave (update) fire-and-forget error', { gtin: data.gtin, error: err.message });
    });
  }

  return data;
}

/**
 * Soft-delete: desativa o produto (active = false, deleted_at = now).
 * Impede exclusão se o produto faz parte de um pedido ativo.
 */
async function deactivateProduct(userId, productId, sellerId = null) {
  // Verificar pedidos ativos que referenciam este produto
  const { data: hasActive } = await sb().rpc('has_active_orders_for_product', { p_product_id: productId });
  if (hasActive) {
    throw new Error('Este produto faz parte de pedidos ativos ou em andamento. Finalize ou cancele os pedidos antes de excluí-lo.');
  }
  return updateProduct(userId, productId, { active: false, deleted_at: new Date().toISOString() }, sellerId);
}

/**
 * Pausa/reativa um produto (toggle active) SEM tocar deleted_at.
 * - active=false → produto pausado (não aparece na loja pública, visível no catálogo do vendedor)
 * - active=true  → reativa (só se deleted_at for null — não reativa excluídos)
 */
async function toggleProductActive(userId, productId, active, sellerId = null) {
  const seller = await getMySellerProfile(userId, sellerId);

  // Se reativando, verificar que o produto não está excluído (deleted_at != null)
  if (active) {
    const { data: existing, error: fetchErr } = await sb()
      .from('marketplace_products')
      .select('id, deleted_at')
      .eq('id', productId)
      .eq('seller_id', seller.id)
      .single();

    if (fetchErr || !existing) throw new Error('Produto não encontrado ou sem permissão');
    if (existing.deleted_at) throw new Error('Não é possível reativar um produto excluído. Crie um novo produto.');
  }

  const { data, error } = await sb()
    .from('marketplace_products')
    .update({ active: !!active, updated_at: new Date().toISOString() })
    .eq('id', productId)
    .eq('seller_id', seller.id)
    .is('deleted_at', null) // nunca altera produtos excluídos
    .select()
    .single();

  if (error || !data) throw new Error('Produto não encontrado ou sem permissão');
  return data;
}

/**
 * Atualiza diretamente o property_status de um imóvel.
 * Não requer ownership via userId — usado por admins ou triggers internos.
 * Para atualização pelo próprio vendedor, usar updateProduct.
 */
async function updateProductPropertyStatus(productId, status) {
  const validStatuses = ['disponivel', 'reservado', 'alugado', 'vendido', 'inativo'];
  if (!validStatuses.includes(status)) throw new Error(`Status inválido: ${status}`);
  const { data, error } = await sb()
    .from('marketplace_products')
    .update({ property_status: status })
    .eq('id', productId)
    .select('id, property_status')
    .single();
  if (error) throw error;
  return data;
}

// ──────────────────────────────────────────────────────
// 3. Pedidos
// ──────────────────────────────────────────────────────

/**
 * Verifica se o vendedor está coberto por assinatura (isenção de comissão).
 * Usa dados do sellerProfile (billing_mode + subscription_status + grace).
 * Decisão D3: grace_until cobre 7 dias após expiração.
 *
 * Esta é a verificação SÍNCRONA rápida (sem RPC). A verificação de auditoria
 * mais precisa (is_sale_covered_by_plan) roda no billing event recording.
 */
function _isSubscriptionCovered(sellerProfile) {
  if (sellerProfile.billing_mode !== 'subscription') return false;
  const status = sellerProfile.subscription_status;
  if (status === 'active') return true;
  if (status === 'grace_period' && sellerProfile.subscription_grace_until) {
    return new Date(sellerProfile.subscription_grace_until) > new Date();
  }
  return false;
}

/**
 * Calcula os valores do pedido a partir dos IDs dos itens no banco.
 * Nunca confia nos preços enviados pelo cliente.
 * @returns {{ items, subtotal_brl, coins_discount_brl, total_brl, commission_brl }}
 */
async function _calculateOrderTotals(sellerProfile, itemsInput, coinsUsed = 0, deliveryFee = 0, guaranteeFeeBrl = 0) {
  const productIds = itemsInput.map(i => i.product_id);

  const { data: products, error } = await sb()
    .from('marketplace_products')
    .select('id, name, price_brl, max_coins_discount, active, seller_id, variant_attributes')
    .in('id', productIds);

  if (error) throw new Error(`Erro ao buscar produtos: ${error.message}`);

  // Valida que todos os produtos pertencem ao vendedor e estão ativos
  const productMap = {};
  for (const p of products || []) {
    if (!p.active) throw new Error(`Produto "${p.name}" não está disponível`);
    if (p.seller_id !== sellerProfile.id) throw new Error(`Produto "${p.name}" não pertence a este vendedor`);
    productMap[p.id] = p;
  }

  // Buscar variantes referenciadas nos itens (se houver)
  const variantIds = itemsInput.map(i => i.variant_id).filter(Boolean);
  const variantMap = {};
  if (variantIds.length > 0) {
    const { data: variants, error: vErr } = await sb()
      .from('product_variants')
      .select('id, product_id, attributes, price_override, is_available, stock')
      .in('id', variantIds);
    if (vErr) throw new Error(`Erro ao buscar variantes: ${vErr.message}`);
    for (const v of variants || []) { variantMap[v.id] = v; }
  }

  // Monta snapshot dos itens com preços do banco
  const items = itemsInput.map(i => {
    const p = productMap[i.product_id];
    if (!p) throw new Error(`Produto ${i.product_id} não encontrado`);
    const qty = Math.max(1, parseInt(i.qty) || 1);

    // Validação de variante
    const hasVariants = p.variant_attributes && Array.isArray(p.variant_attributes) && p.variant_attributes.length > 0;
    if (hasVariants && !i.variant_id) {
      throw new Error(`Produto "${p.name}" possui variantes — variant_id é obrigatório`);
    }
    if (!hasVariants && i.variant_id) {
      throw new Error(`Produto "${p.name}" não possui variantes — variant_id deve ser omitido`);
    }

    const item = { product_id: p.id, name: p.name, qty, unit_price_brl: Number(p.price_brl) };

    if (i.variant_id) {
      const v = variantMap[i.variant_id];
      if (!v) throw new Error(`Variante ${i.variant_id} não encontrada`);
      if (v.product_id !== p.id) throw new Error(`Variante ${i.variant_id} não pertence ao produto "${p.name}"`);
      if (!v.is_available) throw new Error(`Variante ${i.variant_id} não está disponível`);

      // Preço: price_override da variante ou price_brl do produto
      item.unit_price_brl = v.price_override != null ? Number(v.price_override) : Number(p.price_brl);
      // Snapshot da variante no item do pedido
      item.variant_id = v.id;
      item.variant_attributes = v.attributes;
    }

    return item;
  });

  const subtotal_brl = items.reduce((sum, i) => sum + i.unit_price_brl * i.qty, 0);

  // Limita coins ao máximo configurado pelo vendedor
  const maxCoins = sellerProfile.max_coins_per_order || 0;
  const effectiveCoins = Math.min(coinsUsed, maxCoins);
  const coins_discount_brl = +(effectiveCoins * sellerProfile.coins_discount_rate).toFixed(2);
  
  // Total = Subtotal + Frete - Desconto
  const total_brl = Math.max(0, +(subtotal_brl + Number(deliveryFee) + Number(guaranteeFeeBrl) - coins_discount_brl).toFixed(2));

  // Comissão: v2.1 — usa subscriptionService.getCommissionRate() centralizado
  // Precedência: isenção ativa → assinatura Brasileirinho → default (5% lojista / 8% entregador)
  // Incide apenas sobre valor dos produtos (subtotal - desconto), sem frete/garantia
  const commissionInfo = await subscriptionService.getCommissionRate(sellerProfile.user_id, { context: 'order_preview' });
  const effectiveRate = commissionInfo.rate;
  const productRevenue = Math.max(0, subtotal_brl - coins_discount_brl);
  const commission_brl = +(productRevenue * effectiveRate).toFixed(2);

  return { items, subtotal_brl: +subtotal_brl.toFixed(2), effectiveCoins, coins_discount_brl, total_brl, commission_brl, commission_rate: effectiveRate, guarantee_fee_brl: +Number(guaranteeFeeBrl).toFixed(2) };
}

/**
 * Cria um pedido.
 * Fluxo:
 *   1. Valida comprador != vendedor
 *   2. Recalcula preços do banco
 *   3. Insere pedido com status 'pending'
 *   4. Se coins_used > 0: debita atomicamente via gamificationService.spendCoins
 *   5. Registra eloscoins_redemptions (auditoria)
 *   6. (Pagamento delegado ao payment-agent via controller)
 *   7. Dispara gamification
 */

// ── Validação server-side do delivery_fee (Correção 2) ─────────────────────

const DELIVERY_FEE_TOLERANCE = 0.20; // ±20%
const DEGRADED_MIN_FEE = 3.00;      // teto absoluto no modo degradado
const DEGRADED_MAX_FEE = 500.00;

/**
 * Valida a delivery_fee enviada pelo frontend contra os entregadores disponíveis.
 * Impede que o cliente envie um frete artificialmente baixo ou alto.
 *
 * Se preferredServiceId é fornecido, valida DIRETAMENTE contra a tarifa desse
 * entregador (lookup na tabela delivery_services). Isso evita discrepância
 * causada por re-query do matching (que pode retornar candidatos diferentes
 * ou usar fallback textual quando GPS não disponível).
 *
 * Tolerância: ±20% do fee calculado.
 * Modo degradado (RPC/lookup falha): aceita se dentro de R$3–R$500.
 * Princípio: nenhuma alteração silenciosa de valor financeiro.
 */
async function _validateDeliveryFee(deliveryFee, sellerProfile, destLat, destLng, destCity, destState, weightKg = 0, preferredServiceId = null) {
  const fn = '_validateDeliveryFee';

  try {
    // ── Caminho direto: validar contra o entregador que o cliente selecionou ──
    if (preferredServiceId) {
      const { data: svc, error: svcErr } = await sb()
        .from('delivery_services')
        .select('id, price_per_km, base_fee, minimum_fee, status')
        .eq('id', preferredServiceId)
        .maybeSingle();

      if (!svcErr && svc && svc.status === 'active') {
        // Calcular distância da mesma forma que o RPC: haversine × 1.3
        const pickupLat = sellerProfile.address_lat;
        const pickupLng = sellerProfile.address_lng;
        let totalKm = null;

        if (pickupLat != null && destLat != null) {
          totalKm = _haversineKm(pickupLat, pickupLng, destLat, destLng) * 1.3;
        }

        let serverFee;
        if (totalKm != null) {
          serverFee = Math.max(totalKm * Number(svc.price_per_km) + Number(svc.base_fee), Number(svc.minimum_fee));
        } else {
          // Sem GPS: aceitar o fee do frontend se está dentro de limites razoáveis
          serverFee = deliveryFee;
        }

        serverFee = Math.round(serverFee * 100) / 100;

        const lowerBound = serverFee * (1 - DELIVERY_FEE_TOLERANCE);
        const upperBound = serverFee * (1 + DELIVERY_FEE_TOLERANCE);

        if (deliveryFee >= lowerBound && deliveryFee <= upperBound) {
          return { valid: true, serverFee, minFee: serverFee, maxFee: serverFee };
        }

        log(fn, 'Fee fora da tolerância (preferred)', { deliveryFee, serverFee, lowerBound, upperBound, totalKm });
        return {
          valid: false,
          reason: deliveryFee < lowerBound ? 'fee_too_low' : 'fee_too_high',
          message: `Frete informado (R$${deliveryFee.toFixed(2)}) difere do valor calculado (R$${serverFee.toFixed(2)}).`,
          serverFee,
          minFee: serverFee,
          maxFee: serverFee,
        };
      }
      // Se o serviço preferido não está mais ativo, cai no matching genérico abaixo
      log(fn, 'Preferred service indisponível, fallback para matching genérico', { preferredServiceId });
    }

    // ── Fallback: matching genérico (sem preferred ou preferred indisponível) ──
    const deliveryService = require('./deliveryService');

    const candidates = await deliveryService.findEligibleDeliverers(
      sellerProfile.address_lat  ?? null,
      sellerProfile.address_lng  ?? null,
      destLat  ?? null,
      destLng  ?? null,
      {
        weightKg,
        isFragile: false,
        limit: 10,
        pickupCity: sellerProfile.address_city ?? null,
        destCity:   destCity   ?? null,
        destState:  destState  ?? null,
      }
    );

    if (!candidates || candidates.length === 0) {
      return {
        valid: false,
        reason: 'no_deliverers',
        message: 'Nenhum entregador disponível para esta região no momento.',
      };
    }

    const fees = candidates.map(c => Number(c.estimated_fee));
    const minFee = Math.min(...fees);
    const maxFee = Math.max(...fees);

    const lowerBound = minFee * (1 - DELIVERY_FEE_TOLERANCE);
    const upperBound = maxFee * (1 + DELIVERY_FEE_TOLERANCE);

    if (deliveryFee < lowerBound) {
      log(fn, 'Delivery fee abaixo do mínimo tolerado', { deliveryFee, lowerBound, minFee, maxFee });
      return {
        valid: false,
        reason: 'fee_too_low',
        message: `Frete informado (R$${deliveryFee.toFixed(2)}) está abaixo do valor calculado.`,
        serverFee: minFee,
        minFee,
        maxFee,
      };
    }

    if (deliveryFee > upperBound) {
      log(fn, 'Delivery fee acima do máximo tolerado', { deliveryFee, upperBound, minFee, maxFee });
      return {
        valid: false,
        reason: 'fee_too_high',
        message: `Frete informado (R$${deliveryFee.toFixed(2)}) está acima do valor calculado.`,
        serverFee: minFee,
        minFee,
        maxFee,
      };
    }

    return { valid: true, serverFee: minFee, minFee, maxFee };
  } catch (err) {
    // Modo degradado: RPC falhou, aceita fee com teto absoluto
    logger.warn(`[${SERVICE}] ${fn}: Matching falhou, modo degradado: ${err.message}`, { deliveryFee });

    if (deliveryFee < DEGRADED_MIN_FEE || deliveryFee > DEGRADED_MAX_FEE) {
      return {
        valid: false,
        reason: 'fee_invalid_degraded',
        message: `Frete informado (R$${deliveryFee.toFixed(2)}) fora dos limites aceitáveis.`,
        serverFee: null,
      };
    }

    return { valid: true, degraded: true };
  }
}

/**
 * Haversine: distância em km entre dois pontos (lat/lng em graus).
 */
function _haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Helpers de auto-trigger de entrega ──────────────────────────────────────

/**
 * Extrai cidade e estado do final de um endereço textual.
 * Formato esperado: "Rua X, Num, Bairro, Cidade, Estado"
 * Retorna { dest_city, dest_state } ou ambos null se não inferível.
 */
function _parseDeliveryAddress(addressStr) {
  if (!addressStr || typeof addressStr !== 'string') return { dest_city: null, dest_state: null };
  const parts = addressStr.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length < 2) return { dest_city: null, dest_state: null };
  return {
    dest_state: parts[parts.length - 1] || null,
    dest_city:  parts[parts.length - 2] || null,
  };
}

/**
 * Auto-solicita um entregador para pedidos local_delivery já pagos.
 * Fire-and-forget — não bloqueia o fluxo principal; falhas são logadas como warn.
 *
 * @param {object} order  - Registro do marketplace_orders (precisa de id, delivery_address, status)
 * @param {object} seller - Registro do seller_profiles (precisa de user_id, address_city, etc.)
 */
async function _autoRequestDelivery(order, seller) {
  const fn = '_autoRequestDelivery';
  if (order.fulfillment_type !== 'local_delivery') return;
  if (!order.delivery_address) {
    logger.warn(`[${fn}] delivery_address ausente no pedido ${order.id} — auto-trigger ignorado`);
    return;
  }

  const { dest_city, dest_state } = _parseDeliveryAddress(order.delivery_address);
  if (!dest_city) {
    logger.warn(`[${fn}] dest_city não inferível de "${order.delivery_address}" — auto-trigger ignorado`);
    return;
  }

  // Busca seller com campos de endereço necessários para o pickup (não cobertos pelo SELLER_SAFE_COLS)
  const { data: sellerFull } = await sb()
    .from('seller_profiles')
    .select('id, user_id, address_logradouro, address_numero, address_neighborhood, address_city, address_state, address_lat, address_lng')
    .eq('id', seller.id)
    .single();

  const s = sellerFull || seller;
  const pickupAddress = [s.address_logradouro, s.address_numero, s.address_neighborhood]
    .filter(Boolean).join(', ') || s.address_city || 'Loja';

  const pickupCity = s.address_city;
  if (!pickupCity) {
    logger.warn(`[${fn}] pickup_city ausente no seller ${seller.id} — auto-trigger ignorado`);
    return;
  }

  const deliveryService = require('./deliveryService');
  await deliveryService.requestDelivery(s.user_id, order.id, {
    pickup_address:      pickupAddress,
    pickup_city:         pickupCity,
    pickup_state:        s.address_state ?? null,
    pickup_lat:          s.address_lat   ?? null,
    pickup_lng:          s.address_lng   ?? null,
    dest_address:        order.delivery_address,
    dest_city,
    dest_state,
    dest_lat:            order.delivery_lat  ?? null,
    dest_lng:            order.delivery_lng  ?? null,
    weight_kg:           0,
    is_fragile:          false,
    notes:               `Auto-entrega · Pedido #${order.id.slice(-8).toUpperCase()}`,
  });

  logger.info(`[${fn}] Delivery request criado automaticamente`, { orderId: order.id, dest_city });
}

/**
 * Auto-processa envio via Melhor Envio após confirmação de pagamento.
 * Fluxo: addToCart → checkout → generateLabel
 *
 * @param {object} order - Registro do marketplace_orders
 */
async function _autoRequestShipping(order) {
  const fn = '_autoRequestShipping';
  if (order.fulfillment_type !== 'shipping') return;

  const melhorEnvioService = require('./melhorEnvioService');

  // 1. Buscar shipping_order e shipping_config
  const { data: shippingOrder } = await sb()
    .from('shipping_orders')
    .select('*')
    .eq('order_id', order.id)
    .maybeSingle();

  if (!shippingOrder) {
    logger.warn(`[${fn}] Nenhum shipping_order encontrado para pedido ${order.id}`);
    return;
  }

  // Idempotência: só processa se status é 'quoted'
  if (shippingOrder.status !== 'quoted') {
    log(fn, `Shipping order ${shippingOrder.id} já em status "${shippingOrder.status}" — ignorado`);
    return;
  }

  const { data: shippingConfig } = await sb()
    .from('seller_shipping_config')
    .select('*')
    .eq('seller_id', order.seller_id)
    .maybeSingle();

  if (!shippingConfig) {
    logger.error(`[${fn}] Shipping config não encontrada para seller ${order.seller_id}`);
    return;
  }

  // 2. Buscar dados completos dos produtos para volumes
  const items = order.items || [];
  const productIds = items.map(i => i.product_id).filter(Boolean);
  const { data: products } = await sb()
    .from('marketplace_products')
    .select('id, name, weight_kg, dimensions_cm, price_brl')
    .in('id', productIds);

  const productMap = {};
  for (const p of (products || [])) productMap[p.id] = p;

  // 3. Montar dados do carrinho ME
  const buyerSnapshot = order.buyer_snapshot || {};
  const { dest_city, dest_state } = _parseDeliveryAddress(order.delivery_address || '');

  // Extrair CEP do delivery_address (últimos 8 dígitos numéricos ou campo separado)
  const cepMatch = (order.delivery_address || '').match(/(\d{5})-?(\d{3})/);
  const toCep = cepMatch ? `${cepMatch[1]}${cepMatch[2]}` : '';

  const cartProducts = items.map(i => ({
    name: i.name || productMap[i.product_id]?.name || 'Produto',
    quantity: String(i.qty || 1),
    unitary_value: String(i.unit_price_brl || productMap[i.product_id]?.price_brl || 0),
  }));

  const cartVolumes = items.map(i => {
    const p = productMap[i.product_id];
    if (!p) return { height: 10, width: 10, length: 10, weight: 0.5 };
    return {
      height: p.dimensions_cm?.height || 10,
      width: p.dimensions_cm?.width || 10,
      length: p.dimensions_cm?.length || 10,
      weight: (p.weight_kg || 0.5) * (i.qty || 1),
    };
  });

  const totalInsurance = items.reduce((sum, i) => sum + ((i.unit_price_brl || 0) * (i.qty || 1)), 0);

  const cartData = {
    service: shippingOrder.me_service_id,
    from: {
      name: shippingConfig.sender_name || 'ElosCloud',
      email: shippingConfig.sender_email || 'tech@eloscloud.com',
      phone: shippingConfig.sender_phone || '',
      document: shippingConfig.sender_document || '',
      address: shippingConfig.origin_address || '',
      number: shippingConfig.origin_number || 'S/N',
      district: shippingConfig.origin_district || '',
      city: shippingConfig.origin_city || '',
      postal_code: shippingConfig.origin_postal_code || '',
      state_abbr: shippingConfig.origin_state_abbr || '',
      country_id: 'BR',
    },
    to: {
      name: buyerSnapshot.full_name || 'Destinatário',
      email: buyerSnapshot.email || '',
      phone: buyerSnapshot.phone || '',
      document: '',
      address: order.delivery_address || '',
      number: '',
      district: '',
      city: dest_city || '',
      postal_code: toCep,
      state_abbr: dest_state || '',
      country_id: 'BR',
    },
    products: cartProducts,
    volumes: cartVolumes,
    options: {
      insurance_value: totalInsurance,
      receipt: false,
      own_hand: false,
      non_commercial: true,
      platform: 'ElosCloud',
      tags: [{ tag: order.id, url: `https://eloscloud.com/mercado/pedidos/${order.id}` }],
    },
  };

  try {
    // 4. Inserir no carrinho ME
    const cartResult = await melhorEnvioService.addToCart(cartData);
    const meOrderId = cartResult?.id;

    if (!meOrderId) {
      logger.error(`[${fn}] ME addToCart não retornou ID`, { orderId: order.id });
      await sb().from('shipping_orders').update({ status: 'pending', me_raw_response: cartResult }).eq('id', shippingOrder.id);
      return;
    }

    await sb().from('shipping_orders').update({
      me_order_id: meOrderId,
      status: 'cart',
      me_raw_response: cartResult,
      updated_at: new Date().toISOString(),
    }).eq('id', shippingOrder.id);

    log(fn, 'Adicionado ao carrinho ME', { orderId: order.id, meOrderId });

    // 5. Checkout (pagar com saldo da carteira ME)
    await melhorEnvioService.checkout([meOrderId]);
    await sb().from('shipping_orders').update({
      status: 'paid',
      updated_at: new Date().toISOString(),
    }).eq('id', shippingOrder.id);

    log(fn, 'Checkout ME realizado', { orderId: order.id, meOrderId });

    // 6. Gerar etiqueta
    await melhorEnvioService.generateLabel([meOrderId]);
    await sb().from('shipping_orders').update({
      status: 'generated',
      updated_at: new Date().toISOString(),
    }).eq('id', shippingOrder.id);

    log(fn, 'Etiqueta gerada', { orderId: order.id, meOrderId });

    // 7. Obter URL da etiqueta para imprimir
    const printResult = await melhorEnvioService.printLabel([meOrderId]);
    const labelUrl = printResult?.url || null;

    if (labelUrl) {
      await sb().from('shipping_orders').update({
        label_url: labelUrl,
      }).eq('id', shippingOrder.id);
    }

    // 8. Notificar seller com link da etiqueta
    if (order.seller?.user_id) {
      notificationDispatcher.dispatch({
        userId: order.seller.user_id,
        type: 'shipping_label_ready',
        importance: 'high',
        data: { orderId: order.id, labelUrl, carrierName: shippingOrder.carrier_name, serviceName: shippingOrder.service_name },
        metadata: { triggeredBy: 'system' },
        dedupKey: `shipping_label_ready_${order.id}`,
      }).catch(() => {});
    }

    log(fn, 'Fluxo de shipping completo', { orderId: order.id, meOrderId, labelUrl });

  } catch (meErr) {
    logError(fn, meErr, { orderId: order.id });
    // Atualiza status para 'pending' (retry manual necessário)
    await sb().from('shipping_orders').update({
      status: 'pending',
      me_raw_response: { error: meErr.message },
      updated_at: new Date().toISOString(),
    }).eq('id', shippingOrder.id);
  }
}

// ── Guest buyer email notification helper (GST-024 / FLOW-AUDIT W2.1) ───────

/**
 * Envia email de status para guest buyers (visitantes sem conta).
 * Fire-and-forget: não bloqueia o fluxo principal, erros são logados e engolidos.
 *
 * @param {Object} order   - Objeto do pedido (marketplace_orders row)
 * @param {string} status  - Status a notificar: 'paid' | 'in_progress' | 'completed' | 'cancelled'
 */
function notifyGuestBuyer(order, status) {
  setImmediate(async () => {
    try {
      // 1. Resolve email — buyer_snapshot é a fonte primária (imutável no pedido)
      let guestEmail = order.buyer_snapshot?.email;
      let guestName  = order.buyer_snapshot?.full_name || 'Visitante';

      // Fallback: busca na tabela guest_buyers se snapshot não tem email
      if (!guestEmail && order.guest_buyer_id) {
        const { data: gb } = await sb()
          .from('guest_buyers')
          .select('email, full_name')
          .eq('id', order.guest_buyer_id)
          .maybeSingle();
        guestEmail = gb?.email;
        guestName  = gb?.full_name || guestName;
      }

      if (!guestEmail) {
        logger.warn(`[${SERVICE}] notifyGuestBuyer: sem email para pedido ${order.id}`);
        return;
      }

      // 2. Build tracking URL
      const siteUrl    = process.env.SITE_URL || process.env.FRONTEND_URL || 'https://eloscloud.com';
      const trackingUrl = `${siteUrl}/pedido/${order.id}?token=${order.guest_order_token}`;

      // 3. Resolve subject from template STATUS_CONFIG
      const { STATUS_CONFIG } = require('../templates/emails/guestOrderStatus');
      const cfg     = STATUS_CONFIG[status] || STATUS_CONFIG.paid;
      const subject = `${cfg.subject} — ElosCloud`;

      // 4. Resolve seller name (may be populated as join 'seller' or 'seller_profiles')
      const sellerName = order.seller?.business_name
        || order.seller?.trading_name
        || order.seller_profiles?.business_name
        || '';

      // 5. Send email via emailService
      const emailService = require('./emailService');
      await emailService.sendEmail({
        to:           guestEmail,
        subject,
        templateType: 'guest_order_status',
        data: {
          guestName,
          orderId:     order.id,
          status,
          items:       order.items || [],
          totalBrl:    order.total_brl || 0,
          deliveryFee: order.delivery_fee || 0,
          trackingUrl,
          sellerName,
        },
      });

      logger.info(`[${SERVICE}] notifyGuestBuyer: email "${status}" enviado`, {
        orderId: order.id, to: guestEmail,
      });
    } catch (err) {
      logger.warn(`[${SERVICE}] notifyGuestBuyer falhou`, {
        orderId: order.id, status, error: err.message,
      });
    }
  });
}

// ── Função pública para o webhook PIX confirmar pagamento de pedido marketplace ─

/**
 * Chamado pelo webhookController quando Asaas confirma PIX de pedido marketplace.
 * Marca o pedido como 'paid' (idempotente) e auto-solicita entregador se local_delivery.
 */
async function handlePixPaymentConfirmed(orderId) {
  const fn = 'handlePixPaymentConfirmed';

  const { data: order, error } = await sb()
    .from('marketplace_orders')
    .select('*, seller:seller_id ( id, user_id, address_city )')
    .eq('id', orderId)
    .single();

  if (error || !order) {
    logger.warn(`[${fn}] Pedido ${orderId} não encontrado`);
    return;
  }

  // Idempotência: só processa se ainda estiver pending
  if (order.status !== 'pending') {
    logger.info(`[${fn}] Pedido ${orderId} já em status "${order.status}" — ignorado`);
    return;
  }

  // [007] Setar paid_at junto com status
  const now = new Date().toISOString();
  const { error: updateErr } = await sb()
    .from('marketplace_orders')
    .update({ status: 'paid', paid_at: now, updated_at: now })
    .eq('id', orderId)
    .eq('status', 'pending');

  if (updateErr) {
    logger.error(`[${fn}] Erro ao marcar pedido ${orderId} como pago: ${updateErr.message}`);
    return;
  }

  logger.info(`[${fn}] Pedido ${orderId} marcado como pago via PIX`);

  // Notifica comprador e vendedor em tempo real
  const socketManager = require('../config/socket/socketManager');
  // Null-guard: guest orders have buyer_id=NULL — skip buyer socket/notification
  if (order.buyer_id) {
    socketManager.emitToUser(order.buyer_id, 'marketplace:order_paid', { orderId: order.id });
  }
  if (order.seller?.user_id) {
    socketManager.emitToUser(order.seller.user_id, 'marketplace:new_order_paid', { orderId: order.id });
  }

  // Fire-and-forget: notificações persistentes (funcionam offline)
  setImmediate(() => {
    // Null-guard: guest orders — skip buyer notification (guest has no userId)
    if (order.buyer_id) {
      notificationDispatcher.dispatch({
        userId:     order.buyer_id,
        type:       'marketplace_order_paid',
        importance: 'high',
        data:       { orderId: order.id },
        metadata:   { triggeredBy: 'system' },
        dedupKey:   `marketplace_order_paid_buyer_${order.id}`,
      }).catch(() => {});
    } else if (order.guest_buyer_id) {
      // GST-024: guest buyer — email notification (no push/socket, no userId)
      notifyGuestBuyer(order, 'paid');
    }
    if (order.seller?.user_id) {
      const buyerName = order.buyer_id
        ? order.buyer_id
        : (order.buyer_snapshot?.full_name || 'Visitante');
      notificationDispatcher.dispatch({
        userId:     order.seller.user_id,
        type:       'marketplace_new_order',
        importance: 'high',
        data:       { orderId: order.id, buyerId: order.buyer_id, guestName: !order.buyer_id ? buyerName : undefined, sellerId: order.seller_id || order.seller?.id, clientName: order.buyer_snapshot?.full_name || undefined, clientPhone: order.buyer_snapshot?.phone || undefined },
        metadata:   { triggeredBy: 'system' },
        dedupKey:   `marketplace_new_order_seller_${order.id}`,
      }).catch(() => {});
    }
  });

  // Auto-trigger delivery for local_delivery orders (fix: was dead code — now wired)
  if (order.fulfillment_type === 'local_delivery') {
    setImmediate(() => _autoRequestDelivery(order, order.seller).catch(err =>
      logger.warn(`[${fn}] Auto-delivery failed`, { orderId: order.id, error: err.message })
    ));
  }

  // Auto-trigger shipping para pedidos com frete nacional (SHIP-003)
  if (order.fulfillment_type === 'shipping') {
    setImmediate(() => _autoRequestShipping(order).catch(err =>
      logger.warn(`[${fn}] Auto-shipping failed`, { orderId: order.id, error: err.message })
    ));
  }

  // ── Unified Ledger (W3): record payment received ───────────
  setImmediate(() => _recordLedgerForOrder({
    orderId:        order.id,
    sellerUserId:   order.seller?.user_id,
    totalBrl:       Number(order.total_brl),
    commissionBrl:  Number(order.commission_brl) || 0,
    paymentId:      order.payment_id || null,
    paymentMethod:  order.payment_method || 'pix',
  }));
}

async function createOrder(buyerId, data) {
  log('createOrder', 'Criando pedido', { buyerId });

  const {
    seller_id, items: itemsInput, coins_used = 0, payment_method,
    fulfillment_type = 'pickup', delivery_address, delivery_fee = 0,
    scheduled_at,
    delivery_lat, delivery_lng,
    preferred_deliverer_service_id,
    // Shipping nacional (SHIP-003)
    shipping_service_id,
    shipping_fee = 0,
    shipping_postal_code,
  } = data;

  if (!seller_id)            throw new Error('seller_id é obrigatório');
  if (!itemsInput?.length)   throw new Error('items não pode ser vazio');

  // Validação: payment_method deve ser um dos valores permitidos
  const VALID_PAYMENT_METHODS = ['pix', 'credit_card', 'offline_confirmed'];
  if (payment_method != null && !VALID_PAYMENT_METHODS.includes(payment_method)) {
    throw new Error(`payment_method inválido: "${payment_method}". Valores aceitos: ${VALID_PAYMENT_METHODS.join(', ')}`);
  }

  // Validação: fulfillment_type deve ser um dos valores permitidos
  if (!VALID_FULFILLMENT_TYPES.includes(fulfillment_type)) {
    throw new Error(`fulfillment_type inválido: "${fulfillment_type}". Valores aceitos: ${VALID_FULFILLMENT_TYPES.join(', ')}`);
  }

  // Validação: delivery_fee não pode ser negativo
  const sanitizedDeliveryFee = Math.max(0, Number(delivery_fee) || 0);

  // Validação: scheduled_at deve ser uma data futura (se fornecida)
  if (scheduled_at != null) {
    const scheduledDate = new Date(scheduled_at);
    if (isNaN(scheduledDate.getTime())) {
      throw new Error('scheduled_at deve ser uma data válida');
    }
    if (scheduledDate <= new Date()) {
      throw new Error('scheduled_at deve ser uma data/hora futura');
    }
  }

  // 1. Busca seller e valida que está ativo (SELLER_SAFE_COLS — sem location bruta)
  const { data: seller, error: sellerErr } = await sb()
    .from('seller_profiles')
    .select(SELLER_SAFE_COLS)
    .eq('id', seller_id)
    .single();

  if (sellerErr || !seller) throw new Error('Vendedor não encontrado');
  if (seller.status !== 'active') throw new Error('Vendedor não está ativo no marketplace');

  // Verifica bloqueio por inadimplência (2+ ciclos não pagos)
  const isBlocked = await subscriptionService.isSellerBlocked(seller.user_id);
  if (isBlocked) {
    throw new Error('Vendedor com pendências financeiras. Novos pedidos estão temporariamente bloqueados.');
  }

  // Invariante: comprador != vendedor
  if (seller.user_id === buyerId) {
    throw new Error('Você não pode comprar seus próprios produtos');
  }

  // 1b. Validação server-side do delivery_fee (Correção 2)
  let validatedDeliveryFee = sanitizedDeliveryFee;

  if (fulfillment_type === 'local_delivery' && sanitizedDeliveryFee > 0) {
    const { dest_city, dest_state } = _parseDeliveryAddress(delivery_address);

    const validation = await _validateDeliveryFee(
      sanitizedDeliveryFee,
      seller,
      delivery_lat != null ? Number(delivery_lat) : null,
      delivery_lng != null ? Number(delivery_lng) : null,
      dest_city,
      dest_state,
      0,
      preferred_deliverer_service_id || null
    );

    if (!validation.valid) {
      const err = new Error(validation.message);
      err.code = validation.reason === 'no_deliverers' ? 'NO_DELIVERERS' : 'DELIVERY_FEE_MISMATCH';
      err.serverFee = validation.serverFee;
      err.minFee = validation.minFee ?? null;
      err.maxFee = validation.maxFee ?? null;
      throw err;
    }
  } else if (fulfillment_type === 'shipping') {
    // validatedDeliveryFee será preenchido pelo bloco 1c abaixo
    validatedDeliveryFee = 0;
  } else if (fulfillment_type !== 'local_delivery') {
    validatedDeliveryFee = 0;
  }

  // 1c. Validação de shipping nacional (SHIP-003)
  let validatedShippingFee = 0;
  if (fulfillment_type === 'shipping') {
    const { data: shippingConfig } = await sb()
      .from('seller_shipping_config')
      .select('*')
      .eq('seller_id', seller_id)
      .maybeSingle();

    if (!shippingConfig?.accepts_national_shipping) {
      throw new Error('Vendedor não aceita envio nacional por transportadora');
    }
    if (!shipping_service_id) {
      throw new Error('shipping_service_id é obrigatório para envio nacional');
    }
    if (!shipping_postal_code) {
      throw new Error('shipping_postal_code (CEP destino) é obrigatório para envio nacional');
    }
    if (!delivery_address) {
      throw new Error('delivery_address é obrigatório para envio nacional');
    }

    // Validar que produtos têm dimensions_cm
    const shippingProductIds = itemsInput.map(i => i.product_id).filter(Boolean);
    const { data: shippingProducts } = await sb()
      .from('marketplace_products')
      .select('id, name, weight_kg, dimensions_cm, product_type')
      .in('id', shippingProductIds);

    for (const p of (shippingProducts || [])) {
      if (p.product_type !== 'physical_product') {
        throw new Error(`Produto "${p.name}" não é elegível para envio por transportadora`);
      }
      if (!p.dimensions_cm?.width || !p.dimensions_cm?.height || !p.dimensions_cm?.length) {
        throw new Error(`Produto "${p.name}" não tem dimensões cadastradas para envio`);
      }
    }

    // Server-side: recalcular frete via ME e validar ±10%
    const meProducts = (shippingProducts || []).map(p => {
      const item = itemsInput.find(i => i.product_id === p.id);
      return {
        id: p.id,
        width: p.dimensions_cm.width,
        height: p.dimensions_cm.height,
        length: p.dimensions_cm.length,
        weight: p.weight_kg,
        insurance_value: 0,
        quantity: item?.qty || 1,
      };
    });

    try {
      const melhorEnvioService = require('./melhorEnvioService');
      const quotes = await melhorEnvioService.calculateShipping(
        shippingConfig.origin_postal_code,
        shipping_postal_code,
        meProducts,
        String(shipping_service_id)
      );

      const selectedQuote = quotes.find(q => q.serviceId === shipping_service_id);
      if (!selectedQuote) {
        throw new Error(`Serviço de frete ${shipping_service_id} não disponível para esta rota`);
      }

      const serverFee = parseFloat(selectedQuote.customPrice || selectedQuote.price);
      const clientFee = Number(shipping_fee);
      const tolerance = 0.10; // ±10%

      if (clientFee < serverFee * (1 - tolerance) || clientFee > serverFee * (1 + tolerance)) {
        const err = new Error(`Valor do frete diverge do calculado (esperado: R$${serverFee.toFixed(2)}, recebido: R$${clientFee.toFixed(2)})`);
        err.code = 'SHIPPING_FEE_MISMATCH';
        err.serverFee = serverFee;
        throw err;
      }

      validatedShippingFee = serverFee;
    } catch (meErr) {
      if (meErr.code === 'SHIPPING_FEE_MISMATCH') throw meErr;
      logError('createOrder', meErr, { context: 'ME_shipping_validation' });
      // Degraded mode: aceitar se R$5 ≤ fee ≤ R$500
      if (Number(shipping_fee) >= 5 && Number(shipping_fee) <= 500) {
        validatedShippingFee = Number(shipping_fee);
        logger.warn('[createOrder] Shipping fee accepted in degraded mode', { fee: validatedShippingFee });
      } else {
        throw new Error('Não foi possível validar o frete. Tente novamente.');
      }
    }

    validatedDeliveryFee = validatedShippingFee;
  }

  // 2. Validação de modificadores obrigatórios
  const productIds = itemsInput.map(i => i.product_id).filter(Boolean);
  if (productIds.length > 0) {
    const { data: requiredModifiers } = await sb()
      .from('product_modifiers')
      .select('id, product_id, group_name')
      .in('product_id', productIds)
      .eq('is_required', true)
      .eq('active', true);

    if (requiredModifiers && requiredModifiers.length > 0) {
      // Group required modifiers by product_id + group_name
      const requiredGroups = {};
      for (const mod of requiredModifiers) {
        const key = `${mod.product_id}::${mod.group_name}`;
        if (!requiredGroups[key]) {
          requiredGroups[key] = { product_id: mod.product_id, group_name: mod.group_name, modifierIds: [] };
        }
        requiredGroups[key].modifierIds.push(mod.id);
      }

      // For each item, check that all required groups have at least one selection
      for (const item of itemsInput) {
        const selectedModIds = (item.modifiers || []).map(m => m.id).filter(Boolean);
        for (const group of Object.values(requiredGroups)) {
          if (group.product_id !== item.product_id) continue;
          const hasSelection = group.modifierIds.some(id => selectedModIds.includes(id));
          if (!hasSelection) {
            throw new Error(`Modificador obrigatório "${group.group_name}" não selecionado para o produto`);
          }
        }
      }
    }
  }

  // 2b. ElosCoins desabilitado como desconto (2026-07-09)
  const requestedCoins = 0;

  // 2c. Fundo de garantia — FUND-001
  const GUARANTEE_RATE = 0.02; // 2% do subtotal
  const sellerGuaranteeMode = seller.guarantee_fund_mode || 'none';

  // 3. Recalcula totais com preços do banco (nunca do cliente)
  //    Primeira passada sem garantia para obter subtotal
  const preCalc = await _calculateOrderTotals(seller, itemsInput, requestedCoins, validatedDeliveryFee, 0);
  const { items, effectiveCoins, coins_discount_brl, commission_rate } = preCalc;
  let { subtotal_brl, total_brl, commission_brl } = preCalc;

  // Calcula taxa de garantia baseada no subtotal
  let guarantee_fee_brl = 0;
  let guaranteeAmount = 0; // valor real da garantia (para auditoria)
  if (sellerGuaranteeMode !== 'none') {
    guaranteeAmount = +Math.max(0.01, subtotal_brl * GUARANTEE_RATE).toFixed(2);
    if (sellerGuaranteeMode === 'buyer_pays') {
      guarantee_fee_brl = guaranteeAmount;
      total_brl = +(total_brl + guarantee_fee_brl).toFixed(2);
    }
    // seller_absorbs: deduzido do payout do vendedor (não altera total)
    // elocoins_social: pago pelo fundo social (não altera total)
  }

  // 3b. Snapshot imutável do comprador (nome + foto + username no momento da compra)
  //     Compartilhado com vendedor e entregador durante todo o ciclo de vida do pedido.
  const { data: buyerProfile } = await sb()
    .from('users')
    .select('full_name, avatar_url, username, email')
    .eq('id', buyerId)
    .maybeSingle();

  const buyer_snapshot = {
    full_name: buyerProfile?.full_name || buyerProfile?.username || buyerProfile?.email?.split('@')[0] || null,
    photo_url: buyerProfile?.avatar_url || null,
    username:  buyerProfile?.username  || null,
  };

  // 4. Insere pedido com status 'pending'
  // [007] Resolve o flow com base na vertical do seller + tipo de entrega
  const statusFlow = resolveStatusFlow(seller.category, fulfillment_type);

  const { data: order, error: orderErr } = await sb()
    .from('marketplace_orders')
    .insert({
      buyer_id: buyerId,
      seller_id: seller.id,
      items,
      subtotal_brl,
      coins_used: effectiveCoins,
      coins_discount_brl,
      delivery_fee: validatedDeliveryFee,
      guarantee_fee_brl,
      guarantee_fund_mode: sellerGuaranteeMode,
      total_brl,
      commission_brl,
      commission_rate,
      payment_method: payment_method || (total_brl === 0 ? 'eloscoins' : null),
      status: 'pending',
      status_flow: statusFlow,
      fulfillment_type,
      delivery_address,
      delivery_lat:  (delivery_lat != null && delivery_lng != null) ? Number(delivery_lat) : null,
      delivery_lng:  (delivery_lat != null && delivery_lng != null) ? Number(delivery_lng) : null,
      scheduled_at,
      buyer_snapshot,
      preferred_deliverer_service_id: preferred_deliverer_service_id || null,
    })
    .select()
    .single();

  if (orderErr) throw new Error(`Erro ao criar pedido: ${orderErr.message}`);

  // 4b. Criar shipping_orders para envio nacional (SHIP-003)
  if (fulfillment_type === 'shipping' && validatedShippingFee > 0) {
    try {
      const SERVICE_NAMES = { 1: 'PAC', 2: 'SEDEX', 3: '.Package', 4: '.Com', 17: 'Mini Envios' };
      const CARRIER_NAMES = { 1: 'Correios', 2: 'Correios', 3: 'JadLog', 4: 'JadLog', 17: 'Correios' };

      await sb().from('shipping_orders').insert({
        order_id: order.id,
        me_service_id: shipping_service_id,
        carrier_name: CARRIER_NAMES[shipping_service_id] || 'Desconhecido',
        service_name: SERVICE_NAMES[shipping_service_id] || 'Desconhecido',
        status: 'quoted',
        quoted_price: validatedShippingFee,
        shipping_fee: validatedShippingFee,
      });
    } catch (shErr) {
      logError('createOrder', shErr, { context: 'shipping_order_insert', orderId: order.id });
      // Non-blocking: pedido prossegue
    }
  }

  // 4c. Decrementar estoque de variantes atomicamente (ELOS-BE-014)
  // All-or-nothing: se qualquer variante falhar, cancela o pedido
  const variantItems = items
    .filter(i => i.variant_id)
    .map(i => ({ variant_id: i.variant_id, qty: i.qty }));

  if (variantItems.length > 0) {
    try {
      await variantService.decrementStock(variantItems);
    } catch (stockErr) {
      // Compensação: cancela pedido recém-criado
      await sb()
        .from('marketplace_orders')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', order.id);

      logError('createOrder', stockErr, { orderId: order.id, context: 'variant_stock_decrement' });
      const err = new Error(`Estoque insuficiente: ${stockErr.message}`);
      err.code = 'STOCK_INSUFFICIENT';
      throw err;
    }
  }

  // 5. Debita ElosCoins atomicamente (se necessário)
  if (effectiveCoins > 0) {
    try {
      await gamificationService.spendCoins(
        buyerId,
        effectiveCoins,
        'marketplace_order',
        null,
        { order_id: order.id, seller_id: seller.id }
      );

      // Registra auditoria de resgate
      await sb().from('eloscoins_redemptions').insert({
        user_id: buyerId,
        order_id: order.id,
        coins_redeemed: effectiveCoins,
        brl_equivalent: coins_discount_brl
      });
    } catch (coinsErr) {
      // Compensação: cancela o pedido se o débito de coins falhou
      await sb()
        .from('marketplace_orders')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', order.id);

      // Restaurar estoque de variantes se já foi decrementado (ELOS-BE-014)
      if (variantItems.length > 0) {
        try { await variantService.restoreStock(variantItems); } catch (restoreErr) {
          logError('createOrder', restoreErr, { orderId: order.id, context: 'variant_stock_restore_after_coins_fail' });
        }
      }

      logError('createOrder', coinsErr, { orderId: order.id, buyerId });
      throw new Error(`Saldo de ElosCoins insuficiente ou erro no débito: ${coinsErr.message}`);
    }
  }

  // Se pagamento total em coins, marca como pago
  if (total_brl === 0) {
    await sb()
      .from('marketplace_orders')
      .update({ status: 'paid', updated_at: new Date().toISOString() })
      .eq('id', order.id);
    order.status = 'paid';
  }

  log('createOrder', 'Pedido criado', { orderId: order.id, total_brl, effectiveCoins });

  // 6. Gamificação (fire-and-forget)
  await fireEvent('purchase_made', buyerId, { order_id: order.id, total_brl });
  await fireEvent('first_sale', seller.user_id, { order_id: order.id });

  // 7. Registrar fundo de garantia (FUND-001) — fire-and-forget
  if (sellerGuaranteeMode !== 'none' && guaranteeAmount > 0) {
    try {
      await sb().from('marketplace_guarantee_fund').insert({
        order_id: order.id,
        seller_id: seller.id,
        buyer_id: buyerId,
        amount_brl: guaranteeAmount,
        fund_mode: sellerGuaranteeMode,
        event_type: 'collected',
        notes: `Garantia ${sellerGuaranteeMode} — ${(GUARANTEE_RATE * 100).toFixed(0)}% de R$${subtotal_brl.toFixed(2)}`,
      });
    } catch (gErr) {
      logError('createOrder', gErr, { context: 'guarantee_fund_insert', orderId: order.id });
      // Non-blocking: order proceeds even if guarantee logging fails
    }

    // Gamificação: primeira vez que vendedor ativa garantia
    if (['seller_absorbs', 'elocoins_social'].includes(sellerGuaranteeMode)) {
      await fireEvent('enable_guarantee_fund', seller.user_id, { order_id: order.id, mode: sellerGuaranteeMode });
    }
  }

  return { ...order, coins_used: effectiveCoins };
}

/**
 * Lista pedidos do usuário (como comprador ou vendedor).
 */
/**
 * Retorna pedidos ativos do comprador (status paid ou in_progress)
 * com dados do seller e delivery_request para o LiveOrderTracker widget.
 */
async function getActiveOrdersForBuyer(userId) {
  const { data: orders, error } = await sb()
    .from('marketplace_orders')
    .select(`
      id, status, fulfillment_type, created_at, updated_at,
      seller:seller_id ( id, trading_name, business_name )
    `)
    .eq('buyer_id', userId)
    .in('status', ['paid', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) throw new Error(`Erro ao buscar pedidos ativos: ${error.message}`);
  if (!orders?.length) return [];

  // Attach delivery_request to each order (separate query, safer than FK hint)
  const orderIds = orders.map(o => o.id);
  const { data: deliveryReqs } = await sb()
    .from('delivery_requests')
    .select('id, order_id, status, dest_lat, dest_lng, pickup_lat, pickup_lng, service_id, matched_at')
    .in('order_id', orderIds);

  const drMap = {};
  const completedDeliveryOrderIds = new Set();
  for (const dr of (deliveryReqs || [])) {
    drMap[dr.order_id] = dr;
    // Excluir pedidos cuja entrega já foi concluída (evita widget "Entregue!" no login)
    if (['delivered', 'completed', 'cancelled'].includes(dr.status)) {
      completedDeliveryOrderIds.add(dr.order_id);
    }
  }

  return orders
    .filter(o => !completedDeliveryOrderIds.has(o.id))
    .map(o => ({ ...o, delivery_request: drMap[o.id] || null }));
}

async function listOrders(userId, { status, role = 'buyer' } = {}, { limit = 20, page = 1 } = {}, sellerCtx = null) {
  const safeLimit = Math.min(parseInt(limit) || 20, 50);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * safeLimit;

  // Resolve seller_id do usuário se consultando como vendedor
  let sellerId = null;
  if (role === 'seller') {
    if (sellerCtx) {
      // Multi-business: team member ou owner com contexto explícito
      sellerId = sellerCtx;
    } else {
      // Legacy: busca por user_id (owner direto)
      const { data: sp } = await sb()
        .from('seller_profiles')
        .select('id')
        .eq('user_id', userId)
        .single();
      sellerId = sp?.id;
    }
    if (!sellerId) return { orders: [], total: 0, page, limit: safeLimit };
  }

  let query = sb()
    .from('marketplace_orders')
    .select('*, seller:seller_id( id, business_name, trading_name )', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + safeLimit - 1);

  if (role === 'seller') {
    query = query.eq('seller_id', sellerId);
  } else {
    query = query.eq('buyer_id', userId);
  }

  if (status) query = query.eq('status', status);

  const { data, error, count } = await query;
  if (error) throw new Error(`Erro ao listar pedidos: ${error.message}`);

  return { orders: data || [], total: count || 0, page, limit: safeLimit };
}

/**
 * Retorna um pedido pelo ID, com seller_profile e delivery_request se existir.
 * Valida que o userId é comprador ou vendedor do pedido.
 */
async function getOrder(userId, orderId) {
  const { data: order, error } = await sb()
    .from('marketplace_orders')
    .select(`
      *,
      seller:seller_id ( id, user_id, business_name, trading_name )
    `)
    .eq('id', orderId)
    .single();

  if (error || !order) throw new Error('Pedido não encontrado.');

  const isBuyer  = order.buyer_id === userId;
  let   isSeller = order.seller?.user_id === userId;

  // Team member check: se não é owner nem buyer, verifica equipe do seller
  if (!isBuyer && !isSeller) {
    const { data: teamMember } = await sb()
      .from('seller_team_members')
      .select('role, permissions')
      .eq('seller_id', order.seller_id)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    if (teamMember?.permissions?.can_manage_orders) {
      isSeller = true;
    } else {
      throw new Error('Acesso negado.');
    }
  }

  // Inclui delivery_request se existir (pode ser null)
  const { data: deliveryReq } = await sb()
    .from('delivery_requests')
    .select('id, status, service_id, matched_at, delivered_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  // Resolve informações do comprador: snapshot imutável (pedidos novos)
  // ou busca em tempo real como fallback (pedidos antigos sem snapshot).
  // Para guest checkout (buyer_id null): busca em guest_buyers.
  let buyer_info = null;
  const snap = order.buyer_snapshot;
  if (snap && typeof snap === 'object' && snap.full_name) {
    buyer_info = snap;
  } else if (order.buyer_id) {
    const { data: bp } = await sb()
      .from('users')
      .select('full_name, avatar_url, username, email')
      .eq('id', order.buyer_id)
      .maybeSingle();
    buyer_info = bp ? {
      full_name: bp.full_name || bp.username || bp.email?.split('@')[0] || null,
      photo_url: bp.avatar_url || null,
      username:  bp.username  || null,
    } : null;
  } else if (order.guest_buyer_id) {
    const { data: gb } = await sb()
      .from('guest_buyers')
      .select('full_name, email, phone')
      .eq('id', order.guest_buyer_id)
      .maybeSingle();
    buyer_info = gb ? {
      full_name: gb.full_name || null,
      email:     gb.email     || null,
      phone:     gb.phone     || null,
      is_guest:  true,
    } : null;
  }

  return {
    ...order,
    buyer_info,
    delivery_request: deliveryReq || null,
    viewer_role: isSeller ? 'seller' : 'buyer',
  };
}

/**
 * Atualiza o status do pedido.
 * [007] Transições validadas contra STATUS_FLOWS[order.status_flow].
 * Transições de pagamento (pending → paid) são feitas pelo payment-agent via webhook.
 */
async function updateOrderStatus(userId, orderId, newStatus, sellerCtx = null) {
  const { data: order, error } = await sb()
    .from('marketplace_orders')
    .select('*, seller_profiles!inner(user_id, commission_rate, billing_mode)')
    .eq('id', orderId)
    .single();

  if (error || !order) throw new Error('Pedido não encontrado');

  let isSeller = order.seller_profiles.user_id === userId;
  const isBuyer  = order.buyer_id === userId;

  // Team member check: se não é owner nem buyer, verifica se é membro da equipe do seller
  if (!isSeller && !isBuyer) {
    const { data: teamMember } = await sb()
      .from('seller_team_members')
      .select('role, permissions')
      .eq('seller_id', order.seller_id)
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();
    if (teamMember?.permissions?.can_manage_orders) {
      isSeller = true;
    } else {
      throw new Error('Sem permissão para atualizar este pedido');
    }
  }

  // [007] Validar transição contra o flow do pedido
  const flowKey = order.status_flow || 'default';
  const flow = STATUS_FLOWS[flowKey] || STATUS_FLOWS.default;

  if (isSeller) {
    const transition = flow.seller_transitions[order.status];
    if (!transition || transition.next !== newStatus) {
      throw new Error(`Transição inválida no flow "${flowKey}": ${order.status} → ${newStatus}`);
    }
  }

  // [007] Montar update com timestamp da transição
  const now = new Date().toISOString();
  const updatePayload = { status: newStatus, updated_at: now };

  // Setar timestamp da transição
  if (isSeller) {
    const transition = flow.seller_transitions[order.status];
    if (transition?.timestamp_col) {
      updatePayload[transition.timestamp_col] = now;
    }
  }

  const { data: updated, error: updateErr } = await sb()
    .from('marketplace_orders')
    .update(updatePayload)
    .eq('id', orderId)
    .select()
    .single();

  if (updateErr) throw new Error(`Erro ao atualizar pedido: ${updateErr.message}`);

  log('updateOrderStatus', `Pedido ${orderId}: ${order.status} → ${newStatus}`, { userId });

  // Fire-and-forget: notificação de mudança de status para a outra parte
  setImmediate(() => {
    if (isSeller && order.buyer_id) {
      // Registered buyer — in-app notification
      notificationDispatcher.dispatch({
        userId:     order.buyer_id,
        type:       'marketplace_order_status',
        importance: newStatus === 'completed' ? 'high' : 'low',
        data:       { orderId, newStatus, updatedBy: 'seller' },
        metadata:   { triggeredBy: userId },
        dedupKey:   `marketplace_order_status_${orderId}_${newStatus}`,
      }).catch(() => {});
    } else if (isSeller && !order.buyer_id && order.guest_buyer_id) {
      // GST-024: guest buyer — email notification (no push/socket, no userId)
      notifyGuestBuyer(order, newStatus);
    } else if (!isSeller) {
      // Buyer updating — notify seller
      notificationDispatcher.dispatch({
        userId:     order.seller_profiles.user_id,
        type:       'marketplace_order_status',
        importance: newStatus === 'completed' ? 'high' : 'low',
        data:       { orderId, newStatus, updatedBy: 'buyer' },
        metadata:   { triggeredBy: userId },
        dedupKey:   `marketplace_order_status_${orderId}_${newStatus}`,
      }).catch(() => {});
    }
  });

  // Trust Passport — self_reported trust SOMENTE para offline_confirmed
  // Pedidos pix/stripe/hybrid esperam o webhook (witnessed) — NÃO cunham trust aqui.
  if (newStatus === 'completed' && order.payment_method === 'offline_confirmed') {
    setImmediate(async () => {
      try {
        const trustMarketplaceService = require('./trustMarketplaceService');
        const sellerUid = order.seller_profiles.user_id;
        const orderForTrust = {
          id: order.id,
          buyer_id: order.buyer_id,
          total_brl: order.total_brl,
          payment_method: order.payment_method,
          buyer_confirmed: true, // offline_confirmed flow = seller-verified
          seller_user_id: sellerUid,
        };
        await trustMarketplaceService.recordMarketplaceTrust(orderForTrust, sellerUid, 'seller', 'self_reported');
        await trustMarketplaceService.recordMarketplaceTrust(orderForTrust, order.buyer_id, 'buyer', 'self_reported');
      } catch (err) {
        logger.warn(`[${SERVICE}] Trust self_reported falhou para pedido ${orderId}`, {
          error: err.message, orderId,
        });
      }
    });
  }

  // Integração de billing v2.1: registra evento de cobrança quando pedido é completado
  if (newStatus === 'completed') {
    const sellerUserId = order.seller_profiles.user_id;
    setImmediate(async () => {
      try {
        // Método centralizado: verifica isenção → assinatura → default (5%/8%)
        const commissionInfo = await subscriptionService.getCommissionRate(sellerUserId, { context: 'marketplace_order' });
        const commissionRate = commissionInfo.rate;
        const commissionBrl = parseFloat((order.total_brl * commissionRate).toFixed(2));

        // Determina billing_mode para auditoria
        let billingMode = 'commission';
        if (commissionInfo.source === 'exemption') billingMode = 'exemption_covered';
        else if (commissionInfo.source === 'subscription') billingMode = 'monthly_covered';
        else if (commissionInfo.planSlug?.startsWith('brasileirinho_t3')) billingMode = 'percentage_tier';

        // Busca subscription se aplicável
        let subscriptionId = null;
        let subscribedAt = null;
        if (commissionInfo.source === 'subscription') {
          const subscription = await subscriptionService.getActiveSubscription(sellerUserId);
          subscriptionId = subscription?.id || null;
          subscribedAt = subscription?.subscribed_at?.split('T')[0] || null;
        }

        await subscriptionService.recordBillingEvent({
          sellerUserId,
          orderId: order.id,
          billingMode,
          commissionRate,
          commissionBrl,
          subscriptionId,
          saleDate: new Date(order.created_at).toISOString().split('T')[0],
          subscribedAtDate: subscribedAt,
          planSlug: commissionInfo.planSlug || null,
          exemptionId: commissionInfo.exemptionId || null,
        });

        // Acumula no saldo se modo básico (comissão > 0)
        if (commissionBrl > 0 && commissionInfo.source === 'default') {
          await subscriptionService.processBasicModeBilling(sellerUserId, commissionBrl);
        }

        // Absorve comissão na isenção se aplicável
        if (commissionInfo.source === 'exemption' && commissionInfo.exemptionId) {
          const exemptionService = require('./exemptionService');
          await exemptionService.absorbCommission(commissionInfo.exemptionId, commissionBrl);
        }

        // Verifica ativação de isenção pendente
        const exemptionService = require('./exemptionService');
        await exemptionService.checkActivation(sellerUserId);
      } catch (billingErr) {
        logger.error(`[${SERVICE}] Billing event falhou para pedido ${orderId}`, {
          error: billingErr.message, orderId, sellerUserId
        });
      }
    });

    // ── Unified Ledger (W3): promote entries to available ───────────
    setImmediate(() => _promoteLedgerForOrder(orderId));
  }

  return updated;
}

// ──────────────────────────────────────────────────────
// Seller Order Cancellation (FLOW-AUDIT W3.4 / DSH-016 / GAP-008)
// ──────────────────────────────────────────────────────

/** Janela de cancelamento em minutos — configurável via env ou constante */
const SELLER_CANCEL_WINDOW_MINUTES = Number(process.env.SELLER_CANCEL_WINDOW_MINUTES) || 30;

/** Limite mensal de cancelamentos sem penalidade */
const SELLER_CANCEL_MONTHLY_LIMIT = 3;

/** Razões de cancelamento aceitas */
const VALID_CANCEL_REASONS = ['sem_estoque', 'erro_no_pedido', 'cliente_solicitou', 'outro'];

/**
 * Cancela um pedido pelo vendedor (somente status "paid" dentro da janela de 30min).
 *
 * Regras de negócio (D4-Cancelamento-Seller):
 *   - Apenas pedidos "paid" podem ser cancelados pelo seller
 *   - Janela: paid_at + SELLER_CANCEL_WINDOW_MINUTES > now()
 *   - Razão obrigatória (enum VALID_CANCEL_REASONS)
 *   - Até 3 cancelamentos/mês sem penalidade; 4+ gera alerta OPS
 *   - Reembolso automático via Asaas (fire-and-forget)
 *   - Notifica buyer (socket/email para guest)
 *
 * @param {string} orderId
 * @param {string} sellerId — seller_profiles.id (do X-Seller-Context ou resolução)
 * @param {string} userId   — UID do usuário autenticado (owner ou team member)
 * @param {string} reason   — sem_estoque | erro_no_pedido | cliente_solicitou | outro
 * @returns {Object} { order, monthlyCount }
 */
async function cancelOrderBySeller(orderId, sellerId, userId, reason) {
  const fn = 'cancelOrderBySeller';

  // ── 1. Validate reason ───────────────────────────────
  if (!VALID_CANCEL_REASONS.includes(reason)) {
    throw new Error(`Motivo inválido. Válidos: ${VALID_CANCEL_REASONS.join(', ')}`);
  }

  // ── 2. Fetch order with seller info ──────────────────
  const { data: order, error } = await sb()
    .from('marketplace_orders')
    .select('*, seller_profiles!inner(id, user_id)')
    .eq('id', orderId)
    .single();

  if (error || !order) throw new Error('Pedido não encontrado');

  // ── 3. Verify seller ownership / team access ─────────
  const isOwner = order.seller_profiles.user_id === userId;
  let isSeller = isOwner;

  if (!isSeller) {
    // Check team member permission
    const resolvedSellerId = sellerId || order.seller_id;
    const { data: teamMember } = await sb()
      .from('seller_team_members')
      .select('role, permissions')
      .eq('seller_id', resolvedSellerId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();
    if (teamMember?.permissions?.can_manage_orders) {
      isSeller = true;
    }
  }

  if (!isSeller) {
    throw new Error('Sem permissão para cancelar este pedido');
  }

  // ── 4. Validate status = paid ────────────────────────
  if (order.status !== 'paid') {
    throw new Error(`Apenas pedidos com status "paid" podem ser cancelados pelo vendedor. Status atual: ${order.status}`);
  }

  // ── 5. Validate 30-minute window ────────────────────
  const paidAt = new Date(order.updated_at); // updated_at is set when status transitions to paid
  const windowEnd = new Date(paidAt.getTime() + SELLER_CANCEL_WINDOW_MINUTES * 60 * 1000);
  const now = new Date();

  if (now > windowEnd) {
    throw new Error('Janela de cancelamento expirou. Entre em contato com o suporte.');
  }

  // ── 6. Check monthly cancellation count ──────────────
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

  const { count: monthlyCount, error: countErr } = await sb()
    .from('marketplace_orders')
    .select('id', { count: 'exact', head: true })
    .eq('seller_id', order.seller_id)
    .eq('status', 'cancelled')
    .not('cancelled_by', 'is', null)
    .eq('cancelled_by', 'seller')
    .gte('cancelled_at', monthStart)
    .lte('cancelled_at', monthEnd);

  const currentCount = countErr ? 0 : (monthlyCount || 0);

  if (currentCount >= SELLER_CANCEL_MONTHLY_LIMIT) {
    logger.warn(`[${SERVICE}] Seller ${order.seller_id} ultrapassou limite mensal de cancelamentos (${currentCount + 1})`, {
      function: fn, orderId, sellerId: order.seller_id, monthlyCount: currentCount + 1,
    });
  }

  // ── 7. Update order to cancelled ─────────────────────
  const cancelPayload = {
    status: 'cancelled',
    cancelled_by: 'seller',
    cancellation_reason: reason,
    cancelled_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  const { data: updated, error: updateErr } = await sb()
    .from('marketplace_orders')
    .update(cancelPayload)
    .eq('id', orderId)
    .eq('status', 'paid') // optimistic lock — only cancel if still paid
    .select()
    .single();

  if (updateErr) {
    throw new Error(`Erro ao cancelar pedido: ${updateErr.message}`);
  }

  log(fn, `Pedido ${orderId} cancelado pelo seller`, {
    userId, sellerId: order.seller_id, reason, monthlyCount: currentCount + 1,
  });

  // ── 8. Fire-and-forget: refund via Asaas ─────────────
  if (order.payment_id) {
    setImmediate(async () => {
      try {
        const result = await asaasService.refundPayment(order.payment_id);
        logger.info(`[${SERVICE}] Reembolso iniciado para pedido ${orderId}`, {
          function: fn, paymentId: order.payment_id, refundStatus: result?.status,
        });
      } catch (refundErr) {
        logger.error(`[${SERVICE}] Reembolso falhou para pedido ${orderId}`, {
          function: fn, paymentId: order.payment_id, error: refundErr.message,
        });
      }
    });
  }

  // ── 8b. Unified Ledger (W3): reverse entries on cancellation ─
  setImmediate(() => _reverseLedgerForOrder(orderId, `Cancelamento pelo vendedor: ${reason}`));

  // ── 8c. Restaurar estoque de variantes (ELOS-BE-014) ─
  _restoreVariantStockForOrder(order);

  // ── 9. Fire-and-forget: notify buyer ─────────────────
  setImmediate(() => {
    if (order.buyer_id) {
      // Registered buyer — in-app notification
      notificationDispatcher.dispatch({
        userId: order.buyer_id,
        type: 'marketplace_order_status',
        importance: 'high',
        data: { orderId, newStatus: 'cancelled', updatedBy: 'seller', reason },
        metadata: { triggeredBy: userId },
        dedupKey: `marketplace_order_cancelled_${orderId}`,
      }).catch(() => {});
    } else if (order.guest_buyer_id) {
      // Guest buyer — email notification
      notifyGuestBuyer(order, 'cancelled');
    }
  });

  // ── 10. Fire-and-forget: OPS alert if >= 4 cancellations ─
  // Uses structured logger.warn (ops_alert tag) for admin monitoring.
  // ops_activity_log requires a task FK; for system-generated alerts we use
  // the audit log pattern instead. Admin can query by tag 'ops_alert:seller_cancel_threshold'.
  if (currentCount + 1 >= SELLER_CANCEL_MONTHLY_LIMIT + 1) {
    logger.warn(`[${SERVICE}] OPS_ALERT:seller_cancel_threshold — seller ${order.seller_id} atingiu ${currentCount + 1} cancelamentos no mes`, {
      function: fn,
      alertType: 'seller_cancel_threshold',
      sellerId: order.seller_id,
      monthlyCount: currentCount + 1,
      orderId,
      reason,
      limit: SELLER_CANCEL_MONTHLY_LIMIT,
    });

    // Also notify admin via notification dispatcher (fire-and-forget)
    setImmediate(async () => {
      try {
        // Get admin user IDs (role = admin) for notification
        const { data: admins } = await sb()
          .from('users')
          .select('id')
          .eq('role', 'admin')
          .limit(10);
        if (admins?.length) {
          for (const admin of admins) {
            notificationDispatcher.dispatch({
              userId: admin.id,
              type: 'ops_seller_cancel_alert',
              importance: 'high',
              data: {
                sellerId: order.seller_id,
                monthlyCount: currentCount + 1,
                orderId,
                reason,
              },
              metadata: { triggeredBy: 'system' },
              dedupKey: `ops_seller_cancel_alert_${order.seller_id}_${now.getMonth()}`,
            }).catch(() => {});
          }
        }
      } catch (notifyErr) {
        logger.warn(`[${SERVICE}] Falha ao notificar admins sobre seller cancel threshold`, {
          function: fn, error: notifyErr.message,
        });
      }
    });
  }

  return { order: updated, monthlyCount: currentCount + 1 };
}

/**
 * Retorna a contagem de cancelamentos pelo seller no mês corrente.
 * @param {string} sellerId — seller_profiles.id
 * @returns {{ count: number, limit: number }}
 */
async function getSellerMonthlyCancellations(sellerId) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

  const { count, error } = await sb()
    .from('marketplace_orders')
    .select('id', { count: 'exact', head: true })
    .eq('seller_id', sellerId)
    .eq('status', 'cancelled')
    .not('cancelled_by', 'is', null)
    .eq('cancelled_by', 'seller')
    .gte('cancelled_at', monthStart)
    .lte('cancelled_at', monthEnd);

  return {
    count: error ? 0 : (count || 0),
    limit: SELLER_CANCEL_MONTHLY_LIMIT,
  };
}

/**
 * Confirma recebimento de pagamento offline pelo vendedor.
 * Usado quando o comprador pagou fora da plataforma (PIX direto, dinheiro, etc.)
 * e o vendedor quer avançar o pedido manualmente.
 *
 * Segurança: somente o vendedor dono do pedido pode chamar; somente pedidos
 * com status 'pending' são aceitos. A ação é auditada via logger.
 */
async function confirmPaymentOffline(userId, orderId) {
  const { data: order, error } = await sb()
    .from('marketplace_orders')
    .select('*, seller_profiles!inner(user_id)')
    .eq('id', orderId)
    .single();

  if (error || !order) throw new Error('Pedido não encontrado');

  const isSeller = order.seller_profiles.user_id === userId;
  if (!isSeller) throw new Error('Sem permissão: apenas o vendedor pode confirmar pagamento offline');

  if (order.status !== 'pending') {
    throw new Error(`Transição inválida: pedido já está com status "${order.status}"`);
  }

  const { data: updated, error: updateErr } = await sb()
    .from('marketplace_orders')
    .update({
      status:         'paid',
      payment_method: 'offline_confirmed',
      updated_at:     new Date().toISOString(),
    })
    .eq('id', orderId)
    .select()
    .single();

  if (updateErr) throw new Error(`Erro ao confirmar pagamento: ${updateErr.message}`);

  logger.info(`[${SERVICE}] OFFLINE_PAYMENT_CONFIRMED`, {
    orderId,
    confirmedBy: userId,
    previousPaymentMethod: order.payment_method,
  });

  // ── Unified Ledger (W3): record offline payment ───────────
  setImmediate(() => _recordLedgerForOrder({
    orderId,
    sellerUserId:   order.seller_profiles.user_id,
    totalBrl:       Number(order.total_brl),
    commissionBrl:  Number(order.commission_brl) || 0,
    paymentId:      null,
    paymentMethod:  'offline_confirmed',
  }));

  return updated;
}

/**
 * Contesta um pedido. Cria uma disputa via disputa-agent.
 * Só o comprador pode contestar, e apenas se status = 'paid' ou 'in_progress'.
 */
async function createOrderDispute(buyerId, orderId, reason) {
  const { data: order, error } = await sb()
    .from('marketplace_orders')
    .select('*')
    .eq('id', orderId)
    .eq('buyer_id', buyerId)
    .single();

  if (error || !order) throw new Error('Pedido não encontrado ou sem permissão');
  if (!['paid', 'in_progress'].includes(order.status)) {
    throw new Error(`Pedido com status "${order.status}" não pode ser contestado`);
  }

  // Delega ao disputa-agent (integração via disputeService quando implementado)
  // Por ora, marca o pedido como 'disputed' e registra o motivo no campo items (metadata)
  const { data: updated, error: updateErr } = await sb()
    .from('marketplace_orders')
    .update({
      status: 'disputed',
      updated_at: new Date().toISOString()
    })
    .eq('id', orderId)
    .select()
    .single();

  if (updateErr) throw new Error(`Erro ao criar disputa: ${updateErr.message}`);

  logger.warn('[marketplaceService] Disputa criada — integração com disputa-agent pendente', {
    orderId, buyerId, reason
  });

  // Trust Passport — clawback de trust events do pedido disputado
  setImmediate(async () => {
    try {
      const trustMarketplaceService = require('./trustMarketplaceService');
      await trustMarketplaceService.clawbackTrustForOrder(orderId, 'dispute', { reason, buyerId });
    } catch (err) {
      logger.warn(`[${SERVICE}] Trust clawback falhou para disputa ${orderId}`, {
        error: err.message, orderId,
      });
    }
  });

  // Dispatch order_problem notification to seller
  try {
    const notificationDispatcher = require('./NotificationDispatcher');
    notificationDispatcher.dispatch({
      userId: order.seller_id,
      type: 'order_problem',
      importance: 'high',
      data: {
        userId: order.seller_id,
        sellerId: order.seller_id,
        orderId,
        reason,
        buyerId,
      },
      dedupKey: `order_problem_${orderId}`,
      metadata: {},
    }).catch(() => {});
  } catch (_) { /* best-effort */ }

  return updated;
}

// ──────────────────────────────────────────────────────
// 4. Avaliações de Loja (MKTPLACE-REVIEW-001)
// ──────────────────────────────────────────────────────

/**
 * Submete avaliação de uma loja via RPC SECURITY DEFINER.
 * Valida no banco: ownership do pedido, status completed, janela 90d, unicidade.
 */
async function createReview(buyerId, orderId, { rating, comment, is_anonymous = false }) {
  log('createReview', 'Submetendo avaliação', { buyerId, orderId, rating });

  const { data, error } = await sb().rpc('submit_marketplace_review', {
    p_order_id:     orderId,
    p_rating:       rating,
    p_comment:      comment || null,
    p_is_anonymous: is_anonymous,
  });

  if (error) throw new Error(`Erro ao submeter avaliação: ${error.message}`);
  if (!data?.success) throw new Error(data?.message || 'Não foi possível submeter a avaliação.');

  await fireEvent('review_given', buyerId, { order_id: orderId, rating });

  return data;
}

/**
 * Lista avaliações públicas de uma loja com dados do comprador (anonimato respeitado).
 */
async function getSellerReviews(sellerId, { page = 1, limit = 10 } = {}) {
  const safeLimit = Math.min(Number(limit) || 10, 50);
  const offset    = (Math.max(Number(page) || 1, 1) - 1) * safeLimit;

  const { data, error, count } = await sb()
    .from('marketplace_reviews')
    .select(`
      id, rating, comment, is_anonymous,
      seller_reply, seller_replied_at, created_at,
      buyer:buyer_id ( full_name, avatar_url, username )
    `, { count: 'exact' })
    .eq('seller_id', sellerId)
    .order('created_at', { ascending: false })
    .range(offset, offset + safeLimit - 1);

  if (error) throw new Error(`Erro ao buscar avaliações: ${error.message}`);

  // Aplica anonimato: oculta dados do comprador se is_anonymous = true
  const reviews = (data || []).map(r => ({
    ...r,
    buyer: r.is_anonymous ? null : r.buyer,
  }));

  return { reviews, total: count ?? 0, page: Number(page), limit: safeLimit };
}

/**
 * Retorna a avaliação existente de um pedido específico (ou null).
 * Usado pelo frontend para verificar se o comprador já avaliou.
 */
async function getOrderReview(orderId) {
  const { data, error } = await sb()
    .from('marketplace_reviews')
    .select('id, rating, comment, is_anonymous, seller_reply, seller_replied_at, created_at')
    .eq('order_id', orderId)
    .maybeSingle();

  if (error) throw new Error(`Erro ao buscar avaliação do pedido: ${error.message}`);
  return data || null;
}

/**
 * Vendedor responde a uma avaliação recebida via RPC SECURITY DEFINER.
 */
async function replyToReview(sellerUserId, reviewId, reply) {
  log('replyToReview', 'Respondendo avaliação', { sellerUserId, reviewId });

  const { data, error } = await sb().rpc('reply_to_marketplace_review', {
    p_review_id: reviewId,
    p_reply:     reply,
  });

  if (error) throw new Error(`Erro ao responder avaliação: ${error.message}`);
  if (!data?.success) throw new Error(data?.message || 'Não foi possível responder à avaliação.');

  return data;
}

// ──────────────────────────────────────────────────────
// 5. Metas Comunitárias
// ──────────────────────────────────────────────────────

/**
 * Cria uma meta comunitária.
 */
async function createCommunityGoal(userId, data) {
  log('createCommunityGoal', 'Criando meta comunitária', { userId });

  const { title, description, category = 'outros', target_brl, target_date, caixinha_id } = data;
  if (!title)      throw new Error('title é obrigatório');
  if (!target_brl) throw new Error('target_brl é obrigatório');

  const { data: goal, error } = await sb()
    .from('community_goals')
    .insert({
      creator_id: userId,
      caixinha_id: caixinha_id || null,
      title,
      description,
      category,
      target_brl: Number(target_brl),
      target_date: target_date || null,
      status: 'open'
    })
    .select()
    .single();

  if (error) throw new Error(`Erro ao criar meta: ${error.message}`);
  log('createCommunityGoal', 'Meta criada', { goalId: goal.id });
  return goal;
}

/**
 * Lista metas comunitárias abertas ou financiadas.
 */
async function listCommunityGoals({ category, caixinha_id, status = 'open' } = {}, { limit = 20, page = 1 } = {}) {
  const safeLimit = Math.min(parseInt(limit) || 20, 100);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * safeLimit;

  let query = sb()
    .from('community_goals')
    .select('*', { count: 'exact' })
    .in('status', status === 'all' ? ['open', 'funded', 'completed'] : [status])
    .order('created_at', { ascending: false })
    .range(offset, offset + safeLimit - 1);

  if (category)    query = query.eq('category', category);
  if (caixinha_id) query = query.eq('caixinha_id', caixinha_id);

  const { data, error, count } = await query;
  if (error) throw new Error(`Erro ao listar metas: ${error.message}`);

  return { goals: data || [], total: count || 0, page, limit: safeLimit };
}

/**
 * Contribui para uma meta comunitária.
 * Cria o registro de contribuição e atualiza raised_brl atomicamente.
 * Se raised_brl >= target_brl após a contribuição → transiciona para 'funded'.
 */
async function contributeToGoal(userId, goalId, data) {
  log('contributeToGoal', 'Contribuindo para meta', { userId, goalId });

  const { amount_brl = 0, coins_used = 0, payment_id } = data;
  const amountBrl  = Math.max(0, Number(amount_brl));
  const coinsUsed  = Math.max(0, parseInt(coins_used) || 0);

  if (amountBrl === 0 && coinsUsed === 0) {
    throw new Error('Contribuição deve ter valor em BRL ou ElosCoins');
  }

  // Valida que a meta existe e está aberta
  const { data: goal, error: goalErr } = await sb()
    .from('community_goals')
    .select('*')
    .eq('id', goalId)
    .single();

  if (goalErr || !goal) throw new Error('Meta comunitária não encontrada');
  if (goal.status !== 'open') throw new Error(`Meta com status "${goal.status}" não aceita contribuições`);

  // Debita ElosCoins se necessário
  let coinsBrl = 0;
  if (coinsUsed > 0) {
    // Taxa de conversão fixa da plataforma: R$ 0,01 por coin
    const PLATFORM_COINS_RATE = 0.01;
    coinsBrl = +(coinsUsed * PLATFORM_COINS_RATE).toFixed(2);
    await gamificationService.spendCoins(
      userId, coinsUsed, 'community_goal',
      null, { goal_id: goalId }
    );
  }

  const totalContribution = +(amountBrl + coinsBrl).toFixed(2);

  // Insere contribuição
  const { data: contribution, error: contribErr } = await sb()
    .from('community_goal_contributions')
    .insert({
      goal_id: goalId,
      user_id: userId,
      amount_brl: amountBrl,
      coins_used: coinsUsed,
      payment_id: payment_id || null,
      confirmed_at: payment_id ? null : new Date().toISOString() // sem payment_id = confirmado imediatamente (coins)
    })
    .select()
    .single();

  if (contribErr) throw new Error(`Erro ao registrar contribuição: ${contribErr.message}`);

  // Atualiza raised_brl se a contribuição já foi confirmada
  if (contribution.confirmed_at) {
    const newRaised = +(Number(goal.raised_brl) + totalContribution).toFixed(2);
    const newStatus = newRaised >= Number(goal.target_brl) ? 'funded' : 'open';

    await sb()
      .from('community_goals')
      .update({
        raised_brl: newRaised,
        status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', goalId);

    if (newStatus === 'funded') {
      log('contributeToGoal', `Meta ${goalId} atingiu o objetivo — status: funded`, { newRaised });
    }
  }

  await fireEvent('community_goal_supported', userId, { goal_id: goalId, amount: totalContribution });

  return contribution;
}

// ──────────────────────────────────────────────────────
// 4b. Payment methods by seller tier (shared logic — D2-Cartão)
// ──────────────────────────────────────────────────────

/**
 * Retorna os métodos de pagamento disponíveis para um seller baseado no plano.
 * Brasileirinho I+ → PIX + Cartão; sem plano pago → PIX only.
 *
 * @param {string} sellerId — UUID do seller
 * @returns {Promise<string[]>} — ex: ['pix'] ou ['pix', 'credit_card']
 */
async function getAvailablePaymentMethods(sellerId) {
  const { data: seller, error } = await sb()
    .from('seller_profiles')
    .select('plan_slug')
    .eq('id', sellerId)
    .single();

  if (error || !seller) throw new Error('Vendedor não encontrado');

  const plan = seller.plan_slug || 'lojista_basico';
  const isBrasileirinho = plan.startsWith('brasileirinho_');
  return isBrasileirinho ? ['pix', 'credit_card'] : ['pix'];
}

// ──────────────────────────────────────────────────────
// 5. Pagamento de pedido (PIX ou Cartão — Asaas)
// ──────────────────────────────────────────────────────

/**
 * Inicia pagamento PIX de um pedido via Asaas.
 * Cria/reutiliza o customer Asaas (idempotente por externalReference = userId)
 * e gera a cobrança PIX. Atualiza marketplace_orders.payment_id.
 *
 * Pré-condições: order.status === 'pending' && order.total_brl > 0
 *
 * @param {string} orderId
 * @param {{ uid, email, name, cpf }} buyerData
 * @returns {{ order, payment: { paymentId, pixCopiaECola, encodedImage, expiresAt, value } }}
 */
async function initiateOrderPayment(orderId, buyerData) {
  log('initiateOrderPayment', 'Iniciando pagamento PIX', { orderId, buyerId: buyerData.uid });

  const { data: order, error } = await sb()
    .from('marketplace_orders')
    .select('*')
    .eq('id', orderId)
    .eq('buyer_id', buyerData.uid)
    .single();

  if (error || !order) throw new Error('Pedido não encontrado');
  if (order.status !== 'pending') {
    throw new Error(`Pedido com status "${order.status}" não pode iniciar pagamento`);
  }
  if (order.total_brl <= 0) {
    throw new Error('Pedido sem valor a pagar (total = 0)');
  }

  // Cria/reutiliza customer Asaas — idempotente por externalReference = userId
  const customer = await asaasService.createCustomer({
    name:              buyerData.name || buyerData.email,
    email:             buyerData.email,
    cpfCnpj:           buyerData.cpf || undefined,
    externalReference: buyerData.uid,
  });

  // Gera cobrança PIX
  const charge = await asaasService.createPixCharge({
    customerId:        customer.customerId || customer.id,
    value:             order.total_brl,
    description:       `ElosCloud Mercado — Pedido ${orderId}`,
    externalReference: `marketplace_order_${orderId}`,
  });

  // Grava payment_id + código PIX para recuperação posterior
  const pixExpiresAt = charge.expirationDate
    ? new Date(charge.expirationDate + 'T23:59:59Z').toISOString()
    : null;

  const { data: updated } = await sb()
    .from('marketplace_orders')
    .update({
      payment_id:     charge.id || charge.txid,
      payment_method: 'pix',
      pix_code:       charge.pixCopiaECola || null,
      pix_expires_at: pixExpiresAt,
      payment_url:    charge.invoiceUrl || null,
      updated_at:     new Date().toISOString(),
    })
    .eq('id', orderId)
    .select()
    .single();

  log('initiateOrderPayment', 'PIX gerado', { orderId, paymentId: charge.id });

  return {
    order: updated || order,
    payment: {
      paymentId:     charge.id || charge.txid,
      pixCopiaECola: charge.pixCopiaECola,
      encodedImage:  charge.encodedImage,
      expiresAt:     charge.expirationDate,
      value:         order.total_brl,
    },
  };
}

/**
 * Inicia pagamento por cartão de crédito de um pedido via Asaas (CMP-014 + PAY-CARD-003).
 * Segue o mesmo padrão de guestCheckoutService.initiateGuestPayment.
 * Aceita cartão novo OU cartão salvo (savedCardId) OU flag saveCard para tokenizar após sucesso.
 *
 * Pré-condições: order.status === 'pending' && order.total_brl > 0 && seller tem plano Brasileirinho
 *
 * @param {string} orderId
 * @param {{ uid, email, name, cpf }} buyerData
 * @param {{ holderName?, number?, expiryMonth?, expiryYear?, ccv?, postalCode?, savedCardId?, saveCard? }} cardData
 * @returns {{ order, payment: { paymentId, cardStatus, method } }}
 */
async function initiateCardPayment(orderId, buyerData, cardData) {
  const fn = 'initiateCardPayment';
  log(fn, 'Iniciando pagamento por cartão', { orderId, buyerId: buyerData.uid });

  const { data: order, error } = await sb()
    .from('marketplace_orders')
    .select('*, seller:seller_id ( id, user_id, plan_slug, business_name )')
    .eq('id', orderId)
    .eq('buyer_id', buyerData.uid)
    .single();

  if (error || !order) throw new Error('Pedido não encontrado');
  if (order.status !== 'pending') {
    throw new Error(`Pedido com status "${order.status}" não pode iniciar pagamento`);
  }
  if (order.total_brl <= 0) {
    throw new Error('Pedido sem valor a pagar (total = 0)');
  }

  // Validar que seller aceita cartão (tier-gating)
  const plan = order.seller?.plan_slug || 'lojista_basico';
  if (!plan.startsWith('brasileirinho_')) {
    throw new Error('Pagamento por cartão não disponível para este vendedor');
  }

  if (!cardData) throw new Error('Dados do cartão são obrigatórios');

  // Cria/reutiliza customer Asaas — idempotente por externalReference = userId
  const customer = await asaasService.createCustomer({
    name:              buyerData.name || buyerData.email,
    email:             buyerData.email,
    cpfCnpj:           buyerData.cpf || undefined,
    externalReference: buyerData.uid,
  });

  const customerId = customer.customerId || customer.id;
  const externalReference = `marketplace_order_${orderId}`;
  const sellerName = order.seller?.business_name || 'ElosCloud';
  const remoteIp = cardData.remoteIp || '127.0.0.1';

  // PAY-CARD-003: Montar payload — cartão salvo (token) ou cartão novo
  let chargePayload;
  if (cardData.savedCardId) {
    const savedCardService = require('./savedCardService');
    const saved = await savedCardService.getCardById(buyerData.uid, cardData.savedCardId);
    log(fn, 'Usando cartão salvo', { cardId: saved.id, brand: saved.brand });
    chargePayload = {
      customerId: saved.gateway_customer_id,
      value: order.total_brl,
      description: `Pedido #${orderId.substring(0, 8)} - ${sellerName}`,
      externalReference,
      creditCardToken: saved.gateway_token,
      remoteIp,
    };
  } else {
    chargePayload = {
      customerId,
      value: order.total_brl,
      description: `Pedido #${orderId.substring(0, 8)} - ${sellerName}`,
      externalReference,
      creditCard: {
        holderName: cardData.holderName,
        number: cardData.number,
        expiryMonth: cardData.expiryMonth,
        expiryYear: cardData.expiryYear,
        ccv: cardData.ccv,
      },
      creditCardHolderInfo: {
        name: buyerData.name || buyerData.email,
        email: buyerData.email,
        phone: buyerData.phone || undefined,
        postalCode: cardData.postalCode || '00000000',
      },
    };
  }

  const cardCharge = await asaasService.createCardCharge(chargePayload);

  // Se confirmação imediata, marcar como pago
  const paidStatuses = ['CONFIRMED', 'RECEIVED'];
  const newStatus = paidStatuses.includes(cardCharge.status) ? 'paid' : 'pending';

  const { data: updated } = await sb()
    .from('marketplace_orders')
    .update({
      payment_method: 'credit_card',
      payment_id: cardCharge.paymentId,
      payment_url: cardCharge.invoiceUrl || null,
      ...(newStatus === 'paid' && { status: 'paid', updated_at: new Date().toISOString() }),
    })
    .eq('id', orderId)
    .select()
    .single();

  log(fn, 'Cartão processado', { orderId, paymentId: cardCharge.paymentId, status: cardCharge.status });

  // Notificar seller + auto-delivery se pagamento confirmado imediatamente
  if (newStatus === 'paid') {
    const socketManager = require('../config/socket/socketManager');
    const notificationDispatcher = require('./NotificationDispatcher');

    if (order.seller?.user_id) {
      setImmediate(() => {
        socketManager.emitToUser(order.seller.user_id, 'marketplace:new_order_paid', { orderId: order.id });
        notificationDispatcher.dispatch({
          userId: order.seller.user_id,
          type: 'marketplace_new_order',
          importance: 'high',
          data: {
            orderId: order.id,
            sellerId: order.seller_id || order.seller?.id,
            clientName: buyerData.name || 'Cliente',
          },
          dedupKey: `marketplace_new_order_seller_${order.id}`,
          metadata: { triggeredBy: 'system' },
        }).catch(() => {});
      });
    }

    // Auto-trigger delivery for local_delivery orders
    if (order.fulfillment_type === 'local_delivery') {
      setImmediate(() => _autoRequestDelivery(updated || order, order.seller).catch(err =>
        logger.warn(`[${fn}] Auto-delivery failed`, { orderId, error: err.message })
      ));
    }

    // ── Unified Ledger (W3): record instant card payment ───────────
    setImmediate(() => _recordLedgerForOrder({
      orderId,
      sellerUserId:   order.seller?.user_id,
      totalBrl:       Number(order.total_brl),
      commissionBrl:  Number(order.commission_brl) || 0,
      paymentId:      cardCharge.paymentId || null,
      paymentMethod:  'credit_card',
    }));
  }

  // PAY-CARD-003: Se saveCard=true e pagamento confirmado, tokenizar e salvar
  if (cardData.saveCard && !cardData.savedCardId && newStatus === 'paid') {
    setImmediate(async () => {
      try {
        const savedCardService = require('./savedCardService');
        await savedCardService.tokenizeAndSave(buyerData.uid, {
          cardData: {
            holderName: cardData.holderName,
            number: cardData.number,
            expiryMonth: cardData.expiryMonth,
            expiryYear: cardData.expiryYear,
            ccv: cardData.ccv,
          },
          holderInfo: {
            name: buyerData.name || buyerData.email,
            email: buyerData.email,
            cpfCnpj: buyerData.cpf || undefined,
            phone: buyerData.phone || undefined,
            postalCode: cardData.postalCode || '00000000',
          },
          remoteIp,
        });
        log(fn, 'Cartão salvo após pagamento confirmado', { orderId, buyerId: buyerData.uid });
      } catch (err) {
        logger.warn(`[${fn}] Falha ao salvar cartão (não-bloqueante)`, { orderId, error: err.message });
      }
    });
  }

  return {
    order: updated || order,
    payment: {
      method: 'credit_card',
      cardStatus: cardCharge.status,
      paymentId: cardCharge.paymentId,
      confirmed: newStatus === 'paid',
    },
  };
}

/**
 * Renova o PIX de um pedido pendente expirado.
 * Cancela a cobrança antiga no Asaas, cria uma nova e persiste o novo código.
 *
 * @param {string} userId   — UID do comprador (validação de ownership)
 * @param {string} orderId  — UUID do pedido
 * @returns {{ order, payment }} — igual ao retorno de initiateOrderPayment
 */
async function renewOrderPix(userId, orderId) {
  log('renewOrderPix', 'Iniciando renovação de PIX', { orderId, userId });

  const { data: order, error } = await sb()
    .from('marketplace_orders')
    .select('*')
    .eq('id', orderId)
    .eq('buyer_id', userId)
    .single();

  if (error || !order) throw new Error('Pedido não encontrado');
  if (order.status !== 'pending') {
    throw new Error(`Somente pedidos pendentes podem ter o PIX renovado (status atual: ${order.status})`);
  }
  if (order.payment_method && order.payment_method !== 'pix') {
    throw new Error('Este pedido não utiliza PIX');
  }

  // Valida que o código realmente expirou (ou nunca foi gerado)
  if (order.pix_expires_at) {
    const expired = new Date(order.pix_expires_at) < new Date();
    if (!expired) {
      throw new Error('O código PIX ainda está válido. Copie e pague normalmente.');
    }
  }

  // Cancela a cobrança antiga no Asaas (idempotente — ignora 404)
  if (order.payment_id) {
    await asaasService.cancelPayment(order.payment_id);
  }

  // Gera nova cobrança usando os dados do comprador já salvos na ordem
  const { data: buyerRow } = await sb()
    .from('users')
    .select('full_name, username, email')
    .eq('id', userId)
    .single();

  const result = await initiateOrderPayment(orderId, {
    uid:   userId,
    email: buyerRow?.email   || '',
    name:  buyerRow?.full_name || buyerRow?.username || buyerRow?.email || userId,
  });

  log('renewOrderPix', 'PIX renovado com sucesso', { orderId, newPaymentId: result.payment.paymentId });

  return result;
}

/**
 * Aprova ou rejeita um perfil de vendedor (ação admin/suporte).
 * Atualiza o status do seller_profile, notifica o usuário por e-mail
 * e dispara evento de gamificação em caso de aprovação.
 *
 * @param {string} sellerId  — UUID do seller_profile
 * @param {object} opts
 * @param {boolean} opts.approved    — true = aprovado, false = rejeitado
 * @param {string}  [opts.reason]    — Motivo (obrigatório em rejeição, opcional em aprovação)
 * @param {string}  [opts.agentUserId] — UID do agente que tomou a decisão
 */
async function approveSellerProfile(sellerId, { approved, reason = '', agentUserId }) {
  log('approveSellerProfile', 'Processando decisão de aprovação', { sellerId, approved, agentUserId });

  const newStatus = approved ? 'active' : 'rejected';

  const { data: profile, error } = await sb()
    .from('seller_profiles')
    .update({
      status:      newStatus,
      status_note: reason || null,
      updated_at:  new Date().toISOString(),
    })
    .eq('id', sellerId)
    .select(SELLER_SAFE_COLS)
    .single();

  if (error || !profile) throw new Error(`Perfil de vendedor não encontrado: ${sellerId}`);

  log('approveSellerProfile', `Perfil ${newStatus}`, { sellerId, userId: profile.user_id });

  // Notificação por e-mail (fire-and-forget)
  try {
    const emailService = require('./emailService');
    const User         = require('../models/User');
    const user         = await User.getById(profile.user_id);
    if (user?.email) {
      if (approved) {
        await emailService.sendEmail({
          to:           user.email,
          subject:      '🎉 Sua loja foi aprovada no Mercado Local ElosCloud!',
          templateType: 'seller_approved',
          data: {
            userName:     user.nome || user.displayName || 'Vendedor',
            businessName: profile.business_name,
            category:     profile.category || '',
            dashboardUrl: 'https://eloscloud.com/mercado/vendedor',
          },
          userId:        profile.user_id,
          reference:     profile.id,
          referenceType: 'seller_profile',
        });
      } else {
        await emailService.sendEmail({
          to:           user.email,
          subject:      'Atualização sobre sua solicitação de loja — ElosCloud',
          templateType: 'seller_rejected',
          data: {
            userName:     user.nome || user.displayName || 'Usuário',
            businessName: profile.business_name,
            reason:       reason || '',
            supportUrl:   'https://eloscloud.com/ajuda/chamados',
          },
          userId:        profile.user_id,
          reference:     profile.id,
          referenceType: 'seller_profile',
        });
      }
    }
  } catch (emailErr) {
    logger.warn(`[${SERVICE}] Falha ao enviar e-mail de aprovação (não bloqueante): ${emailErr.message}`, { sellerId });
  }

  if (approved) {
    await fireEvent('seller_approved', profile.user_id, { seller_id: sellerId });
  }

  return profile;
}

// ──────────────────────────────────────────────────────────────────────────────
// MENU CATEGORIES (alimentação)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Cria uma categoria no cardápio do vendedor (ex.: "Entradas", "Pratos Principais").
 */
async function createMenuCategory(userId, data) {
  const seller = await getMySellerProfile(userId);
  if (seller.status !== 'active') throw new Error('Perfil de vendedor não está ativo.');
  const caps = ProductValidator.mergedCapabilitiesFor(
    Array.isArray(seller.category) ? seller.category : [seller.category]
  );
  if (!caps.has_menu_categories) {
    throw new Error('Seu tipo de negócio não suporta categorias de produto.');
  }

  const { name, description, sort_order } = data;
  if (!name) throw new Error('name é obrigatório');

  const { data: cat, error } = await sb()
    .from('menu_categories')
    .insert({ seller_id: seller.id, name, description, sort_order: sort_order ?? 0 })
    .select()
    .single();

  if (error) throw new Error(`Erro ao criar categoria: ${error.message}`);
  log('createMenuCategory', 'Categoria criada', { categoryId: cat.id });
  return cat;
}

/**
 * Lista categorias do cardápio de um vendedor (público).
 */
async function listMenuCategories(sellerId) {
  const { data, error } = await sb()
    .from('menu_categories')
    .select('*')
    .eq('seller_id', sellerId)
    .eq('active', true)
    .order('sort_order')
    .order('name');

  if (error) throw new Error(`Erro ao listar categorias: ${error.message}`);
  return data;
}

/**
 * Atualiza uma categoria do cardápio (somente o dono).
 */
async function updateMenuCategory(userId, categoryId, updates) {
  const seller = await getMySellerProfile(userId);

  const ALLOWED = ['name', 'description', 'sort_order', 'active'];
  const patch = {};
  for (const k of ALLOWED) {
    if (updates[k] !== undefined) patch[k] = updates[k];
  }
  if (!Object.keys(patch).length) throw new Error('Nenhum campo válido para atualizar.');

  const { data, error } = await sb()
    .from('menu_categories')
    .update(patch)
    .eq('id', categoryId)
    .eq('seller_id', seller.id)
    .select()
    .single();

  if (error) throw new Error(`Erro ao atualizar categoria: ${error.message}`);
  if (!data) throw new Error('Categoria não encontrada ou sem permissão.');
  return data;
}

/**
 * Cardápio completo do vendedor via RPC (categorias + itens + modifiers).
 */
async function getSellerMenu(sellerId) {
  const { data, error } = await sb()
    .rpc('get_seller_menu', { p_seller_id: sellerId });

  if (error) throw new Error(`Erro ao buscar cardápio: ${error.message}`);
  return data;
}

// ──────────────────────────────────────────────────────────────────────────────
// PRODUCT MODIFIERS (customizações de prato)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Adiciona um modifier (sem cebola, queijo extra...) a um item de cardápio.
 */
async function addProductModifier(userId, productId, modifierData) {
  const seller = await getMySellerProfile(userId);

  // Confirma que o produto pertence ao seller e é food_item
  const { data: product, error: pe } = await sb()
    .from('marketplace_products')
    .select('id, product_type, seller_id')
    .eq('id', productId)
    .eq('seller_id', seller.id)
    .single();

  if (pe || !product) throw new Error('Produto não encontrado ou sem permissão.');
  if (product.product_type !== 'food_item') {
    throw new Error('Modifiers só são suportados em itens de cardápio (food_item).');
  }

  const { group_name, modifier_type, label, price_delta, is_required, max_selections, sort_order } = modifierData;
  if (!group_name) throw new Error('group_name é obrigatório (ex.: "Retiradas", "Adicionais")');
  if (!modifier_type) throw new Error('modifier_type é obrigatório: exclusion | addition | substitution');
  if (!label) throw new Error('label é obrigatório (ex.: "Sem cebola")');

  const { data: modifier, error } = await sb()
    .from('product_modifiers')
    .insert({
      product_id: productId,
      group_name,
      modifier_type,
      label,
      price_delta:    price_delta    ?? 0,
      is_required:    is_required    ?? false,
      max_selections: max_selections ?? 1,
      sort_order:     sort_order     ?? 0,
    })
    .select()
    .single();

  if (error) throw new Error(`Erro ao adicionar modifier: ${error.message}`);
  log('addProductModifier', 'Modifier adicionado', { productId, modifierId: modifier.id });
  return modifier;
}

/**
 * Lista modifiers de um produto (público, somente ativos).
 */
async function listProductModifiers(productId) {
  const { data, error } = await sb()
    .from('product_modifiers')
    .select('*')
    .eq('product_id', productId)
    .eq('active', true)
    .order('group_name')
    .order('sort_order');

  if (error) throw new Error(`Erro ao listar modifiers: ${error.message}`);
  return data;
}

/**
 * Atualiza um modifier (somente o dono do produto).
 */
async function updateProductModifier(userId, modifierId, updates) {
  const seller = await getMySellerProfile(userId);

  const ALLOWED = ['group_name', 'label', 'modifier_type', 'price_delta', 'is_required', 'max_selections', 'sort_order', 'active'];
  const patch = {};
  for (const k of ALLOWED) {
    if (updates[k] !== undefined) patch[k] = updates[k];
  }
  if (!Object.keys(patch).length) throw new Error('Nenhum campo válido para atualizar.');

  // Resolve product_id do modifier e confirma ownership via subquery no banco
  const { data, error } = await sb()
    .from('product_modifiers')
    .update(patch)
    .eq('id', modifierId)
    .filter('product_id', 'in', `(
      SELECT p.id FROM marketplace_products p
      JOIN seller_profiles s ON s.id = p.seller_id
      WHERE s.user_id = '${seller.user_id}'
    )`)
    .select()
    .single();

  if (error) throw new Error(`Erro ao atualizar modifier: ${error.message}`);
  if (!data) throw new Error('Modifier não encontrado ou sem permissão.');
  return data;
}

/**
 * Remove (soft delete) um modifier.
 */
async function removeProductModifier(userId, modifierId) {
  return updateProductModifier(userId, modifierId, { active: false });
}

// ──────────────────────────────────────────────────────────────────────────────
// SELLER SUBTYPES
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Lista subtypes disponíveis, opcionalmente filtrado por category.
 */
async function listSellerSubtypes(category) {
  let q = sb()
    .from('marketplace_seller_subtypes')
    .select('*')
    .order('sort_order');

  if (category) q = q.eq('category', category);

  const { data, error } = await q;
  if (error) throw new Error(`Erro ao listar subtypes: ${error.message}`);
  return data;
}

// ──────────────────────────────────────────────────────
// Gestão de Loja (desativação / exclusão)
// ──────────────────────────────────────────────────────

/**
 * Desativa temporariamente a loja do vendedor (status → inactive).
 * Produtos permanecem no banco mas ficam invisíveis (seller não é 'active').
 * Pedidos ativos impedem a desativação.
 */
async function deactivateStore(userId) {
  const seller = await getMySellerProfile(userId);

  if (seller.status === 'inactive') {
    throw new Error('Sua loja já está desativada.');
  }
  if (seller.status !== 'active') {
    throw new Error(`Não é possível desativar uma loja com status "${seller.status}".`);
  }

  // Verificar pedidos ativos
  const { data: hasActive } = await sb().rpc('has_active_orders_for_seller', { p_seller_id: seller.id });
  if (hasActive) {
    throw new Error('Você possui pedidos ativos ou em andamento. Finalize-os antes de desativar sua loja.');
  }

  const { data, error } = await sb()
    .from('seller_profiles')
    .update({
      status: 'inactive',
      deactivated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', seller.id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error || !data) throw new Error('Erro ao desativar a loja.');

  logger.info(`[${SERVICE}] Loja desativada pelo vendedor`, { userId, sellerId: seller.id });
  return data;
}

/**
 * Reativa a loja do vendedor (inactive → active).
 */
async function reactivateStore(userId) {
  const seller = await getMySellerProfile(userId);

  if (seller.status !== 'inactive') {
    throw new Error(`Só é possível reativar uma loja com status "inactive". Status atual: "${seller.status}".`);
  }

  const { data, error } = await sb()
    .from('seller_profiles')
    .update({
      status: 'active',
      deactivated_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', seller.id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error || !data) throw new Error('Erro ao reativar a loja.');

  logger.info(`[${SERVICE}] Loja reativada pelo vendedor`, { userId, sellerId: seller.id });
  return data;
}

/**
 * Exclui definitivamente a loja do vendedor (status → deleted).
 * Soft-delete todos os produtos. Dados preservados para auditoria de pedidos passados.
 * Impede exclusão se há pedidos ativos.
 */
async function deleteStore(userId) {
  const seller = await getMySellerProfile(userId);

  if (seller.status === 'deleted') {
    throw new Error('Esta loja já foi excluída.');
  }

  // Verificar pedidos ativos
  const { data: hasActive } = await sb().rpc('has_active_orders_for_seller', { p_seller_id: seller.id });
  if (hasActive) {
    throw new Error('Você possui pedidos ativos ou em andamento. Finalize-os antes de excluir sua loja.');
  }

  // [STORE-DEL-001] Liberar handle para quarentena 90d antes de excluir
  if (seller.username) {
    try {
      await handleService.recordHandleRelease(seller.username, 'seller', seller.id);
    } catch (err) {
      logger.warn(`[${SERVICE}] Failed to release handle on store delete`, { userId, handle: seller.username, error: err.message });
    }
  }

  // [STORE-DEL-002] Cancelar assinatura Asaas para não cobrar seller após exclusão
  try {
    const { data: activeSub } = await sb()
      .from('user_subscriptions')
      .select('id, payment_id, status')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    if (activeSub?.payment_id) {
      await asaasService.cancelSubscription(activeSub.payment_id);
      await sb()
        .from('user_subscriptions')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', activeSub.id);
      logger.info(`[${SERVICE}] Assinatura cancelada ao excluir loja`, { userId, subscriptionId: activeSub.id });
    }
  } catch (err) {
    logger.warn(`[${SERVICE}] Failed to cancel subscription on store delete`, { userId, error: err.message });
  }

  const now = new Date().toISOString();

  // Soft-delete todos os produtos do vendedor
  await sb()
    .from('marketplace_products')
    .update({ active: false, deleted_at: now })
    .eq('seller_id', seller.id)
    .is('deleted_at', null);

  // Marcar loja como excluída
  const { data, error } = await sb()
    .from('seller_profiles')
    .update({
      status: 'deleted',
      deleted_at: now,
      updated_at: now,
    })
    .eq('id', seller.id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error || !data) throw new Error('Erro ao excluir a loja.');

  // [EQP-026] Notificar membros da equipe sobre exclusão da loja
  try {
    const { data: teamMembers } = await sb()
      .from('seller_team_members')
      .select('user_id')
      .eq('seller_id', seller.id)
      .eq('status', 'active')
      .neq('user_id', userId);

    if (teamMembers?.length) {
      const businessName = seller.trading_name || seller.business_name || 'Negócio';
      for (const member of teamMembers) {
        notificationDispatcher.dispatch('store_deleted', member.user_id, {
          sellerId: seller.id,
          businessName,
        }).catch(err => logger.warn(`[${SERVICE}] Failed to notify team member on store delete`, { userId: member.user_id, error: err.message }));
      }
    }
  } catch (err) {
    logger.warn(`[${SERVICE}] Failed to notify team on store delete`, { userId, error: err.message });
  }

  logger.info(`[${SERVICE}] Loja excluída definitivamente pelo vendedor`, { userId, sellerId: seller.id });

  // Gamificação: perder selo de vendedor (se existir)
  await fireEvent('seller_store_deleted', userId, { sellerId: seller.id });

  return data;
}

/**
 * Backfill: geocodifica vendedores ativos que têm endereço textual mas sem coordenadas.
 * Usa a cadeia BrasilAPI → Google Geocoding.
 * Retorna { updated, skipped, failed }.
 */
async function backfillSellerCoords({ limit = 50 } = {}) {
  log('backfillSellerCoords', 'Iniciando backfill de coordenadas de vendedores');

  const { data: sellers, error } = await sb()
    .from('seller_profiles')
    .select('id, address_cep, address_logradouro, address_numero, address_neighborhood, address_city, address_state')
    .in('status', ['active', 'pending'])
    .is('address_lat', null)
    .not('address_city', 'is', null)
    .limit(limit);

  if (error) throw new Error(`Erro ao buscar vendedores para backfill: ${error.message}`);
  if (!sellers?.length) return { updated: 0, skipped: 0, failed: 0, total: 0 };

  let updated = 0, skipped = 0, failed = 0;

  for (const seller of sellers) {
    try {
      const coords = await resolveCoords({
        cep: seller.address_cep,
        logradouro: seller.address_logradouro,
        numero: seller.address_numero,
        bairro: seller.address_neighborhood,
        cidade: seller.address_city,
        estado: seller.address_state,
      });

      if (!coords) { skipped++; continue; }

      const { error: upErr } = await sb()
        .from('seller_profiles')
        .update({ address_lat: coords.lat, address_lng: coords.lng, updated_at: new Date().toISOString() })
        .eq('id', seller.id);

      if (upErr) { failed++; continue; }
      updated++;
    } catch {
      failed++;
    }
  }

  log('backfillSellerCoords', 'Backfill concluído', { updated, skipped, failed, total: sellers.length });
  return { updated, skipped, failed, total: sellers.length };
}

// ──────────────────────────────────────────────────────
// Financeiro (Seller Financial Panel)
// ───��──────────────────────────────────────────────────

async function getSellerFinancials(userId, startDate, endDate, sellerCtx = null) {
  log('getSellerFinancials', 'Buscando financeiro do seller', { userId, startDate, endDate });

  // Resolve seller_id
  let sellerId = sellerCtx;
  if (!sellerId) {
    const { data: sp } = await sb()
      .from('seller_profiles')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();
    sellerId = sp?.id;
  }
  if (!sellerId) throw new Error('Perfil de vendedor não encontrado.');

  // Query aggregated metrics
  const { data: orders, error } = await sb()
    .from('marketplace_orders')
    .select('id, total_brl, commission_brl, commission_rate, delivery_fee, status, created_at, items')
    .eq('seller_id', sellerId)
    .in('status', ['completed', 'paid', 'in_progress'])
    .gte('created_at', startDate)
    .lte('created_at', endDate)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    logError('getSellerFinancials', error);
    throw new Error(`Erro ao buscar dados financeiros: ${error.message}`);
  }

  const allOrders = orders || [];

  // Calculate aggregates
  // total_brl inclui delivery_fee — separar para mostrar receita real do seller
  const vendas_brutas = allOrders.reduce((sum, o) => sum + (parseFloat(o.total_brl) || 0), 0);
  const total_comissoes = allOrders.reduce((sum, o) => sum + (parseFloat(o.commission_brl) || 0), 0);
  const total_delivery_fees = allOrders.reduce((sum, o) => sum + (parseFloat(o.delivery_fee) || 0), 0);
  // Receita de produtos = total cobrado - frete (frete é repasse ao entregador)
  const receita_produtos = vendas_brutas - total_delivery_fees;
  // Líquido = receita de produtos - comissão da plataforma
  const rendimento_liquido = receita_produtos - total_comissoes;

  // Return last 50 orders for the list
  const recentOrders = allOrders.slice(0, 50).map(o => {
    // Prefer persisted commission_rate; fallback for old orders (pre-migration)
    let commissionPct;
    if (o.commission_rate != null) {
      commissionPct = parseFloat(o.commission_rate) * 100;
    } else {
      // Fallback: derive from total (original formula used at order time)
      const totalVal = parseFloat(o.total_brl) || 0;
      commissionPct = totalVal > 0 ? ((parseFloat(o.commission_brl) || 0) / totalVal) * 100 : 0;
    }
    return {
      id: o.id,
      total_brl: o.total_brl,
      commission_brl: o.commission_brl,
      commission_pct: +commissionPct.toFixed(1),
      delivery_fee: o.delivery_fee,
      status: o.status,
      created_at: o.created_at,
      first_item_name: Array.isArray(o.items) && o.items.length > 0 ? (o.items[0].name || o.items[0].product_name || '—') : '—',
    };
  });

  return {
    total_orders: allOrders.length,
    vendas_brutas: +vendas_brutas.toFixed(2),
    receita_produtos: +receita_produtos.toFixed(2),
    total_comissoes: +total_comissoes.toFixed(2),
    total_delivery_fees: +total_delivery_fees.toFixed(2),
    rendimento_liquido: +rendimento_liquido.toFixed(2),
    orders: recentOrders,
  };
}

// ──────────────────────────────────────────────────────
// Clientes por Pedido (Order Clients)
// ──────────────────────────────────────────────────────

async function listOrderClients(userId, { search, page = 1, limit = 50 } = {}, sellerCtx = null) {
  log('listOrderClients', 'Listando clientes por pedido', { userId });

  let sellerId = sellerCtx;
  if (!sellerId) {
    const { data: sp } = await sb()
      .from('seller_profiles')
      .select('id')
      .eq('user_id', userId)
      .single();
    sellerId = sp?.id;
  }
  if (!sellerId) throw new Error('Perfil de vendedor não encontrado.');

  const { data: orders, error } = await sb()
    .from('marketplace_orders')
    .select('id, buyer_id, guest_buyer_id, buyer_snapshot, total_brl, status, created_at')
    .eq('seller_id', sellerId)
    .order('created_at', { ascending: false });

  if (error) {
    logError('listOrderClients', error);
    throw new Error(`Erro ao buscar pedidos: ${error.message}`);
  }

  if (!orders?.length) return { clients: [], total: 0, page: 1, limit };

  // Agrupa por buyer_id ou guest_buyer_id
  const clientMap = {};
  for (const o of orders) {
    const key = o.buyer_id || `guest_${o.guest_buyer_id}`;
    if (!clientMap[key]) {
      clientMap[key] = {
        buyer_id: o.buyer_id || null,
        guest_buyer_id: o.guest_buyer_id || null,
        is_guest: !o.buyer_id,
        name: o.buyer_snapshot?.full_name || o.buyer_snapshot?.name || null,
        email: o.buyer_snapshot?.email || null,
        avatar_url: null,
        total_orders: 0,
        total_spent: 0,
        last_order_date: o.created_at,
        orders_by_status: {},
      };
    }
    const c = clientMap[key];
    c.total_orders++;
    c.total_spent += parseFloat(o.total_brl) || 0;
    c.orders_by_status[o.status] = (c.orders_by_status[o.status] || 0) + 1;
    if (o.created_at > c.last_order_date) c.last_order_date = o.created_at;
  }

  // Enrich: registered buyers → users (nome/avatar atualizado)
  const registeredIds = Object.values(clientMap)
    .filter(c => c.buyer_id)
    .map(c => c.buyer_id);

  if (registeredIds.length) {
    const { data: users } = await sb()
      .from('users')
      .select('id, full_name, avatar_url, email')
      .in('id', registeredIds);

    if (users) {
      for (const u of users) {
        const c = clientMap[u.id];
        if (c) {
          c.name = u.full_name || c.name;
          c.avatar_url = u.avatar_url || null;
          c.email = u.email || c.email;
        }
      }
    }
  }

  // Enrich: guests → guest_buyers
  const guestIds = Object.values(clientMap)
    .filter(c => c.guest_buyer_id)
    .map(c => c.guest_buyer_id);

  if (guestIds.length) {
    const { data: guests } = await sb()
      .from('guest_buyers')
      .select('id, name, email, phone')
      .in('id', guestIds);

    if (guests) {
      for (const g of guests) {
        const c = clientMap[`guest_${g.id}`];
        if (c) {
          c.name = g.name || c.name;
          c.email = g.email || c.email;
        }
      }
    }
  }

  let clients = Object.values(clientMap);

  // Filtro search por nome/email
  if (search) {
    const s = search.toLowerCase();
    clients = clients.filter(c =>
      (c.name && c.name.toLowerCase().includes(s)) ||
      (c.email && c.email.toLowerCase().includes(s))
    );
  }

  // Sort por total_spent DESC
  clients.sort((a, b) => b.total_spent - a.total_spent);

  // Paginação
  const total = clients.length;
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const lm = Math.min(Math.max(1, parseInt(limit, 10) || 50), 100);
  const offset = (pg - 1) * lm;
  const paged = clients.slice(offset, offset + lm);

  // Arredonda total_spent
  for (const c of paged) c.total_spent = +c.total_spent.toFixed(2);

  return { clients: paged, total, page: pg, limit: lm };
}

async function listOrdersByBuyer(userId, buyerId, buyerType, { status, page = 1, limit = 20 } = {}, sellerCtx = null) {
  log('listOrdersByBuyer', 'Listando pedidos de um buyer', { userId, buyerId, buyerType });

  let sellerId = sellerCtx;
  if (!sellerId) {
    const { data: sp } = await sb()
      .from('seller_profiles')
      .select('id')
      .eq('user_id', userId)
      .single();
    sellerId = sp?.id;
  }
  if (!sellerId) throw new Error('Perfil de vendedor não encontrado.');

  let query = sb()
    .from('marketplace_orders')
    .select('id, buyer_id, guest_buyer_id, buyer_snapshot, items, subtotal_brl, total_brl, commission_brl, commission_rate, delivery_fee, status, payment_method, fulfillment_type, delivery_address, scheduled_at, created_at, updated_at')
    .eq('seller_id', sellerId);

  if (buyerType === 'guest') {
    query = query.eq('guest_buyer_id', buyerId);
  } else {
    query = query.eq('buyer_id', buyerId);
  }

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }

  // Count total before pagination
  const { data: allOrders, error: countErr } = await query.order('created_at', { ascending: false });
  if (countErr) {
    logError('listOrdersByBuyer', countErr);
    throw new Error(`Erro ao buscar pedidos: ${countErr.message}`);
  }

  const total = allOrders?.length || 0;
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const lm = Math.min(Math.max(1, parseInt(limit, 10) || 50), 50);
  const offset = (pg - 1) * lm;
  const paged = (allOrders || []).slice(offset, offset + lm);

  return { orders: paged, total, page: pg, limit: lm };
}

module.exports = {
  // Taxonomia
  getCategories,
  // Hyper-local
  getUserLocation,
  // Seller profiles
  createSellerProfile,
  approveSellerProfile,
  getSellerProfile,
  getMySellerProfile,
  getMyBusinesses,
  listSellers,
  updateSellerProfile,
  removeSellerLocation,
  deactivateStore,
  reactivateStore,
  deleteStore,
  backfillSellerCoords,
  // Seller subtypes
  listSellerSubtypes,
  // Produtos
  createProduct,
  getProduct,
  listProducts,
  listProductsNear,
  searchMarketplace,
  listMyProducts,
  updateProduct,
  deactivateProduct,
  toggleProductActive,
  updateProductPropertyStatus,
  // Menu (alimentação)
  createMenuCategory,
  listMenuCategories,
  updateMenuCategory,
  getSellerMenu,
  // Modifiers (alimentação)
  addProductModifier,
  listProductModifiers,
  updateProductModifier,
  removeProductModifier,
  // Pedidos
  createOrder,
  getAvailablePaymentMethods,
  initiateOrderPayment,
  initiateCardPayment,
  renewOrderPix,
  getActiveOrdersForBuyer,
  listOrders,
  getOrder,
  updateOrderStatus,
  cancelOrderBySeller,
  getSellerMonthlyCancellations,
  confirmPaymentOffline,
  createOrderDispute,
  handlePixPaymentConfirmed,
  autoTriggerDelivery: _autoRequestDelivery,
  // Shipping
  autoTriggerShipping: _autoRequestShipping,
  // Metas comunitárias
  createCommunityGoal,
  listCommunityGoals,
  contributeToGoal,
  // Avaliações de loja
  createReview,
  getSellerReviews,
  getOrderReview,
  replyToReview,
  // Financeiro
  getSellerFinancials,
  // Clientes por Pedido
  listOrderClients,
  listOrdersByBuyer,
  // [007] Status flows
  STATUS_FLOWS,
  resolveStatusFlow,
};
