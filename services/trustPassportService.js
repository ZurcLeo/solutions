/**
 * @fileoverview TrustPassportService — ElosCloud
 *
 * Score unificado cross-vertical de reputação.
 * Agrega dados de 10 domínios (account, social, financial, stays,
 * delivery, marketplace, moderation, civic, mobility, external) em um score 0-100 com 5 níveis.
 *
 * Decisões de produto:
 *   D1 — Score numérico interno; público: nível + validadores
 *   D2 — Decaimento por inatividade, não por conduta ruim
 *   D3 — Endosso Snapshot + revisão administrativa
 *
 * Tabelas: trust_levels, trust_events, trust_passports
 * Migration: 20260617000006_trust_passport_schema.sql
 */

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const SERVICE = 'trustPassportService';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

function log(fn, msg, extra = {}) {
  logger.info(msg, { service: SERVICE, function: fn, ...extra });
}

function logError(fn, err, extra = {}) {
  logger.error(`Erro em ${fn}: ${err.message}`, {
    service: SERVICE, function: fn, error: err.message, ...extra,
  });
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const DOMAINS = [
  'account', 'social', 'financial', 'stays',
  'delivery', 'marketplace', 'moderation', 'civic',
  'mobility', 'external',
];

/** Peso máximo por domínio (soma = 100) */
const DOMAIN_WEIGHTS = {
  account:       8,
  social:        13,
  financial:     17,
  stays:         10,
  delivery:      8,
  marketplace:   11,
  moderation:    9,
  civic:         8,
  mobility:      8,
  external:      6,
};
// activity_consistency contribui para 'account' (10 total)

/** Fallback level names (in case join fails) */
const LEVEL_NAMES = { 1: 'Novato', 2: 'Conhecido', 3: 'Vizinho de Confiança', 4: 'Pilar da Comunidade', 5: 'Guardião' };

/** Freshness: decai linearmente de 1.0 (< 30d) a 0.3 (≥ 180d inativo) */
function activityFreshness(lastPositiveDate) {
  if (!lastPositiveDate) return 0.3;
  const daysSince = (Date.now() - new Date(lastPositiveDate).getTime()) / 86400000;
  if (daysSince <= 30) return 1.0;
  if (daysSince >= 180) return 0.3;
  return 1.0 - ((daysSince - 30) / 150) * 0.7;
}

/** Multiplicador de endosso por nível do endossante */
const ENDORSEMENT_WEIGHT = { 3: 1.0, 4: 1.5, 5: 2.0 };

/** Limite mensal de endossos por nível */
const ENDORSEMENT_LIMITS = { 3: 1, 4: 3, 5: 5 };

/** Eventos de alto impacto que disparam recálculo imediato */
const HIGH_IMPACT_EVENTS = new Set([
  'dispute_lost',             // -5 permanente
  'identity_verified',        // +5 account
  'kyc_validation_received',  // +3 social
  'ride_cancelled_driver',    // -3 mobility (cancelamento < 2h da partida)
  'ride_no_show_passenger',   // -3 mobility (passageiro não embarcou)
  'external_place_verified',  // +1~5 external (Google Places)
]);

// ──────────────────────────────────────────────
// Validator definitions
// ──────────────────────────────────────────────

/**
 * Each validator: { key, label, domain, check(events, passport) → boolean }
 * check receives all trust_events for the user + supplementary data.
 */
const VALIDATOR_DEFS = [
  {
    key: 'estadias_5star',
    label: 'Estadias 5★',
    domain: 'stays',
    check: (ctx) => ctx.domainAvg.stays >= 4.5 && ctx.domainCount.stays >= 2,
  },
  {
    key: 'entregas_no_prazo',
    label: 'Entregas no prazo',
    domain: 'delivery',
    check: (ctx) => ctx.domainAvg.delivery >= 4.0 && ctx.domainCount.delivery >= 3,
  },
  {
    key: 'caixinhas_em_dia',
    label: 'Caixinhas em dia',
    domain: 'financial',
    check: (ctx) => {
      const neg = ctx.events.filter(e => e.domain === 'financial' && e.is_negative);
      return ctx.domainCount.financial >= 3 && neg.length === 0;
    },
  },
  {
    key: 'avalizado_vizinhos',
    label: 'Avalizado por vizinhos',
    domain: 'social',
    check: (ctx) => ctx.endorsementCount >= 3,
  },
  {
    key: 'meses_ativo',
    label: '6+ meses ativo',
    domain: 'account',
    check: (ctx) => ctx.accountAgeDays >= 180,
  },
  {
    key: 'marketplace_confiavel',
    label: 'Vendedor/comprador confiável',
    domain: 'marketplace',
    check: (ctx) => {
      // Requires ≥5 distinct counterparties with witnessed+vested trust events
      const mktEvents = ctx.events.filter(
        e => e.domain === 'marketplace'
          && !e.is_negative
          && e.source === 'witnessed'
          && e.vesting_status === 'vested'
          && e.counterparty_id
      );
      const distinctCounterparties = new Set(mktEvents.map(e => e.counterparty_id));
      return distinctCounterparties.size >= 5;
    },
  },
  {
    key: 'sem_suspensoes',
    label: 'Sem suspensões',
    domain: 'moderation',
    check: (ctx) => {
      const neg = ctx.events.filter(e => e.domain === 'moderation' && e.is_negative);
      return neg.length === 0;
    },
  },
  {
    key: 'financeiro_em_dia',
    label: 'Financeiro em dia',
    domain: 'financial',
    check: (ctx) => {
      const recentNeg = ctx.events.filter(
        e => e.domain === 'financial' && e.is_negative
          && (Date.now() - new Date(e.created_at).getTime()) < 180 * 86400000
      );
      return ctx.domainCount.financial >= 5 && recentNeg.length === 0;
    },
  },
  {
    key: 'cidadao_ativo',
    label: 'Cidadão Ativo',
    domain: 'civic',
    check: (ctx) => ctx.domainAvg.civic >= 3.0 && ctx.domainCount.civic >= 3,
  },
  {
    key: 'motorista_solidario',
    label: 'Motorista Solidário',
    domain: 'mobility',
    check: (ctx) => ctx.domainAvg.mobility >= 4.0 && ctx.domainCount.mobility >= 3,
  },
  {
    key: 'negocio_verificado_externamente',
    label: 'Negócio Verificado Externamente',
    domain: 'external',
    check: (ctx) => ctx.domainAvg.external >= 3.5 && ctx.domainCount.external >= 1,
  },
];

/** Validators required per level (level 4+ needs financeiro_em_dia) */
const REQUIRED_VALIDATORS = {
  4: ['financeiro_em_dia'],
  5: ['financeiro_em_dia', 'sem_suspensoes', 'avalizado_vizinhos'],
};

// ──────────────────────────────────────────────
// 1. Record trust event
// ──────────────────────────────────────────────

async function recordEvent(userId, domain, eventType, impact, isNegative = false, metadata = {}) {
  const fn = 'recordEvent';
  log(fn, `Trust event: ${eventType}`, { userId, domain, impact, isNegative });

  if (!DOMAINS.includes(domain)) {
    throw new Error(`Domínio inválido: ${domain}. Válidos: ${DOMAINS.join(', ')}`);
  }
  if ((isNegative && impact > 0) || (!isNegative && impact < 0)) {
    throw new Error('Sinal do impact não bate com is_negative');
  }

  const { error } = await sb()
    .from('trust_events')
    .insert({
      user_id: userId,
      domain,
      event_type: eventType,
      impact,
      is_negative: isNegative,
      metadata,
    });

  if (error) {
    logError(fn, error, { userId, eventType });
    throw error;
  }

  // On-demand recalculation for high-impact events (fire-and-forget)
  if (HIGH_IMPACT_EVENTS.has(eventType) || Math.abs(impact) >= 5) {
    calculatePassport(userId).catch(err =>
      logError(fn, err, { userId, eventType, note: 'recalc on-demand falhou' })
    );
  }
}

// ──────────────────────────────────────────────
// 2. Calculate passport
// ──────────────────────────────────────────────

/** System accounts whose passports are manually managed (skip auto-recalc) */
const SYSTEM_ACCOUNTS = new Set([
  'sS855lp9DwhZodxMqG7bf5cYeQ92', // Claude Suporte
]);

async function calculatePassport(userId) {
  const fn = 'calculatePassport';

  // System accounts have manually managed passports — never overwrite
  if (SYSTEM_ACCOUNTS.has(userId)) {
    log(fn, 'Conta de sistema — pulando recálculo', { userId });
    const { data } = await sb()
      .from('trust_passports')
      .select('*, trust_levels(name)')
      .eq('user_id', userId)
      .single();
    if (data) {
      data.level_name = data.trust_levels?.name || LEVEL_NAMES[data.trust_level] || 'Guardião';
      delete data.trust_levels;
      return data;
    }
  }

  log(fn, 'Calculando passaporte', { userId });

  // Fetch all events
  const { data: events, error: evErr } = await sb()
    .from('trust_events')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (evErr) { logError(fn, evErr, { userId }); throw evErr; }

  // Fetch user creation date for account_age
  const { data: user, error: uErr } = await sb()
    .from('users')
    .select('id, created_at')
    .eq('id', userId)
    .single();

  if (uErr) { logError(fn, uErr, { userId }); throw uErr; }

  // Fetch active endorsements
  const { data: endorsements, error: eErr } = await sb()
    .from('kyc_social_validations')
    .select('endorser_level_at_time')
    .eq('validated_user_id', userId)
    .eq('endorsement_status', 'active');

  if (eErr) { logError(fn, eErr, { userId }); }

  // Fetch trust_levels
  const { data: levels, error: lErr } = await sb()
    .from('trust_levels')
    .select('*')
    .order('level', { ascending: true });

  if (lErr) { logError(fn, lErr); throw lErr; }

  // ── Domain score calculation ──
  const domainScores = {};
  const activeDomains = [];
  const domainAvg = {};
  const domainCount = {};

  for (const domain of DOMAINS) {
    const domainEvents = events.filter(e => e.domain === domain);

    if (domainEvents.length === 0) {
      domainScores[domain] = 0;
      domainAvg[domain] = 0;
      domainCount[domain] = 0;
      continue;
    }

    activeDomains.push(domain);
    domainCount[domain] = domainEvents.length;

    // Last positive event date for freshness
    const lastPositive = domainEvents.find(e => !e.is_negative);
    const freshness = activityFreshness(lastPositive?.created_at);

    // Sum: positives × freshness, negatives × 1.0 (permanent)
    let sum = 0;
    let positiveSum = 0;
    let positiveCount = 0;

    for (const e of domainEvents) {
      if (e.is_negative) {
        sum += Number(e.impact); // negative, permanent weight
      } else {
        sum += Number(e.impact) * freshness;
        positiveSum += Number(e.impact);
        positiveCount++;
      }
    }

    domainAvg[domain] = positiveCount > 0 ? positiveSum / positiveCount : 0;

    const domainRaw = Math.max(0, sum);
    domainScores[domain] = Math.min(DOMAIN_WEIGHTS[domain], domainRaw);
  }

  // Social endorsements bonus
  const endorsementCount = (endorsements || []).length;
  if (endorsementCount > 0) {
    let endorsementBonus = 0;
    for (const end of endorsements) {
      const mult = ENDORSEMENT_WEIGHT[end.endorser_level_at_time] || 1.0;
      endorsementBonus += 1.5 * mult; // each endorsement adds 1.5 × multiplier
    }
    domainScores.social = Math.min(
      DOMAIN_WEIGHTS.social,
      (domainScores.social || 0) + endorsementBonus
    );
    if (!activeDomains.includes('social')) activeDomains.push('social');
  }

  // Account age bonus (auto-calculated, no events needed)
  const accountAgeDays = (Date.now() - new Date(user.created_at).getTime()) / 86400000;
  const ageBonus = Math.min(DOMAIN_WEIGHTS.account, accountAgeDays / 365 * DOMAIN_WEIGHTS.account);
  domainScores.account = Math.min(
    DOMAIN_WEIGHTS.account,
    (domainScores.account || 0) + ageBonus
  );
  if (!activeDomains.includes('account')) activeDomains.push('account');

  // ── Total score (absolute, NOT normalized) ──
  const trustScore = Math.min(100, Object.values(domainScores).reduce((a, b) => a + b, 0));

  // ── Validators ──
  const ctx = { events, domainAvg, domainCount, endorsementCount, accountAgeDays };
  const validators = [];
  for (const v of VALIDATOR_DEFS) {
    if (v.check(ctx)) {
      validators.push({ key: v.key, label: v.label, domain: v.domain, achieved_at: new Date().toISOString() });
    }
  }
  const validatorKeys = new Set(validators.map(v => v.key));

  // ── Level (score + min_domains + required validators) ──
  let trustLevel = 1;
  for (const lvl of levels) {
    if (trustScore >= Number(lvl.min_score) && activeDomains.length >= lvl.min_domains) {
      // Check required validators for this level
      const required = REQUIRED_VALIDATORS[lvl.level] || [];
      const hasAll = required.every(vk => validatorKeys.has(vk));
      if (hasAll) trustLevel = lvl.level;
    }
  }

  // ── Progress % (min of 3 bottlenecks) ──
  const nextLevel = levels.find(l => l.level === trustLevel + 1);
  let progressPct = 100;
  let bottleneck = null;

  if (nextLevel) {
    const currentMin = Number(levels.find(l => l.level === trustLevel).min_score);
    const nextMin = Number(nextLevel.min_score);
    const pointsPct = nextMin > currentMin
      ? Math.min(100, ((trustScore - currentMin) / (nextMin - currentMin)) * 100)
      : 100;

    const domainsPct = nextLevel.min_domains > 0
      ? Math.min(100, (activeDomains.length / nextLevel.min_domains) * 100)
      : 100;

    const requiredNext = REQUIRED_VALIDATORS[nextLevel.level] || [];
    const validatorsPct = requiredNext.length > 0
      ? Math.min(100, (requiredNext.filter(vk => validatorKeys.has(vk)).length / requiredNext.length) * 100)
      : 100;

    progressPct = Math.min(pointsPct, domainsPct, validatorsPct);

    if (progressPct === domainsPct && domainsPct < 100) {
      bottleneck = 'domains';
    } else if (progressPct === validatorsPct && validatorsPct < 100) {
      bottleneck = 'validators';
    } else if (progressPct === pointsPct && pointsPct < 100) {
      bottleneck = 'points';
    }
  }

  // ── Next level actions ──
  const nextActions = [];
  if (nextLevel) {
    if (bottleneck === 'domains') {
      const missing = nextLevel.min_domains - activeDomains.length;
      nextActions.push({
        action: 'activate_domains',
        domain: null,
        description: `Ative mais ${missing} vertical${missing > 1 ? 'is' : ''} (ex: entregas, estadias, marketplace)`,
      });
    }
    if (bottleneck === 'validators') {
      const requiredNext = REQUIRED_VALIDATORS[nextLevel.level] || [];
      for (const vk of requiredNext) {
        if (!validatorKeys.has(vk)) {
          const def = VALIDATOR_DEFS.find(d => d.key === vk);
          if (def) {
            nextActions.push({
              action: 'complete_validator',
              domain: def.domain,
              description: `Complete: ${def.label}`,
            });
          }
        }
      }
    }
    if (bottleneck === 'points') {
      // Suggest actions in domains with room to grow
      for (const domain of DOMAINS) {
        const current = domainScores[domain] || 0;
        const max = DOMAIN_WEIGHTS[domain];
        if (current < max * 0.7) {
          const def = VALIDATOR_DEFS.find(v => v.domain === domain && !validatorKeys.has(v.key));
          nextActions.push({
            action: 'earn_points',
            domain,
            description: def ? `${def.label} (+pontos em ${domain})` : `Mais atividade em ${domain}`,
          });
          if (nextActions.length >= 3) break;
        }
      }
    }
  }

  // ── Level name (derived, not stored in DB) ──
  const levelData = levels.find(l => l.level === trustLevel);
  const levelName = levelData?.name || 'Novato';

  // ── Fetch previous level for change detection ──
  let previousLevel = null;
  try {
    const { data: prev } = await sb()
      .from('trust_passports')
      .select('trust_level')
      .eq('user_id', userId)
      .maybeSingle();
    if (prev) previousLevel = prev.trust_level;
  } catch (_) { /* best-effort */ }

  // ── UPSERT trust_passports (only DB columns) ──
  const dbPayload = {
    user_id: userId,
    trust_score: +trustScore.toFixed(2),
    trust_level: trustLevel,
    domain_scores: domainScores,
    active_domains: activeDomains,
    validators,
    next_level_actions: nextActions.slice(0, 3),
    progress_pct: +progressPct.toFixed(1),
    bottleneck,
    last_calculated: new Date().toISOString(),
  };

  const { error: upsertErr } = await sb()
    .from('trust_passports')
    .upsert(dbPayload, { onConflict: 'user_id' });

  if (upsertErr) {
    logError(fn, upsertErr, { userId });
    throw upsertErr;
  }

  // Return enriched passport (with level_name for frontend)
  const passport = { ...dbPayload, level_name: levelName };
  log(fn, 'Passaporte calculado', { userId, trustScore: passport.trust_score, trustLevel });

  // Dispatch trust_level_changed notification if level changed
  if (previousLevel !== null && previousLevel !== trustLevel) {
    try {
      const notificationDispatcher = require('./NotificationDispatcher');
      const previousLevelData = levels.find(l => l.level === previousLevel);
      notificationDispatcher.dispatch({
        userId,
        type: 'trust_level_changed',
        importance: trustLevel > previousLevel ? 'medium' : 'high',
        data: {
          userId,
          sellerId: null,
          previousLevel,
          newLevel: trustLevel,
          previousLevelName: previousLevelData?.name || 'Desconhecido',
          newLevelName: levelName,
          trustScore: passport.trust_score,
        },
        dedupKey: `trust_level_${userId}_${trustLevel}_${Date.now()}`,
        metadata: {},
      }).catch(() => {});
    } catch (_) { /* best-effort */ }
  }

  return passport;
}

// ──────────────────────────────────────────────
// 3. Get passport (with staleness check)
// ──────────────────────────────────────────────

async function getPassport(userId) {
  const fn = 'getPassport';

  const { data, error } = await sb()
    .from('trust_passports')
    .select('*, trust_levels(name)')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    logError(fn, error, { userId });
    throw error;
  }

  // No passport yet, or stale (> 24h) → recalculate
  if (!data || (Date.now() - new Date(data.last_calculated).getTime()) > 86400000) {
    return calculatePassport(userId);
  }

  // Enrich with level_name from joined trust_levels
  data.level_name = data.trust_levels?.name || LEVEL_NAMES[data.trust_level] || 'Novato';
  delete data.trust_levels; // Remove nested join object
  return data;
}

