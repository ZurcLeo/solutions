/**
 * @fileoverview WebAuthn Service — Passkeys FIDO2 (registro e autenticação)
 * Ticket: AUTH-PL-003
 *
 * Usa @simplewebauthn/server para gerar/verificar opções WebAuthn.
 * Challenges armazenados em JWT de curta duração (5min).
 * Credenciais armazenadas em user_webauthn_credentials (Supabase).
 */

'use strict';

const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const jwt = require('jsonwebtoken');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const CTRL = 'webauthnService';

// RP (Relying Party) configuration
const RP_NAME = 'ElosCloud';
const RP_ID = process.env.WEBAUTHN_RP_ID || 'app.eloscloud.com';
const RP_ORIGIN = process.env.WEBAUTHN_ORIGIN || 'https://app.eloscloud.com';

// Challenge JWT TTL
const CHALLENGE_TTL = '5m';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

// ---------------------------------------------------------------------------
// Challenge management via JWT (stateless, no DB needed)
// ---------------------------------------------------------------------------

/**
 * Encodes challenge + context in a short-lived JWT.
 * @param {string} challenge - base64url challenge from WebAuthn
 * @param {Object} context - additional context (userId, purpose)
 * @returns {string} JWT
 */
function encodeChallenge(challenge, context = {}) {
  return jwt.sign(
    { challenge, ...context, purpose: 'webauthn_challenge' },
    process.env.JWT_SECRET,
    { expiresIn: CHALLENGE_TTL }
  );
}

/**
 * Decodes and validates challenge JWT.
 * @param {string} challengeToken
 * @returns {Object} decoded payload
 * @throws {Error} if expired or invalid
 */
function decodeChallenge(challengeToken) {
  const payload = jwt.verify(challengeToken, process.env.JWT_SECRET);
  if (payload.purpose !== 'webauthn_challenge') {
    throw new Error('Invalid challenge token purpose');
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Registration (requires authenticated user)
// ---------------------------------------------------------------------------

/**
 * Gera opções de registro de passkey para o usuário autenticado.
 *
 * @param {string} userId
 * @param {string} userName - display name for the credential
 * @returns {{ options: Object, challengeToken: string }}
 */
async function getRegistrationOptions(userId, userName) {
  const fn = `${CTRL}.getRegistrationOptions`;

  // Buscar credenciais existentes (para excluir do registro)
  const { data: existingCreds } = await sb()
    .from('user_webauthn_credentials')
    .select('credential_id, transports')
    .eq('user_id', userId);

  const excludeCredentials = (existingCreds || []).map(cred => ({
    id: cred.credential_id,
    transports: cred.transports || [],
  }));

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: userName || userId,
    attestationType: 'none',
    excludeCredentials,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform',
    },
  });

  // Challenge em JWT (stateless)
  const challengeToken = encodeChallenge(options.challenge, {
    userId,
    flow: 'registration',
  });

  logger.info(`[${fn}] Registration options generated`, { userId });
  return { options, challengeToken };
}

/**
 * Verifica resposta de registro e armazena credencial.
 *
 * @param {string} userId
 * @param {string} challengeToken - JWT com challenge
 * @param {Object} registrationResponse - resposta do browser
 * @param {string} [deviceName] - nome do dispositivo (opcional)
 * @returns {{ success: boolean, credentialId?: string, error?: string }}
 */
async function verifyRegistration(userId, challengeToken, registrationResponse, deviceName) {
  const fn = `${CTRL}.verifyRegistration`;

  // 1. Decodificar challenge
  let challengePayload;
  try {
    challengePayload = decodeChallenge(challengeToken);
  } catch {
    return { success: false, error: 'challenge_expired' };
  }

  if (challengePayload.userId !== userId || challengePayload.flow !== 'registration') {
    return { success: false, error: 'challenge_mismatch' };
  }

  // 2. Verificar resposta
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: registrationResponse,
      expectedChallenge: challengePayload.challenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
    });
  } catch (err) {
    logger.error(`[${fn}] Verification failed`, { userId, error: err.message });
    return { success: false, error: 'verification_failed' };
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { success: false, error: 'verification_failed' };
  }

  const { credential, credentialDeviceType, aaguid } = verification.registrationInfo;

  // 3. Armazenar credencial
  const { error: insertErr } = await sb()
    .from('user_webauthn_credentials')
    .insert({
      user_id: userId,
      credential_id: credential.id,
      public_key: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      device_name: deviceName || credentialDeviceType || 'Passkey',
      transports: credential.transports || [],
      aaguid: aaguid || null,
    });

  if (insertErr) {
    logger.error(`[${fn}] Failed to store credential`, { userId, error: insertErr.message });
    return { success: false, error: 'storage_failed' };
  }

  logger.info(`[${fn}] Passkey registered`, { userId, credentialId: credential.id });
  return { success: true, credentialId: credential.id };
}

// ---------------------------------------------------------------------------
// Authentication (public — user has no JWT yet)
// ---------------------------------------------------------------------------

/**
 * Gera opções de autenticação por passkey.
 *
 * @param {string} email - email do usuário (para buscar credenciais)
 * @returns {{ options: Object, challengeToken: string } | null}
 */
