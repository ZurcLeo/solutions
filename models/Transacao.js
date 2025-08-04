const {getFirestore} = require('../firebaseAdmin');

const db = getFirestore();

class Transacao {
  constructor(data) {
    this.id = data.id;
    this.caixinhaId = data.caixinhaId;
    this.userId = data.userId;
    this.type = data.type; // 'contribuicao', 'emprestimo', 'bonus', etc.
    this.amount = data.amount;
    this.date = data.date ? new Date(data.date.seconds * 1000) : new Date();
  }

  static async getById(caixinhaId, id) {
    const doc = await db.collection('caixinhas').doc(caixinhaId).collection('transacoes').doc(id).get();
    if (!doc.exists) {
      throw new Error('Transação não encontrada.');
    }
    return new Transacao(doc.data());
  }

  static async create(data) {
    const transacao = new Transacao(data);
    const docRef = await db.collection('caixinhas').doc(data.caixinhaId).collection('transacoes').add({ ...transacao });
    transacao.id = docRef.id;
    return transacao;
  }

  static async update(caixinhaId, id, data) {
    const transacaoRef = db.collection('caixinhas').doc(caixinhaId).collection('transacoes').doc(id);
    await transacaoRef.update(data);
    const updatedDoc = await transacaoRef.get();
    return new Transacao(updatedDoc.data());
  }

  static async delete(caixinhaId, id) {
    const transacaoRef = db.collection('caixinhas').doc(caixinhaId).collection('transacoes').doc(id);
    await transacaoRef.delete();
  }

  static async getByUserId(userId, limit = 10) {
    try {
      // Query across all caixinhas for user transactions
      const caixinhasSnapshot = await db.collection('caixinhas').get();
      const transactions = [];
      
      for (const caixinhaDoc of caixinhasSnapshot.docs) {
        const transacoesSnapshot = await db.collection('caixinhas')
          .doc(caixinhaDoc.id)
          .collection('transacoes')
          .where('userId', '==', userId)
          .orderBy('date', 'desc')
          .limit(limit)
          .get();
        
        transacoesSnapshot.forEach(doc => {
          transactions.push(new Transacao({ id: doc.id, ...doc.data() }));
        });
      }
      
      return transactions
        .sort((a, b) => b.date - a.date)
        .slice(0, limit);
    } catch (error) {
      console.warn('Failed to get transactions by user ID:', error.message);
      return [];
    }
  }
}

module.exports = Transacao;