// ──────────────────────────────────────────────
// 4. Get public passport (level + validators only)
// ──────────────────────────────────────────────

async function getPublicPassport(userId) {
  const fn = 'getPublicPassport';

  const { data, error } = await sb()
    .rpc('get_public_passport', { p_user_id: userId });

  if (error) {
    logError(fn, error, { userId });
    throw error;
  }

  return data?.[0] || {
    trust_level: 1,
    level_name: 'Novato',
    validators: [],
    active_domains: [],
  };
}

// ──────────────────────────────────────────────
// 5. Create endorsement (KYC social validation)
// ──────────────────────────────────────────────

async function createEndorsement(endorserId, endorsedId) {
  const fn = 'createEndorsement';
  log(fn, 'Criando endosso', { endorserId, endorsedId });

  if (endorserId === endorsedId) {
    throw new Error('Não é possível endorsar a si mesmo');
  }

  // Get endorser's trust level (read directly — avoid getPassport which may recalculate)
  const { data: endorserRow, error: endorserErr } = await sb()
    .from('trust_passports')
    .select('trust_level')
    .eq('user_id', endorserId)
    .single();

  if (endorserErr && endorserErr.code !== 'PGRST116') {
    logError(fn, endorserErr, { endorserId });
    throw endorserErr;
  }

  const endorserLevel = endorserRow?.trust_level || 0;

  if (endorserLevel < 3) {
    throw new Error(`Nível mínimo para endorsar é 3 (Vizinho de Confiança). Seu nível: ${endorserLevel}`);
  }

  // Monthly limit check
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const { count, error: countErr } = await sb()
    .from('kyc_social_validations')
    .select('*', { count: 'exact', head: true })
    .eq('validator_id', endorserId)
    .gte('validated_at', monthStart.toISOString());

  if (countErr) { logError(fn, countErr, { endorserId }); throw countErr; }

  const limit = ENDORSEMENT_LIMITS[endorserLevel] || 1;
  if (count >= limit) {
    throw new Error(`Limite mensal de endossos atingido (${limit}/${limit} para nível ${endorserLevel})`);
  }

  // Check if pair already exists (the UNIQUE index enforces this, but give better error)
  const { data: existing } = await sb()
    .from('kyc_social_validations')
    .select('id, endorsement_status')
    .eq('validator_id', endorserId)
    .eq('validated_user_id', endorsedId)
    .single();

  if (existing) {
    if (existing.endorsement_status === 'invalidated') {
      throw new Error('Endosso anterior foi invalidado. Contate o suporte para reabilitação.');
    }
    throw new Error('Você já endorsou este usuário');
  }

  // Find or create KYC request for the endorsed user
  let { data: request } = await sb()
    .from('kyc_social_requests')
    .select('id')
    .eq('user_id', endorsedId)
    .single();

  if (!request) {
    // Auto-create a request for the endorsed user
    const { data: newReq, error: reqErr } = await sb()
      .from('kyc_social_requests')
      .insert({ user_id: endorsedId, status: 'pending' })
      .select('id')
      .single();

    if (reqErr) { logError(fn, reqErr); throw reqErr; }
    request = newReq;
  }

  // Insert validation with snapshot
  const { error: insErr } = await sb()
    .from('kyc_social_validations')
    .insert({
      request_id: request.id,
      validator_id: endorserId,
      validated_user_id: endorsedId,
      endorser_level_at_time: endorserLevel,
      endorsement_status: 'active',
    });

  if (insErr) {
    logError(fn, insErr, { endorserId, endorsedId });
    throw insErr;
  }

  // Record trust event for the endorsed user
  await recordEvent(endorsedId, 'social', 'endorsement_received', 2.0, false, {
    endorser_id: endorserId,
    endorser_level: endorserLevel,
  });

  // Recalculate endorsed user's passport immediately (endorsement is meaningful)
  calculatePassport(endorsedId).catch(err =>
    logError(fn, err, { endorsedId, note: 'recalc pós-endosso falhou' })
  );

  log(fn, 'Endosso criado', { endorserId, endorsedId, endorserLevel });
  return { success: true, endorserLevel };
}

// ──────────────────────────────────────────────
// 6. Batch recalculation (for pg_cron)
// ──────────────────────────────────────────────

async function recalculateAll() {
  const fn = 'recalculateAll';
  log(fn, 'Recalculando todos os passaportes');

  // Get all users with trust events
  const { data: userIds, error } = await sb()
    .from('trust_events')
    .select('user_id')
    .order('user_id');

  if (error) { logError(fn, error); throw error; }

  const unique = [...new Set(userIds.map(r => r.user_id))];
  log(fn, `${unique.length} usuários para recalcular`);

  let success = 0;
  let failed = 0;

  for (const uid of unique) {
    try {
      await calculatePassport(uid);
      success++;
    } catch (err) {
      logError(fn, err, { userId: uid });
      failed++;
    }
  }

  log(fn, 'Recalculação concluída', { success, failed, total: unique.length });
  return { success, failed, total: unique.length };
}

// ──────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────

module.exports = {
  recordEvent,
  calculatePassport,
  getPassport,
  getPublicPassport,
  createEndorsement,
  recalculateAll,
  // Exposed for testing
  DOMAIN_WEIGHTS,
  ENDORSEMENT_LIMITS,
  VALIDATOR_DEFS,
};
