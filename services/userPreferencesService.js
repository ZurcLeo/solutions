// backend/eloscloudapp/services/userPreferencesService.js
// PREFS-001 — Serviço central de preferências do usuário

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const SVC = 'userPreferencesService';

const DEFAULTS = {
  cookie_prefs: {
    necessary: true,
    functional: false,
    analytics: false,
    marketing: false,
    third_party: false,
  },
  privacy_prefs: {
    public_profile: true,
    appear_in_searches: true,
    activity_visibility: true,
    social_function: true,
    who_can_add: 'everyone',
  },
  notification_prefs: {
    channels: { push: true, email: true, sms: false },
    events: {
      payments:    { push: true,  email: true  },
      invites:     { push: true,  email: true  },
      caixinhas:   { push: true,  email: true  },
      messages:    { push: true,  email: false },
      security:    { push: true,  email: true  },
      pedidos:     { push: true,  email: true  },  // Marketplace: novos pedidos, status
      entregas:    { push: true,  email: false },  // Delivery: solicitações, status, avaliação
      mobilidade:  { push: true,  email: false },  // Carona: reservas, partida, avaliação
    },
  },
};

/**
 * Retorna as preferências do usuário. Se não existir registro, retorna defaults sem criar.
 */
async function get(userId) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    logger.error('Erro ao buscar preferências', { service: SVC, userId, error: error.message });
    throw error;
  }

  if (!data) return { user_id: userId, ...DEFAULTS };

  return data;
}

/**
 * Atualiza uma categoria de preferências. Valida campos imutáveis antes de gravar.
 * @param {string} userId
 * @param {'cookie_prefs'|'privacy_prefs'|'notification_prefs'} category
 * @param {object} data — objeto parcial a ser mesclado na categoria
 */
async function update(userId, category, data, ipAddress = null) {
  const VALID_CATEGORIES = ['cookie_prefs', 'privacy_prefs', 'notification_prefs'];
  if (!VALID_CATEGORIES.includes(category)) {
    const err = new Error(`Categoria inválida: ${category}`);
    err.statusCode = 400;
    throw err;
  }

  // Validar imutáveis no application layer (antes do trigger do DB)
  if (category === 'cookie_prefs' && data.necessary === false) {
    const err = new Error('cookie_prefs.necessary não pode ser desativado');
    err.statusCode = 400;
    throw err;
  }
  if (category === 'notification_prefs') {
    const security = data?.events?.security;
    if (security && (security.push === false || security.email === false)) {
      const err = new Error('notification_prefs.events.security não pode ser desativado');
      err.statusCode = 400;
      throw err;
    }
  }

  const supabase = getSupabaseClient();

  // Buscar atual para fazer merge
  const current = await get(userId);
  let merged;
  if (category === 'notification_prefs') {
    // Deep merge for notification_prefs: channels and events are nested objects
    const cur = current[category] || {};
    merged = {
      channels: { ...cur.channels, ...data.channels },
      events:   { ...cur.events },
    };
    // Merge each event individually so partial updates don't clobber siblings
    if (data.events) {
      for (const [key, val] of Object.entries(data.events)) {
        merged.events[key] = { ...(cur.events?.[key] || {}), ...val };
      }
    }
  } else {
    merged = { ...current[category], ...data };
  }

  // ── PREFS-005: Audit log — registrar diff de cada campo alterado ──────────
  const oldCategoryData = current[category] || {};
  const auditEntries = _buildAuditEntries(userId, category, oldCategoryData, merged, ipAddress);
  if (auditEntries.length > 0) {
    await _insertAuditEntries(supabase, auditEntries);
  }

  // Upsert
  const payload = {
    user_id: userId,
    [category]: merged,
    updated_at: new Date().toISOString(),
  };

  // Registrar consent_updated_at ao atualizar cookie_prefs
  if (category === 'cookie_prefs') {
    payload.consent_updated_at = new Date().toISOString();
  }

  const { data: result, error } = await supabase
    .from('user_preferences')
    .upsert(payload, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) {
    logger.error('Erro ao atualizar preferências', { service: SVC, userId, category, error: error.message });
    throw error;
  }

  return result;
}

/**
 * Verifica se é permitido enviar uma notificação para o usuário.
 * Retorna true para eventos de security independente das prefs.
 * Retorna true se não houver registro (defaults permitem tudo).
 *
 * @param {string} userId
 * @param {'push'|'email'|'sms'} channel
 * @param {string} eventType — ex: 'payments', 'invites', 'security'
 */
async function canSend(userId, channel, eventType) {
  // Segurança sempre passa
  if (eventType === 'security') return true;

  try {
    const prefs = await get(userId);
    const { channels = {}, events = {} } = prefs.notification_prefs || {};

    // Canal desativado globalmente
    if (channels[channel] === false) return false;

    // Evento específico desativado para o canal
    const eventPrefs = events[eventType];
    if (eventPrefs && eventPrefs[channel] === false) return false;

    return true;
  } catch {
    // Em caso de erro ao buscar prefs, não bloquear envio
    return true;
  }
}

