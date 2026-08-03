/**
 * @fileoverview fiscalController — Controllers para módulo fiscal
 * Joi validation + delegação para fiscalService e bookingAttachmentService
 */

'use strict';

const Joi = require('joi');
const fiscalService = require('../services/fiscalService');
const bookingAttachmentService = require('../services/bookingAttachmentService');
const { logger } = require('../logger');

const CTRL = 'fiscalController';

// ──────────────────────────────────────────────────────
// Schemas
// ──────────────────────────────────────────────────────

const createClientSchema = Joi.object({
  client_user_id:   Joi.string().required(),
  apelido:          Joi.string().max(100).allow('', null),
  regime_tributario: Joi.string().max(50).allow('', null),
  notas_internas:   Joi.string().max(2000).allow('', null),
});

const updateClientSchema = Joi.object({
  apelido:          Joi.string().max(100).allow('', null),
  regime_tributario: Joi.string().max(50).allow('', null),
  notas_internas:   Joi.string().max(2000).allow('', null),
  status:           Joi.string().valid('active', 'inactive', 'archived'),
});

const createPendenciaSchema = Joi.object({
  seller_client_id:    Joi.string().required(),
  tipo:                Joi.string().valid('intimacao', 'notificacao', 'oficio', 'obrigacao_acessoria', 'outro').required(),
  titulo:              Joi.string().max(200).required(),
  descricao:           Joi.string().max(5000).allow('', null),
  prazo_legal:         Joi.string().isoDate().required(),
  responsavel_user_id: Joi.string().allow(null),
  ciencia_confirmada:  Joi.boolean().default(false),
  metadata:            Joi.object().allow(null),
});

const updatePendenciaSchema = Joi.object({
  titulo:              Joi.string().max(200),
  descricao:           Joi.string().max(5000).allow('', null),
  prazo_legal:         Joi.string().isoDate(),
  responsavel_user_id: Joi.string().allow(null),
  status:              Joi.string().valid('aberta', 'em_andamento'),
  metadata:            Joi.object(),
});

// ──────────────────────────────────────────────────────
// Clientes
// ──────────────────────────────────────────────────────

async function listClients(req, res) {
  try {
    const sellerId = req.sellerContext?.sellerId;
    if (!sellerId) return res.status(403).json({ success: false, message: 'Seller context não encontrado' });

    const status = req.query.status || 'active';
    const data = await fiscalService.listClients(sellerId, { status });
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] listClients: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createClient(req, res) {
  try {
    const sellerId = req.sellerContext?.sellerId;
    if (!sellerId) return res.status(403).json({ success: false, message: 'Seller context não encontrado' });

    const { error: valErr, value } = createClientSchema.validate(req.body);
    if (valErr) return res.status(400).json({ success: false, message: valErr.details[0].message });

    const data = await fiscalService.createClient(sellerId, req.user.uid, value);
    res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] createClient: ${err.message}`);
    const status = err.message.includes('já é cliente') ? 409 : err.message.includes('não encontrado') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
}

async function getClient(req, res) {
  try {
    const sellerId = req.sellerContext?.sellerId;
    if (!sellerId) return res.status(403).json({ success: false, message: 'Seller context não encontrado' });

    const data = await fiscalService.getClient(sellerId, req.params.clientId);
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] getClient: ${err.message}`);
    res.status(404).json({ success: false, message: err.message });
  }
}

