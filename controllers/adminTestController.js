/**
 * @fileoverview Admin Test Controller
 *
 * Endpoints para o painel de testes de integrações (/admin/testes).
 * Permite criar test users do Mercado Livre, gerar HMAC para IconChat,
 * e consultar logs de ações.
 */

'use strict';

const crypto = require('crypto');
const Joi    = require('joi');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');
const mlAuthService = require('../services/mlAuthService');

const TAG = 'adminTestController';

// ── ML Test Users ────────────────────────────────────────────────────────────

/**
 * POST /api/admin/tests/ml/test-user
 * Cria um usuário de teste no Mercado Livre via API oficial.
 * O admin pode fornecer um access_token manual ou usar o token de um seller conectado.
 */
async function createMlTestUser(req, res) {
  const schema = Joi.object({
    access_token: Joi.string().optional(),
    seller_id:    Joi.string().optional(),
    site_id:      Joi.string().default('MLB'),
    role:         Joi.string().valid('seller', 'buyer').default('seller'),
    notes:        Joi.string().max(500).allow('', null).optional(),
  }).or('access_token', 'seller_id');

  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  let accessToken = value.access_token;

  // Se não forneceu token manual, busca do seller conectado
  if (!accessToken && value.seller_id) {
    try {
      const mlAuthService = require('../services/mlAuthService');
      accessToken = await mlAuthService.getAccessToken(value.seller_id);
    } catch (err) {
      logger.error(`[${TAG}] Erro ao obter token do seller`, { sellerId: value.seller_id, error: err.message });
      return res.status(400).json({ error: 'seller_not_connected', details: err.message });
    }
  }

  if (!accessToken) {
    return res.status(400).json({ error: 'access_token_required' });
  }

  // Chamar API do Mercado Livre
  try {
    const response = await fetch('https://api.mercadolibre.com/users/test_user', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ site_id: value.site_id }),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.warn(`[${TAG}] ML API error creating test user`, { status: response.status, body });
      return res.status(response.status).json({
        error: 'ml_api_error',
        status: response.status,
        details: body,
      });
    }

    const mlUser = await response.json();

    // Persistir no banco
    const supabase = getSupabaseClient();
    const { error: dbError } = await supabase
      .from('ml_test_users')
      .insert({
        ml_user_id: mlUser.id,
        nickname:   mlUser.nickname,
        password:   mlUser.password,
        site_id:    value.site_id,
        site_status: mlUser.site_status || 'active',
        role:       value.role,
        notes:      value.notes || null,
        created_by: req.user.uid,
      });

    if (dbError) {
      logger.error(`[${TAG}] Erro ao salvar test user`, { dbError: dbError.message });
      // Retorna os dados mesmo se falhar o save (o user já foi criado no ML)
    }

    return res.status(201).json({
      success: true,
      test_user: {
        id:          mlUser.id,
        nickname:    mlUser.nickname,
        password:    mlUser.password,
        site_id:     value.site_id,
        site_status: mlUser.site_status || 'active',
        role:        value.role,
        email_verification_hint: `Código = últimos dígitos do ID: ${String(mlUser.id).slice(-6)}`,
      },
      saved: !dbError,
    });
  } catch (err) {
    logger.error(`[${TAG}] Erro ao criar test user ML`, { error: err.message });
    return res.status(500).json({ error: 'internal_error', details: err.message });
  }
}

/**
 * GET /api/admin/tests/ml/test-users
 * Lista usuários de teste salvos.
 */