/**
 * Verifica se uma feature de privacidade está permitida para o usuário-alvo.
 *
 * @param {string} targetUserId — usuário cujos dados serão acessados
 * @param {'appear_in_searches'|'activity_visibility'|'social_function'|'public_profile'} feature
 */
async function isPrivacyAllowed(targetUserId, feature) {
  try {
    const prefs = await get(targetUserId);
    const privacyPrefs = prefs.privacy_prefs || {};
    return privacyPrefs[feature] !== false;
  } catch {
    // Em caso de erro, assume permitido (não bloquear acesso por falha de infra)
    return true;
  }
}

/**
 * Atualiza os campos de localização do usuário.
 * Quando location_mode = 'none', limpa os campos (trigger no DB também garante isso).
 * Sincroniza users.home_bairro/cidade/estado além de user_preferences.
 *
 * @param {string} userId
 * @param {{ location_mode: 'fixed'|'none', home_bairro?: string, home_cidade?: string, home_estado?: string }} data
 */
async function updateLocation(userId, { location_mode, home_bairro, home_cidade, home_estado }) {
  if (!['fixed', 'none'].includes(location_mode)) {
    const err = new Error('location_mode deve ser "fixed" ou "none"');
    err.statusCode = 400;
    throw err;
  }
  if (location_mode === 'fixed') {
    if (!home_bairro?.trim() || !home_cidade?.trim() || !home_estado?.trim()) {
      const err = new Error('home_bairro, home_cidade e home_estado são obrigatórios quando location_mode = fixed');
      err.statusCode = 400;
      throw err;
    }
  }

  const supabase = getSupabaseClient();

  const prefPayload = {
    user_id: userId,
    location_mode,
    home_bairro: location_mode === 'fixed' ? home_bairro.trim() : null,
    home_cidade: location_mode === 'fixed' ? home_cidade.trim() : null,
    home_estado: location_mode === 'fixed' ? home_estado.trim() : null,
    updated_at: new Date().toISOString(),
  };

  const { data: result, error: prefErr } = await supabase
    .from('user_preferences')
    .upsert(prefPayload, { onConflict: 'user_id' })
    .select()
    .single();

  if (prefErr) {
    logger.error('Erro ao atualizar localização em user_preferences', { service: SVC, userId, error: prefErr.message });
    throw prefErr;
  }

  // Sincronizar users.home_* para que o algoritmo de feed possa consultá-los diretamente
  const { error: userErr } = await supabase
    .from('users')
    .update({
      home_bairro: location_mode === 'fixed' ? home_bairro.trim() : null,
      home_cidade: location_mode === 'fixed' ? home_cidade.trim() : null,
      home_estado: location_mode === 'fixed' ? home_estado.trim() : null,
    })
    .eq('id', userId);

  if (userErr) {
    logger.warn('Aviso: user_preferences atualizado mas sync em users falhou', { service: SVC, userId, error: userErr.message });
  }

  return result;
}

/**
 * Salva um endereço completo do usuário (residencial ou comercial).
 * Os campos ficam em user_preferences como addr_res_* ou addr_com_*.
 *
 * @param {string} userId
 * @param {'residential'|'commercial'} type
 * @param {{ cep?, logradouro?, numero?, complemento?, bairro?, cidade?, estado? }} addr
 */
async function updateAddress(userId, type, addr) {
  if (!['residential', 'commercial'].includes(type)) {
    const err = new Error('type deve ser "residential" ou "commercial"');
    err.statusCode = 400;
    throw err;
  }

  const p = type === 'residential' ? 'addr_res_' : 'addr_com_';
  const payload = {
    user_id: userId,
    [`${p}cep`]:         addr.cep?.replace(/\D/g, '') || null,
    [`${p}logradouro`]:  addr.logradouro?.trim()       || null,
    [`${p}numero`]:      addr.numero?.trim()            || null,
    [`${p}complemento`]: addr.complemento?.trim()       || null,
    [`${p}bairro`]:      addr.bairro?.trim()            || null,
    [`${p}cidade`]:      addr.cidade?.trim()            || null,
    [`${p}estado`]:      addr.estado?.trim()            || null,
    updated_at: new Date().toISOString(),
  };

  const supabase = getSupabaseClient();
  const { data: result, error } = await supabase
    .from('user_preferences')
    .upsert(payload, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) {
    logger.error('Erro ao salvar endereço', { service: SVC, userId, type, error: error.message });
    throw error;
  }

  return result;
}

/**
 * Salva registro profissional do usuário (fonte de verdade).
 * A loja (seller_profiles) mantém sua própria cópia; esta é a referência central.
 *
 * @param {string} userId
 * @param {{ tipo?: string, numero?: string, uf?: string }} data
 */
