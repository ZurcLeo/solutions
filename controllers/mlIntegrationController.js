'use strict';

const Joi = require('joi');
const mlAuthService = require('../services/mlAuthService');
const mlSyncService = require('../services/mlSyncService');
const mlMessagingService = require('../services/mlMessagingService');
const webhookOutboundService = require('../services/webhookOutboundService');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const CTRL = 'mlIntegrationController';

// ── Joi Schemas (allowlist validation) ────────────────────────────────────────

const SCHEMAS = {
    // OAuth callback query params
    callback: Joi.object({
        code: Joi.string().max(512).required(),
        state: Joi.string().max(2048).required(),
        error: Joi.string().max(128).optional(),
    }).unknown(true), // ML pode enviar params extras

    // Webhook body from ML servers
    webhook: Joi.object({
        resource: Joi.string().max(256).pattern(/^\/[a-z_/0-9]+$/i).required(),
        user_id: Joi.number().integer().positive().required(),
        topic: Joi.string().max(64).required(),
        application_id: Joi.number().integer().optional(),
        attempts: Joi.number().integer().optional(),
        sent: Joi.string().isoDate().optional(),
        received: Joi.string().isoDate().optional(),
    }).unknown(true),
};

/**
 * GET /api/integrations/ml/connect
 * Retorna URL de autorizacao OAuth ML.
 * Requer vendedor autenticado com seller_profile ativo.
 */
exports.connect = async (req, res) => {
    try {
        const sellerId = req.sellerContext?.sellerId;
        if (!sellerId) {
            return res.status(400).json({ error: 'seller_context_required', message: 'Voce precisa ter uma loja ativa.' });
        }

        // [BUG-006] Inclui userId no state assinado (audit + seguranca)
        const url = mlAuthService.getAuthorizationUrl(sellerId, req.user.uid);
        return res.json({ authorization_url: url });
    } catch (err) {
        logger.error(`[${CTRL}] connect error`, { error: err.message });
        return res.status(500).json({ error: 'internal_error' });
    }
};

/**
 * GET /api/integrations/ml/callback
 * Callback do OAuth ML. Recebe code + state.
 * Troca code por tokens, salva, redireciona para o painel.
 */
exports.callback = async (req, res) => {
    const frontUrl = process.env.FRONTEND_URL || 'https://eloscloud.com';
    try {
        const { error: joiErr, value: query } = SCHEMAS.callback.validate(req.query, { abortEarly: true });

        if (query?.error || joiErr) {
            const reason = query?.error ? 'denied' : 'invalid_callback';
            if (query?.error) logger.warn(`[${CTRL}] ML OAuth denied`);
            return res.redirect(`${frontUrl}/mercado/vendedor?ml_error=${reason}`);
        }

        const { code, state } = query;

        // [BUG-006] Verificar HMAC + expiração do state (impede forjamento de sellerId)
        const stateData = mlAuthService.verifyState(state);
        if (!stateData) {
            logger.warn(`[${CTRL}] callback invalid/expired state`);
            return res.redirect(`${frontUrl}/mercado/vendedor?ml_error=invalid_state`);
        }

        // ── Admin flow (test panel) ───────────────────────────
        if (stateData.admin) {
            try {
                const exchangeParams = {
                    grant_type: 'authorization_code',
                    client_id: process.env.ML_APP_ID,
                    client_secret: process.env.ML_CLIENT_SECRET,
                    code,
                    redirect_uri: process.env.ML_REDIRECT_URI,
                };
                if (stateData.cv) exchangeParams.code_verifier = stateData.cv;
                const tokenResp = await fetch('https://api.mercadolibre.com/oauth/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
                    body: new URLSearchParams(exchangeParams).toString(),
                });
                if (tokenResp.ok) {
                    const tokenData = await tokenResp.json();
                    return res.redirect(`${frontUrl}/admin/testes?ml_token=${encodeURIComponent(tokenData.access_token)}`);
                }
                const errBody = await tokenResp.text();
                logger.error(`[${CTRL}] admin token exchange failed`, { status: tokenResp.status, body: errBody });
                return res.redirect(`${frontUrl}/admin/testes?ml_error=token_exchange_failed`);
            } catch (adminErr) {
                logger.error(`[${CTRL}] admin token exchange error`, { error: adminErr.message });
                return res.redirect(`${frontUrl}/admin/testes?ml_error=token_exchange_error`);
            }
        }

        // ── Seller OAuth flow ─────────────────────────────────
        const { sid: sellerId, uid: userId, cv: codeVerifier } = stateData;
        if (!sellerId || !userId) {
            return res.redirect(`${frontUrl}/mercado/vendedor?ml_error=missing_seller`);
        }

        // [BUG-006] Verificar que o user que iniciou o flow é owner do seller
        const supabase = getSupabaseClient();
        const { data: isOwner } = await supabase
            .from('seller_profiles')
            .select('id')
            .eq('id', sellerId)
            .eq('user_id', userId)
            .maybeSingle();

        if (!isOwner) {
            logger.warn(`[${CTRL}] callback user is not owner of seller`, { sellerId, userId });
            return res.redirect(`${frontUrl}/mercado/vendedor?ml_error=unauthorized`);
        }

        // Trocar code por tokens (PKCE: code_verifier viaja no state assinado)
        const tokenData = await mlAuthService.exchangeCode(code, codeVerifier);

        // Buscar dados do usuario ML
        const mlUser = await mlAuthService.getMlUser(tokenData.access_token);

        // Salvar conexao com audit trail
        await mlAuthService.saveConnection(sellerId, tokenData, mlUser, userId);

        logger.info(`[${CTRL}] ML connected`, { sellerId, connectedBy: userId });

        // Redirecionar para o painel com sucesso
        return res.redirect(`${frontUrl}/mercado/vendedor?ml_connected=true&ml_user=${encodeURIComponent(mlUser.nickname || '')}`);
    } catch (err) {
        logger.error(`[${CTRL}] callback error`, { error: err.message, stack: err.stack });
        return res.redirect(`${frontUrl}/mercado/vendedor?ml_error=exchange_failed`);
    }
};

