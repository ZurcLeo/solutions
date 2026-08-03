'use strict';

const mlAuthService = require('./mlAuthService');
const { logger } = require('../logger');

const SVC = 'mlMessagingService';
const ML_API_BASE = 'https://api.mercadolibre.com';
const TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/**
 * Authenticated ML API fetch with timeout and error logging.
 * @param {string} sellerId - ElosCloud seller ID
 * @param {string} path - API path (e.g. '/questions/123')
 * @param {object} [options] - fetch options override (method, body, headers)
 * @returns {Promise<object>} parsed JSON response
 */
async function _mlApiFetch(sellerId, path, options = {}) {
    const accessToken = await mlAuthService.getAccessToken(sellerId);
    if (!accessToken) {
        throw new Error('ML nao conectado ou token expirado');
    }

    const url = `${ML_API_BASE}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const resp = await fetch(url, {
            ...options,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
                ...options.headers,
            },
            signal: controller.signal,
        });

        if (!resp.ok) {
            const errText = await resp.text();
            logger.error(`[${SVC}] ML API error`, { path, status: resp.status, body: errText });
            throw new Error(`ML API ${path} failed (${resp.status}): ${errText}`);
        }

        return resp.json();
    } catch (err) {
        if (err.name === 'AbortError') {
            logger.error(`[${SVC}] ML API timeout`, { path });
            throw new Error(`ML API ${path} timed out after ${TIMEOUT_MS}ms`);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

/**
 * Fetch a single ML question by ID.
 * GET /questions/{id}
 */
async function fetchQuestion(sellerId, questionId) {
    return _mlApiFetch(sellerId, `/questions/${questionId}`);
}

/**
 * Answer a ML question.
 * POST /answers with { question_id, text }
 * ML limit: max 2000 chars.
 */
async function answerQuestion(sellerId, questionId, text) {
    return _mlApiFetch(sellerId, '/answers', {
        method: 'POST',
        body: JSON.stringify({ question_id: questionId, text }),
    });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * Fetch messages in a conversation pack.
 * GET /messages/packs/{packId}/sellers/{sellerId}
 * ML Messages API uses pack_id and requires seller ML user_id in path.
 */
async function fetchMessages(sellerId, packId) {
    // Need ML user_id for the messages path
    const accessToken = await mlAuthService.getAccessToken(sellerId);
    if (!accessToken) throw new Error('ML nao conectado ou token expirado');

    // Fetch ML user info to get numeric user_id
    const mlUser = await mlAuthService.getMlUser(accessToken);
    return _mlApiFetch(sellerId, `/messages/packs/${packId}/sellers/${mlUser.id}`);
}

/**
 * Send a message in a conversation pack.
 * POST /messages/packs/{packId}/sellers/{sellerId}
 * ML limit: max 350 chars.
 * Note: Brazil AI layer routes to.user_id = 3037675074 since Feb 2026.
 */
async function sendMessage(sellerId, packId, text, buyerId) {
    const accessToken = await mlAuthService.getAccessToken(sellerId);
    if (!accessToken) throw new Error('ML nao conectado ou token expirado');

    const mlUser = await mlAuthService.getMlUser(accessToken);
    return _mlApiFetch(sellerId, `/messages/packs/${packId}/sellers/${mlUser.id}`, {
        method: 'POST',
        body: JSON.stringify({
            from: { user_id: mlUser.id },
            to: { user_id: buyerId },
            text,
        }),
    });
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/**
 * Fetch a single ML order by ID.
 * GET /orders/{id}
 */
async function fetchOrder(sellerId, orderId) {
    return _mlApiFetch(sellerId, `/orders/${orderId}`);
}

module.exports = {
    fetchQuestion,
    answerQuestion,
    fetchMessages,
    sendMessage,
    fetchOrder,
    _mlApiFetch,
};
