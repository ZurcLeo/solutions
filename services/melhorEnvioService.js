'use strict';

const { logger } = require('../logger');

const SVC = 'melhorEnvioService';

const USER_AGENT = 'ElosCloud (tech@eloscloud.com)';
const DEFAULT_SERVICES = '1,2,3,4,17'; // PAC, SEDEX, JadLog .Package, JadLog .Com, Mini Envios
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 min buffer antes do vencimento
const MAX_RETRIES = 2;
const RATE_LIMIT_BASE_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// Config e auth helpers (internos)
// ---------------------------------------------------------------------------

/**
 * Le env vars do Melhor Envio.
 * @returns {{ clientId: string, clientSecret: string, accessToken: string, refreshToken: string, tokenExpiresAt: string, baseUrl: string }}
 */
function _getConfig() {
    const clientId = process.env.ME_CLIENT_ID;
    const clientSecret = process.env.ME_CLIENT_SECRET;
    const accessToken = process.env.ME_ACCESS_TOKEN;
    const refreshToken = process.env.ME_REFRESH_TOKEN;
    const tokenExpiresAt = process.env.ME_TOKEN_EXPIRES_AT;
    const baseUrl = process.env.ME_BASE_URL;

    if (!accessToken) {
        throw new Error('ME_ACCESS_TOKEN nao configurado — token Melhor Envio obrigatorio');
    }
    if (!baseUrl) {
        throw new Error('ME_BASE_URL nao configurado — ex: https://sandbox.melhorenvio.com.br');
    }

    return { clientId, clientSecret, accessToken, refreshToken, tokenExpiresAt, baseUrl };
}

/**
 * Verifica se o token esta expirado ou proximo de expirar (5 min buffer).
 * @returns {boolean}
 */
function _isTokenExpired() {
    const { tokenExpiresAt } = _getConfig();
    if (!tokenExpiresAt) {
        // Sem data de expiracao registrada — assume valido (melhor tentar do que falhar)
        return false;
    }
    const expiresMs = new Date(tokenExpiresAt).getTime();
    if (isNaN(expiresMs)) {
        logger.warn(`[${SVC}] ME_TOKEN_EXPIRES_AT invalido: ${tokenExpiresAt}`);
        return false;
    }
    return Date.now() >= expiresMs - TOKEN_EXPIRY_BUFFER_MS;
}

/**
 * Renova o access_token via OAuth refresh_token.
 * Atualiza process.env em memoria (runtime only).
 */
