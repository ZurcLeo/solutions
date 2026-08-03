// models/Membro.js — Supabase-first (migrado de Firestore em 2026-05-19)
const { getSupabaseClient } = require('../config/supabase');
const Joi = require('joi');
const { logger } = require('../logger');
const { randomUUID } = require('crypto');

const VALID_ROLES = ['admin', 'gerente', 'membro', 'removed'];
const VALID_STATUSES = ['ativo', 'inativo', 'pendente'];

const createSchema = Joi.object({
  caixinhaId: Joi.string().required(),
  userId: Joi.string().required(),
  role: Joi.string().valid(...VALID_ROLES).default('membro'),
  status: Joi.string().valid(...VALID_STATUSES).default('ativo'),
  isAdmin: Joi.boolean().default(false),
  active: Joi.boolean().default(true),
}).unknown(true);

const updateSchema = Joi.object({
  role: Joi.string().valid(...VALID_ROLES).optional(),
  status: Joi.string().valid(...VALID_STATUSES).optional(),
  isAdmin: Joi.boolean().optional(),
  active: Joi.boolean().optional(),
}).unknown(true);

const TABLE = 'caixinha_members';
const SERVICE = 'membroModel';

function mapMembro(row) {
  if (!row) return null;
  // O row pode vir de um join: row.users.full_name
  const user = row.users || {};
  return {
    id:           row.id,
    caixinhaId:   row.caixinha_id,
    userId:       row.user_id,
    nome:         user.full_name  || row.nome || null,
    email:        user.email      || row.email || null,
    fotoDoPerfil: user.avatar_url || row.foto_do_perfil || null,
    isAdmin:      row.is_admin || false,
    active:       row.active !== false,
    role:         row.role || 'membro',
    status:       row.status || 'ativo',
    joinedAt:     row.joined_at || null,
  };
}

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

class Membro {
  constructor(data) {
    this.id = data.id;
    this.caixinhaId = data.caixinhaId;
    this.userId = data.userId;
    this.nome = data.nome;
    this.email = data.email;
    this.fotoDoPerfil = data.fotoDoPerfil;
    this.isAdmin = data.isAdmin || false;
    this.active = data.active !== false;
    this.role = data.role || 'membro';
    this.status = data.status || 'ativo';
    this.joinedAt = data.joinedAt;
  }

  static async getById(caixinhaId, membroId) {
    const { data, error } = await sb()
      .from(TABLE)
      .select('*, users(full_name, avatar_url, email)')
      .eq('id', membroId)
      .eq('caixinha_id', caixinhaId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Membro não encontrado.');
    return new Membro(mapMembro(data));
  }

  static async getAllByCaixinhaId(caixinhaId) {
    const { data, error } = await sb()
      .from(TABLE)
      .select('*, users(full_name, avatar_url, email)')
      .eq('caixinha_id', caixinhaId);

    if (error) throw error;
    return (data || []).map(row => new Membro(mapMembro(row)));
  }

  static async getByUserId(caixinhaId, userId) {
    const { data, error } = await sb()
      .from(TABLE)
      .select('*, users(full_name, avatar_url, email)')
      .eq('user_id', userId)
      .eq('caixinha_id', caixinhaId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    return new Membro(mapMembro(data));
  }

  static async create(data) {
    const { error: vErr } = createSchema.validate(data);
    if (vErr) throw new Error(vErr.details[0].message);

    logger.info('Criando membro', { service: SERVICE, caixinhaId: data.caixinhaId });

    const row = {
      id:           data.id || randomUUID(),
      caixinha_id:  data.caixinhaId,
      user_id:      data.userId,
      is_admin:     data.isAdmin || false,
      active:       data.active !== false,
      role:         data.role || 'membro',
      status:       data.status || 'ativo',
      joined_at:    data.joinedAt || new Date().toISOString(),
    };

    const { data: created, error } = await sb()
      .from(TABLE)
      .insert(row)
      .select()
      .single();

    if (error) throw error;

    const membro = new Membro(mapMembro(created));
    membro.memberId = created.id;
    return membro;
  }

  static async update(caixinhaId, memberId, data) {
    const { error: vErr } = updateSchema.validate(data);
    if (vErr) throw new Error(vErr.details[0].message);

    const row = {};
    if (data.isAdmin !== undefined)   row.is_admin = data.isAdmin;
    if (data.active !== undefined)    row.active = data.active;
    if (data.role !== undefined)      row.role = data.role;
    if (data.status !== undefined)    row.status = data.status;

    const { data: updated, error } = await sb()
      .from(TABLE)
      .update(row)
      .eq('id', memberId)
      .eq('caixinha_id', caixinhaId)
      .select()
      .single();

    if (error) throw error;

    return new Membro(mapMembro(updated));
  }

  static async delete(caixinhaId, memberId) {
    const { error } = await sb()
      .from(TABLE)
      .delete()
      .eq('id', memberId)
      .eq('caixinha_id', caixinhaId);

    if (error) throw error;
  }
}

module.exports = Membro;
