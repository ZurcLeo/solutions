const admin = require('firebase-admin');
const firestore = admin.firestore();

class Membro {
  constructor(data) {
    this.id = data.id;
    this.caixinhaId = data.caixinhaId;
    this.userId = data.userId;
    this.role = data.role || 'membro';
  }

  static async getById(caixinhaId, id) {
    const doc = await firestore.collection('caixinhas').doc(caixinhaId).collection('membros').doc(id).get();
    if (!doc.exists) {
      throw new Error('Membro não encontrado.');
    }
    return new Membro(doc.data());
  }

  static async create(data) {
    const membro = new Membro(data);
    const docRef = await firestore.collection('caixinhas').doc(data.caixinhaId).collection('membros').add({ ...membro });
    membro.id = docRef.id;
    return membro;
  }

  static async update(caixinhaId, id, data) {
    const membroRef = firestore.collection('caixinhas').doc(caixinhaId).collection('membros').doc(id);
    await membroRef.update(data);
    const updatedDoc = await membroRef.get();
    return new Membro(updatedDoc.data());
  }

  static async delete(caixinhaId, id) {
    const membroRef = firestore.collection('caixinhas').doc(caixinhaId).collection('membros').doc(id);
    await membroRef.delete();
  }
}

module.exports = Membro;