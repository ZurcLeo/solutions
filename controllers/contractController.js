'use strict';

/**
 * contractController.js
 * Controlador REST para contratos digitais de empréstimo.
 *
 * Rotas (ver routes/contracts.js):
 *   POST   /api/contracts/generate             — gerar contrato (async, retorna 202)
 *   GET    /api/contracts/:id                  — status do contrato
 *   GET    /api/contracts/:id/download-url     — Signed URL (TTL 1h)
 *   GET    /api/contracts/:id/signing-link     — link Clicksign para assinar
 *   POST   /api/contracts/:id/cancel           — cancelar contrato
 *   GET    /api/contracts                      — listar contratos do usuário
 *   POST   /api/contracts/webhook/clicksign    — webhook Clicksign (público, validado por HMAC)
 *
 * Autor: infra-agent
 * Data: 2026-05-18
 */

const crypto          = require('crypto');
const ContractService = require('../services/ContractService');
const { logger }      = require('../logger');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function _err(res, err) {
  const status = err.statusCode ?? 500;
  logger.error('contractController error', { message: err.message, status });
  return res.status(status).json({ success: false, message: err.message });
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * POST /api/contracts/generate
 * Body: { caixinhaId, loanId, type: 'bilateral'|'multilateral', valueTotal }
 * Retorna 202 com contractId — processamento ocorre em background.
 */
const generateContract = async (req, res) => {
  try {
    const { caixinhaId, loanId, type, valueTotal } = req.body;

    if (!caixinhaId || !loanId || !type) {
      return res.status(400).json({ success: false, message: 'caixinhaId, loanId e type são obrigatórios' });
    }

    if (!['bilateral', 'multilateral'].includes(type)) {
      return res.status(400).json({ success: false, message: 'type deve ser "bilateral" ou "multilateral"' });
    }

    const result = await ContractService.generateContract({
      caixinhaId,
      loanId,
      type,
      valueTotal: Number(valueTotal) || 0,
    });

    return _ok(res, result, 202);
  } catch (err) {
    return _err(res, err);
  }
};

/**
 * GET /api/contracts/:id
 * Retorna status e metadados do contrato.
 */
const getContract = async (req, res) => {
  try {
    const data = await ContractService.getContract(req.params.id, req.user.uid);
    return _ok(res, data);
  } catch (err) {
    return _err(res, err);
  }
};

/**
 * GET /api/contracts/:id/download-url
 * Retorna uma Signed URL (TTL 1h) para o PDF criptografado.
 * Para PDF legível, o frontend deve chamar o backend que descriptografa e serve via stream.
 */
const getDownloadUrl = async (req, res) => {
  try {
    const contract = await ContractService.getContract(req.params.id, req.user.uid);
    const url = await ContractService.getDownloadUrl(req.params.id, contract.caixinha_id, req.user.uid);
    return _ok(res, { url, ttlSeconds: 3600 });
  } catch (err) {
    return _err(res, err);
  }
};

/**
 * GET /api/contracts/:id/signing-link
 * Retorna o link do Clicksign para o usuário autenticado assinar o contrato.
 */
const getSigningLink = async (req, res) => {
  try {
    const data = await ContractService.getSigningLink(req.params.id, req.user.uid);
    return _ok(res, data);
  } catch (err) {
    return _err(res, err);
  }
};

/**
 * POST /api/contracts/:id/cancel
 * Body: { reason }
 */
const cancelContract = async (req, res) => {
  try {
    const { reason } = req.body;
    await ContractService.cancelContract(req.params.id, reason || 'user_request', req.user.uid);
    return _ok(res, { cancelled: true });
  } catch (err) {
    return _err(res, err);
  }
};

/**
 * GET /api/contracts
 * Query: { status?, caixinhaId? }
 * Lista os contratos do usuário autenticado.
 */
const listContracts = async (req, res) => {
  try {
    const data = await ContractService.listUserContracts(req.user.uid, req.query);
    return _ok(res, data);
  } catch (err) {
    return _err(res, err);
  }
};

/**
 * POST /api/contracts/webhook/clicksign
 * Recebe eventos do Clicksign via webhook.
 * Validação por HMAC-SHA256 (secret: CLICKSIGN_WEBHOOK_SECRET).
 * Esta rota é pública (sem verifyToken) — autenticada via HMAC.
 */
const clicksignWebhook = async (req, res) => {
  try {
    // Validar HMAC se o secret estiver configurado
    const webhookSecret = process.env.CLICKSIGN_WEBHOOK_SECRET;
    if (webhookSecret) {
      const signature = req.headers['x-clicksign-hmac-sha256'];
      if (!signature) {
        logger.warn('Clicksign webhook: assinatura HMAC ausente');
        return res.status(401).json({ success: false, message: 'Assinatura HMAC ausente' });
      }

      const rawBody   = JSON.stringify(req.body);
      const expected  = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
      const isValid   = crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expected,  'hex')
      );

      if (!isValid) {
        logger.warn('Clicksign webhook: assinatura HMAC inválida');
        return res.status(401).json({ success: false, message: 'Assinatura inválida' });
      }
    }

    // Processar o evento em background (responder 200 imediatamente para o Clicksign)
    res.status(200).json({ received: true });

    setImmediate(() => {
      ContractService.handleClicksignWebhook(req.body).catch(err => {
        logger.error('Clicksign webhook processing error', { error: err.message });
      });
    });

  } catch (err) {
    logger.error('Clicksign webhook handler error', { error: err.message });
    return res.status(200).json({ received: true }); // sempre 200 para o Clicksign
  }
};

module.exports = {
  generateContract,
  getContract,
  getDownloadUrl,
  getSigningLink,
  cancelContract,
  listContracts,
  clicksignWebhook,
};
