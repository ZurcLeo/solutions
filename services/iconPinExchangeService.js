'use strict';

const crypto = require('crypto');
const { getSupabaseClient } = require('../config/supabase');
const encryptionService = require('./encryptionService');
const { logger } = require('../logger');

const TAG = 'iconPinExchangeService';
const PIN_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 3;

// Alfabeto seguro: A-Z sem I/L/O + 2-9 = 31 chars (D1)
const SAFE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponivel');
  return client;
}

// ──────────────────────────────────────────────────────
// PIN generation + hashing
// ──────────────────────────────────────────────────────

/**
 * Gera PIN de 8 caracteres no formato XXXX-XXXX (D1/D8)
 * ~42.6 bits de entropia (31^8)
 */
function generatePin() {
  const bytes = crypto.randomBytes(8);
  let pin = '';
  for (let i = 0; i < 8; i++) {
    pin += SAFE_ALPHABET[bytes[i] % SAFE_ALPHABET.length];
  }
  return `${pin.slice(0, 4)}-${pin.slice(4)}`;
}

/**
 * Hash do PIN: strip dash, uppercase, SHA-256 hex (D3)
 */
function hashPin(pin) {
  const normalized = pin.replace(/-/g, '').toUpperCase();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Mascara o HMAC secret: primeiros 4 + **** + ultimos 4
 */
function maskSecret(hmacSecret) {
  if (!hmacSecret || hmacSecret.length < 8) return '****';
  return `${hmacSecret.slice(0, 4)}${'*'.repeat(8)}${hmacSecret.slice(-4)}`;
}

// ──────────────────────────────────────────────────────
// Create PIN Exchange
// ──────────────────────────────────────────────────────

/**
 * Cria uma troca via PIN. Expira PINs pendentes anteriores do mesmo seller.
 * Cifra credenciais com AES-256-GCM via encryptionService.
 *
 * @param {string} sellerId
 * @param {string} subscriptionId
 * @param {Object} credentials - { hmacSecret, callbackUrl, iconTenantId }
 * @returns {{ pin: string, maskedHmac: string, expiresAt: string }}
 */
async function createPinExchange(sellerId, subscriptionId, credentials) {
  // Expirar PINs pendentes anteriores deste seller
  await sb()
    .from('icon_pin_exchanges')
    .update({ status: 'expired', expired_at: new Date().toISOString() })
    .eq('seller_id', sellerId)
    .eq('status', 'pending');

  const pin = generatePin();
  const pinHash = hashPin(pin);
  const expiresAt = new Date(Date.now() + PIN_TTL_MINUTES * 60 * 1000).toISOString();

  // Cifrar credenciais com encryptionService (D4)
  await encryptionService.initialized;
  const encrypted = await encryptionService.encrypt(credentials, {
    aad: `icon_pin:${sellerId}`,
    dataType: 'icon_credentials',
  });

  const { error } = await sb()
    .from('icon_pin_exchanges')
    .insert({
      pin_hash: pinHash,
      seller_id: sellerId,
      subscription_id: subscriptionId,
      encrypted_credentials: encrypted,
      expires_at: expiresAt,
    });

  if (error) {
    logger.error(`[${TAG}] createPinExchange insert error`, { error: error.message, sellerId });
    throw error;
  }

  logger.info(`[${TAG}] PIN exchange created`, { sellerId, subscriptionId, expiresAt });

  return {
    pin,
    maskedHmac: maskSecret(credentials.hmacSecret),
    expiresAt,
  };
}

// ──────────────────────────────────────────────────────
// Redeem PIN
// ──────────────────────────────────────────────────────

/**
 * Resgata credenciais via PIN (D2: uso unico, D6: max 3 tentativas).
 *
 * @param {string} pin - PIN no formato XXXX-XXXX
 * @param {string} ip - IP do solicitante (auditoria)
 * @returns {{ hmacSecret: string, callbackUrl: string, iconTenantId: string }}
 */
async function redeemPin(pin, ip) {
  const pinHash = hashPin(pin);

  const { data: exchange, error } = await sb()
    .from('icon_pin_exchanges')
    .select('*')
    .eq('pin_hash', pinHash)
    .eq('status', 'pending')
    .single();

  if (error && error.code === 'PGRST116') {
    // Nenhum match — pode ser PIN invalido ou ja usado
    const err = new Error('pin_not_found');
    err.statusCode = 404;
    throw err;
  }
  if (error) {
    logger.error(`[${TAG}] redeemPin query error`, { error: error.message });
    throw error;
  }

  // Verificar TTL
  if (new Date(exchange.expires_at) < new Date()) {
    await sb()
      .from('icon_pin_exchanges')
      .update({ status: 'expired', expired_at: new Date().toISOString() })
      .eq('id', exchange.id);
    const err = new Error('pin_expired');
    err.statusCode = 410;
    throw err;
  }

  // Verificar tentativas (D6)
  if (exchange.attempts >= exchange.max_attempts) {
    const err = new Error('pin_max_attempts_exceeded');
    err.statusCode = 429;
    throw err;
  }

  // Incrementar tentativas
  await sb()
    .from('icon_pin_exchanges')
    .update({ attempts: exchange.attempts + 1 })
    .eq('id', exchange.id);

  // Decifrar credenciais
  await encryptionService.initialized;
  const decrypted = await encryptionService.decrypt(exchange.encrypted_credentials, {
    aad: `icon_pin:${exchange.seller_id}`,
  });

  const credentials = typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted;

  // Marcar como resgatado (D2: uso unico)
  await sb()
    .from('icon_pin_exchanges')
    .update({
      status: 'redeemed',
      redeemed_at: new Date().toISOString(),
      redeemed_by_ip: ip,
    })
    .eq('id', exchange.id);

  logger.info(`[${TAG}] PIN redeemed`, {
    exchangeId: exchange.id,
    sellerId: exchange.seller_id,
    ip,
  });

  return credentials;
}

// ──────────────────────────────────────────────────────
// Cleanup: expire stale PINs
// ──────────────────────────────────────────────────────

async function expireStaleExchanges() {
  const { data, error } = await sb()
    .from('icon_pin_exchanges')
    .update({ status: 'expired', expired_at: new Date().toISOString() })
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())
    .select('id');

  if (error) {
    logger.error(`[${TAG}] expireStaleExchanges error`, { error: error.message });
    return 0;
  }

  const count = data?.length || 0;
  if (count > 0) {
    logger.info(`[${TAG}] Expired ${count} stale PIN exchanges`);
  }
  return count;
}

module.exports = {
  generatePin,
  hashPin,
  maskSecret,
  createPinExchange,
  redeemPin,
  expireStaleExchanges,
};
