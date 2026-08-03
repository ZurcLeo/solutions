/**
 * @fileoverview icalSyncService — ElosCloud iCal Sync
 *
 * Importa calendarios .ics de plataformas externas (Airbnb, Booking, VRBO)
 * para bloquear datas automaticamente em imoveis de temporada, evitando
 * overbooking cross-platform.
 *
 * Fluxo de sync:
 *   fetch(ical_url) → SHA-256 hash → diff → upsert property_blocked_dates
 *
 * Parsing manual de .ics (sem libs externas):
 *   Extrai VEVENT blocks → DTSTART, DTEND, SUMMARY
 *   Suporta formatos: YYYYMMDD (all-day) e YYYYMMDDTHHMMSSZ (datetime)
 *
 * Tabelas:
 *   property_ical_sources    — fontes de importacao (URLs .ics)
 *   property_blocked_dates   — datas bloqueadas (source='ical_sync', source_ref=UUID)
 *
 * Padrao: TEXT PKs, sb() helper, sbService() para bypass RLS, logger prefixado.
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { createClient }      = require('@supabase/supabase-js');
const { logger }            = require('../logger');
const crypto                 = require('crypto');

const gamificationService    = require('./gamificationService');

const SERVICE = 'icalSyncService';

// ──────────────────────────────────────────────────────
// Helpers (mesmo padrao de propertyStayService)
// ──────────────────────────────────────────────────────

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponivel');
  return client;
}

function sbService() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY nao configurados.');
  return createClient(url, key, { auth: { persistSession: false } });
}

function log(fn, msg, extra = {}) {
  logger.info(msg, { service: SERVICE, function: fn, ...extra });
}

function logError(fn, err, extra = {}) {
  logger.error(`Erro em ${fn}: ${err.message}`, {
    service: SERVICE, function: fn, error: err.message, ...extra,
  });
}

// ──────────────────────────────────────────────────────
// Helper: resolve seller_profiles.id a partir do Firebase UID
// ──────────────────────────────────────────────────────

async function getSellerProfileId(firebaseUid) {
  if (!firebaseUid) return null;
  const { data } = await sb()
    .from('seller_profiles')
    .select('id')
    .eq('user_id', firebaseUid)
    .single();
  return data?.id ?? null;
}

/**
 * Verifica que o usuario eh o seller do imovel.
 * @param {string} firebaseUid
 * @param {string} productId
 * @returns {{ sellerProfileId: string, product: object }}
 * @throws {Error} se nao autorizado
 */
async function verifyOwnership(firebaseUid, productId) {
  const sellerProfileId = await getSellerProfileId(firebaseUid);
  if (!sellerProfileId) throw new Error('Perfil de vendedor nao encontrado para este usuario.');

  const { data: product } = await sb()
    .from('marketplace_products')
    .select('id, seller_id')
    .eq('id', productId)
    .single();

  if (!product || product.seller_id !== sellerProfileId) {
    throw new Error('Nao autorizado: voce nao eh o dono deste imovel.');
  }

  return { sellerProfileId, product };
}

// ──────────────────────────────────────────────────────
// iCal Parser (manual, sem dependencias externas)
// ──────────────────────────────────────────────────────

/**
 * Parseia uma data iCal nos formatos:
 *   YYYYMMDD          → all-day event
 *   YYYYMMDDTHHMMSSZ  → datetime UTC
 *   YYYYMMDDTHHMMSS   → datetime local (trata como UTC)
 *
 * Tambem suporta VALUE=DATE:YYYYMMDD inline.
 *
 * @param {string} raw - valor bruto do DTSTART/DTEND (ex: "20260715" ou "VALUE=DATE:20260715")
 * @returns {Date|null}
 */
