'use strict';

/**
 * Rotas de Contatos de Emergencia — CARONA-GAP-006
 *
 * Base: /api/emergency-contacts
 *
 *   GET    /api/emergency-contacts                  — listar meus contatos
 *   POST   /api/emergency-contacts                  — adicionar contato (max 3)
 *   PATCH  /api/emergency-contacts/:contactId       — atualizar contato
 *   DELETE /api/emergency-contacts/:contactId       — remover contato
 */

const express = require('express');
const router  = express.Router();
const verifyToken   = require('../middlewares/auth');
const { readLimit, writeLimit } = require('../middlewares/rateLimiter');
const { healthCheck } = require('../middlewares/healthMiddleware');
const ctrl = require('../controllers/emergencyContactController');

const ROUTE_NAME = 'emergencyContacts';
router.use(healthCheck(ROUTE_NAME));

router.get('/',              verifyToken, readLimit,  ctrl.getContacts);
router.post('/',             verifyToken, writeLimit, ctrl.addContact);
router.patch('/:contactId',  verifyToken, writeLimit, ctrl.updateContact);
router.delete('/:contactId', verifyToken, writeLimit, ctrl.deleteContact);

module.exports = router;
