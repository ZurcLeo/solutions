const {getFirestore} = require('../firebaseAdmin');

class Contribuicao {
  constructor(data) {
    this.id = data.id;
    this.caixinhaId = data.caixinhaId;
    this.userId = data.userId;
    this.contribuicao = data.contribuicao;
    this.dataContribuicao = data.dataContribuicao ? new Date(data.dataContribuicao.seconds * 1000) : new Date();
  }

  static async getById(caixinhaId, id) {
    const db = getFirestore();
    const doc = await db.collection('caixinhas').doc(caixinhaId).collection('contribuicoes').doc(id).get();
    if (!doc.exists) {
      throw new Error('Contribuição não encontrada.');
    }
    return new Contribuicao(doc.data());
  }

  static async create(data) {
    const db = getFirestore();
    const contribuicao = new Contribuicao(data);
    const docRef = await db.collection('caixinhas').doc(data.caixinhaId).collection('contribuicoes').add({ ...contribuicao });
    contribuicao.id = docRef.id;
    return contribuicao;
  }

  static async update(caixinhaId, id, data) {
    const db = getFirestore();
    const contribuicaoRef = db.collection('caixinhas').doc(caixinhaId).collection('contribuicoes').doc(id);
    await contribuicaoRef.update(data);
    const updatedDoc = await contribuicaoRef.get();
    return new Contribuicao(updatedDoc.data());
  }

  static async delete(caixinhaId, id) {
    const db = getFirestore();
    const contribuicaoRef = db.collection('caixinhas').doc(caixinhaId).collection('contribuicoes').doc(id);
    await contribuicaoRef.delete();
  }
}

module.exports = Contribuicao;