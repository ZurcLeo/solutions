// models/Wallet.js — Supabase-first (migrado de Firestore em 2026-05-19)
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const TABLE = 'wallets';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

class Wallet {
  constructor(data) {
    this.userId      = data.userId || data.user_id;
    this.balance     = data.balance ?? 0;
    this.status      = data.status || 'active';
    this.lastUpdated = data.lastUpdated || data.updated_at || new Date();
  }

  static async findByUserId(userId) {
    const { data, error } = await sb()
      .from(TABLE)
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    return new Wallet({ ...data, userId });
  }

  static async updateBalance(userId, amount, type) {
    // Garante que wallet existe (cria com saldo 0 se necessário)
    await sb()
      .from(TABLE)
      .upsert({ user_id: userId, balance: 0 }, { onConflict: 'user_id', ignoreDuplicates: true });

    const { data: current, error: readErr } = await sb()
      .from(TABLE)
      .select('balance')
      .eq('user_id', userId)
      .single();

    if (readErr) throw readErr;

    const newBalance = type === 'credit'
      ? (current.balance || 0) + amount
      : (current.balance || 0) - amount;

    if (newBalance < 0) throw new Error('Insufficient funds');

    const { error: writeErr } = await sb()
      .from(TABLE)
      .update({ balance: newBalance })
      .eq('user_id', userId);

    if (writeErr) throw writeErr;

    logger.info('Saldo de wallet atualizado', { service: 'walletModel', userId, newBalance, type });
    return newBalance;
  }
}

module.exports = Wallet;
