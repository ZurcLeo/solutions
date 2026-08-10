'use strict';

const crypto = require('crypto');
const { getSupabaseClient } = require('../config/supabase');
const { encrypt, decrypt } = require('../utils/tokenEncryption');
const { logger } = require('../logger');

const SVC = 'mlAuthService';

// ML OAuth config
const ML_AUTH_URL = 'https://auth.mercadolivre.com.br/authorization';
const ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const ML_API_BASE = 'https://api.mercadolibre.com';

function _getConfig() {
    const appId = process.env.ML_APP_ID;
    const secret = process.env.ML_CLIENT_SECRET;
    const redirectUri = process.env.ML_REDIRECT_URI; // ex: https://eloscloud-api.fly.dev/api/integrations/ml/callback
    if (!appId || !secret || !redirectUri) {
        throw new Error('ML OAuth config incomplete: ML_APP_ID, ML_CLIENT_SECRET, ML_REDIRECT_URI');
    }
    return { appId, secret, redirectUri };
}

function sb() {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase client indisponivel');
    return client;
}

/**
 * Gera PKCE code_verifier (43-128 chars) e code_challenge (S256).
 */
function _generatePkce() {
    const verifier = crypto.randomBytes(32).toString('base64url'); // 43 chars
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
}

/**
 * [BUG-006] Assina o state com HMAC-SHA256 usando ML_CLIENT_SECRET.
 * Formato: base64url(payload).hmac — impede forjamento de sellerId/userId.
 */
function _signState(payload) {
    const { secret } = _getConfig();
    const raw = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(raw).digest('base64url');
    return `${raw}.${sig}`;
}

/**
 * [BUG-006] Verifica HMAC + expiração do state.
 * @returns {object|null} payload se válido, null se inválido/expirado
 */
function verifyState(state, { maxAgeMs = 10 * 60 * 1000 } = {}) {
    try {
        const { secret } = _getConfig();
        const dotIdx = state.lastIndexOf('.');
        if (dotIdx < 1) return null;

        const raw = state.substring(0, dotIdx);
        const sig = state.substring(dotIdx + 1);
        const expected = crypto.createHmac('sha256', secret).update(raw).digest('base64url');

        // Timing-safe comparison
        if (sig.length !== expected.length) return null;
        if (!crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expected, 'utf8'))) return null;

        const payload = JSON.parse(Buffer.from(raw, 'base64url').toString());

        // Expiração (default 10 min)
        if (payload.ts && (Date.now() - payload.ts > maxAgeMs)) return null;

        return payload;
    } catch {
        return null;
    }
}

/**
 * Gera URL de autorizacao OAuth do ML.
 * [BUG-006] State agora inclui userId e é HMAC-signed.
 * @param {string} sellerId
 * @param {string} userId - quem iniciou o connect (audit + seguranca)
 */
function getAuthorizationUrl(sellerId, userId) {
    const { appId, redirectUri } = _getConfig();
    const { verifier, challenge } = _generatePkce();
    const state = _signState({ sid: sellerId, uid: userId, cv: verifier, ts: Date.now() });
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: appId,
        redirect_uri: redirectUri,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
    });
    return `${ML_AUTH_URL}?${params.toString()}`;
}

/**
 * Troca authorization code por tokens.
 * @param {string} code - authorization code do ML
 * @param {string} codeVerifier - PKCE code_verifier gerado em getAuthorizationUrl
 */
async function exchangeCode(code, codeVerifier) {
    const { appId, secret, redirectUri } = _getConfig();
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: appId,
        client_secret: secret,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
    });
    const resp = await fetch(ML_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: body.toString(),
    });
    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`ML token exchange failed (${resp.status}): ${err}`);
    }
    return resp.json(); // { access_token, token_type, expires_in, scope, user_id, refresh_token }
}

/**
 * Refresh do access_token usando refresh_token.
 */
async function refreshAccessToken(refreshToken) {
    const { appId, secret } = _getConfig();
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: appId,
        client_secret: secret,
        refresh_token: refreshToken,
    });
    const resp = await fetch(ML_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: body.toString(),
    });
    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`ML token refresh failed (${resp.status}): ${err}`);
    }
    return resp.json();
}

/**
 * Busca dados do usuario ML para popular external_username.
 */
