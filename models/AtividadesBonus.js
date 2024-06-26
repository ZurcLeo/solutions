const admin = require('firebase-admin');
const firestore = admin.firestore();

class AtividadesBonus {
  constructor(data) {
    this.id = data.id;
    this.caixinhaId = data.caixinhaId;
    this.descricao = data.descricao;
    this.valorArrecadado = data.valorArrecadado;
    this.dataAtividade = data.dataAtividade ? new Date(data.dataAtividade.seconds * 1000) : new Date();
  }

  static async getById(id) {
    const doc = await firestore.collection('atividadesBonus').doc(id).get();
    if (!doc.exists) {
      throw new Error('Atividade bônus não encontrada.');
    }
    return new AtividadesBonus(doc.data());
  }

  static async create(data) {
    const atividade = new AtividadesBonus(data);
    const docRef = await firestore.collection('atividadesBonus').add({ ...atividade });
    atividade.id = docRef.id;
    return atividade;
  }

  static async update(id, data) {
    const atividadeRef = firestore.collection('atividadesBonus').doc(id);
    await atividadeRef.update(data);
    const updatedDoc = await atividadeRef.get();
    return new AtividadesBonus(updatedDoc.data());
  }

  static async delete(id) {
    const atividadeRef = firestore.collection('atividadesBonus').doc(id);
    await atividadeRef.delete();
  }
}

module.exports = AtividadesBonus;