async function _refreshToken() {
    const { clientId, clientSecret, refreshToken, baseUrl } = _getConfig();

    if (!refreshToken) {
        throw new Error('ME_REFRESH_TOKEN nao configurado — impossivel renovar token');
    }
    if (!clientId || !clientSecret) {
        throw new Error('ME_CLIENT_ID / ME_CLIENT_SECRET nao configurados — impossivel renovar token');
    }

    logger.info(`[${SVC}] Renovando access_token Melhor Envio...`);

    const resp = await fetch(`${baseUrl}/oauth/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({
            grant_type: 'refresh_token',
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
        }),
    });

    if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`Melhor Envio token refresh falhou (${resp.status}): ${errBody}`);
    }

    const data = await resp.json();
    // data: { token_type, expires_in (2592000 = 30d), access_token, refresh_token }

    // Atualiza env vars em memoria (runtime)
    process.env.ME_ACCESS_TOKEN = data.access_token;
    if (data.refresh_token) {
        process.env.ME_REFRESH_TOKEN = data.refresh_token;
    }
    const newExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
    process.env.ME_TOKEN_EXPIRES_AT = newExpiresAt;

    logger.warn(
        `[${SVC}] Token Melhor Envio renovado em memoria. ` +
        `ATENCAO: Atualize as env vars no Fly.io (ME_ACCESS_TOKEN, ME_REFRESH_TOKEN, ME_TOKEN_EXPIRES_AT) ` +
        `para persistir apos restart. Novo token expira em ${newExpiresAt}`
    );

    return data;
}

// ---------------------------------------------------------------------------
// API call wrapper (interno)
// ---------------------------------------------------------------------------

/**
 * Wrapper generico para chamadas a API do Melhor Envio.
 * Auto-refresh de token, retry em 401, backoff em 429.
 *
 * @param {string} method - HTTP method
 * @param {string} path - Path relativo (ex: /api/v2/me/balance)
 * @param {object} [data] - Body para POST/PUT/PATCH
 * @param {number} [retries=1] - Numero de retries restantes
 * @returns {Promise<{status: number, data: any}>}
 */
async function _apiCall(method, path, data = null, retries = 1) {
    // Auto-refresh se token esta proximo de expirar
    if (_isTokenExpired()) {
        try {
            await _refreshToken();
        } catch (refreshErr) {
            logger.error(`[${SVC}] Falha ao renovar token antes da chamada`, {
                path,
                error: refreshErr.message,
            });
            throw refreshErr;
        }
    }

    const { accessToken, baseUrl } = _getConfig();
    const url = `${baseUrl}${path}`;
    const tag = `${method} ${path}`;

    const headers = {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
    };

    const fetchOpts = { method, headers };
    if (data && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
        fetchOpts.body = JSON.stringify(data);
    }

    logger.info(`[${SVC}] ${tag} iniciando`, {
        url: path,
        hasBody: !!data,
    });

    let resp;
    try {
        resp = await fetch(url, fetchOpts);
    } catch (networkErr) {
        logger.error(`[${SVC}] ${tag} erro de rede`, { error: networkErr.message });
        throw new Error(`Melhor Envio indisponivel: ${networkErr.message}`);
    }

    // --- 401 Unauthorized: tenta refresh + retry ---
    if (resp.status === 401 && retries > 0) {
        logger.warn(`[${SVC}] ${tag} 401 — tentando refresh e retry`);
        try {
            await _refreshToken();
        } catch (refreshErr) {
            logger.error(`[${SVC}] ${tag} refresh falhou apos 401`, { error: refreshErr.message });
            throw new Error(`Melhor Envio autenticacao falhou: ${refreshErr.message}`);
        }
        return _apiCall(method, path, data, retries - 1);
    }

    // --- 429 Rate Limit: backoff exponencial ---
    if (resp.status === 429 && retries > 0) {
        const attempt = MAX_RETRIES - retries + 1;
        const delayMs = RATE_LIMIT_BASE_DELAY_MS * Math.pow(2, attempt);
        logger.warn(`[${SVC}] ${tag} 429 rate-limited — aguardando ${delayMs}ms (tentativa ${attempt})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return _apiCall(method, path, data, retries - 1);
    }

    // --- Parse response body ---
    let respData;
    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        respData = await resp.json();
    } else {
        respData = await resp.text();
    }

    // --- 422 Validation Error ---
    if (resp.status === 422) {
        const fieldErrors = _extractValidationErrors(respData);
        logger.warn(`[${SVC}] ${tag} 422 validacao`, { fields: fieldErrors });
        const err = new Error(`Melhor Envio validacao: ${fieldErrors}`);
        err.status = 422;
        err.validationErrors = respData;
        throw err;
    }

    // --- Outros erros ---
    if (!resp.ok) {
        const summary = typeof respData === 'string' ? respData.slice(0, 300) : JSON.stringify(respData).slice(0, 300);
        logger.error(`[${SVC}] ${tag} falhou`, { status: resp.status, body: summary });
        const err = new Error(`Melhor Envio ${tag} falhou (${resp.status}): ${summary}`);
        err.status = resp.status;
        err.responseData = respData;
        throw err;
    }

    logger.info(`[${SVC}] ${tag} ok`, { status: resp.status });

    return { status: resp.status, data: respData };
}

/**
 * Extrai mensagens de erro de validacao 422 do Melhor Envio.
 * @param {any} body - Response body
 * @returns {string} Mensagem user-friendly
 */
function _extractValidationErrors(body) {
    if (!body || typeof body !== 'object') return String(body);

    // ME retorna { message, errors: { field: [msgs] } }
    if (body.errors && typeof body.errors === 'object') {
        const parts = [];
        for (const [field, msgs] of Object.entries(body.errors)) {
            const msgStr = Array.isArray(msgs) ? msgs.join(', ') : String(msgs);
            parts.push(`${field}: ${msgStr}`);
        }
        return parts.join(' | ') || body.message || 'Erro de validacao';
    }

    if (body.message) return body.message;
    return JSON.stringify(body).slice(0, 300);
}

// ---------------------------------------------------------------------------
// Funcoes publicas
// ---------------------------------------------------------------------------

/**
 * Calcula opcoes de frete para um envio.
 *
 * @param {string} fromCep - CEP de origem (8 digitos, sem hifen)
 * @param {string} toCep - CEP de destino (8 digitos, sem hifen)
 * @param {Array<{id: string, width: number, height: number, length: number, weight: number, insurance_value: number, quantity: number}>} products - Produtos
 * @param {string} [services] - IDs de servicos separados por virgula (default: "1,2,3,4,17")
 * @returns {Promise<Array<{serviceId: number, serviceName: string, carrierName: string, carrierLogo: string, price: number, customPrice: number, deliveryDays: number, deliveryRange: {min: number, max: number}}>>}
 */