async function listMlTestUsers(req, res) {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('ml_test_users')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    return res.json({ test_users: data || [] });
  } catch (err) {
    logger.error(`[${TAG}] Erro ao listar test users`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

/**
 * PATCH /api/admin/tests/ml/test-users/:id/expire
 * Marca um test user como expirado.
 */
async function expireMlTestUser(req, res) {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('ml_test_users')
      .update({ expired: true })
      .eq('id', req.params.id);

    if (error) throw error;

    return res.json({ success: true });
  } catch (err) {
    logger.error(`[${TAG}] Erro ao expirar test user`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

// ── IconChat HMAC Generator ──────────────────────────────────────────────────

/**
 * POST /api/admin/tests/iconchat/hmac
 * Gera assinatura HMAC para testar endpoints da IconChat API manualmente.
 */
async function generateIconChatHmac(req, res) {
  const schema = Joi.object({
    seller_id: Joi.string().required(),
    url:       Joi.string().required(),
    secret:    Joi.string().optional(),
  });

  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  let hmacSecret = value.secret;

  // Se não forneceu secret, buscar da subscription
  if (!hmacSecret) {
    try {
      const supabase = getSupabaseClient();
      const { data: sub } = await supabase
        .from('webhook_subscriptions')
        .select('hmac_secret')
        .eq('seller_id', value.seller_id)
        .eq('is_active', true)
        .maybeSingle();

      if (sub) hmacSecret = sub.hmac_secret;
    } catch (err) {
      logger.warn(`[${TAG}] Erro ao buscar HMAC secret`, { error: err.message });
    }
  }

  if (!hmacSecret) {
    return res.status(400).json({ error: 'hmac_secret_not_found', hint: 'Forneça o secret manualmente ou verifique se há uma subscription ativa para este seller.' });
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `${timestamp}.${value.seller_id}.${value.url}`;
  const signature = 'sha256=' + crypto
    .createHmac('sha256', hmacSecret)
    .update(message)
    .digest('hex');

  return res.json({
    headers: {
      'X-Icon-Signature':  signature,
      'X-Icon-Timestamp':  timestamp,
      'X-Icon-Seller-Id':  value.seller_id,
      'X-Elos-Icon-Conversation-Id': `test-${Date.now()}`,
    },
    debug: {
      message,
      valid_for: '5 minutos',
    },
  });
}

// ── IconChat Action Log ──────────────────────────────────────────────────────

/**
 * GET /api/admin/tests/iconchat/action-log
 * Lista últimas ações executadas via IconChat (dedup log).
 */
async function getIconChatActionLog(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('icon_action_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return res.json({ actions: data || [] });
  } catch (err) {
    logger.error(`[${TAG}] Erro ao listar action log`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

/**
 * GET /api/admin/tests/iconchat/webhook-log
 * Lista últimos webhooks enviados/recebidos.
 */
async function getWebhookDeliveryLog(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('webhook_delivery_log')
      .select('id, subscription_id, event_type, status, attempt, response_status, response_body, error_message, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return res.json({ deliveries: data || [] });
  } catch (err) {
    logger.error(`[${TAG}] Erro ao listar webhook log`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

// ── Connected Sellers (para dropdown de token source) ────────────────────────

/**
 * GET /api/admin/tests/ml/connected-sellers
 * Lista sellers com conta ML conectada (para dropdown de source de token).
 */
async function listConnectedSellers(req, res) {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('seller_external_accounts')
      .select('id, seller_id, external_username, account_status, connected_at')
      .eq('platform', 'mercadolivre')
      .eq('account_status', 'active')
      .order('connected_at', { ascending: false });

    if (error) throw error;

    return res.json({ sellers: data || [] });
  } catch (err) {
    logger.error(`[${TAG}] Erro ao listar connected sellers`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

// ── ML Admin OAuth (obter token para criar test users) ───────────────────────

/**
 * GET /api/admin/tests/ml/auth-url
 * Gera URL de autorização ML para admin obter token (com PKCE S256).
 * O state contém flag admin + code_verifier para o callback redirecionar ao painel de testes.
 */
function getMlAdminAuthUrl(req, res) {
  try {
    const appId = process.env.ML_APP_ID;
    const redirectUri = process.env.ML_REDIRECT_URI;
    if (!appId || !redirectUri) {
      return res.status(500).json({ error: 'ml_config_missing' });
    }

    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    // [BUG-006] State assinado via mlAuthService (mesmo HMAC do seller flow)
    const mlSecret = process.env.ML_CLIENT_SECRET;
    const statePayload = { admin: true, cv: verifier, ts: Date.now() };
    const raw = Buffer.from(JSON.stringify(statePayload)).toString('base64url');
    const sig = crypto.createHmac('sha256', mlSecret).update(raw).digest('base64url');
    const state = `${raw}.${sig}`;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: appId,
      redirect_uri: redirectUri,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    return res.json({ authorization_url: `https://auth.mercadolivre.com.br/authorization?${params.toString()}` });
  } catch (err) {
    logger.error(`[${TAG}] Erro ao gerar admin auth URL`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

/**
 * POST /api/admin/tests/ml/exchange-token
 * Troca authorization code por access_token (sem PKCE).
 * Retorna o token em texto para uso em testes.
 */
async function exchangeMlToken(req, res) {
  const schema = Joi.object({
    code: Joi.string().max(512).required(),
  });

  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const appId = process.env.ML_APP_ID;
    const secret = process.env.ML_CLIENT_SECRET;
    const redirectUri = process.env.ML_REDIRECT_URI;

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: appId,
      client_secret: secret,
      code: value.code,
      redirect_uri: redirectUri,
    });

    const resp = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      return res.status(resp.status).json({ error: 'ml_token_exchange_failed', details: errBody });
    }

    const tokenData = await resp.json();
    return res.json({
      access_token: tokenData.access_token,
      expires_in: tokenData.expires_in,
      user_id: tokenData.user_id,
      scope: tokenData.scope,
    });
  } catch (err) {
    logger.error(`[${TAG}] Erro ao trocar code por token`, { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

// ── Melhor Envio Test Utilities ───────────────────────────────────────────────

/**
 * POST /api/admin/tests/melhorenvio/quote
 * Calcula cotação de frete via Melhor Envio.
 */
async function getMelhorEnvioQuote(req, res) {
  const schema = Joi.object({
    from_cep:  Joi.string().required(),
    to_cep:    Joi.string().required(),
    products:  Joi.array().items(Joi.object({
      id:              Joi.string().required(),
      width:           Joi.number().required(),
      height:          Joi.number().required(),
      length:          Joi.number().required(),
      weight:          Joi.number().required(),
      insurance_value: Joi.number().required(),
      quantity:        Joi.number().integer().required(),
    })).min(1).required(),
    services:  Joi.string().default('1,2,3,4,17'),
  });

  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const melhorEnvioService = require('../services/melhorEnvioService');
    const quotes = await melhorEnvioService.calculateShipping(value.from_cep, value.to_cep, value.products, value.services);
    return res.json({ quotes });
  } catch (err) {
    logger.error(`[${TAG}] Erro ao cotar frete ME`, { error: err.message });
    return res.status(500).json({ error: 'internal_error', details: err.message });
  }
}

/**
 * GET /api/admin/tests/melhorenvio/app-settings
 * Retorna configurações do app no Melhor Envio.
 */
async function getMelhorEnvioAppSettings(req, res) {
  try {
    const melhorEnvioService = require('../services/melhorEnvioService');
    const settings = await melhorEnvioService.getAppSettings();
    return res.json({ settings });
  } catch (err) {
    logger.error(`[${TAG}] Erro ao obter config ME`, { error: err.message });
    return res.status(500).json({ error: 'internal_error', details: err.message });
  }
}

/**
 * GET /api/admin/tests/melhorenvio/balance
 * Retorna saldo da carteira Melhor Envio.
 */
async function getMelhorEnvioBalance(req, res) {
  try {
    const melhorEnvioService = require('../services/melhorEnvioService');
    const balance = await melhorEnvioService.getBalance();
    return res.json({ balance });
  } catch (err) {
    logger.error(`[${TAG}] Erro ao consultar saldo ME`, { error: err.message });
    return res.status(500).json({ error: 'internal_error', details: err.message });
  }
}

/**
 * POST /api/admin/tests/melhorenvio/test-cart
 * Insere item no carrinho do Melhor Envio (sandbox).
 */
async function testMelhorEnvioCart(req, res) {
  const addressSchema = Joi.object({
    name:        Joi.string().required(),
    email:       Joi.string().email().required(),
    phone:       Joi.string().required(),
    document:    Joi.string().required(),
    address:     Joi.string().required(),
    number:      Joi.string().required(),
    district:    Joi.string().required(),
    city:        Joi.string().required(),
    postal_code: Joi.string().required(),
    state_abbr:  Joi.string().length(2).required(),
    complement:  Joi.string().allow('', null).optional(),
    company_document: Joi.string().allow('', null).optional(),
    note:        Joi.string().allow('', null).optional(),
  });

  const schema = Joi.object({
    from:     addressSchema.required(),
    to:       addressSchema.required(),
    products: Joi.array().items(Joi.object({
      name:           Joi.string().required(),
      quantity:       Joi.number().integer().required(),
      unitary_value:  Joi.number().required(),
    })).min(1).required(),
    volumes:  Joi.array().items(Joi.object({
      height: Joi.number().required(),
      width:  Joi.number().required(),
      length: Joi.number().required(),
      weight: Joi.number().required(),
    })).min(1).required(),
    service:  Joi.number().integer().valid(1, 2, 3, 4, 17).required(),
    options:  Joi.object({
      insurance_value: Joi.number().optional(),
      receipt:         Joi.boolean().optional(),
      own_hand:        Joi.boolean().optional(),
      collect:         Joi.boolean().optional(),
      reverse:         Joi.boolean().optional(),
      non_commercial:  Joi.boolean().optional(),
    }).optional(),
  });

  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const melhorEnvioService = require('../services/melhorEnvioService');
    const cart_item = await melhorEnvioService.addToCart(value);
    return res.json({ cart_item });
  } catch (err) {
    logger.error(`[${TAG}] Erro ao inserir no carrinho ME`, { error: err.message });
    return res.status(500).json({ error: 'internal_error', details: err.message });
  }
}

// ── Melhor Envio Store Management ──────────────────────────────────────────────

/**
 * GET /api/admin/tests/melhorenvio/stores
 * Lista lojas cadastradas no Melhor Envio.
 */
async function listMelhorEnvioStores(req, res) {
  try {
    const melhorEnvioService = require('../services/melhorEnvioService');
    const stores = await melhorEnvioService.listStores();
    return res.json({ stores });
  } catch (err) {
    logger.error(`[${TAG}] Erro ao listar lojas ME`, { error: err.message });
    return res.status(502).json({ error: err.message });
  }
}

/**
 * POST /api/admin/tests/melhorenvio/store
 * Cadastra uma nova loja + endereço (opcional) no Melhor Envio.
 */
async function registerMelhorEnvioStore(req, res) {
  const schema = Joi.object({
    name:           Joi.string().required(),
    email:          Joi.string().email().required(),
    description:    Joi.string().allow('').default(''),
    company_name:   Joi.string().required(),
    document:       Joi.string().required(),
    state_register: Joi.string().allow('').default(''),
    // Optional address fields
    address: Joi.object({
      postal_code: Joi.string().length(8).required(),
      address:     Joi.string().required(),
      number:      Joi.string().required(),
      complement:  Joi.string().allow('').default(''),
      city:        Joi.string().required(),
      state:       Joi.string().required(),
    }).optional(),
  });

  const { error, value } = schema.validate(req.body, { stripUnknown: true });
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const melhorEnvioService = require('../services/melhorEnvioService');

    // 1. Register the store
    const { address: addressData, ...storeData } = value;
    const store = await melhorEnvioService.registerStore(storeData);
    logger.info(`[${TAG}] Loja ME criada: ${store?.id}`);

    // 2. If address provided, register it
    let addressResult = null;
    if (addressData && store?.id) {
      try {
        addressResult = await melhorEnvioService.registerStoreAddress(store.id, addressData);
        logger.info(`[${TAG}] Endereco cadastrado para loja ME ${store.id}`);
      } catch (addrErr) {
        logger.warn(`[${TAG}] Erro ao cadastrar endereco da loja ME`, { error: addrErr.message });
        // Don't fail — store was created, just address failed
      }
    }

    return res.json({ store, address: addressResult });
  } catch (err) {
    logger.error(`[${TAG}] Erro ao cadastrar loja ME`, { error: err.message });
    return res.status(502).json({ error: err.message });
  }
}

module.exports = {
  createMlTestUser,
  listMlTestUsers,
  expireMlTestUser,
  generateIconChatHmac,
  getIconChatActionLog,
  getWebhookDeliveryLog,
  listConnectedSellers,
  getMlAdminAuthUrl,
  exchangeMlToken,
  getMelhorEnvioQuote,
  getMelhorEnvioAppSettings,
  getMelhorEnvioBalance,
  testMelhorEnvioCart,
  listMelhorEnvioStores,
  registerMelhorEnvioStore,
};
