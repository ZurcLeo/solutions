const { getFirestore } = require('../firebaseAdmin'); // Use getFirestore para inicialização lazy
const { logger } = require('../logger');

// models/Wallet.js
class Wallet {
    constructor(data) {
      this.userId = data.userId;
      this.balance = data.balance || 0;
      this.status = data.status || 'active';
      this.lastUpdated = data.lastUpdated || new Date();
    }
  
    static async updateBalance(userId, amount, type) {
      const db = getFirestore();
      const walletRef = db.collection('wallets').doc(userId);
      
      return await db.runTransaction(async (transaction) => {
        const wallet = await transaction.get(walletRef);
        const newBalance = type === 'credit' 
          ? wallet.data().balance + amount 
          : wallet.data().balance - amount;
  
        if (newBalance < 0) throw new Error('Insufficient funds');
        
        transaction.update(walletRef, { balance: newBalance });
        return newBalance;
      });
    }
  }

  module.exports = Wallet;