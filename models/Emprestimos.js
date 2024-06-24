const admin = require('firebase-admin');
const firestore = admin.firestore();

class Emprestimos {
  constructor(data) {
    this.id = data.id;
    this.caixinhaId = data.caixinhaId;
    this.userId = data.userId;
    this.valorSolicitado = data.valorSolicitado;
    this.dataSolicitacao = data.dataSolicitacao ? new Date(data.dataSolicitacao.seconds * 1000) : new Date();
    this.status = data.status || 'pendente';
    this.votos = data.votos || {};
  }

  static async getById(id) {
    const doc = await firestore.collection('emprestimos').doc(id).get();
    if (!doc.exists) {
      throw new Error('Empréstimo não encontrado.');
    }
    return new Emprestimos(doc.data());
  }

  static async create(data) {
    const emprestimo = new Emprestimos(data);
    const docRef = await firestore.collection('emprestimos').add({ ...emprestimo });
    emprestimo.id = docRef.id;
    return emprestimo;
  }

  static async update(id, data) {
    const emprestimoRef = firestore.collection('emprestimos').doc(id);
    await emprestimoRef.update(data);
    const updatedDoc = await emprestimoRef.get();
    return new Emprestimos(updatedDoc.data());
  }

  static async delete(id) {
    const emprestimoRef = firestore.collection('emprestimos').doc(id);
    await emprestimoRef.delete();
  }
}

module.exports = Emprestimos;