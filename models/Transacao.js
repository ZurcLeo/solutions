const admin = require('firebase-admin');
const firestore = admin.firestore();

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
    const doc = await firestore.collection('caixinhas').doc(caixinhaId).collection('transacoes').doc(id).get();
    if (!doc.exists) {
      throw new Error('Transação não encontrada.');
    }
    return new Transacao(doc.data());
  }

  static async create(data) {
    const transacao = new Transacao(data);
    const docRef = await firestore.collection('caixinhas').doc(data.caixinhaId).collection('transacoes').add({ ...transacao });
    transacao.id = docRef.id;
    return transacao;
  }

  static async update(caixinhaId, id, data) {
    const transacaoRef = firestore.collection('caixinhas').doc(caixinhaId).collection('transacoes').doc(id);
    await transacaoRef.update(data);
    const updatedDoc = await transacaoRef.get();
    return new Transacao(updatedDoc.data());
  }

  static async delete(caixinhaId, id) {
    const transacaoRef = firestore.collection('caixinhas').doc(caixinhaId).collection('transacoes').doc(id);
    await transacaoRef.delete();
  }
}

module.exports = Transacao;