async function updateClient(req, res) {
  try {
    const sellerId = req.sellerContext?.sellerId;
    if (!sellerId) return res.status(403).json({ success: false, message: 'Seller context não encontrado' });

    const { error: valErr, value } = updateClientSchema.validate(req.body);
    if (valErr) return res.status(400).json({ success: false, message: valErr.details[0].message });

    const data = await fiscalService.updateClient(sellerId, req.params.clientId, value);
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] updateClient: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function archiveClient(req, res) {
  try {
    const sellerId = req.sellerContext?.sellerId;
    if (!sellerId) return res.status(403).json({ success: false, message: 'Seller context não encontrado' });

    const data = await fiscalService.archiveClient(sellerId, req.params.clientId);
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] archiveClient: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function searchUser(req, res) {
  try {
    const { email } = req.query;
    if (!email || email.length < 3) return res.status(400).json({ success: false, message: 'Email deve ter pelo menos 3 caracteres' });

    const data = await fiscalService.searchUserByEmail(email);
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] searchUser: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ──────────────────────────────────────────────────────
// Pendências
// ──────────────────────────────────────────────────────

async function listClientPendencias(req, res) {
  try {
    const sellerId = req.sellerContext?.sellerId;
    if (!sellerId) return res.status(403).json({ success: false, message: 'Seller context não encontrado' });

    const data = await fiscalService.listPendencias(sellerId, {
      seller_client_id: req.params.clientId,
      status: req.query.status,
    });
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] listClientPendencias: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createPendencia(req, res) {
  try {
    const sellerId = req.sellerContext?.sellerId;
    if (!sellerId) return res.status(403).json({ success: false, message: 'Seller context não encontrado' });

    const body = { ...req.body, seller_client_id: req.params.clientId };
    const { error: valErr, value } = createPendenciaSchema.validate(body);
    if (valErr) return res.status(400).json({ success: false, message: valErr.details[0].message });

    const data = await fiscalService.createPendencia(sellerId, req.user.uid, value);
    res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] createPendencia: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function listAllPendencias(req, res) {
  try {
    const sellerId = req.sellerContext?.sellerId;
    if (!sellerId) return res.status(403).json({ success: false, message: 'Seller context não encontrado' });

    const data = await fiscalService.listPendencias(sellerId, {
      status: req.query.status,
      responsavel_user_id: req.query.responsavel,
    });
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] listAllPendencias: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updatePendencia(req, res) {
  try {
    const sellerId = req.sellerContext?.sellerId;
    if (!sellerId) return res.status(403).json({ success: false, message: 'Seller context não encontrado' });

    const { error: valErr, value } = updatePendenciaSchema.validate(req.body);
    if (valErr) return res.status(400).json({ success: false, message: valErr.details[0].message });

    const data = await fiscalService.updatePendencia(sellerId, req.params.id, req.user.uid, value);
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] updatePendencia: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function resolvePendencia(req, res) {
  try {
    const sellerId = req.sellerContext?.sellerId;
    if (!sellerId) return res.status(403).json({ success: false, message: 'Seller context não encontrado' });

    const data = await fiscalService.resolvePendencia(sellerId, req.params.id, req.user.uid);
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] resolvePendencia: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getPendenciaHistorico(req, res) {
  try {
    const data = await fiscalService.getPendenciaHistorico(req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] getPendenciaHistorico: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ──────────────────────────────────────────────────────
// Painel do cliente (D3)
// ──────────────────────────────────────────────────────

async function getMyPendencias(req, res) {
  try {
    const data = await fiscalService.getMyPendencias(req.user.uid);
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] getMyPendencias: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ──────────────────────────────────────────────────────
// Attachments
// ──────────────────────────────────────────────────────

async function uploadAttachment(req, res) {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Arquivo é obrigatório' });

    const data = await bookingAttachmentService.uploadAttachment(
      req.params.bookingId, req.user.uid, req.file, req.body.descricao,
    );
    res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] uploadAttachment: ${err.message}`);
    const status = err.message.includes('Máximo') || err.message.includes('Tipo') || err.message.includes('excede') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
}

async function listAttachments(req, res) {
  try {
    const data = await bookingAttachmentService.listAttachments(req.params.bookingId);
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] listAttachments: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteAttachment(req, res) {
  try {
    const data = await bookingAttachmentService.deleteAttachment(req.params.attachmentId, req.user.uid);
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[${CTRL}] deleteAttachment: ${err.message}`);
    const status = err.message.includes('Apenas') || err.message.includes('24 horas') ? 403 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
}

async function getAttachmentUrl(req, res) {
  try {
    const url = await bookingAttachmentService.getSignedUrl(req.params.attachmentId);
    res.json({ success: true, data: { url } });
  } catch (err) {
    logger.error(`[${CTRL}] getAttachmentUrl: ${err.message}`);
    res.status(404).json({ success: false, message: err.message });
  }
}

module.exports = {
  // Clientes
  listClients,
  createClient,
  getClient,
  updateClient,
  archiveClient,
  searchUser,
  // Pendências
  listClientPendencias,
  createPendencia,
  listAllPendencias,
  updatePendencia,
  resolvePendencia,
  getPendenciaHistorico,
  // Cliente (D3)
  getMyPendencias,
  // Attachments
  uploadAttachment,
  listAttachments,
  deleteAttachment,
  getAttachmentUrl,
};