function parseIcalDate(raw) {
  if (!raw) return null;

  // Remover parametros inline (ex: "VALUE=DATE:20260715" ou "TZID=America/Sao_Paulo:20260715T140000")
  let dateStr = raw;
  const colonIdx = raw.indexOf(':');
  if (colonIdx !== -1 && !/^\d/.test(raw)) {
    dateStr = raw.substring(colonIdx + 1);
  }

  dateStr = dateStr.trim();

  // Formato all-day: YYYYMMDD (8 digitos)
  if (/^\d{8}$/.test(dateStr)) {
    const y = parseInt(dateStr.substring(0, 4), 10);
    const m = parseInt(dateStr.substring(4, 6), 10) - 1;
    const d = parseInt(dateStr.substring(6, 8), 10);
    return new Date(Date.UTC(y, m, d));
  }

  // Formato datetime: YYYYMMDDTHHMMSSZ ou YYYYMMDDTHHMMSS
  const dtMatch = dateStr.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (dtMatch) {
    const [, y, mo, d, h, mi, s] = dtMatch;
    return new Date(Date.UTC(
      parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10),
      parseInt(h, 10), parseInt(mi, 10), parseInt(s, 10)
    ));
  }

  return null;
}

/**
 * Formata Date para 'YYYY-MM-DD' (formato usado em property_blocked_dates).
 * @param {Date} date
 * @returns {string}
 */
function formatDateYMD(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Extrai VEVENTs de um corpo .ics e retorna array de { start, end, summary }.
 * @param {string} icsBody
 * @returns {Array<{ start: string, end: string, summary: string }>}
 *   start e end no formato 'YYYY-MM-DD'
 */
function parseIcsEvents(icsBody) {
  const events = [];

  // Split por VEVENT blocks
  const blocks = icsBody.split('BEGIN:VEVENT');

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split('END:VEVENT')[0];
    if (!block) continue;

    // Unfold iCal lines: linhas que comecam com espaco ou tab sao continuacao
    const unfolded = block.replace(/\r?\n[ \t]/g, '');
    const lines = unfolded.split(/\r?\n/);

    let dtStart = null;
    let dtEnd   = null;
    let summary = '';

    for (const line of lines) {
      // DTSTART pode ter parametros: DTSTART;VALUE=DATE:20260715
      if (line.startsWith('DTSTART')) {
        const value = line.substring(line.indexOf(':') + 1).trim();
        // Pode ter parametros antes do ':'
        const fullValue = line.includes(';')
          ? line.substring(line.indexOf(';') + 1)
          : value;
        dtStart = parseIcalDate(fullValue);
      } else if (line.startsWith('DTEND')) {
        const value = line.substring(line.indexOf(':') + 1).trim();
        const fullValue = line.includes(';')
          ? line.substring(line.indexOf(';') + 1)
          : value;
        dtEnd = parseIcalDate(fullValue);
      } else if (line.startsWith('SUMMARY')) {
        summary = line.substring(line.indexOf(':') + 1).trim();
      }
    }

    // Para eventos all-day sem DTEND, usar DTSTART + 1 dia
    if (dtStart && !dtEnd) {
      dtEnd = new Date(dtStart.getTime() + 24 * 60 * 60 * 1000);
    }

    if (dtStart && dtEnd) {
      events.push({
        start:   formatDateYMD(dtStart),
        end:     formatDateYMD(dtEnd),
        summary: summary || 'Reserva externa',
      });
    }
  }

  return events;
}

// ──────────────────────────────────────────────────────
// 1. Adicionar fonte iCal
// ──────────────────────────────────────────────────────

/**
 * Adiciona uma fonte iCal a um imovel de temporada.
 * Executa a primeira sincronizacao imediatamente.
 *
 * @param {string} userId    - Firebase UID do host
 * @param {string} productId - ID do imovel (marketplace_products)
 * @param {object} opts
 * @param {string} opts.sourceUrl  - URL do feed .ics (deve iniciar com https://)
 * @param {string} opts.sourceName - Nome da fonte (airbnb, booking, vrbo, custom)
 * @returns {object} registro criado em property_ical_sources
 */
