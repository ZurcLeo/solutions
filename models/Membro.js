const {getFirestore} = require('../firebaseAdmin');
const {logger} = require('../logger')
const db = getFirestore();

class Membro {
  constructor(data) {
    this.id = data.id;
    this.caixinhaId = data.caixinhaId;
    this.nome = data.nome;
    this.userId = data.userId;
    this.active = data.active;
    this.email = data.email;
    this.fotoDoPerfil = data.fotoDoPerfil;
    this.isAdmin = data.isAdmin;
    this.joinedAt = data.joinedAt;
    this.role = data.role || 'membro';
  }

  static async getById(caixinhaId, membroId) {
    const doc = await db.collection('caixinhas').doc(caixinhaId)
      .collection('membros').doc(membroId).get();
    
    if (!doc.exists) {
      throw new Error('Membro não encontrado.');
    }
    
    return new Membro(doc.data());
  }

  static async getAllByCaixinhaId(caixinhaId) {
    const snapshot = await db.collection('caixinhas').doc(caixinhaId)
      .collection('membros').get();
      
    return snapshot.docs.map(doc => {
      const data = doc.data();
      data.id = doc.id;
      return new Membro(data);
    });
  }

  static async create(data) {
    logger.info('escrevendo dados da cxnh: ', data)
    const membro = new Membro(data);
    const docRef = await db.collection('caixinhas').doc(data.caixinhaId).collection('membros').add({ ...membro });
    membro.memberId = docRef.id;
    return membro;
  }

  static async update(caixinhaId, memberId, data) {
    const membroRef = db.collection('caixinhas').doc(caixinhaId).collection('membros').doc(memberId);
    await membroRef.update(data);
    const updatedDoc = await membroRef.get();
    return new Membro(updatedDoc.data());
  }

  static async delete(caixinhaId, memberId) {
    const membroRef = db.collection('caixinhas').doc(caixinhaId).collection('membros').doc(memberId);
    await membroRef.delete();
  }
}

module.exports = Membro;