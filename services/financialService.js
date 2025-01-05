// services/financialService.js

const { getFirestore } = require('../firebaseAdmin');


class FinancialService {
    async processTransaction(transactionData) {
      const { userId, amount, type, description } = transactionData;
      
      try {
        // Iniciar transação no Firestore
        const db = getFirestore();
        const batch = db.batch();
  
        // Registrar transação
        const transactionRef = db.collection('transactions').doc();
        batch.set(transactionRef, {
          userId,
          amount,
          type,
          description,
          status: 'pending',
          createdAt: new Date()
        });
  
        // Atualizar saldo
        const walletRef = db.collection('wallets').doc(userId);
        const wallet = await walletRef.get();
        
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
        throw new Error(`Transaction failed: ${error.message}`);
      }
    }
  }

