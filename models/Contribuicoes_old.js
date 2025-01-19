const admin = require('firebase-admin');
const firestore = admin.firestore();

class Contribuicoes {
  constructor(data) {
    this.id = data.id;
    this.caixinhaId = data.caixinhaId;
    this.userId = data.userId;
    this.valor = data.valor;
    this.dataContribuicao = data.dataContribuicao ? new Date(data.dataContribuicao.seconds * 1000) : new Date();
  }

  static async getById(id) {
    const doc = await firestore.collection('contribuicoes').doc(id).get();
    if (!doc.exists) {
      throw new Error('Contribuição não encontrada.');
    }
    return new Contribuicoes(doc.data());
  }

  static async create(data) {
    const contribuicao = new Contribuicoes(data);
    const docRef = await firestore.collection('contribuicoes').add({ ...contribuicao });
    contribuicao.id = docRef.id;
    return contribuicao;
  }

  static async update(id, data) {
    const contribuicaoRef = firestore.collection('contribuicoes').doc(id);
    await contribuicaoRef.update(data);
    const updatedDoc = await contribuicaoRef.get();
    return new Contribuicoes(updatedDoc.data());
  }

  static async delete(id) {
    const contribuicaoRef = firestore.collection('contribuicoes').doc(id);
    await contribuicaoRef.delete();
  }
}

module.exports = Contribuicoes;