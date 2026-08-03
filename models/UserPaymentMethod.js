// models/UserPaymentMethod.js — Supabase-first
// Dados sensíveis criptografados com AES-256-GCM via encryptionService (igual BankAccount.js).
const { getSupabaseClient } = require('../config/supabase');
const encryptionService = require('../services/encryptionService');
const { logger } = require('../logger');
const { randomUUID } = require('crypto');

const TABLE = 'user_payment_methods';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

class UserPaymentMethod {
  constructor(data) {
    this.id          = data.id         || null;
    this.userId      = data.userId     || data.user_id;

    this.bankName    = data.bankName   || data.bank_name  || null;
    this.bankCode    = data.bankCode   || data.bank_code  || null;
    this.lastDigits  = data.lastDigits || data.last_digits || null;
    this.isValidated = data.isValidated ?? data.is_validated ?? false;
    this.validatedAt = data.validatedAt || data.validated_at || null;
    this.createdAt   = data.createdAt  || data.created_at  || new Date();
    this.updatedAt   = data.updatedAt  || data.updated_at  || null;

    if (data.encrypted) {
      this.encrypted = data.encrypted;
    } else {
      this.accountNumber = data.accountNumber || null;
      this.accountHolder = data.accountHolder || null;
      this.accountType   = data.accountType   || null;
      this.pixKey        = data.pixKey         || null;
      this.pixKeyType    = data.pixKeyType     || null;
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
        dataType: 'user_payment_method',
        aad: `user_payment_method_${this.userId}`,
      });
      this.lastDigits = this.accountNumber ? this.accountNumber.slice(-4) : null;

      delete this.accountNumber;
      delete this.accountHolder;
      delete this.accountType;
      delete this.pixKey;
      delete this.pixKeyType;

      return {
        id:          this.id,
        userId:      this.userId,
        bankName:    this.bankName,
        bankCode:    this.bankCode,
        lastDigits:  this.lastDigits,
        isValidated: this.isValidated,
        validatedAt: this.validatedAt,
        encrypted:   this.encrypted,
      };
    } catch (error) {
      logger.error('Erro ao criptografar dados do método de pagamento', {
        service: 'UserPaymentMethod', method: 'prepareForStorage',
        userId: this.userId, error: error.message,
      });
      throw new Error('Falha ao criptografar dados do método de pagamento');
    }
  }

  async decrypt() {
    if (!this.encrypted) return this;
    try {
      const decrypted = await encryptionService.decrypt(this.encrypted, {
        dataType: 'user_payment_method',
        aad: `user_payment_method_${this.userId}`,
      });
      this.accountNumber = decrypted.accountNumber;
      this.accountHolder = decrypted.accountHolder;
      this.accountType   = decrypted.accountType;
      this.bankCode      = decrypted.bankCode;
      this.pixKey        = decrypted.pixKey;
      this.pixKeyType    = decrypted.pixKeyType;
      return this;
    } catch (error) {
      logger.error('Erro ao descriptografar método de pagamento', {
        service: 'UserPaymentMethod', method: 'decrypt',
        userId: this.userId, error: error.message,
      });
      throw new Error('Falha ao descriptografar dados do método de pagamento');
    }
  }

  static async create(userId, data) {
    if (!userId) throw new Error('userId é obrigatório.');

    const method = new UserPaymentMethod({ ...data, userId });
    await method.prepareForStorage();
    const id = randomUUID();

    const { error } = await sb()
      .from(TABLE)
      .insert({
        id,
        user_id:      userId,
        bank_name:    method.bankName   || null,
        bank_code:    method.bankCode   || null,
        last_digits:  method.lastDigits || null,
        encrypted:    method.encrypted  || null,
        is_validated: false,
      });

    if (error) throw error;

    method.id = id;
    logger.info('Método de pagamento criado', { service: 'UserPaymentMethod', userId, id });
    return method;
  }

  static async getByUser(userId) {
    if (!userId) throw new Error('userId é obrigatório.');

    const { data, error } = await sb()
      .from(TABLE)
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const methods = (data || []).map(row =>
      new UserPaymentMethod({ ...row, userId: row.user_id })
    );

    logger.info('Métodos de pagamento listados', { service: 'UserPaymentMethod', userId, total: methods.length });
    return methods;
  }

  static async getById(id, userId) {
    const { data, error } = await sb()
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Método de pagamento não encontrado.');

    return new UserPaymentMethod({ ...data, userId: data.user_id });
  }

  static async markValidated(id, userId, validationPaymentId = null) {
    const now = new Date().toISOString();
    const updates = { is_validated: true, validated_at: now, updated_at: now };
    if (validationPaymentId) updates.validation_payment_id = validationPaymentId;

    const { error } = await sb()
      .from(TABLE)
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;

    logger.info('Método de pagamento validado', { service: 'UserPaymentMethod', id, userId, validationPaymentId });
    return await this.getById(id, userId);
  }

  static async delete(id, userId) {
    const { error } = await sb()
      .from(TABLE)
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;

    logger.info('Método de pagamento excluído', { service: 'UserPaymentMethod', id, userId });
    return true;
  }
}

module.exports = UserPaymentMethod;