async function calculateShipping(fromCep, toCep, products, services) {
    if (!fromCep || !toCep) {
        throw new Error('CEPs de origem e destino sao obrigatorios');
    }
    if (!products || products.length === 0) {
        throw new Error('Pelo menos um produto e obrigatorio para calcular frete');
    }

    const payload = {
        from: { postal_code: String(fromCep).replace(/\D/g, '') },
        to: { postal_code: String(toCep).replace(/\D/g, '') },
        products: products.map(p => ({
            id: String(p.id),
            width: Number(p.width),
            height: Number(p.height),
            length: Number(p.length),
            weight: Number(p.weight),
            insurance_value: Number(p.insurance_value) || 0,
            quantity: Number(p.quantity) || 1,
        })),
        options: { receipt: false, own_hand: false },
        services: services || DEFAULT_SERVICES,
    };

    const { data: results } = await _apiCall('POST', '/api/v2/me/shipment/calculate', payload);

    if (!Array.isArray(results)) {
        logger.warn(`[${SVC}] calculateShipping retorno inesperado`, { type: typeof results });
        return [];
    }

    // Filtra servicos sem erro e mapeia para formato padronizado
    return results
        .filter(svc => svc.error == null)
        .map(svc => ({
            serviceId: svc.id,
            serviceName: svc.name,
            carrierName: svc.company?.name || '',
            carrierLogo: svc.company?.picture || '',
            price: parseFloat(svc.price) || 0,
            customPrice: parseFloat(svc.custom_price) || parseFloat(svc.price) || 0,
            deliveryDays: svc.custom_delivery_time || svc.delivery_time || 0,
            deliveryRange: {
                min: svc.delivery_range?.min || svc.custom_delivery_range?.min || 0,
                max: svc.delivery_range?.max || svc.custom_delivery_range?.max || 0,
            },
        }));
}

/**
 * Adiciona um envio ao carrinho do Melhor Envio.
 *
 * @param {object} cartData - Dados completos do envio (service, from, to, products, volumes, options)
 * @param {number} cartData.service - ID do servico de frete (ex: 1 = PAC)
 * @param {object} cartData.from - Remetente (name, email, phone, document, address, number, district, city, postal_code, state_abbr, country_id)
 * @param {object} cartData.to - Destinatario (mesmos campos)
 * @param {Array<{name: string, quantity: number, unitary_value: number}>} cartData.products - Produtos
 * @param {Array<{height: number, width: number, length: number, weight: number}>} cartData.volumes - Volumes
 * @param {object} cartData.options - Opcoes (insurance_value, receipt, own_hand, platform, tags)
 * @returns {Promise<{id: string, protocol: string, service_id: number, quote: number, price: number, status: string, delivery_min: number, delivery_max: number}>}
 */
async function addToCart(cartData) {
    if (!cartData || !cartData.service) {
        throw new Error('Dados do carrinho incompletos — service obrigatorio');
    }
    if (!cartData.from || !cartData.to) {
        throw new Error('Dados do carrinho incompletos — from e to obrigatorios');
    }

    const { data } = await _apiCall('POST', '/api/v2/me/cart', cartData);

    logger.info(`[${SVC}] Envio adicionado ao carrinho`, {
        orderId: data?.id,
        protocol: data?.protocol,
        serviceId: data?.service_id,
    });

    return data;
}

/**
 * Realiza o checkout (compra) dos envios no carrinho.
 * Requer saldo suficiente na carteira do Melhor Envio.
 *
 * @param {string[]} meOrderIds - Array de UUIDs dos envios no carrinho
 * @returns {Promise<object>} Confirmacao do checkout
 */
async function checkout(meOrderIds) {
    if (!meOrderIds || meOrderIds.length === 0) {
        throw new Error('Pelo menos um ID de envio e obrigatorio para checkout');
    }

    const { data } = await _apiCall('POST', '/api/v2/me/shipment/checkout', {
        orders: meOrderIds,
    });

    logger.info(`[${SVC}] Checkout realizado`, {
        orderCount: meOrderIds.length,
        orderIds: meOrderIds,
    });

    return data;
}

/**
 * Gera etiquetas para os envios ja pagos.
 *
 * @param {string[]} meOrderIds - Array de UUIDs dos envios
 * @returns {Promise<object>} Resultado da geracao
 */
async function generateLabel(meOrderIds) {
    if (!meOrderIds || meOrderIds.length === 0) {
        throw new Error('Pelo menos um ID de envio e obrigatorio para gerar etiqueta');
    }

    const { data } = await _apiCall('POST', '/api/v2/me/shipment/generate', {
        orders: meOrderIds,
    });

    logger.info(`[${SVC}] Etiquetas geradas`, { orderIds: meOrderIds });

    return data;
}

