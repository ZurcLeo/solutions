// models/BankAccount.js — Supabase-first (migrado de Firestore em 2026-05-19)
// Dados sensíveis continuam criptografados pelo encryptionService (AES-256-GCM).
const { getSupabaseClient } = require('../config/supabase');
const { getFirestore } = require('../firebaseAdmin');
const encryptionService = require('../services/encryptionService');
const { logger } = require('../logger');
const { randomUUID } = require('crypto');

const TABLE = 'bank_accounts';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

function cleanData(data) {
  return Object.fromEntries(Object.entries(data).filter(([_, value]) => value !== undefined));
}

class BankAccount {
  constructor(data) {
    this.id         = data.id        || null;
    this.adminId    = data.adminId   || data.admin_id;
    this.caixinhaId = data.caixinhaId || data.caixinha_id;

    // Public fields (not encrypted)
    this.bankName   = data.bankName  || data.bank_name;
    this.isActive   = data.isActive  ?? data.is_active ?? false;
    this.createdAt  = data.createdAt
      ? (data.createdAt.seconds ? new Date(data.createdAt.seconds * 1000) : new Date(data.createdAt))
      : new Date();
    this.updatedAt  = data.updatedAt
      ? (data.updatedAt.seconds ? new Date(data.updatedAt.seconds * 1000) : new Date(data.updatedAt))
      : null;

    // Secure fields
    if (data.encrypted) {
      this.encrypted  = data.encrypted;
      this.lastDigits = data.lastDigits || data.last_digits || null;
    } else {
      this.accountNumber  = data.accountNumber;
      this.accountHolder  = data.accountHolder;
      this.accountType    = data.accountType;
      this.bankCode       = data.bankCode;
      this.pixKey         = data.pixKey         || null;
      this.pixKeyType     = data.pixKeyType      || null;
    }
  }

  async prepareForStorage() {
    try {
      const sensitiveData = {
        accountNumber: this.accountNumber,
        accountHolder: this.accountHolder,
        accountType:   this.accountType,
        bankCode:      this.bankCode,
        pixKey:        this.pixKey,
        pixKeyType:    this.pixKeyType,
      };

      this.encrypted  = await encryptionService.encrypt(sensitiveData, {
        dataType: 'bank_account',
        aad: `bank_account_${this.adminId}_${this.caixinhaId}`,
      });
      this.lastDigits = this.accountNumber ? this.accountNumber.slice(-4) : null;

      delete this.accountNumber;
      delete this.accountHolder;
      delete this.accountType;
      delete this.bankCode;
      delete this.pixKey;
      delete this.pixKeyType;

      return {
        id:          this.id,
        adminId:     this.adminId,
        caixinhaId:  this.caixinhaId,
        bankName:    this.bankName,
        isActive:    this.isActive,
        encrypted:   this.encrypted,
        lastDigits:  this.lastDigits,
        createdAt:   this.createdAt,
        updatedAt:   this.updatedAt,
      };
    } catch (error) {
      logger.error('Erro ao criptografar dados bancários', {
        service: 'BankAccount', method: 'prepareForStorage',
        adminId: this.adminId, caixinhaId: this.caixinhaId, error: error.message,
      });
      throw new Error('Falha ao criptografar dados bancários');
    }
  }

  async decrypt() {
    if (!this.encrypted) return this;
    try {
      const decrypted = await encryptionService.decrypt(this.encrypted, {
        dataType: 'bank_account',
        aad: `bank_account_${this.adminId}_${this.caixinhaId}`,
      });
      this.accountNumber = decrypted.accountNumber;
      this.accountHolder = decrypted.accountHolder;
      this.accountType   = decrypted.accountType;
      this.bankCode      = decrypted.bankCode;
      this.pixKey        = decrypted.pixKey;
      this.pixKeyType    = decrypted.pixKeyType;
      return this;
    } catch (error) {
      logger.error('Erro ao descriptografar dados bancários', {
        service: 'BankAccount', method: 'decrypt',
        adminId: this.adminId, caixinhaId: this.caixinhaId, error: error.message,
      });
      throw new Error('Falha ao descriptografar dados bancários');
    }
  }

  // ── Leitura ──────────────────────────────────────────────────────────────────

  static async find(adminId, query = {}) {
    logger.info('Buscando contas bancárias', { service: 'BankAccount', method: 'find', adminId, query });
    if (!adminId) throw new Error('adminId é obrigatório para buscar contas bancárias.');

    let req = sb().from(TABLE).select('*').eq('admin_id', adminId);
    if (query.caixinhaId)    req = req.eq('caixinha_id', query.caixinhaId);
    if (query.lastDigits)    req = req.eq('last_digits', query.lastDigits);
    if (query.isActive !== undefined) req = req.eq('is_active', query.isActive);

    const { data, error } = await req;
    if (error) throw error;

    const accounts = [];
    for (const row of (data || [])) {
      const account = new BankAccount({ ...row, adminId: row.admin_id, caixinhaId: row.caixinha_id });
      if (query.includeDecrypted === true) await account.decrypt();
      accounts.push(account);
    }

    logger.info('Contas bancárias encontradas', { service: 'BankAccount', adminId, total: accounts.length });
    return accounts;
  }

