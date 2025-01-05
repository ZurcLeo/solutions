const admin = require('firebase-admin');
const firestore = admin.firestore();

class AtividadeBonus {
  constructor(data) {
    this.id = data.id;
    this.caixinhaId = data.caixinhaId;
    this.description = data.description;
    this.valorArrecadado = data.valorArrecadado;
    this.dataAtividade = data.dataAtividade ? new Date(data.dataAtividade.seconds * 1000) : new Date();
  }

  static async getById(caixinhaId, id) {
    const doc = await firestore.collection('caixinhas').doc(caixinhaId).collection('atividadesBonus').doc(id).get();
    if (!doc.exists) {
      throw new Error('Atividade bônus não encontrada.');
    }
    return new AtividadeBonus(doc.data());
  }

  static async create(data) {
    const atividadeBonus = new AtividadeBonus(data);
    const docRef = await firestore.collection('caixinhas').doc(data.caixinhaId).collection('atividadesBonus').add({ ...atividadeBonus });
    atividadeBonus.id = docRef.id;
    return atividadeBonus;
  }

  static async update(caixinhaId, id, data) {
    const atividadeBonusRef = firestore.collection('caixinhas').doc(caixinhaId).collection('atividadesBonus').doc(id);
    await atividadeBonusRef.update(data);
    const updatedDoc = await atividadeBonusRef.get();
    return new AtividadeBonus(updatedDoc.data());
  }

  static async delete(caixinhaId, id) {
    const atividadeBonusRef = firestore.collection('caixinhas').doc(caixinhaId).collection('atividadesBonus').doc(id);
    await atividadeBonusRef.delete();
  }
}

module.exports = AtividadeBonus;