async function getAuthenticationOptions(email) {
  const fn = `${CTRL}.getAuthenticationOptions`;

  const normalizedEmail = email.toLowerCase().trim();

  // 1. Resolver usuário
  const { data: user } = await sb()
    .from('users')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (!user) {
    // Não revelar se email existe — retorna opções genéricas (sem allowCredentials)
    // O browser mostrará o seletor de passkeys do sistema que falhará gracefully
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      userVerification: 'preferred',
    });

    const challengeToken = encodeChallenge(options.challenge, {
      userId: null,
      flow: 'authentication',
    });

    return { options, challengeToken };
  }

  // 2. Buscar credenciais do usuário
  const { data: credentials } = await sb()
    .from('user_webauthn_credentials')
    .select('credential_id, transports')
    .eq('user_id', user.id);

  if (!credentials || credentials.length === 0) {
    // Usuário existe mas não tem passkeys
    return { options: null, noPasskeys: true };
  }

  const allowCredentials = credentials.map(cred => ({
    id: cred.credential_id,
    transports: cred.transports || [],
  }));

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials,
    userVerification: 'preferred',
  });

  const challengeToken = encodeChallenge(options.challenge, {
    userId: user.id,
    flow: 'authentication',
  });

  logger.info(`[${fn}] Authentication options generated`, { userId: user.id });
  return { options, challengeToken };
}

/**
 * Verifica resposta de autenticação e retorna userId.
 *
 * @param {string} challengeToken - JWT com challenge
 * @param {Object} authResponse - resposta do browser
 * @returns {{ success: boolean, userId?: string, error?: string }}
 */
async function verifyAuthentication(challengeToken, authResponse) {
  const fn = `${CTRL}.verifyAuthentication`;

  // 1. Decodificar challenge
  let challengePayload;
  try {
    challengePayload = decodeChallenge(challengeToken);
  } catch {
    return { success: false, error: 'challenge_expired' };
  }

  if (challengePayload.flow !== 'authentication') {
    return { success: false, error: 'challenge_mismatch' };
  }

  // 2. Buscar credencial pelo credential_id da resposta
  const credentialId = authResponse.id;

  const { data: storedCred } = await sb()
    .from('user_webauthn_credentials')
    .select('id, user_id, credential_id, public_key, counter, transports')
    .eq('credential_id', credentialId)
    .maybeSingle();

  if (!storedCred) {
    logger.warn(`[${fn}] Credential not found`, { credentialId });
    return { success: false, error: 'credential_not_found' };
  }

  // 3. Verificar que o challenge corresponde ao userId correto (se especificado)
  if (challengePayload.userId && challengePayload.userId !== storedCred.user_id) {
    return { success: false, error: 'credential_mismatch' };
  }

  // 4. Verificar resposta
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: authResponse,
      expectedChallenge: challengePayload.challenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: storedCred.credential_id,
        publicKey: Buffer.from(storedCred.public_key, 'base64url'),
        counter: Number(storedCred.counter),
        transports: storedCred.transports || [],
      },
    });
  } catch (err) {
    logger.error(`[${fn}] Verification failed`, { credentialId, error: err.message });
    return { success: false, error: 'verification_failed' };
  }

  if (!verification.verified) {
    return { success: false, error: 'verification_failed' };
  }

  // 5. Atualizar counter (replay prevention)
  await sb()
    .from('user_webauthn_credentials')
    .update({
      counter: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq('id', storedCred.id);

  // 6. Registrar tentativa bem-sucedida
  const { data: user } = await sb()
    .from('users')
    .select('email')
    .eq('id', storedCred.user_id)
    .maybeSingle();

  if (user) {
    try {
      await sb()
        .from('auth_login_attempts')
        .insert({
          email: user.email,
          method: 'webauthn',
          success: true,
        });
    } catch {
      // fire-and-forget
    }
  }

  logger.info(`[${fn}] Passkey authentication verified`, { userId: storedCred.user_id });
  return { success: true, userId: storedCred.user_id };
}

// ---------------------------------------------------------------------------
// Credential management (requires authenticated user)
// ---------------------------------------------------------------------------

/**
 * Lista passkeys do usuário.
 * @param {string} userId
 * @returns {Array}
 */
async function listCredentials(userId) {
  const { data, error } = await sb()
    .from('user_webauthn_credentials')
    .select('id, credential_id, device_name, created_at, last_used_at, transports')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('listCredentials error', { userId, error: error.message });
    return [];
  }

  return data || [];
}

/**
 * Remove uma passkey do usuário.
 * @param {string} userId
 * @param {string} credentialDbId - ID do registro (não credential_id)
 * @returns {{ success: boolean, error?: string }}
 */
async function deleteCredential(userId, credentialDbId) {
  const { data, error } = await sb()
    .from('user_webauthn_credentials')
    .delete()
    .eq('id', credentialDbId)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();

  if (error) {
    logger.error('deleteCredential error', { userId, credentialDbId, error: error.message });
    return { success: false, error: 'delete_failed' };
  }

  if (!data) {
    return { success: false, error: 'not_found' };
  }

  logger.info('Passkey deleted', { userId, credentialDbId });
  return { success: true };
}

/**
 * Verifica se usuário tem pelo menos uma passkey registrada.
 * @param {string} userId
 * @returns {boolean}
 */
async function hasPasskeys(userId) {
  const { count } = await sb()
    .from('user_webauthn_credentials')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  return (count || 0) > 0;
}

module.exports = {
  getRegistrationOptions,
  verifyRegistration,
  getAuthenticationOptions,
  verifyAuthentication,
  listCredentials,
  deleteCredential,
  hasPasskeys,
};
