'use strict';

/**
 * @fileoverview emergencyContactController — CARONA-GAP-006
 * CRUD de contatos de emergencia do usuario.
 */

const emergencyContactService = require('../services/emergencyContactService');
const { logger } = require('../logger');

const CTRL = 'emergencyContactController';

exports.getContacts = async (req, res) => {
  try {
    const contacts = await emergencyContactService.getContacts(req.user.uid);
    res.status(200).json({ success: true, data: contacts });
  } catch (err) {
    logger.error(`[${CTRL}] getContacts: ${err.message}`, { userId: req.user?.uid });
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.addContact = async (req, res) => {
  try {
    const { name, phone, relationship, isPrimary } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'Nome e telefone sao obrigatorios.' });
    }
    const contact = await emergencyContactService.addContact(req.user.uid, {
      name, phone, relationship, isPrimary,
    });
    res.status(201).json({ success: true, data: contact });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    logger.error(`[${CTRL}] addContact: ${err.message}`, { userId: req.user?.uid });
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateContact = async (req, res) => {
  try {
    const contact = await emergencyContactService.updateContact(
      req.user.uid, req.params.contactId, req.body,
    );
    res.status(200).json({ success: true, data: contact });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    logger.error(`[${CTRL}] updateContact: ${err.message}`, { userId: req.user?.uid });
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.deleteContact = async (req, res) => {
  try {
    await emergencyContactService.deleteContact(req.user.uid, req.params.contactId);
    res.status(204).end();
  } catch (err) {
    logger.error(`[${CTRL}] deleteContact: ${err.message}`, { userId: req.user?.uid });
    res.status(500).json({ success: false, message: err.message });
  }
};
