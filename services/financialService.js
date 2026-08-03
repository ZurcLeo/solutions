// services/financialService.js
const { logger } = require('../logger');
const { getSupabaseClient } = require('../config/supabase');

// Firestore como backup fire-and-forget durante a transição
const { getFirestore } = require('../firebaseAdmin');

const sb = () => getSupabaseClient();

class FinancialService {
  async processTransaction(transactionData) {
    const { userId, amount, type, description } = transactionData;

    try {
      const supabase = sb();

      if (supabase) {
        // 1. Verificar/debitar saldo via RPC atômica
        if (type === 'debit') {
          const { error: debitErr } = await supabase.rpc('debit_wallet', {
            p_user_id: userId,
            p_amount:  amount
          });
          if (debitErr) throw new Error(`Insufficient funds or wallet error: ${debitErr.message}`);
        } else {
          const { error: creditErr } = await supabase.rpc('credit_wallet', {
            p_user_id: userId,
            p_amount:  amount
          });
          if (creditErr) throw new Error(`Credit failed: ${creditErr.message}`);
        }

        // 2. Registrar transação
        await supabase.from('elo_coin_transactions').insert({
          user_id:     userId,
          amount:      type === 'credit' ? amount : -amount,
          type,
          description,
          status:      'completed'
        });

        // 3. Ler novo saldo
        const { data: wallet } = await supabase
          .from('wallets')
          .select('balance')
          .eq('user_id', userId)
          .single();

        const newBalance = wallet?.balance ?? 0;

        // Backup Firestore fire-and-forget
        try {
          const db = getFirestore();
          const batch = db.batch();
          const { FieldValue } = require('../firebaseAdmin');
          const transactionRef = db.collection('transactions').doc();
          batch.set(transactionRef, { userId, amount, type, description, status: 'completed', createdAt: new Date() });
          const walletRef = db.collection('wallets').doc(userId);
          batch.update(walletRef, { balance: newBalance });
          batch.commit().catch(() => {});
        } catch (_) {}

        return { success: true, balance: newBalance };
      }

      // ─── Fallback Firestore (sem Supabase disponível) ─────────────────────
      const db = getFirestore();
      const batch = db.batch();

      const transactionRef = db.collection('transactions').doc();
      batch.set(transactionRef, {
        userId, amount, type, description, status: 'pending', createdAt: new Date()
      });

      const walletRef = db.collection('wallets').doc(userId);
      const wallet    = await walletRef.get();

      if (type === 'debit' && wallet.data().balance < amount) {
        throw new Error('Insufficient funds');
      }

      const newBalance = type === 'credit'
        ? wallet.data().balance + amount
        : wallet.data().balance - amount;

      batch.update(walletRef, { balance: newBalance });
      await batch.commit();

      return { success: true, balance: newBalance };
    } catch (error) {
      logger.error('financialService.processTransaction error', {
        service: 'financialService', userId, amount, type, error: error.message
      });
      throw new Error(`Transaction failed: ${error.message}`);
    }
  }
}

module.exports = new FinancialService();