async function addIcalSource(userId, productId, { sourceUrl, sourceName }) {
  const fn = 'addIcalSource';

  if (!userId || !productId || !sourceUrl || !sourceName) {
    throw new Error('userId, productId, sourceUrl e sourceName sao obrigatorios.');
  }

  // 1. Validar URL
  if (!sourceUrl.startsWith('https://')) {
    throw new Error('A URL do calendario deve usar HTTPS (comece com https://).');
  }

  // 2. Verificar ownership
  const { sellerProfileId } = await verifyOwnership(userId, productId);

  // 3. Inserir fonte
  const { data: source, error } = await sb()
    .from('property_ical_sources')
    .insert({
      product_id:  productId,
      seller_id:   sellerProfileId,
      source_name: sourceName,
      ical_url:    sourceUrl,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('Esta URL de calendario ja esta cadastrada para este imovel.');
    }
    logError(fn, error, { productId, sourceUrl });
    throw new Error(`Erro ao adicionar fonte iCal: ${error.message}`);
  }

  log(fn, 'Fonte iCal adicionada', { sourceId: source.id, productId, sourceName });

  // 4. Executar primeira sync imediatamente (fire-and-forget com log de erro)
  try {
    await syncSingleSource(source.id);
  } catch (syncErr) {
    logError(fn, syncErr, { sourceId: source.id, context: 'first_sync' });
    // Nao lanca erro — a fonte foi criada com sucesso, sync pode ser retentada
  }

  // 5. Lei do Time — gamificação (fire-and-forget, não bloqueia fluxo principal)
  try {
    await gamificationService.triggerEvent('ical_sync_configured', userId, {
      productId,
      sourceName,
      sourceId: source.id,
    });
  } catch (gamErr) {
    logger.warn('Falha ao disparar evento gamificação (não-bloqueante)', {
      service: SERVICE, function: fn, error: gamErr.message,
    });
  }

  // 6. Retornar registro atualizado (com status do sync)
  const { data: updated } = await sb()
    .from('property_ical_sources')
    .select('*')
    .eq('id', source.id)
    .single();

  return updated || source;
}

// ──────────────────────────────────────────────────────
// 2. Listar fontes iCal
// ──────────────────────────────────────────────────────

/**
 * Lista todas as fontes iCal de um imovel para o seller autenticado.
 *
 * @param {string} userId    - Firebase UID
 * @param {string} productId - ID do imovel
 * @returns {Array<object>}
 */
async function listIcalSources(userId, productId) {
  const fn = 'listIcalSources';

  if (!userId || !productId) {
    throw new Error('userId e productId sao obrigatorios.');
  }

  const sellerProfileId = await getSellerProfileId(userId);
  if (!sellerProfileId) return [];

  const { data, error } = await sb()
    .from('property_ical_sources')
    .select('*')
    .eq('seller_id', sellerProfileId)
    .eq('product_id', productId)
    .order('created_at', { ascending: true });

  if (error) {
    logError(fn, error, { productId, sellerProfileId });
    throw new Error(`Erro ao listar fontes iCal: ${error.message}`);
  }

  return data ?? [];
}

// ──────────────────────────────────────────────────────
// 3. Remover fonte iCal
// ──────────────────────────────────────────────────────

/**
 * Remove uma fonte iCal e todas as datas bloqueadas associadas.
 *
 * @param {string} userId   - Firebase UID
 * @param {string} sourceId - UUID da property_ical_sources
 */
async function removeIcalSource(userId, sourceId) {
  const fn = 'removeIcalSource';

  if (!userId || !sourceId) {
    throw new Error('userId e sourceId sao obrigatorios.');
  }

  const sellerProfileId = await getSellerProfileId(userId);
  if (!sellerProfileId) throw new Error('Perfil de vendedor nao encontrado.');

  // Verificar ownership da fonte
  const { data: source, error: fetchErr } = await sb()
    .from('property_ical_sources')
    .select('id, product_id, seller_id')
    .eq('id', sourceId)
    .single();

  if (fetchErr || !source) throw new Error('Fonte iCal nao encontrada.');
  if (source.seller_id !== sellerProfileId) throw new Error('Nao autorizado a remover esta fonte iCal.');

  // Remover datas bloqueadas associadas (via sbService para bypass RLS)
  const { error: delBlockErr } = await sbService()
    .from('property_blocked_dates')
    .delete()
    .eq('property_id', source.product_id)
    .eq('source', 'ical_sync')
    .eq('source_ref', sourceId);

  if (delBlockErr) {
    logError(fn, delBlockErr, { sourceId, context: 'delete_blocked_dates' });
    // Nao bloqueia a remocao da fonte
  }

  // Remover a fonte
  const { error: delErr } = await sb()
    .from('property_ical_sources')
    .delete()
    .eq('id', sourceId)
    .eq('seller_id', sellerProfileId);

  if (delErr) {
    logError(fn, delErr, { sourceId });
    throw new Error(`Erro ao remover fonte iCal: ${delErr.message}`);
  }

  log(fn, 'Fonte iCal removida', { sourceId, productId: source.product_id });
  return { success: true };
}