/**
 * Imprime (gera PDF) das etiquetas.
 *
 * @param {string[]} meOrderIds - Array de UUIDs dos envios
 * @param {'a4'|'thermal'} [format='a4'] - Formato da etiqueta
 * @returns {Promise<object>} URL do PDF da etiqueta
 */
async function printLabel(meOrderIds, format = 'a4') {
    if (!meOrderIds || meOrderIds.length === 0) {
        throw new Error('Pelo menos um ID de envio e obrigatorio para imprimir etiqueta');
    }
    if (!['a4', 'thermal'].includes(format)) {
        throw new Error('Formato de etiqueta invalido — use "a4" ou "thermal"');
    }

    const { data } = await _apiCall('POST', '/api/v2/me/shipment/print', {
        mode: format,
        orders: meOrderIds,
    });

    logger.info(`[${SVC}] Etiquetas impressas`, { orderIds: meOrderIds, format });

    return data;
}

/**
 * Cancela um envio.
 *
 * @param {string} meOrderId - UUID do envio no Melhor Envio
 * @param {number} reasonId - ID do motivo de cancelamento (ex: 2)
 * @param {string} description - Descricao do motivo
 * @returns {Promise<object>} Resultado do cancelamento
 */
async function cancelShipment(meOrderId, reasonId, description) {
    if (!meOrderId) {
        throw new Error('ID do envio obrigatorio para cancelamento');
    }

    const { data } = await _apiCall('POST', '/api/v2/me/shipment/cancel', {
        order: {
            id: meOrderId,
            reason_id: reasonId || 2,
            description: description || 'Pedido cancelado pelo vendedor',
        },
    });

    logger.info(`[${SVC}] Envio cancelado`, { meOrderId, reasonId });

    return data;
}

/**
 * Consulta eventos de rastreio de um envio.
 *
 * @param {string} meOrderId - UUID do envio no Melhor Envio
 * @returns {Promise<object>} Eventos de rastreio
 */
async function getTracking(meOrderId) {
    if (!meOrderId) {
        throw new Error('ID do envio obrigatorio para rastreio');
    }

    const params = new URLSearchParams({ orders: meOrderId });
    const { data } = await _apiCall('GET', `/api/v2/me/shipment/tracking?${params.toString()}`);

    logger.info(`[${SVC}] Tracking consultado`, { meOrderId });

    return data;
}

/**
 * Consulta saldo da carteira do Melhor Envio.
 *
 * @returns {Promise<{balance: number}>} Saldo disponivel
 */
async function getBalance() {
    const { data } = await _apiCall('GET', '/api/v2/me/balance');

    logger.info(`[${SVC}] Saldo consultado`, {
        balance: data?.balance ?? 'N/A',
    });

    return data;
}

/**
 * Consulta configuracoes do aplicativo no Melhor Envio (servicos habilitados, dimensoes padrao, etc).
 *
 * @returns {Promise<object>} Settings do app
 */
async function getAppSettings() {
    const { data } = await _apiCall('GET', '/api/v2/me/shipment/app-settings');

    logger.info(`[${SVC}] App settings consultadas`);

    return data;
}

/**
 * Lista lojas cadastradas na conta Melhor Envio.
 * @returns {Promise<Array>}
 */
async function listStores() {
    const { data } = await _apiCall('GET', '/api/v2/me/companies');
    logger.info(`[${SVC}] Lojas ME listadas`, { count: Array.isArray(data) ? data.length : 0 });
    return data;
}

/**
 * Cadastra uma nova loja no Melhor Envio.
 * @param {{ name: string, email: string, description?: string, company_name: string, document: string, state_register?: string }} storeData
 * @returns {Promise<object>}
 */
async function registerStore(storeData) {
    const { data } = await _apiCall('POST', '/api/v2/me/companies', storeData);
    logger.info(`[${SVC}] Loja ME cadastrada`, { storeId: data?.id, name: storeData.name });
    return data;
}

/**
 * Cadastra endereco de uma loja no Melhor Envio.
 * @param {number|string} storeId
 * @param {{ postal_code: string, address: string, number: string, complement?: string, city: string, state: string }} addressData
 * @returns {Promise<object>}
 */
async function registerStoreAddress(storeId, addressData) {
    if (!storeId) throw new Error('storeId obrigatorio');
    const { data } = await _apiCall('POST', `/api/v2/me/companies/${storeId}/addresses`, addressData);
    logger.info(`[${SVC}] Endereco cadastrado para loja ME`, { storeId });
    return data;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    calculateShipping,
    addToCart,
    checkout,
    generateLabel,
    printLabel,
    cancelShipment,
    getTracking,
    getBalance,
    getAppSettings,
    listStores,
    registerStore,
    registerStoreAddress,
};