async function getMlUser(accessToken) {
    const resp = await fetch(`${ML_API_BASE}/users/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) throw new Error(`ML /users/me failed (${resp.status})`);
    return resp.json(); // { id, nickname, ... }
}

/**
 * Salva ou atualiza a conexao ML do seller.
 * Upsert por (seller_id, platform='mercadolivre').
 * [BUG-006] connectedBy registra quem executou o OAuth.
 */
async function saveConnection(sellerId, tokenData, mlUser, connectedBy = null) {
    const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString();

    const row = {
        seller_id: sellerId,
        platform: 'mercadolivre',
        external_user_id: String(tokenData.user_id || mlUser.id),
        external_username: mlUser.nickname || null,
        access_token_encrypted: encrypt(tokenData.access_token),
        refresh_token_encrypted: tokenData.refresh_token ? encrypt(tokenData.refresh_token) : null,
        token_expires_at: expiresAt,
        scopes: tokenData.scope ? tokenData.scope.split(' ') : [],
        account_status: 'active',
        sync_error: null,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...(connectedBy && { connected_by: connectedBy }),
    };

    const { data, error } = await sb()
        .from('seller_external_accounts')
        .upsert(row, { onConflict: 'seller_id,platform' })
        .select('id, external_user_id, external_username, account_status')
        .single();

    if (error) throw error;
    logger.info(`[${SVC}] ML connection saved`, { sellerId });
    return data;
}

/**
 * Obtem access_token descriptografado para um seller.
 * Se expirado, faz refresh automaticamente.
 */
async function getAccessToken(sellerId) {
    const { data: account, error } = await sb()
        .from('seller_external_accounts')
        .select('*')
        .eq('seller_id', sellerId)
        .eq('platform', 'mercadolivre')
        .eq('account_status', 'active')
        .maybeSingle();

    if (error) throw error;
    if (!account) return null;

    // Checar se o token expira em menos de 5 minutos
    const expiresAt = new Date(account.token_expires_at);
    const needsRefresh = expiresAt.getTime() - Date.now() < 5 * 60 * 1000;

    if (needsRefresh && account.refresh_token_encrypted) {
        try {
            const refreshToken = decrypt(account.refresh_token_encrypted);
            const newTokens = await refreshAccessToken(refreshToken);

            const newExpiresAt = new Date(Date.now() + (newTokens.expires_in * 1000)).toISOString();
            await sb()
                .from('seller_external_accounts')
                .update({
                    access_token_encrypted: encrypt(newTokens.access_token),
                    refresh_token_encrypted: newTokens.refresh_token ? encrypt(newTokens.refresh_token) : account.refresh_token_encrypted,
                    token_expires_at: newExpiresAt,
                    account_status: 'active',
                    sync_error: null,
                })
                .eq('id', account.id);

            logger.info(`[${SVC}] ML token refreshed`, { sellerId });
            return newTokens.access_token;
        } catch (refreshErr) {
            logger.error(`[${SVC}] ML token refresh failed`, { sellerId, error: refreshErr.message });
            await sb()
                .from('seller_external_accounts')
                .update({ account_status: 'expired', sync_error: refreshErr.message })
                .eq('id', account.id);
            return null;
        }
    }

    return decrypt(account.access_token_encrypted);
}

/**
 * Desconecta a conta ML de um seller.
 */
async function disconnect(sellerId) {
    const { error } = await sb()
        .from('seller_external_accounts')
        .update({
            account_status: 'disconnected',
            access_token_encrypted: 'REVOKED',
            refresh_token_encrypted: null,
        })
        .eq('seller_id', sellerId)
        .eq('platform', 'mercadolivre');

    if (error) throw error;
    logger.info(`[${SVC}] ML disconnected`, { sellerId });
}

/**
 * Retorna status da conexao ML (sem tokens).
 */
async function getConnectionStatus(sellerId) {
    const { data, error } = await sb()
        .from('seller_external_accounts')
        .select('id, platform, external_user_id, external_username, account_status, last_sync_at, sync_error, connected_at, connected_by')
        .eq('seller_id', sellerId)
        .eq('platform', 'mercadolivre')
        .maybeSingle();

    if (error) throw error;
    return data; // null se nao vinculado
}

module.exports = {
    getAuthorizationUrl,
    verifyState,
    exchangeCode,
    refreshAccessToken,
    getMlUser,
    saveConnection,
    getAccessToken,
    disconnect,
    getConnectionStatus,
};