// ──────────────────────────────────────────────────────
// 4. Sincronizar uma unica fonte
// ──────────────────────────────────────────────────────

/**
 * Sincroniza uma unica fonte iCal:
 *   1. Fetch do .ics
 *   2. Hash SHA-256 para skip se inalterado
 *   3. Parse VEVENTs → datas bloqueadas
 *   4. Upsert property_blocked_dates em transacao
 *
 * @param {string} sourceId - UUID da property_ical_sources
 * @returns {{ status: 'ok'|'skipped'|'error', eventsCount?: number, message?: string }}
 */
async function syncSingleSource(sourceId) {
  const fn = 'syncSingleSource';

  if (!sourceId) throw new Error('sourceId eh obrigatorio.');

  // 1. Buscar a fonte
  const { data: source, error: srcErr } = await sbService()
    .from('property_ical_sources')
    .select('*')
    .eq('id', sourceId)
    .single();

  if (srcErr || !source) throw new Error('Fonte iCal nao encontrada.');
  if (!source.is_active) throw new Error('Fonte iCal esta desativada.');

  const { ical_url, product_id, source_name, last_hash, seller_id } = source;

  try {
    // 2. Fetch do .ics com timeout de 15s
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let response;
    try {
      response = await fetch(ical_url, {
        signal:  controller.signal,
        headers: {
          'User-Agent': 'ElosCloud-iCal-Sync/1.0',
          'Accept':     'text/calendar, text/plain, */*',
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const body = await response.text();

    if (!body || body.length < 20) {
      throw new Error('Resposta vazia ou invalida do feed iCal.');
    }

    // 3. Calcular hash SHA-256
    const hash = crypto.createHash('sha256').update(body).digest('hex');

    // 4. Se hash identico, skip (ja sincronizado)
    if (hash === last_hash) {
      await sbService()
        .from('property_ical_sources')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('id', sourceId);

      log(fn, 'Sync skipped (hash identico)', { sourceId, productId: product_id });
      return { status: 'skipped', message: 'Calendario nao foi alterado desde a ultima sincronizacao.' };
    }

    // 5. Parsear eventos
    const events = parseIcsEvents(body);

    // Filtrar eventos no passado (manter apenas datas futuras ou hoje)
    const today = formatDateYMD(new Date());
    const futureEvents = events.filter(e => e.end >= today);

    // 6. Transacao: limpar datas antigas e inserir novas
    const client = sbService();

    // 6a. DELETE datas bloqueadas anteriores desta fonte
    const { error: delErr } = await client
      .from('property_blocked_dates')
      .delete()
      .eq('property_id', product_id)
      .eq('source', 'ical_sync')
      .eq('source_ref', sourceId);

    if (delErr) {
      logError(fn, delErr, { sourceId, context: 'delete_old_blocks' });
      throw new Error(`Erro ao limpar bloqueios anteriores: ${delErr.message}`);
    }

    // 6b. INSERT novas datas bloqueadas
    if (futureEvents.length > 0) {
      const rows = futureEvents.map(event => ({
        property_id: product_id,
        seller_id:   seller_id,
        blocked_from: event.start,
        blocked_to:   event.end,
        reason:       source_name || 'ical_sync',
        source:       'ical_sync',
        source_ref:   sourceId,
      }));

      const { error: insErr } = await client
        .from('property_blocked_dates')
        .insert(rows);

      if (insErr) {
        logError(fn, insErr, { sourceId, context: 'insert_blocks', count: rows.length });
        throw new Error(`Erro ao inserir bloqueios: ${insErr.message}`);
      }
    }

    // 7. Atualizar status da fonte: sucesso
    await client
      .from('property_ical_sources')
      .update({
        last_synced_at:      new Date().toISOString(),
        last_hash:           hash,
        sync_status:         'ok',
        sync_error:          null,
        consecutive_failures: 0,
      })
      .eq('id', sourceId);

    log(fn, 'Sync concluido com sucesso', {
      sourceId,
      productId: product_id,
      totalEvents: events.length,
      futureEvents: futureEvents.length,
    });

    return {
      status:      'ok',
      eventsCount: futureEvents.length,
      message:     `${futureEvents.length} evento(s) sincronizado(s).`,
    };

  } catch (err) {
    // 8. Atualizar status da fonte: erro
    logError(fn, err, { sourceId, productId: product_id });

    try {
      await sbService()
        .from('property_ical_sources')
        .update({
          last_synced_at:       new Date().toISOString(),
          sync_status:          'error',
          sync_error:           err.message?.substring(0, 500),
          consecutive_failures: (source.consecutive_failures || 0) + 1,
        })
        .eq('id', sourceId);
    } catch (updateErr) {
      logError(fn, updateErr, { sourceId, context: 'update_error_status' });
    }

    throw err;
  }
}

// ──────────────────────────────────────────────────────
// 5. Sincronizar todas as fontes ativas (cron)
// ──────────────────────────────────────────────────────

/**
 * Sincroniza todas as fontes iCal ativas que precisam de re-sync.
 * Chamado periodicamente pelo cron job.
 *
 * Criterio: is_active=true AND (last_synced_at IS NULL OR
 *   last_synced_at < now() - interval 'sync_interval_min minutes')
 *
 * Executa em serie para evitar flood de requests.
 *
 * @returns {{ synced: number, skipped: number, errors: number, details: Array }}
 */
async function syncAllActiveSources() {
  const fn = 'syncAllActiveSources';

  log(fn, 'Iniciando sync batch de fontes iCal');

  // Buscar fontes que precisam de sync
  // Usa query SQL raw porque o filtro com interval dinamico nao eh trivial no Supabase client
  const { data: sources, error } = await sbService()
    .from('property_ical_sources')
    .select('id, product_id, source_name, sync_interval_min, last_synced_at, consecutive_failures')
    .eq('is_active', true)
    .order('last_synced_at', { ascending: true, nullsFirst: true });

  if (error) {
    logError(fn, error, { context: 'fetch_active_sources' });
    throw new Error(`Erro ao buscar fontes ativas: ${error.message}`);
  }

  if (!sources || sources.length === 0) {
    log(fn, 'Nenhuma fonte ativa encontrada para sync');
    return { synced: 0, skipped: 0, errors: 0, details: [] };
  }

  // Filtrar fontes que precisam de re-sync baseado no intervalo
  const now = Date.now();
  const needsSync = sources.filter(s => {
    if (!s.last_synced_at) return true; // nunca sincronizado
    const lastSync  = new Date(s.last_synced_at).getTime();
    const interval  = (s.sync_interval_min || 30) * 60 * 1000;
    return (now - lastSync) >= interval;
  });

  // Desativar fontes com muitas falhas consecutivas (>= 10)
  const tooManyFailures = needsSync.filter(s => s.consecutive_failures >= 10);
  for (const s of tooManyFailures) {
    try {
      await sbService()
        .from('property_ical_sources')
        .update({ is_active: false, sync_error: 'Desativada automaticamente apos 10+ falhas consecutivas.' })
        .eq('id', s.id);
      log(fn, 'Fonte desativada por falhas consecutivas', { sourceId: s.id, failures: s.consecutive_failures });
    } catch { /* best-effort */ }
  }

  const activeSources = needsSync.filter(s => s.consecutive_failures < 10);

  const results = { synced: 0, skipped: 0, errors: 0, details: [] };

  // Executar em serie
  for (const source of activeSources) {
    try {
      const result = await syncSingleSource(source.id);
      if (result.status === 'skipped') {
        results.skipped++;
      } else {
        results.synced++;
      }
      results.details.push({ sourceId: source.id, ...result });
    } catch (err) {
      results.errors++;
      results.details.push({
        sourceId: source.id,
        status:   'error',
        message:  err.message,
      });
    }
  }

  log(fn, 'Sync batch concluido', {
    total: activeSources.length,
    synced: results.synced,
    skipped: results.skipped,
    errors: results.errors,
  });

  return results;
}

// ──────────────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────────────

module.exports = {
  addIcalSource,
  listIcalSources,
  removeIcalSource,
  syncSingleSource,
  syncAllActiveSources,

  // Exporta parser para testes unitarios
  _parseIcalDate:  parseIcalDate,
  _parseIcsEvents: parseIcsEvents,
  _formatDateYMD:  formatDateYMD,
};
