/**
 * @fileoverview Resolução de telefone → userId/guestId para IconChat API.
 *
 * Extrai e reutiliza a lógica de normalização BR de webhookReturnService._getUserByPhone.
 * Suporta registered users (users.telefone) e guest buyers (guest_buyers.phone).
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

/**
 * Normaliza telefone brasileiro em variações candidatas.
 * Gera combinações de: com/sem DDI 55 × com/sem nono dígito.
 * O nono dígito ("9" após o DDD) foi adicionado aos celulares BR entre 2012-2016;
 * cadastros antigos podem não tê-lo, enquanto WhatsApp sempre envia com ele.
 * @param {string} phone
 * @returns {string[]} lista de candidatos (nunca vazia se phone tem ≥10 dígitos)
 */
function normalizePhoneBR(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return [];

  const seen = new Set();
  const candidates = [];

  function add(c) {
    if (c.length >= 10 && !seen.has(c)) {
      seen.add(c);
      candidates.push(c);
    }
  }

  // ── 1. Variações de DDI 55 ──
  add(digits);

  let local = digits; // DDD(2) + número(8 ou 9)
  if (digits.startsWith('55') && digits.length >= 12) {
    local = digits.slice(2);
    add(local);
  } else if (!digits.startsWith('55') && digits.length <= 11) {
    add('55' + digits);
  }

  // ── 2. Variações de nono dígito (inserir/remover "9" após DDD) ──
  if (local.length === 10 || local.length === 11) {
    const ddd = local.slice(0, 2);
    const number = local.slice(2);

    if (number.length === 8) {
      // Cadastro antigo sem nono dígito → tentar com 9
      add(ddd + '9' + number);
      add('55' + ddd + '9' + number);
    }
    if (number.length === 9 && number.startsWith('9')) {
      // Cadastro com nono dígito → tentar sem 9
      add(ddd + number.slice(1));
      add('55' + ddd + number.slice(1));
    }
  }

  return candidates;
}

/**
 * Resolve telefone para userId (registered) ou guestId (guest_buyers).
 * @param {string} phone
 * @returns {Promise<{ userId: string|null, guestId: string|null, source: 'registered'|'guest'|null }>}
 */
async function resolveByPhone(phone) {
  const candidates = normalizePhoneBR(phone);
  if (candidates.length === 0) {
    return { userId: null, guestId: null, source: null };
  }

  // 1) Tentar registered user
  for (const c of candidates) {
    const { data } = await sb()
      .from('users')
      .select('id')
      .eq('telefone', c)
      .maybeSingle();
    if (data) return { userId: data.id, guestId: null, source: 'registered' };
  }

  // 2) Tentar guest buyer
  for (const c of candidates) {
    const { data } = await sb()
      .from('guest_buyers')
      .select('id')
      .eq('phone', c)
      .maybeSingle();
    if (data) return { userId: null, guestId: data.id, source: 'guest' };
  }

  return { userId: null, guestId: null, source: null };
}

module.exports = { normalizePhoneBR, resolveByPhone };
