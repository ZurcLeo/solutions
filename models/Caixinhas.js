const admin = require('firebase-admin');
const firestore = admin.firestore();

class Caixinha {
  constructor(data) {
    this.id = data.id;
    this.groupId = data.groupId;
    this.name = data.name;
    this.description = data.description;
    this.adminId = data.adminId;
    this.members = data.members || [];
    this.contribuicaoMensal = data.contribuicaoMensal || 0;
    this.saldoTotal = data.saldoTotal || 0;
    this.dataCriacao = data.dataCriacao ? new Date(data.dataCriacao.seconds * 1000) : new Date();
  }

  static async getById(id) {
    const doc = await firestore.collection('caixinhas').doc(id).get();
    if (!doc.exists) {
      throw new Error('Caixinha não encontrada.');
    }
    return new Caixinha(doc.data());
  }

  static async create(data) {
    const caixinha = new Caixinha(data);
    const docRef = await firestore.collection('caixinhas').add({ ...caixinha });
    caixinha.id = docRef.id;
    return caixinha;
  }

  static async update(id, data) {
    const caixinhaRef = firestore.collection('caixinhas').doc(id);
    await caixinhaRef.update(data);
    const updatedDoc = await caixinhaRef.get();
    return new Caixinha(updatedDoc.data());
  }

  static async delete(id) {
    const caixinhaRef = firestore.collection('caixinhas').doc(id);
    await caixinhaRef.delete();
  }
}

module.exports = Caixinha;