/**
 * GET /api/integrations/ml/status
 * Retorna status da conexao ML do seller.
 */
exports.getStatus = async (req, res) => {
    try {
        const sellerId = req.sellerContext?.sellerId;
        if (!sellerId) {
            return res.status(400).json({ error: 'seller_context_required' });
        }

        const status = await mlAuthService.getConnectionStatus(sellerId);
        return res.json({ connected: !!status, data: status });
    } catch (err) {
        logger.error(`[${CTRL}] getStatus error`, { error: err.message });
        return res.status(500).json({ error: 'internal_error' });
    }
};

/**
 * POST /api/integrations/ml/disconnect
 * Desconecta a conta ML do seller.
 */
exports.disconnect = async (req, res) => {
    try {
        const sellerId = req.sellerContext?.sellerId;
        if (!sellerId) {
            return res.status(400).json({ error: 'seller_context_required' });
        }

        await mlAuthService.disconnect(sellerId);
        return res.json({ success: true, message: 'Mercado Livre desconectado.' });
    } catch (err) {
        logger.error(`[${CTRL}] disconnect error`, { error: err.message });
        return res.status(500).json({ error: 'internal_error' });
    }
};

/**
 * POST /api/integrations/ml/import
 * Importa/sincroniza catalogo completo do ML.
 * Roda inline (MVP) — pode ser lento para catalogos grandes.
 */
exports.importCatalog = async (req, res) => {
    try {
        const sellerId = req.sellerContext?.sellerId;
        if (!sellerId) {
            return res.status(400).json({ error: 'seller_context_required', message: 'Voce precisa ter uma loja ativa.' });
        }

        logger.info(`[${CTRL}] importCatalog started`, { sellerId });
        const result = await mlSyncService.importAll(sellerId);
        return res.json(result);
    } catch (err) {
        logger.error(`[${CTRL}] importCatalog error`, { error: err.message, stack: err.stack });
        return res.status(500).json({ error: 'import_failed', message: err.message });
    }
};

/**
 * POST /api/integrations/ml/webhook
 * Recebe notifications do Mercado Livre.
 * SEM auth JWT — validacao por ML user_id → seller lookup.
 * Responde 200 imediatamente (ML retry em 15min se nao receber).
 */
exports.handleWebhook = async (req, res) => {
    // 1) Responder 200 IMEDIATAMENTE (ML espera resposta rapida)
    res.status(200).json({ received: true });

    // 2) Processar async (fire-and-forget apos responder)
    try {
        const { error: joiErr, value: body } = SCHEMAS.webhook.validate(req.body, { abortEarly: true });
        if (joiErr) {
            logger.warn(`[${CTRL}] webhook validation failed`, { detail: joiErr.details[0]?.message });
            return;
        }

        const { resource, user_id, topic } = body;

        // Validar que o resource e um path legitimo da API ML
        const validResource = /^\/items\/ML[A-Z0-9]+$/.test(resource)
            || /^\/orders\/\d+$/.test(resource)
            || /^\/questions\/\d+$/.test(resource)
            || /^\/messages\/[\w-]+$/.test(resource);

        if (!validResource) {
            logger.warn(`[${CTRL}] webhook suspicious resource path`, { resource });
            return;
        }

        // 3) Lookup seller by ML user_id
        const supabase = getSupabaseClient();
        if (!supabase) {
            logger.error(`[${CTRL}] webhook supabase unavailable`);
            return;
        }

        const { data: account } = await supabase
            .from('seller_external_accounts')
            .select('seller_id, account_status')
            .eq('platform', 'mercadolivre')
            .eq('external_user_id', String(user_id))
            .eq('account_status', 'active')
            .maybeSingle();

        if (!account) {
            logger.warn(`[${CTRL}] webhook no active account for ML user`);
            return;
        }

        const sellerId = account.seller_id;

        // 4) Topic router
        switch (topic) {
            case 'items':
                await _handleItemsTopic(sellerId, resource);
                break;
            case 'questions':
                await _handleQuestionsTopic(sellerId, resource);
                break;
            case 'messages':
                await _handleMessagesTopic(sellerId, resource);
                break;
            case 'orders_v2':
                await _handleOrdersTopic(sellerId, resource);
                break;
            default:
                logger.debug(`[${CTRL}] webhook ignoring topic`, { topic });
        }
    } catch (err) {
        logger.error(`[${CTRL}] webhook processing error`, { error: err.message });
        // Nao re-throw — ja respondemos 200
    }
};