  static async getById(adminId, id, options = {}) {
    const { data, error } = await sb()
      .from(TABLE).select('*')
      .eq('id', id).eq('admin_id', adminId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Conta bancária não encontrada.');

    const account = new BankAccount({ ...data, adminId: data.admin_id, caixinhaId: data.caixinha_id });
    const shouldDecrypt = options.decrypt !== false;
    if (shouldDecrypt) await account.decrypt();

    logger.info('Conta bancária encontrada', { service: 'BankAccount', method: 'getById', adminId, accountId: id });
    return account;
  }

  static async getAllByAdmin(adminId, options = {}) {
    const { data, error } = await sb().from(TABLE).select('*').eq('admin_id', adminId);
    if (error) throw error;

    const accounts = [];
    for (const row of (data || [])) {
      const account = new BankAccount({ ...row, adminId: row.admin_id, caixinhaId: row.caixinha_id });
      const shouldDecrypt = options.decrypt !== false;
      if (shouldDecrypt) await account.decrypt();
      accounts.push(account);
    }

    logger.info('Listagem de contas bancárias por admin', { service: 'BankAccount', adminId, count: accounts.length });
    return accounts;
  }

  // ── Escrita ──────────────────────────────────────────────────────────────────

  static async create(data) {
    const { adminId, caixinhaId } = data;
    if (!adminId || !caixinhaId) throw new Error('adminId e caixinhaId são obrigatórios.');

    const cleanAccountData = cleanData(data);
    const account          = new BankAccount(cleanAccountData);
    const storageData      = await account.prepareForStorage();
    const accountId        = randomUUID();

    const { data: created, error } = await sb()
      .from(TABLE)
      .insert({
        id:          accountId,
        admin_id:    adminId,
        caixinha_id: caixinhaId,
        bank_name:   storageData.bankName    || null,
        is_active:   storageData.isActive    || false,
        last_digits: storageData.lastDigits  || null,
        encrypted:   storageData.encrypted   || null,
      })
      .select()
      .single();

    if (error) throw error;

    account.id = accountId;

    // Atualizar caixinha.bank_account_active se isActive === true
    if (storageData.isActive) {
      await sb().from('caixinhas').update({ bank_account_active: true }).eq('id', caixinhaId);
    }

    // Backup Firestore fire-and-forget
    try {
      const path = `bankAccounts/${adminId}/accounts`;
      getFirestore().collection(path).doc(accountId).set({
        ...storageData, id: accountId,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }).catch(() => {});
    } catch (_) {}

    logger.info('Conta bancária criada', { service: 'BankAccount', adminId, caixinhaId, accountId });
    return account;
  }

  static async update(adminId, id, data) {
    const hasSensitiveFields = [
      'accountNumber', 'accountHolder', 'accountType', 'bankCode', 'pixKey', 'pixKeyType',
    ].some(field => data[field] !== undefined);

    let storageData;
    if (hasSensitiveFields) {
      const existingAccount = await this.getById(adminId, id, { decrypt: true });
      Object.assign(existingAccount, data);
      storageData = await existingAccount.prepareForStorage();
    } else {
      storageData = cleanData(data);
    }

    const row = {};
    if (storageData.bankName   !== undefined) row.bank_name   = storageData.bankName;
    if (storageData.isActive   !== undefined) row.is_active   = storageData.isActive;
    if (storageData.lastDigits !== undefined) row.last_digits = storageData.lastDigits;
    if (storageData.encrypted  !== undefined) row.encrypted   = storageData.encrypted;

    const { error } = await sb()
      .from(TABLE).update(row)
      .eq('id', id).eq('admin_id', adminId);

    if (error) throw error;

    // Backup Firestore fire-and-forget
    try {
      const path = `bankAccounts/${adminId}/accounts`;
      getFirestore().collection(path).doc(id)
        .update({ ...row, updatedAt: new Date().toISOString() }).catch(() => {});
    } catch (_) {}

    logger.info('Conta bancária atualizada', { service: 'BankAccount', method: 'update', adminId, accountId: id });
    return await this.getById(adminId, id);
  }

  static async delete(adminId, id) {
    // Lê antes de deletar para obter caixinhaId
    const { data: row } = await sb()
      .from(TABLE).select('caixinha_id').eq('id', id).eq('admin_id', adminId).maybeSingle();

    const { error } = await sb().from(TABLE).delete().eq('id', id).eq('admin_id', adminId);
    if (error) throw error;

    // Atualizar bank_account_active na caixinha se necessário
    if (row?.caixinha_id) {
      const { data: remaining } = await sb()
        .from(TABLE).select('id')
        .eq('caixinha_id', row.caixinha_id).eq('is_active', true).limit(1);
      if (!remaining?.length) {
        await sb().from('caixinhas').update({ bank_account_active: false }).eq('id', row.caixinha_id);
      }
    }

    // Backup Firestore fire-and-forget
    try {
      const path = `bankAccounts/${adminId}/accounts`;
      getFirestore().collection(path).doc(id).delete().catch(() => {});
    } catch (_) {}

    logger.info('Conta bancária excluída', { service: 'BankAccount', adminId, accountId: id });
    return true;
  }

  static async deactivateAll(adminId) {
    const { error } = await sb()
      .from(TABLE).update({ is_active: false })
      .eq('admin_id', adminId).eq('is_active', true);

    if (error) throw error;
    logger.info('Todas as contas desativadas', { service: 'BankAccount', adminId });
    return true;
  }

  static async activate(adminId, id) {
    await this.deactivateAll(adminId);
    const result = await this.update(adminId, id, { isActive: true });
    logger.info('Conta bancária ativada', { service: 'BankAccount', adminId, accountId: id });
    return result;
  }

  /** @deprecated — use via create() com dados não-criptografados */
  static async migrateToEncrypted(adminId) {
    logger.warn('migrateToEncrypted: operação legada (dados já migrados para Supabase)', {
      service: 'BankAccount', adminId,
    });
    return { migrated: 0, skipped: 0, failed: 0 };
  }

  /** @deprecated — não necessário com Supabase (sem subcoleção) */
  static getPath(adminId) {
    if (!adminId) throw new Error('adminId é obrigatório');
    return `bankAccounts/${adminId}/accounts`;
  }
}

module.exports = BankAccount;