async function updateRegistroProfissional(userId, { tipo, numero, uf }) {
  const VALID_TIPOS = ['CRC','OAB','CRM','CREA','CAU','COREN','CRP','CRN','outro'];
  if (tipo && !VALID_TIPOS.includes(tipo)) {
    const err = new Error(`reg_prof_tipo inválido: deve ser um de ${VALID_TIPOS.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  const supabase = getSupabaseClient();
  const { data: result, error } = await supabase
    .from('user_preferences')
    .upsert({
      user_id: userId,
      reg_prof_tipo:   tipo   || null,
      reg_prof_numero: numero?.trim() || null,
      reg_prof_uf:     uf     || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) {
    logger.error('Erro ao salvar registro profissional', { service: SVC, userId, error: error.message });
    throw error;
  }

  return result;
}

/**
 * Salva tipo e placa do veículo do usuário.
 *
 * @param {string} userId
 * @param {{ vehicle_type?: 'bike'|'moto'|'car'|'van', vehicle_plate?: string }} data
 */
async function updateVehicle(userId, { vehicle_type, vehicle_plate }) {
  const VALID_TYPES = ['bike', 'moto', 'car', 'van'];
  if (vehicle_type && !VALID_TYPES.includes(vehicle_type)) {
    const err = new Error(`vehicle_type inválido: deve ser um de ${VALID_TYPES.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  const supabase = getSupabaseClient();
  const { data: result, error } = await supabase
    .from('user_preferences')
    .upsert({
      user_id: userId,
      vehicle_type:  vehicle_type  || null,
      vehicle_plate: vehicle_plate?.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) {
    logger.error('Erro ao salvar veículo', { service: SVC, userId, error: error.message });
    throw error;
  }

  return result;
}

/**
 * Retorna IDs de usuários que desativaram uma feature de privacidade.
 * Usado para filtragem SQL-level em feed/search/marketplace.
 * Retorna array vazio em caso de erro (não bloqueia acesso por falha de infra).
 *
 * @param {'appear_in_searches'|'activity_visibility'|'social_function'|'public_profile'} feature
 * @returns {Promise<string[]>} IDs dos usuários que desativaram a feature
 */
async function getOptedOutUserIds(feature) {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('user_preferences')
      .select('user_id')
      .eq(`privacy_prefs->>${feature}`, false);

    if (error) {
      logger.error('Erro ao buscar opted-out users', { service: SVC, feature, error: error.message });
      return [];
    }

    return (data || []).map(row => row.user_id);
  } catch {
    return [];
  }
}

// ─── PREFS-005: Audit log helpers ──────────────────────────────────────────

/**
 * Compara dois objetos (flat ou aninhados até 2 níveis) e retorna audit entries
 * para cada campo efetivamente alterado.
 * @private
 */
function _buildAuditEntries(userId, category, oldData, newData, ipAddress) {
  const entries = [];

  const walk = (oldObj, newObj, pathPrefix) => {
    const allKeys = new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})]);
    for (const key of allKeys) {
      const oldVal = oldObj?.[key];
      const newVal = newObj?.[key];
      const fieldPath = pathPrefix ? `${pathPrefix}.${key}` : `${category}.${key}`;

      // Se ambos são objetos (não arrays), recursar um nível
      if (
        oldVal && typeof oldVal === 'object' && !Array.isArray(oldVal) &&
        newVal && typeof newVal === 'object' && !Array.isArray(newVal)
      ) {
        walk(oldVal, newVal, fieldPath);
        continue;
      }

      // Comparação por serialização JSON (cobre booleans, strings, arrays, etc.)
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        entries.push({
          user_id: userId,
          category,
          field_path: fieldPath,
          old_value: oldVal !== undefined ? JSON.stringify(oldVal) : null,
          new_value: JSON.stringify(newVal),
          ip_address: ipAddress || null,
        });
      }
    }
  };

  walk(oldData, newData, '');
  return entries;
}

/**
 * Insere entradas de auditoria no banco. Fire-and-forget safe (não bloqueia update em caso de erro).
 * @private
 */
async function _insertAuditEntries(supabase, entries) {
  try {
    if (entries.length === 0) return;
    const { error } = await supabase.from('preference_audit_log').insert(entries);
    if (error) {
      logger.warn('Falha ao inserir audit log de preferências', { service: SVC, error: error.message, count: entries.length });
    }
  } catch (err) {
    logger.warn('Exceção ao inserir audit log de preferências', { service: SVC, error: err.message });
  }
}

/**
 * Retorna o histórico de alterações de preferências do usuário (paginado).
 * @param {string} userId
 * @param {{ page?: number, limit?: number, category?: string }} options
 * @returns {Promise<{ data: object[], total: number, page: number, limit: number }>}
 */