// ---------------------------------------------------------------------------
// Topic Handlers (internal)
// ---------------------------------------------------------------------------

async function _handleItemsTopic(sellerId, resource) {
    const match = resource.match(/\/items\/(ML[A-Z0-9]+)/);
    if (!match) {
        logger.warn(`[${CTRL}] webhook could not parse item ID`, { resource });
        return;
    }
    const mlItemId = match[1];
    await mlSyncService.syncSingleProduct(sellerId, mlItemId);
    logger.info(`[${CTRL}] webhook item synced`, { sellerId, mlItemId });
}

async function _handleQuestionsTopic(sellerId, resource) {
    const match = resource.match(/\/questions\/(\d+)/);
    if (!match) {
        logger.warn(`[${CTRL}] webhook could not parse question ID`, { resource });
        return;
    }
    const questionId = Number(match[1]);

    const question = await mlMessagingService.fetchQuestion(sellerId, questionId);

    await webhookOutboundService.dispatchForSeller(sellerId, 'ml.question.received', {
        event: 'ml.question.received',
        sellerId,
        data: question,
        source: 'mercadolivre',
        occurredAt: new Date().toISOString(),
    });

    logger.info(`[${CTRL}] webhook question dispatched`, { sellerId, questionId });
}

async function _handleMessagesTopic(sellerId, resource) {
    const match = resource.match(/\/messages\/([\w-]+)/);
    if (!match) {
        logger.warn(`[${CTRL}] webhook could not parse message pack ID`, { resource });
        return;
    }
    const packId = match[1];

    const messages = await mlMessagingService.fetchMessages(sellerId, packId);

    await webhookOutboundService.dispatchForSeller(sellerId, 'ml.message.received', {
        event: 'ml.message.received',
        sellerId,
        data: messages,
        source: 'mercadolivre',
        occurredAt: new Date().toISOString(),
    });

    logger.info(`[${CTRL}] webhook message dispatched`, { sellerId, packId });
}

async function _handleOrdersTopic(sellerId, resource) {
    const match = resource.match(/\/orders\/(\d+)/);
    if (!match) {
        logger.warn(`[${CTRL}] webhook could not parse order ID`, { resource });
        return;
    }
    const orderId = Number(match[1]);

    const order = await mlMessagingService.fetchOrder(sellerId, orderId);

    // Determine event type based on order status
    const isNew = order.status === 'confirmed' && order.date_created === order.last_updated;
    const eventType = isNew ? 'ml.order.created' : 'ml.order.updated';

    await webhookOutboundService.dispatchForSeller(sellerId, eventType, {
        event: eventType,
        sellerId,
        data: order,
        source: 'mercadolivre',
        occurredAt: new Date().toISOString(),
    });

    logger.info(`[${CTRL}] webhook order dispatched`, { sellerId, orderId, eventType });
}

/**
 * GET /api/integrations/ml/products
 * Lista produtos ML importados para este seller.
 */
exports.listMlProducts = async (req, res) => {
    try {
        const sellerId = req.sellerContext?.sellerId;
        if (!sellerId) {
            return res.status(400).json({ error: 'seller_context_required' });
        }

        const supabase = getSupabaseClient();
        if (!supabase) {
            return res.status(500).json({ error: 'internal_error' });
        }

        const { data, error } = await supabase
            .from('marketplace_products')
            .select('id, external_id, name, price_brl, stock, active, images, sku, updated_at')
            .eq('seller_id', sellerId)
            .eq('source', 'ml')
            .order('updated_at', { ascending: false });

        if (error) throw error;

        return res.json({ products: data || [], count: (data || []).length });
    } catch (err) {
        logger.error(`[${CTRL}] listMlProducts error`, { error: err.message });
        return res.status(500).json({ error: 'internal_error' });
    }
};
