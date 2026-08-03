'use strict';

const Joi = require('joi');
const pixDiretoService = require('../services/pixDiretoService');
const { logger } = require('../logger');

const SERVICE = 'pixDiretoController';

function logError(fn, err, extra = {}) {
  logger.error(`Erro em ${fn}: ${err.message}`, {
    service: SERVICE, function: fn, error: err.message, ...extra,
  });
}

// ── Schemas ──────────────────────────────────────────────────────────────────

const generateSchema = Joi.object({
  caixinhaId: Joi.string().required(),
  amount: Joi.number().positive().precision(2).required(),
});

const approveSchema = Joi.object({
  notes: Joi.string().max(500).optional().allow(''),
});

const rejectSchema = Joi.object({
  reason: Joi.string().min(5).max(500).required(),
});

const cashPaymentSchema = Joi.object({
  caixinhaId: Joi.string().required(),
  memberId: Joi.string().required(),
  amount: Joi.number().positive().precision(2).required(),
  paymentDate: Joi.string().isoDate().optional(),
  notes: Joi.string().max(500).optional().allow(''),
});

const listFiltersSchema = Joi.object({
  status: Joi.string().valid(
    'pending_upload', 'pending_review', 'auto_approved',
    'admin_approved', 'admin_rejected', 'expired'
  ).optional(),
  limit: Joi.number().integer().min(1).max(100).default(20),
  offset: Joi.number().integer().min(0).default(0),
});

// ── Controllers ──────────────────────────────────────────────────────────────

/**
 * POST /api/payments/pix-direto/generate
 * Body: { caixinhaId, amount }
 */
async function generatePixData(req, res) {
  try {
    const { error, value } = generateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }

    const contributorId = req.user.uid;
    const result = await pixDiretoService.generatePixData(
      value.caixinhaId, contributorId, value.amount
    );

    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    logError('generatePixData', err, { userId: req.user?.uid });
    const status = err.message.includes('não encontrad') || err.message.includes('não está habilitado')
      ? 422 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/payments/pix-direto/upload/:receiptId
 * File: receipt (multipart/form-data)
 */
async function uploadReceiptCtrl(req, res) {
  try {
    const { receiptId } = req.params;
    if (!receiptId) {
      return res.status(400).json({ success: false, error: 'receiptId é obrigatório.' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Arquivo do comprovante é obrigatório.' });
    }

    const contributorId = req.user.uid;
    const result = await pixDiretoService.uploadReceipt(
      receiptId,
      contributorId,
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname
    );

    return res.json({ success: true, data: result });
  } catch (err) {
    logError('uploadReceipt', err, { receiptId: req.params.receiptId, userId: req.user?.uid });
    const status = err.message.includes('não encontrad') || err.message.includes('não pertence')
      ? 404
      : err.message.includes('expirou') || err.message.includes('já processado')
        ? 422
        : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/payments/pix-direto/approve/:receiptId
 * Body: { notes? }
 */
async function approveReceipt(req, res) {
  try {
    const { receiptId } = req.params;
    if (!receiptId) {
      return res.status(400).json({ success: false, error: 'receiptId é obrigatório.' });
    }

    const { error, value } = approveSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }

    const adminId = req.user.uid;
    const result = await pixDiretoService.approveReceipt(receiptId, adminId, value.notes);

    return res.json({ success: true, data: result });
  } catch (err) {
    logError('approveReceipt', err, { receiptId: req.params.receiptId, adminId: req.user?.uid });
    const status = err.message.includes('não encontrad') ? 404
      : err.message.includes('não pode ser') ? 422 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/payments/pix-direto/reject/:receiptId
 * Body: { reason }
 */
async function rejectReceipt(req, res) {
  try {
    const { receiptId } = req.params;
    if (!receiptId) {
      return res.status(400).json({ success: false, error: 'receiptId é obrigatório.' });
    }

    const { error, value } = rejectSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }

    const adminId = req.user.uid;
    const result = await pixDiretoService.rejectReceipt(receiptId, adminId, value.reason);

    return res.json({ success: true, data: result });
  } catch (err) {
    logError('rejectReceipt', err, { receiptId: req.params.receiptId, adminId: req.user?.uid });
    const status = err.message.includes('não encontrad') ? 404
      : err.message.includes('não pode ser') ? 422 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/payments/pix-direto/modes/:caixinhaId
 */
async function getPaymentModes(req, res) {
  try {
    const { caixinhaId } = req.params;
    if (!caixinhaId) {
      return res.status(400).json({ success: false, error: 'caixinhaId é obrigatório.' });
    }

    const result = await pixDiretoService.getPaymentModes(caixinhaId);
    return res.json({ success: true, data: result });
  } catch (err) {
    logError('getPaymentModes', err, { caixinhaId: req.params.caixinhaId });
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/payments/pix-direto/receipts/:caixinhaId
 * Query: { status?, limit?, offset? }
 */
async function listReceipts(req, res) {
  try {
    const { caixinhaId } = req.params;
    if (!caixinhaId) {
      return res.status(400).json({ success: false, error: 'caixinhaId é obrigatório.' });
    }

    const { error, value } = listFiltersSchema.validate(req.query);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }

    const adminId = req.user.uid;
    const receipts = await pixDiretoService.listReceiptsForAdmin(caixinhaId, adminId, value);

    return res.json({ success: true, data: receipts });
  } catch (err) {
    logError('listReceipts', err, { caixinhaId: req.params.caixinhaId, adminId: req.user?.uid });
    const status = err.message.includes('não é administrador') ? 403 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/payments/pix-direto/my-receipts/:caixinhaId
 */
async function getMyReceipts(req, res) {
  try {
    const { caixinhaId } = req.params;
    const contributorId = req.user.uid;

    const receipts = await pixDiretoService.getContributorReceipts(contributorId, caixinhaId);
    return res.json({ success: true, data: receipts });
  } catch (err) {
    logError('getMyReceipts', err, { caixinhaId: req.params.caixinhaId, userId: req.user?.uid });
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/payments/pix-direto/admin/register-cash
 * Body: { caixinhaId, memberId, amount, paymentDate?, notes? }
 */
async function registerCashPayment(req, res) {
  try {
    const { error, value } = cashPaymentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }

    const adminId = req.user.uid;
    const result = await pixDiretoService.registerCashPayment(adminId, value);

    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    logError('registerCashPayment', err, { userId: req.user?.uid });
    const status = err.message.includes('administrador') ? 403
      : err.message.includes('não é membro') || err.message.includes('não está ativo') ? 400
      : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
}

module.exports = {
  generatePixData,
  uploadReceipt: uploadReceiptCtrl,
  approveReceipt,
  rejectReceipt,
  getPaymentModes,
  listReceipts,
  getMyReceipts,
  registerCashPayment,
};