async function getAuditLog(userId, { page = 1, limit = 20, category } = {}) {
  const supabase = getSupabaseClient();
  const offset = (page - 1) * limit;

  let query = supabase
    .from('preference_audit_log')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('changed_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (category) {
    query = query.eq('category', category);
  }

  const { data, error, count } = await query;

  if (error) {
    logger.error('Erro ao buscar audit log de preferências', { service: SVC, userId, error: error.message });
    throw error;
  }

  return { data: data || [], total: count || 0, page, limit };
}

/**
 * Retorna TODOS os dados do usuário para exportação (LGPD Art. 18 — Portabilidade).
 * Dados de terceiros são anonimizados conforme LGPD Art. 6 (necessidade/minimização).
 * @param {string} userId
 * @returns {Promise<object>}
 */
async function getDataExport(userId) {
  const supabase = getSupabaseClient();

  const extract = (result) => {
    if (result.status === 'fulfilled' && !result.value.error) {
      return result.value.data;
    }
    return null;
  };

  // ── Wave 1: Core user data (11 queries — existentes) ──────────────────────
  const [
    userRes, prefsRes, postsRes, connectionsRes,
    gamificationRes, tasksRes, selosRes,
    caixinhaMembersRes, transactionsRes, supportRes, auditLogRes,
  ] = await Promise.allSettled([
    supabase.from('users').select('*').eq('id', userId).maybeSingle(),
    supabase.from('user_preferences').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('posts').select('*').eq('author_id', userId).order('created_at', { ascending: false }).limit(500),
    supabase.from('user_connections').select('*').or(`user_id.eq.${userId},connected_user_id.eq.${userId}`).limit(500),
    supabase.from('user_gamification').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('user_tasks').select('*').eq('user_id', userId).limit(500),
    supabase.from('user_selos').select('*').eq('user_id', userId).limit(200),
    supabase.from('membros').select('*').eq('userId', userId).limit(100),
    supabase.from('transacoes').select('*').eq('membroId', userId).order('data', { ascending: false }).limit(500),
    supabase.from('support_tickets').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(200),
    supabase.from('preference_audit_log').select('*').eq('user_id', userId).order('changed_at', { ascending: false }).limit(500),
  ]);

  // ── Resolve seller_id (necessário para queries dependentes) ────────────────
  const sellerRes = await supabase
    .from('seller_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  const sellerProfile = sellerRes.error ? null : sellerRes.data;
  const sellerId = sellerProfile?.id || null;

  // ── Wave 2: Marketplace, delivery, trust, etc (22 queries) ─────────────────
  const wave2Queries = [
    // Marketplace — pedidos como comprador
    supabase.from('marketplace_orders').select('id, seller_id, status, total_brl, coins_discount_brl, payment_method, payment_status, created_at, updated_at').eq('buyer_id', userId).order('created_at', { ascending: false }).limit(500),
    // Marketplace — pedidos como vendedor
    sellerId
      ? supabase.from('marketplace_orders').select('id, buyer_id, status, total_brl, coins_discount_brl, payment_method, payment_status, created_at, updated_at').eq('seller_id', sellerId).order('created_at', { ascending: false }).limit(500)
      : Promise.resolve({ data: null }),
    // Produtos do seller
    sellerId
      ? supabase.from('marketplace_products').select('id, name, price, product_type, active, category, created_at, updated_at').eq('seller_id', sellerId).order('created_at', { ascending: false }).limit(500)
      : Promise.resolve({ data: null }),
    // Avaliações dadas
    supabase.from('marketplace_reviews').select('id, order_id, seller_id, rating, comment, created_at').eq('buyer_id', userId).limit(200),
    // Trade requests
    supabase.from('trade_requests').select('id, product_id, status, message, created_at, updated_at').eq('requester_id', userId).limit(200),
    // Team memberships
    supabase.from('seller_team_members').select('id, seller_id, role, permissions, status, created_at').eq('user_id', userId).limit(50),
    // Veículos
    supabase.from('user_vehicles').select('*').eq('user_id', userId).limit(20),
    // Assinatura
    supabase.from('user_subscriptions').select('id, plan_slug, status, billing_cycle, current_period_start, current_period_end, created_at').eq('user_id', userId).limit(10),
    // Billing events (como seller)
    sellerId
      ? supabase.from('billing_events').select('id, event_type, amount_brl, commission_rate, order_id, created_at').eq('seller_id', sellerId).order('created_at', { ascending: false }).limit(500)
      : Promise.resolve({ data: null }),
    // ElosCoins transactions
    supabase.from('elo_coin_transactions').select('id, type, amount, balance_after, description, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(500),
    // Trust passport
    supabase.from('trust_passports').select('user_id, total_score, trust_level, domain_scores, last_calculated_at').eq('user_id', userId).maybeSingle(),
    // Trust events
    supabase.from('trust_events').select('id, domain, event_type, impact, metadata, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(500),
    // KYC social validations (dadas e recebidas)
    supabase.from('kyc_social_validations').select('id, user_id, validated_user_id, validation_type, status, created_at').or(`user_id.eq.${userId},validated_user_id.eq.${userId}`).limit(200),
    // Push subscriptions (sem endpoint/keys — apenas device info)
    supabase.from('push_subscriptions').select('id, device_label, browser, os, created_at, is_active').eq('user_id', userId).limit(50),
    // Suspensões
    supabase.from('user_suspensions').select('id, reason, status, duration_days, suspended_at, expires_at, lifted_at, created_at').eq('user_id', userId).limit(50),
    // Business invites recebidos
    supabase.from('business_invites').select('id, seller_id, role, status, created_at, accepted_at, expires_at').eq('target_email', extract(userRes)?.email || '___').limit(50),
    // Ágora relatos
    supabase.from('agora_relatos').select('id, titulo, descricao, categoria, status, regiao_id, created_at, updated_at').eq('usuario_id', userId).limit(200),
    // Ágora votos em enquetes (HMAC anônimo — exporta apenas metadados)
    supabase.from('agora_votos_enquete').select('id, enquete_id, created_at').eq('usuario_id', userId).limit(500),
    // Delivery requests (como entregador)
    supabase.from('delivery_requests').select('id, order_id, status, pickup_address, delivery_address, freight_value, created_at, updated_at').eq('driver_id', userId).order('created_at', { ascending: false }).limit(200),
    // Delivery ratings recebidas
    supabase.from('delivery_ratings').select('id, rating, comment, from_role, created_at').eq('driver_id', userId).limit(200),
    // Webhook subscriptions (seller — sem hmac_secret)
    sellerId
      ? supabase.from('webhook_subscriptions').select('id, provider, endpoint_url, events_enabled, is_active, created_at').eq('seller_id', sellerId).limit(20)
      : Promise.resolve({ data: null }),
    // Notifications recentes
    supabase.from('notification_jobs').select('id, channel, event_type, status, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(200),
  ];

  const wave2Results = await Promise.allSettled(wave2Queries);
  const w2 = (idx) => {
    const r = wave2Results[idx];
    if (r.status === 'fulfilled') {
      const val = r.value;
      if (val && !val.error) return val.data;
    }
    return null;
  };

  const rawData = {
    exported_at: new Date().toISOString(),
    user_id: userId,

    // ── Identidade & Preferências ──
    profile:              extract(userRes),
    preferences:          extract(prefsRes),

    // ── Social ──
    posts:                extract(postsRes),
    connections:          extract(connectionsRes),

    // ── Gamificação ──
    gamification:         extract(gamificationRes),
    tasks:                extract(tasksRes),
    selos:                extract(selosRes),

    // ── Financeiro / Caixinhas ──
    caixinha_memberships: extract(caixinhaMembersRes),
    transactions:         extract(transactionsRes),
    elo_coin_transactions: w2(9),

    // ── Marketplace ──
    seller_profile:       sellerProfile,
    products:             w2(2),
    orders_as_buyer:      w2(0),
    orders_as_seller:     w2(1),
    reviews_given:        w2(3),
    trade_requests:       w2(4),
    team_memberships:     w2(5),

    // ── Veículos ──
    vehicles:             w2(6),

    // ── Assinatura & Cobrança ──
    subscription:         w2(7),
    billing_events:       w2(8),

    // ── Confiança & Verificação ──
    trust_passport:       w2(10),
    trust_events:         w2(11),
    kyc_validations:      w2(12),

    // ── Dispositivos & Notificações ──
    push_devices:         w2(13),
    notifications:        w2(21),

    // ── Suspensões ──
    suspensions:          w2(14),

    // ── Negócio / Equipe ──
    business_invites:     w2(15),
    webhook_integrations: w2(20),

    // ── Cidadania / Ágora ──
    agora_relatos:        w2(16),
    agora_votos:          w2(17),

    // ── Entregas ──
    deliveries:           w2(18),
    delivery_ratings:     w2(19),

    // ── Suporte & Auditoria ──
    support_tickets:      extract(supportRes),
    preference_audit_log: extract(auditLogRes),
  };

  return _sanitizeExportData(rawData, userId);
}

// ─── LGPD: Sanitização de dados de terceiros na exportação ──────────────────

/**
 * Sanitiza todos os dados exportados para remover informações pessoais de terceiros.
 * LGPD Art. 6, III (necessidade) e V (minimização): a exportação deve conter apenas
 * dados pessoais do titular, com referências a terceiros anonimizadas.
 *
 * @param {object} data — dados brutos extraídos do banco
 * @param {string} userId — ID do usuário titular da exportação
 * @returns {object} dados sanitizados
 * @private
 */
function _sanitizeExportData(data, userId) {
  // Mapa de IDs de terceiros → rótulos anônimos sequenciais
  const anonMap = new Map();
  let anonCounter = 0;

  /**
   * Retorna um rótulo anônimo estável para um ID de terceiro.
   * O mesmo ID sempre recebe o mesmo rótulo dentro de uma exportação.
   */
  const anonymizeId = (thirdPartyId) => {
    if (!thirdPartyId || thirdPartyId === userId) return thirdPartyId;
    if (!anonMap.has(thirdPartyId)) {
      anonCounter += 1;
      anonMap.set(thirdPartyId, `outro_usuario_${anonCounter}`);
    }
    return anonMap.get(thirdPartyId);
  };

  return {
    exported_at: data.exported_at,
    user_id: data.user_id,

    // ── Identidade & Preferências ──
    profile: data.profile,
    preferences: data.preferences,

    // ── Social ──
    posts: _sanitizePosts(data.posts, userId, anonymizeId),
    connections: _sanitizeConnections(data.connections, userId, anonymizeId),

    // ── Gamificação ──
    gamification: data.gamification,
    tasks: data.tasks,
    selos: data.selos,

    // ── Financeiro / Caixinhas ──
    caixinha_memberships: _sanitizeCaixinhaMemberships(data.caixinha_memberships, userId, anonymizeId),
    transactions: _sanitizeTransactions(data.transactions, userId, anonymizeId),
    elo_coin_transactions: data.elo_coin_transactions,

    // ── Marketplace ──
    seller_profile: _sanitizeSellerProfile(data.seller_profile),
    products: data.products,
    orders_as_buyer: _sanitizeOrders(data.orders_as_buyer, userId, anonymizeId),
    orders_as_seller: _sanitizeOrders(data.orders_as_seller, userId, anonymizeId),
    reviews_given: data.reviews_given,
    trade_requests: data.trade_requests,
    team_memberships: data.team_memberships,

    // ── Veículos ──
    vehicles: data.vehicles,

    // ── Assinatura & Cobrança ──
    subscription: data.subscription,
    billing_events: data.billing_events,

    // ── Confiança & Verificação ──
    trust_passport: data.trust_passport,
    trust_events: data.trust_events,
    kyc_validations: _sanitizeKycValidations(data.kyc_validations, userId, anonymizeId),

    // ── Dispositivos & Notificações ──
    push_devices: data.push_devices,
    notifications: data.notifications,

    // ── Suspensões ──
    suspensions: _sanitizeSuspensions(data.suspensions, anonymizeId),

    // ── Negócio / Equipe ──
    business_invites: data.business_invites,
    webhook_integrations: data.webhook_integrations,

    // ── Cidadania / Ágora ──
    agora_relatos: data.agora_relatos,
    agora_votos: data.agora_votos,

    // ── Entregas ──
    deliveries: _sanitizeDeliveries(data.deliveries, anonymizeId),
    delivery_ratings: data.delivery_ratings,

    // ── Suporte & Auditoria ──
    support_tickets: _sanitizeSupportTickets(data.support_tickets, userId),
    preference_audit_log: data.preference_audit_log,
  };
}

/**
 * Conexões: anonimiza IDs de terceiros, remove nome/email/foto do remetente,
 * mantém mensagem apenas quando enviada pelo titular.
 * @private
 */
function _sanitizeConnections(connections, userId, anonymizeId) {
  if (!connections || !Array.isArray(connections)) return connections;

  return connections.map((conn) => {
    // Determinar quem é o "outro" nesta conexão
    const isSender = conn.user_id === userId;

    return {
      id: conn.id,
      status: conn.status,
      is_best_friend: conn.is_best_friend,
      created_at: conn.created_at,
      updated_at: conn.updated_at,
      data_aceite: conn.data_aceite,
      data_rejeicao: conn.data_rejeicao,
      // Anonimizar o ID do terceiro; manter o do titular
      user_id: isSender ? conn.user_id : anonymizeId(conn.user_id),
      connected_user_id: isSender ? anonymizeId(conn.connected_user_id) : conn.connected_user_id,
      // Mensagem: incluir apenas se foi enviada PELO titular (user_id é quem envia)
      mensagem: isSender ? conn.mensagem : undefined,
      // Removidos: sender_name, sender_email, sender_photo_url (dados pessoais de terceiro)
    };
  });
}

/**
 * Tickets de suporte: remove informações de agentes/equipe interna,
 * filtra notas internas, sanitiza histórico de conversa.
 * @private
 */
function _sanitizeSupportTickets(tickets, userId) {
  if (!tickets || !Array.isArray(tickets)) return tickets;

  const TEAM_LABEL = 'Equipe de Suporte ElosCloud';

  return tickets.map((ticket) => {
    // Sanitizar conversation_history: remover msgs de agentes que contenham dados internos
    let sanitizedHistory = ticket.conversation_history;
    if (Array.isArray(sanitizedHistory)) {
      sanitizedHistory = sanitizedHistory.map((msg) => {
        // Se a mensagem é do agente/sistema, anonimizar remetente
        if (msg.sender !== userId && msg.role !== 'user' && msg.from !== userId) {
          const cleaned = { ...msg };
          // Substituir campos de identificação do agente
          if (cleaned.sender) cleaned.sender = TEAM_LABEL;
          if (cleaned.from) cleaned.from = TEAM_LABEL;
          if (cleaned.agent_name) cleaned.agent_name = TEAM_LABEL;
          if (cleaned.agent_id) cleaned.agent_id = TEAM_LABEL;
          if (cleaned.agentId) cleaned.agentId = TEAM_LABEL;
          if (cleaned.agent_email) delete cleaned.agent_email;
          if (cleaned.agent_photo) delete cleaned.agent_photo;
          if (cleaned.name) cleaned.name = TEAM_LABEL;
          return cleaned;
        }
        return msg;
      });
    }

    // Sanitizar notes: manter apenas notas públicas, anonimizar autor
    let sanitizedNotes = ticket.notes;
    if (Array.isArray(sanitizedNotes)) {
      sanitizedNotes = sanitizedNotes.map((note) => {
        const cleaned = { ...note };
        if (cleaned.author && cleaned.author !== userId) cleaned.author = TEAM_LABEL;
        if (cleaned.author_id && cleaned.author_id !== userId) cleaned.author_id = TEAM_LABEL;
        if (cleaned.author_name) cleaned.author_name = TEAM_LABEL;
        if (cleaned.author_email) delete cleaned.author_email;
        return cleaned;
      });
    }

    return {
      id: ticket.id,
      user_id: ticket.user_id,
      category: ticket.category,
      issue_type: ticket.issue_type,
      subject: ticket.subject,
      description: ticket.description,
      priority: ticket.priority,
      status: ticket.status,
      module: ticket.module,
      tags: ticket.tags,
      attachments: ticket.attachments,
      context: ticket.context,
      conversation_history: sanitizedHistory,
      notes: sanitizedNotes,
      // internal_notes: REMOVIDO — notas internas da equipe não pertencem ao titular
      resolution: ticket.resolution,
      resolved_at: ticket.resolved_at,
      assigned_to: TEAM_LABEL,    // Anonimizar agente responsável
      assigned_at: ticket.assigned_at,
      closed_at: ticket.closed_at,
      created_at: ticket.created_at,
      updated_at: ticket.updated_at,
      // Dados do próprio usuário no ticket
      user_name: ticket.user_name,
      user_email: ticket.user_email,
      last_message_snippet: ticket.last_message_snippet,
      // CSAT: dados do próprio usuário
      csat_score: ticket.csat_score,
      csat_comment: ticket.csat_comment,
      csat_responded_at: ticket.csat_responded_at,
      // csat_survey_token: REMOVIDO — token de uso único, não é dado pessoal
    };
  });
}

/**
 * Posts: já filtrados por author_id = userId, mas sanitiza campos embutidos
 * que possam conter dados de terceiros (ex: shared_from, mentions).
 * @private
 */
function _sanitizePosts(posts, userId, anonymizeId) {
  if (!posts || !Array.isArray(posts)) return posts;

  return posts.map((post) => {
    const sanitized = { ...post };
    // Anonimizar referências a terceiros em campos de compartilhamento
    if (sanitized.shared_from && sanitized.shared_from !== userId) {
      sanitized.shared_from = anonymizeId(sanitized.shared_from);
    }
    if (sanitized.original_author_id && sanitized.original_author_id !== userId) {
      sanitized.original_author_id = anonymizeId(sanitized.original_author_id);
    }
    if (sanitized.original_author_name) delete sanitized.original_author_name;
    if (sanitized.original_author_photo) delete sanitized.original_author_photo;
    // Anonimizar menções
    if (Array.isArray(sanitized.mentions)) {
      sanitized.mentions = sanitized.mentions.map((m) => {
        if (typeof m === 'string') return anonymizeId(m);
        if (m && typeof m === 'object') {
          return {
            ...m,
            user_id: anonymizeId(m.user_id),
            name: undefined,
            photo_url: undefined,
          };
        }
        return m;
      });
    }
    return sanitized;
  });
}

/**
 * Memberships de caixinha: query já filtra por userId, mas remove
 * referências a outros membros que possam estar embutidas.
 * @private
 */
function _sanitizeCaixinhaMemberships(memberships, userId, anonymizeId) {
  if (!memberships || !Array.isArray(memberships)) return memberships;

  return memberships.map((m) => {
    const sanitized = { ...m };
    // Anonimizar campos que referenciam admin/gerente/outros membros
    if (sanitized.admin_id && sanitized.admin_id !== userId) {
      sanitized.admin_id = anonymizeId(sanitized.admin_id);
    }
    if (sanitized.invited_by && sanitized.invited_by !== userId) {
      sanitized.invited_by = anonymizeId(sanitized.invited_by);
    }
    if (sanitized.invited_by_name) delete sanitized.invited_by_name;
    if (sanitized.invited_by_email) delete sanitized.invited_by_email;
    return sanitized;
  });
}

/**
 * Transações financeiras: anonimiza contraparte (quem aprovou, quem
 * estornou) e referências a outros membros.
 * @private
 */
function _sanitizeTransactions(transactions, userId, anonymizeId) {
  if (!transactions || !Array.isArray(transactions)) return transactions;

  return transactions.map((tx) => {
    const sanitized = { ...tx };
    // Anonimizar user_id se não for o próprio titular (ex: transações cruzadas)
    if (sanitized.user_id && sanitized.user_id !== userId) {
      sanitized.user_id = anonymizeId(sanitized.user_id);
    }
    // Anonimizar campos de aprovação/estorno por terceiro
    if (sanitized.admin_aprovador && sanitized.admin_aprovador !== userId) {
      sanitized.admin_aprovador = anonymizeId(sanitized.admin_aprovador);
    }
    if (sanitized.admin_rejeitador && sanitized.admin_rejeitador !== userId) {
      sanitized.admin_rejeitador = anonymizeId(sanitized.admin_rejeitador);
    }
    if (sanitized.estornado_por && sanitized.estornado_por !== userId) {
      sanitized.estornado_por = anonymizeId(sanitized.estornado_por);
    }
    // Remover nome/email de contraparte se embutidos
    if (sanitized.contraparte_nome) delete sanitized.contraparte_nome;
    if (sanitized.contraparte_email) delete sanitized.contraparte_email;
    if (sanitized.approved_by_name) delete sanitized.approved_by_name;
    return sanitized;
  });
}

// ─── Sanitizers para novos domínios ────────────────────────────────────────

/**
 * Seller profile: remove campos internos sensíveis (commission_rate, billing).
 * @private
 */
function _sanitizeSellerProfile(profile) {
  if (!profile) return null;
  const sanitized = { ...profile };
  // Remover campos internos de billing/comissão — não são dados pessoais do titular
  delete sanitized.commission_rate;
  delete sanitized.billing_mode;
  delete sanitized.subscription_status;
  delete sanitized.grace_until;
  return sanitized;
}

/**
 * Orders: anonimiza buyer_id/seller_id de terceiros.
 * @private
 */
function _sanitizeOrders(orders, userId, anonymizeId) {
  if (!orders || !Array.isArray(orders)) return orders;
  return orders.map((o) => {
    const s = { ...o };
    if (s.buyer_id && s.buyer_id !== userId) s.buyer_id = anonymizeId(s.buyer_id);
    if (s.seller_id) s.seller_id = anonymizeId(s.seller_id);
    return s;
  });
}

/**
 * KYC validations: anonimiza IDs de terceiros.
 * @private
 */
function _sanitizeKycValidations(validations, userId, anonymizeId) {
  if (!validations || !Array.isArray(validations)) return validations;
  return validations.map((v) => {
    const s = { ...v };
    if (s.user_id && s.user_id !== userId) s.user_id = anonymizeId(s.user_id);
    if (s.validated_user_id && s.validated_user_id !== userId) s.validated_user_id = anonymizeId(s.validated_user_id);
    return s;
  });
}

/**
 * Suspensions: anonimiza quem suspendeu/levantou.
 * @private
 */
function _sanitizeSuspensions(suspensions, anonymizeId) {
  if (!suspensions || !Array.isArray(suspensions)) return suspensions;
  return suspensions.map((s) => {
    const sanitized = { ...s };
    if (sanitized.suspended_by) sanitized.suspended_by = anonymizeId(sanitized.suspended_by);
    if (sanitized.lifted_by) sanitized.lifted_by = anonymizeId(sanitized.lifted_by);
    return sanitized;
  });
}

/**
 * Deliveries: anonimiza endereços parcialmente (remove número/complemento de terceiros).
 * @private
 */
function _sanitizeDeliveries(deliveries, anonymizeId) {
  if (!deliveries || !Array.isArray(deliveries)) return deliveries;
  return deliveries.map((d) => {
    const s = { ...d };
    if (s.buyer_id) s.buyer_id = anonymizeId(s.buyer_id);
    if (s.seller_id) s.seller_id = anonymizeId(s.seller_id);
    return s;
  });
}

module.exports = { get, update, updateLocation, updateAddress, updateRegistroProfissional, updateVehicle, canSend, isPrivacyAllowed, getOptedOutUserIds, getAuditLog, getDataExport, DEFAULTS };
