/**
 * @fileoverview Channel Links — rotas user-facing
 *
 * GET  /api/channel-links/preview?t=    (público, sem auth)
 * POST /api/channel-links/confirm       (verifyToken)
 * GET  /api/channel-links/mine          (verifyToken)
 * DELETE /api/channel-links/mine        (verifyToken)
 */

'use strict';

const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/auth');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const channelLinkCtrl = require('../controllers/channelLinkController');

// Middleware opcional: tenta extrair user de sessão sem 401 se ausente
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }
  // Tenta verificar; se falhar, segue sem user
  try {
    await new Promise((resolve, reject) => {
      verifyToken(req, { status: () => ({ json: reject }) }, resolve);
    });
  } catch {
    // Token inválido — segue sem user
  }
  next();
};

// Preview: público (token é o segredo), com auth opcional para hasExistingLink
router.get('/preview', optionalAuth, readLimit, channelLinkCtrl.preview);

// Confirm/Mine/Revoke: session required
router.post('/confirm', verifyToken, writeLimit, channelLinkCtrl.confirm);
router.get('/mine', verifyToken, readLimit, channelLinkCtrl.getMyLink);
router.delete('/mine', verifyToken, writeLimit, channelLinkCtrl.revoke);

module.exports = router;
