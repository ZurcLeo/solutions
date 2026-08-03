'use strict';

/**
 * @fileoverview emergencyContactService — CARONA-GAP-006
 * CRUD de contatos de emergencia do usuario.
 * Maximo 3 contatos, apenas 1 primario por usuario.
 * Usado pelo botao SOS durante viagens de carona.
 */

const { createClient } = require('@supabase/supabase-js');
const { logger }       = require('../logger');

const SERVICE = 'emergencyContactService';
const MAX_CONTACTS = 3;

// ─── Supabase service-role client ────────────────────────────
let _sbService = null;
function sbService() {
  if (!_sbService) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados.');
    _sbService = createClient(url, key, { auth: { persistSession: false } });
  }
  return _sbService;
}

// ─── Logging helpers ─────────────────────────────────────────
function log(fn, msg, extra = {}) {
  logger.info(msg, { service: SERVICE, function: fn, ...extra });
}

function logWarn(fn, msg, extra = {}) {
  logger.warn(msg, { service: SERVICE, function: fn, ...extra });
}

function logError(fn, err, extra = {}) {
  logger.error(`Erro em ${fn}: ${err.message || err}`, {
    service: SERVICE, function: fn, error: err.message || err, ...extra,
  });
}

// ─── CRUD ────────────────────────────────────────────────────

/**
 * Lista todos os contatos de emergencia do usuario.
 * Primario primeiro, depois por created_at.
 */
async function getContacts(userId) {
  const fn = 'getContacts';
  const { data, error } = await sbService()
    .from('user_emergency_contacts')
    .select('*')
    .eq('user_id', userId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) {
    logError(fn, error, { userId });
    throw error;
  }
  return data || [];
}

/**
 * Adiciona um contato de emergencia.
 * Maximo 3 por usuario. Se isPrimary=true, desmarca outros.
 */
async function addContact(userId, { name, phone, relationship, isPrimary = false }) {
  const fn = 'addContact';

  // Max 3 contacts check
  const existing = await getContacts(userId);
  if (existing.length >= MAX_CONTACTS) {
    throw Object.assign(
      new Error(`Maximo de ${MAX_CONTACTS} contatos de emergencia.`),
      { status: 400 },
    );
  }

  // If setting as primary, unset any existing primary
  if (isPrimary && existing.some(c => c.is_primary)) {
    const { error: unsetErr } = await sbService()
      .from('user_emergency_contacts')
      .update({ is_primary: false })
      .eq('user_id', userId)
      .eq('is_primary', true);
    if (unsetErr) logWarn(fn, `Falha ao desmarcar primario anterior: ${unsetErr.message}`);
  }

  const { data, error } = await sbService()
    .from('user_emergency_contacts')
    .insert({
      user_id: userId,
      name,
      phone,
      relationship: relationship || null,
      is_primary: isPrimary,
    })
    .select()
    .single();

  if (error) {
    logError(fn, error, { userId });
    throw error;
  }

  log(fn, 'Contato de emergencia adicionado', { userId, contactId: data.id });
  return data;
}

/**
 * Atualiza um contato de emergencia.
 * Apenas campos permitidos. Se is_primary=true, desmarca outros.
 */
async function updateContact(userId, contactId, updates) {
  const fn = 'updateContact';

  // Filter allowed fields
  const allowed = ['name', 'phone', 'relationship', 'is_primary'];
  const filtered = Object.fromEntries(
    Object.entries(updates).filter(([k]) => allowed.includes(k)),
  );
  filtered.updated_at = new Date().toISOString();

  // If setting as primary, unset others
  if (filtered.is_primary) {
    const { error: unsetErr } = await sbService()
      .from('user_emergency_contacts')
      .update({ is_primary: false })
      .eq('user_id', userId)
      .eq('is_primary', true);
    if (unsetErr) logWarn(fn, `Falha ao desmarcar primario anterior: ${unsetErr.message}`);
  }

  const { data, error } = await sbService()
    .from('user_emergency_contacts')
    .update(filtered)
    .eq('id', contactId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    logError(fn, error, { userId, contactId });
    throw error;
  }
  if (!data) {
    throw Object.assign(new Error('Contato nao encontrado.'), { status: 404 });
  }

  log(fn, 'Contato de emergencia atualizado', { userId, contactId });
  return data;
}

/**
 * Remove um contato de emergencia.
 */
async function deleteContact(userId, contactId) {
  const fn = 'deleteContact';

  const { error } = await sbService()
    .from('user_emergency_contacts')
    .delete()
    .eq('id', contactId)
    .eq('user_id', userId);

  if (error) {
    logError(fn, error, { userId, contactId });
    throw error;
  }

  log(fn, 'Contato de emergencia removido', { userId, contactId });
  return { deleted: true };
}

module.exports = {
  getContacts,
  addContact,
  updateContact,
  deleteContact,
};
